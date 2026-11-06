import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, inject, OnDestroy, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SoftloadApi, Example, Option } from './api';
import { INITIAL_EDITOR_FIELDS, GRID_LAYOUTS, SIDEBAR_POSITIONS, fieldsFromExample, restoreEditorFields, type EditorFields } from './editor-state';

interface Preview { render(value: Record<string, unknown>): void; setDevice(device: string): void; }
interface PreviewGlobal { mount(frame: HTMLIFrameElement, stage: HTMLElement): Preview; }
@Component({
  standalone:true, selector:'sl-editor', imports:[FormsModule], changeDetection:ChangeDetectionStrategy.OnPush,
  template:`
  <main class="container">
    <div class="section-head">
      <p class="eyebrow">Estúdio de criação · Blogger XML</p>
      <h1>Seu blog, do seu jeito.</h1>
      <p class="lead">Escolha uma estrutura, personalize as cores e baixe o XML validado pelo nosso compilador procedural. Sem IA.</p>
    </div>
    @if (api.error()) { <p role="alert" class="status error">{{api.error()}}</p> }
    @if (api.data(); as boot) {
      <section class="panel" aria-labelledby="gallery-title" style="margin-bottom:18px">
        <div class="space-between"><div><p class="eyebrow">Inspiração</p><h2 id="gallery-title">Comece por um exemplo</h2></div>
          <span class="pill">{{boot.exemplos.length}} estilos editáveis</span>
        </div>
        <div class="flex" style="margin-bottom:18px">
          <button class="button button-small" [class.button-outline]="category() !== 'Todos'" (click)="category.set('Todos')">Todos</button>
          @for (cat of categories(boot.exemplos); track cat) {
            <button class="button button-small" [class.button-outline]="category() !== cat" (click)="category.set(cat)">{{cat}}</button>
          }
        </div>
        <div class="gallery">
          @for (example of boot.exemplos; track example.id) {
            @if (category() === 'Todos' || category() === example.categoria) {
              <button type="button" [disabled]="busy()" (click)="selectExample(example)" [attr.aria-pressed]="selected() === example.id">
                <span class="sample" [style.background]="exampleColor(example,boot.cores)">{{example.nome.slice(0,1)}}</span>
                <strong>{{example.nome}}</strong><br><span class="small muted">{{example.categoria}}</span>
              </button>
            }
          }
        </div>
      </section>
      <div class="grid-two" style="grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr)">
        <section class="panel" aria-labelledby="editor-title">
          <p class="eyebrow">Editor</p><h2 id="editor-title">Configurar template</h2>
          <form (ngSubmit)="download()" #form="ngForm">
            <div class="field">
              <label for="modo">Como começar?</label>
              <select id="modo" name="modo" [ngModel]="fields().modo" (ngModelChange)="changeField('modo',$event)" [disabled]="busy()">
                <option value="novo">Começar do zero</option><option value="modelo">A partir de um nicho</option>
              </select>
            </div>
            @if (fields().modo === 'modelo') {
              <div class="field"><label for="nichoTema">Nicho de partida</label>
                <select id="nichoTema" name="nichoTema" [ngModel]="fields().nichoTema" (ngModelChange)="changeField('nichoTema',$event)" required [disabled]="busy()">
                  @for (niche of boot.nichos; track niche.id) { <option [value]="niche.id">{{niche.nome}}</option> }
                </select>
                <span class="small muted">{{chosenNiche(boot.nichos)?.aviso || 'Os nichos usam os componentes existentes do compilador.'}}</span>
              </div>
            }
            <div class="field"><label for="siteName">Nome do blog</label>
              <input id="siteName" name="siteName" [ngModel]="fields().siteName" minlength="2" maxlength="60" required (ngModelChange)="changeField('siteName',$event)" [disabled]="busy()"/>
            </div>
            <div class="field"><label for="colorPreset">Paleta de cores</label>
              <select id="colorPreset" name="colorPreset" [ngModel]="fields().colorPreset" (ngModelChange)="changeField('colorPreset',$event)" [disabled]="busy()">
                @for (c of boot.cores; track c.id) {<option [value]="c.id">{{c.nome}}</option>}
              </select>
            </div>
            <div class="field"><label for="typography">Tipografia</label>
              <select id="typography" name="typography" [ngModel]="fields().typography" (ngModelChange)="changeField('typography',$event)" [disabled]="busy()">
                @for (f of boot.fontes; track f.id) {<option [value]="f.id">{{f.nome}}</option>}
              </select>
            </div>
            <div class="field"><label for="gridLayout">Layout das postagens</label>
              <select id="gridLayout" name="gridLayout" [ngModel]="fields().gridLayout" (ngModelChange)="changeField('gridLayout',$event)" [disabled]="busy()">
                <option value="revista">Revista · 3 colunas</option><option value="dupla">Duas colunas</option>
                <option value="lista">Lista</option><option value="quadrado">Mosaico</option>
                <option value="mural">Mural compacto</option><option value="coluna-unica">Uma coluna</option><option value="zigzag">Zigue-zague</option>
              </select>
            </div>
            <div class="field"><label for="sidebarPosition">Barra lateral</label>
              <select id="sidebarPosition" name="sidebarPosition" [ngModel]="fields().sidebarPosition" (ngModelChange)="changeField('sidebarPosition',$event)" [disabled]="busy()">
                <option value="right">Direita</option><option value="left">Esquerda</option><option value="none">Sem barra lateral</option>
              </select>
            </div>
            <div class="flex">
              <button class="button button-outline button-small" type="button" [disabled]="busy()" (click)="surprise(boot)">Surpreenda-me</button>
              <button class="button button-outline button-small" type="button" [disabled]="busy()" (click)="save()">Salvar escolhas</button>
            </div>
            <hr class="divider"/>
            <p class="muted small">
              {{boot.user ? 'Conta gratuita: 2 downloads adicionais; Essencial com limite ampliado.' : 'Sem cadastro: até 2 downloads nesta sessão.'}}
              <a href="/planos">Plano Essencial</a>.
            </p>
            <button class="button" type="submit" style="width:100%" [disabled]="busy() || !form.valid">
              {{busy() ? 'Validando XML…' : 'Gerar e baixar XML'}}
            </button>
            <p class="status" [class.error]="failed()" role="status" aria-live="polite">{{message()}}</p>
            @if (downloadUrl()) {<a [href]="downloadUrl()" [download]="downloadName()" class="button button-outline" style="width:100%">Baixar XML novamente</a>}
          </form>
        </section>
        <section class="panel" aria-labelledby="preview-title">
          <div class="space-between"><div><p class="eyebrow">Visualização</p><h2 id="preview-title">Prévia responsiva</h2></div>
          <span class="pill">Simulação no navegador</span></div>
          <p class="muted small">Uma ilustração local; a aparência final deve ser conferida importando o XML em um blog de testes.</p>
          <div class="preview-toolbar">
            <button type="button" class="button button-small" [class.button-outline]="device() !== 'desktop'" (click)="setDevice('desktop')">Computador</button>
            <button type="button" class="button button-small" [class.button-outline]="device() !== 'tablet'" (click)="setDevice('tablet')">Tablet</button>
            <button type="button" class="button button-small" [class.button-outline]="device() !== 'mobile'" (click)="setDevice('mobile')">Celular</button>
          </div>
          <div class="preview-window" #stage><iframe #frame sandbox="" referrerpolicy="no-referrer" title="Prévia ilustrativa do Blogger"></iframe></div>
          <p class="muted small">{{device() === 'desktop' ? '1080' : device() === 'tablet' ? '768' : '390'}} px — Prévia ilustrativa. Nenhum download consumido.</p>
        </section>
      </div>
    }
  </main>
  `,
  styles:[`@media(max-width:920px){.grid-two{grid-template-columns:1fr!important}}`]
})
export class EditorPage implements AfterViewInit, OnDestroy {
  readonly api = inject(SoftloadApi);
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
  readonly device=signal('desktop'); readonly category=signal('Todos'); readonly selected=signal('');
  readonly message=signal('O XML é validado antes do download.'); readonly busy=signal(false);readonly failed=signal(false);
  readonly downloadUrl=signal('');readonly downloadName=signal('template-blogger.xml');
  private preview?: Preview;
  constructor() {
    void this.api.bootstrap().then(boot => {
      if (!this.fields().nichoTema) this.fields.update(fields=>({...fields,nichoTema:boot.nichos[0]?.id || ''}));
      this.restore(boot);
      this.updatePreview();
    }).catch(() => {});
  }
  ngAfterViewInit(): void { this.mountPreview(); }
  ngOnDestroy(): void { if (this.downloadUrl()) URL.revokeObjectURL(this.downloadUrl()); }
  categories(examples: Example[]): string[] { return [...new Set(examples.map(e=>e.categoria||'Outros'))]; }
  chosenNiche(niches: Option[]): Option | undefined {return niches.find(n => n.id===this.fields().nichoTema);}
  exampleColor(e: Example, colors: Option[]): string { return colors.find(c=>c.id===e.colorPreset)?.hex || '#155e75'; }
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
    const color=boot.cores.find(c=>c.id===fields.colorPreset);
    this.preview.render({
      siteName:fields.siteName||'Meu Blog',niche:fields.modo==='modelo'?fields.nichoTema:'',
      pageType:fields.modo==='modelo'?this.chosenNiche(boot.nichos)?.pageType:'blogger-conteudo',
      accent:color?.hex,bg:color?.bg,surface:color?.surface,text:color?.text,footer:color?.footer,
      typography:fields.typography,layout:fields.gridLayout,side:fields.sidebarPosition
    });
  }
  setDevice(device:'desktop'|'tablet'|'mobile'):void {this.device.set(device);this.preview?.setDevice(device);}
  selectExample(e:Example):void {
    if(this.busy())return;
    this.invalidateXml();
    this.selected.set(e.id);
    this.fields.set(fieldsFromExample(e));
    this.failed.set(false);
    this.message.set('Exemplo aplicado. Personalize e gere seu XML.');
    this.updatePreview();
  }
  surprise(boot: {cores:Option[];fontes:Option[]}):void {
    const choices:{[K in 'colorPreset'|'typography'|'gridLayout'|'sidebarPosition']:string[]}={
      colorPreset:boot.cores.map(x=>x.id),typography:boot.fontes.map(x=>x.id),
      gridLayout:[...GRID_LAYOUTS],sidebarPosition:[...SIDEBAR_POSITIONS]
    };
    const random=(xs:string[])=>{const buf=new Uint32Array(1);crypto.getRandomValues(buf);return xs[buf[0]%xs.length]||'';};
    if(this.busy())return;
    const next={...this.fields()};
    for(const k of Object.keys(choices) as Array<keyof typeof choices>)next[k]=random(choices[k]);
    this.fields.set(next);
    this.selected.set('');
    this.invalidateXml();
    this.failed.set(false);
    this.message.set('Novo estilo escolhido. Confira a prévia.');
    this.updatePreview();
  }
  save():void {
    try { localStorage.setItem('softload-blogger-estilo-v1',JSON.stringify(this.fields()));
      this.message.set('Escolhas salvas neste dispositivo.'); }
    catch {this.message.set('Não foi possível salvar no navegador, mas você pode gerar XML.');}
  }
  private restore(boot:{cores:Option[]; fontes:Option[]; nichos:Option[]}):void {
    try {
      const stored:unknown=JSON.parse(localStorage.getItem('softload-blogger-estilo-v1')||'{}');
      this.fields.set(restoreEditorFields(this.fields(),stored,{
        colors:boot.cores.map(c=>c.id),fonts:boot.fontes.map(f=>f.id),niches:boot.nichos.map(n=>n.id)
      }));
    }catch{ /* Dados locais podem ser antigos ou inválidos. */ }
  }
  async download():Promise<void>{
    if(this.busy())return;
    const boot=this.api.data();if(!boot){this.message.set('As opções ainda estão carregando.');return;}
    if(this.fields().siteName.trim().length<2){this.failed.set(true);this.message.set('Informe um nome com pelo menos 2 caracteres.');return;}
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
