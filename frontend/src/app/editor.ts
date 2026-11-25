import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, inject, OnDestroy, computed, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SoftloadApi, Example, NicheOption, Option } from './api';
import { INITIAL_EDITOR_FIELDS, fieldsFromExample, restoreEditorFields, type EditorFields } from './editor-state';

type PreviewDevice = 'desktop' | 'tablet' | 'mobile';
interface Preview { render(value: Record<string, unknown>): void; setDevice(device: PreviewDevice): void; destroy(): void; }
interface PreviewGlobal { mount(frame: HTMLIFrameElement, stage: HTMLElement): Preview; }
const steps = [
  { id: 'modelo', label: 'Modelo' },
  { id: 'identidade', label: 'Identidade' },
  { id: 'layout', label: 'Layout' },
  { id: 'revisao', label: 'Revisão' },
] as const;
type EditorStep = (typeof steps)[number]['id'];

const layoutOptions = [
  { id: 'revista', label: 'Revista · 3 colunas' },
  { id: 'dupla', label: 'Duas colunas' },
  { id: 'lista', label: 'Lista' },
  { id: 'quadrado', label: 'Mosaico' },
  { id: 'mural', label: 'Mural compacto' },
  { id: 'coluna-unica', label: 'Uma coluna' },
  { id: 'zigzag', label: 'Zigue-zague' },
];

const sidebarOptions = [
  { id: 'right', label: 'Direita' },
  { id: 'left', label: 'Esquerda' },
  { id: 'none', label: 'Sem barra lateral' },
];

@Component({
  standalone: true,
  selector: 'sl-editor',
  imports: [FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './editor.html',
  styleUrl: './editor.css',
})
export class EditorPage implements AfterViewInit, OnDestroy {
  readonly api = inject(SoftloadApi);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly steps = steps;
  readonly layoutOptions = layoutOptions;
  readonly sidebarOptions = sidebarOptions;
  readonly step = signal<EditorStep>('modelo');
  readonly stepIndex = computed(() => steps.findIndex(step => step.id === this.step()));
  readonly previewOnly = signal(false);
  readonly draftMessage = signal('');
  readonly fieldError = signal('');
  readonly palette = computed(() => this.api.data()?.cores.find(color => color.id === this.fields().colorPreset));
  readonly font = computed(() => this.api.data()?.fontes.find(font => font.id === this.fields().typography));
  private frame?: ElementRef<HTMLIFrameElement>;
  private stage?: ElementRef<HTMLElement>;
  // A prévia existe somente após o bootstrap; os setters evitam corrida com @if.
  @ViewChild('frame') set frameElement(value: ElementRef<HTMLIFrameElement> | undefined) {
    this.frame=value;
    this.mountPreview();
  }
  @ViewChild('stage') set stageElement(value: ElementRef<HTMLElement> | undefined) {
    this.stage=value;
    this.mountPreview();
  }
  readonly fields=signal<EditorFields>({...INITIAL_EDITOR_FIELDS});
  readonly previewDevices = [
    { id:'desktop', label:'Computador' }, { id:'tablet', label:'Tablet' }, { id:'mobile', label:'Celular' }
  ] as const;
  readonly device = signal<PreviewDevice>(
    window.matchMedia('(max-width: 600px)').matches ? 'mobile' :
      window.matchMedia('(max-width: 835px)').matches ? 'tablet' : 'desktop'
  );
  readonly category=signal('Todos'); readonly selected=signal('');
  readonly activeNiche=computed<NicheOption | undefined>(() => {
    const fields=this.fields();
    return fields.modo==='modelo' ? this.api.data()?.nichos.find(niche=>niche.id===fields.nichoTema) : undefined;
  });
  readonly categories = computed(() => [...new Set((this.api.data()?.exemplos || []).map(example => example.categoria || 'Outros'))]);
  readonly matchingExamples = computed(() => (this.api.data()?.exemplos || []).filter(example =>
    this.category() === 'Todos' || this.category() === (example.categoria || 'Outros')));
  readonly showAllExamples = signal(false);
  readonly exampleLimit = 6;
  readonly visibleExamples = computed(() => this.showAllExamples()
    ? this.matchingExamples() : this.matchingExamples().slice(0, this.exampleLimit));
  readonly message=signal('O XML é validado antes do download.'); readonly busy=signal(false);readonly failed=signal(false);
  readonly downloadUrl=signal('');readonly downloadName=signal('template-blogger.xml');
  private preview?: Preview;
  constructor() {
    void this.api.bootstrap().then(boot => {
      if (!this.fields().nichoTema) this.fields.update(fields=>({...fields,nichoTema:boot.nichos[0]?.id || ''}));
      const modelId = this.route.snapshot.queryParamMap.get('modelo');
      const model = boot.exemplos.find(example => example.id === modelId);
      if (model) {
        this.selectExample(model);
        this.step.set('identidade');
      } else {
        this.restore(boot);
      }
      this.updatePreview();
    }).catch(() => {});
  }
  ngAfterViewInit(): void { this.mountPreview(); }
  ngOnDestroy(): void {
    this.preview?.destroy();
    if (this.downloadUrl()) URL.revokeObjectURL(this.downloadUrl());
  }
  exampleColor(example: Example, colors: Option[]): string {
    return colors.find(color => color.id === example.colorPreset)?.hex || '#4933d5';
  }

  filterExamples(category: string): void {
    this.category.set(category);
    this.showAllExamples.set(false);
  }

  private validateName(): boolean {
    const name = this.fields().siteName.trim();
    return name.length >= 2 && name.length <= 60;
  }

  goToStep(next: EditorStep): void {
    if (this.busy()) return;
    const needsName = next === 'layout' || next === 'revisao';
    const invalidName = needsName && !this.validateName();
    const target = invalidName ? 'identidade' : next;
    this.step.set(target);
    this.previewOnly.set(false);
    this.fieldError.set(invalidName ? 'Informe um nome com 2 a 60 caracteres.' : '');
    requestAnimationFrame(() => {
      const selector = invalidName ? '#siteName' : '#step-title';
      this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
    });
  }

  back(): void {
    const previous = steps[this.stepIndex() - 1];
    if (previous) this.goToStep(previous.id);
  }

  submitStep(): void {
    const next = steps[this.stepIndex() + 1];
    if (next) this.goToStep(next.id);
    else void this.download();
  }

  showPreview(visible: boolean): void {
    this.previewOnly.set(visible);
    requestAnimationFrame(() => {
      const selector = visible ? '#preview-title' : '#step-title';
      this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus();
    });
  }

  layoutName(): string {
    if (this.activeNiche()?.gridConfigurable === false) return 'Estrutura do modelo';
    return layoutOptions.find(option => option.id === this.fields().gridLayout)?.label || '';
  }

  sidebarName(): string {
    if (this.activeNiche()?.sidebarConfigurable === false) return 'Estrutura do modelo';
    return sidebarOptions.find(option => option.id === this.fields().sidebarPosition)?.label || '';
  }
  private mountPreview(): void {
    const api=(window as Window & {SoftloadBloggerPreview?:PreviewGlobal}).SoftloadBloggerPreview;
    if (!api || !this.frame || !this.stage || this.preview) return;
    this.preview=api.mount(this.frame.nativeElement,this.stage.nativeElement);
    this.preview.setDevice(this.device());
    this.updatePreview();
  }
  // Centralize updates so OnPush form, gallery and XML always agree.
  changeField<K extends keyof EditorFields>(key:K,value:EditorFields[K]):void {
    if(this.busy()||this.fields()[key]===value)return;
    this.fields.update(fields=>({...fields,[key]:value}));
    this.selected.set('');
    this.draftMessage.set('');
    if (key === 'siteName') this.fieldError.set('');
    this.failed.set(false);
    if(this.invalidateXml())this.message.set('Você alterou o template. Gere um novo XML para essas escolhas.');
    this.updatePreview();
  }
  private invalidateXml():boolean {
    const previous=this.downloadUrl();
    if(!previous)return false;
    URL.revokeObjectURL(previous);
    this.downloadUrl.set('');
    this.downloadName.set('template-blogger.xml');
    return true;
  }
  updatePreview():void {
    if(!this.preview)this.mountPreview();
    const boot=this.api.data();
    if(!boot||!this.preview)return;
    const fields=this.fields();
    const niche=this.activeNiche();
    const color = this.palette();
    const font = this.font();
    this.preview.render({
      siteName:fields.siteName||'Meu Blog',niche:fields.modo==='modelo'?fields.nichoTema:'',
      pageType:niche?.pageType,gridConfigurable:niche?.gridConfigurable,sidebarConfigurable:niche?.sidebarConfigurable,
      accent:color?.hex,bg:color?.bg,surface:color?.surface,text:color?.text,footer:color?.footer,
      typography:fields.typography,font,layout:fields.gridLayout,side:fields.sidebarPosition
    });
  }
  setDevice(device:PreviewDevice):void {this.device.set(device);this.preview?.setDevice(device);}
  selectExample(e:Example):void {
    if(this.busy())return;
    this.invalidateXml();
    this.selected.set(e.id);
    this.fields.set(fieldsFromExample(e));
    this.draftMessage.set('');
    this.fieldError.set('');
    this.failed.set(false);
    this.message.set('Exemplo aplicado. Personalize e gere seu XML.');
    this.updatePreview();
  }
  surprise(boot: { cores: Option[]; fontes: Option[] }): void {
    if (this.busy()) return;
    const random = (options: Option[]) => {
      const draw = crypto.getRandomValues(new Uint32Array(1))[0];
      return options[draw % options.length]?.id;
    };
    this.fields.update(fields => ({
      ...fields,
      colorPreset: random(boot.cores) ?? fields.colorPreset,
      typography: random(boot.fontes) ?? fields.typography,
    }));
    this.selected.set('');
    this.draftMessage.set('');
    this.invalidateXml();
    this.failed.set(false);
    this.message.set('Novo estilo escolhido. Confira a prévia.');
    this.updatePreview();
  }
  save(): void {
    if (!this.validateName()) {
      this.draftMessage.set('Informe um nome com 2 a 60 caracteres para salvar.');
      return;
    }
    try {
      localStorage.setItem('softload-blogger-estilo-v1', JSON.stringify({ ...this.fields(), step: this.step() }));
      this.draftMessage.set('Rascunho salvo neste navegador.');
    } catch {
      this.draftMessage.set('Não foi possível salvar o rascunho neste navegador.');
    }
  }
  private restore(boot:{cores:Option[]; fontes:Option[]; nichos:Option[]}):void {
    try {
      const stored:unknown=JSON.parse(localStorage.getItem('softload-blogger-estilo-v1')||'{}');
      this.fields.set(restoreEditorFields(this.fields(),stored,{
        colors:boot.cores.map(c=>c.id),fonts:boot.fontes.map(f=>f.id),niches:boot.nichos.map(n=>n.id)
      }));
      if (stored && typeof stored === 'object' && 'step' in stored) {
        const savedStep = steps.find(step => step.id === stored.step);
        if (savedStep) this.step.set(savedStep.id);
      }
    }catch{ /* Dados locais podem ser antigos ou inválidos. */ }
  }
  async download():Promise<void>{
    if(this.busy())return;
    const boot=this.api.data();if(!boot){this.message.set('As opções ainda estão carregando.');return;}
    if (!this.validateName()) { this.goToStep('identidade'); this.fieldError.set('Informe um nome com 2 a 60 caracteres.'); return; }
    this.busy.set(true);this.failed.set(false);this.message.set('Compilando e validando o XML…');
    this.invalidateXml();
    const params=new URLSearchParams({...this.fields(), guestToken:boot.guestToken});
    try{
      const r=await fetch(boot.downloadPath,{method:'POST',credentials:'same-origin',redirect:'follow',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=utf-8','Accept':'application/xml','X-Requested-With':'XMLHttpRequest'},body:params.toString()});
      const mime=r.headers.get('content-type')||'';
      if(!r.ok){
        const text=(await r.text()).replace(/<[^>]*>/g,' ').trim().slice(0,280);
        throw new Error(mime.includes('text/html')?'Sua sessão expirou ou a operação foi redirecionada. Entre novamente.':text||'Falha ao gerar o template.');
      }
      if(!/\b(?:application|text)\/xml\b/i.test(mime))throw new Error('O servidor não retornou XML válido; nenhuma alteração foi aplicada.');
      const blob=await r.blob();if(blob.size<1000)throw new Error('O XML retornado parece incompleto.');
      const found=(r.headers.get('content-disposition')||'').match(/filename="([a-z0-9-]{1,40}\.xml)"/i);
      const name=found?.[1]||'template-blogger.xml';
      const url=URL.createObjectURL(blob);this.downloadName.set(name);this.downloadUrl.set(url);
      const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
      this.message.set('XML gerado. Se o download não começar, use o link abaixo.');
    }catch(e){this.failed.set(true);this.message.set(e instanceof Error?e.message:'Falha de conexão. Tente novamente.');}
    finally{this.busy.set(false);}
  }
}
