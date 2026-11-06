import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { SoftloadApi, Account } from './api';

@Component({standalone:true,imports:[RouterLink],changeDetection:ChangeDetectionStrategy.OnPush,template:`
<main class="container">
<section class="hero-card hero">
  <span class="eyebrow">Softload Blogger · Sem IA</span>
  <h1>Um blog com a<br> sua identidade.</h1>
  <p class="lead">Crie templates XML para Blogger, do zero ou por nichos. Escolha o estilo, visualize a estrutura e baixe para usar no Blogger.</p>
  <div class="flex" style="margin-top:30px">
    <a routerLink="/criar" class="button">Criar meu template</a>
    <a routerLink="/dashboard/plano-essencial" class="button button-outline">Conhecer o Essencial</a>
  </div>
  <p class="muted small">Teste sem cadastro · Até 2 downloads por sessão · Sem inteligência artificial</p>
</section>
<section class="cards-top">
  <p class="eyebrow">Seu espaço de criação</p>
  <h2>Personalize, visualize e publique.</h2>
  <div class="grid">
    <article class="panel"><span class="pill">01 / Estrutura</span><h3 style="margin-top:17px">Nichos e layouts</h3><p class="muted">Comece com um nicho ou página-base, personalize a grade de posts e a barra lateral.</p></article>
    <article class="panel"><span class="pill">02 / Aparência</span><h3 style="margin-top:17px">Cores e fontes</h3><p class="muted">Escolha a identidade visual. A prévia acompanha as opções selecionadas.</p></article>
    <article class="panel"><span class="pill">03 / Entrega</span><h3 style="margin-top:17px">XML validado</h3><p class="muted">O compilador verifica o XML antes do download. Teste a importação em seu Blogger.</p></article>
  </div>
</section>
<section class="panel space-between" style="margin-top:35px"><div><h2>Pronto para criar?</h2><p class="muted">Você pode começar gratuitamente, direto do navegador.</p></div><a routerLink="/criar" class="button">Abrir editor</a></section>
</main>
`})
export class HomePage {}

@Component({standalone:true,imports:[],changeDetection:ChangeDetectionStrategy.OnPush,template:`
<main class="container"><section class="panel" style="max-width:535px;margin:0 auto">
<p class="eyebrow">Softload · Área da conta</p>
@if (mode === 'login') {<h1>Entrar</h1><p class="muted">Entre para usar sua conta e seus templates.</p>}
@else if (mode === 'register') {<h1>Criar conta</h1><p class="muted">Cadastre-se gratuitamente. Você também pode <a href="/criar">testar sem cadastro</a>.</p>}
@else {<h1>Recuperar senha</h1><p class="muted">Enviaremos instruções caso exista uma conta com o e-mail informado.</p>}
<form [attr.action]="'/'+mode" method="post">
  @if (mode === 'register') {<div class="field"><label for="name">Nome</label><input id="name" name="name" autocomplete="name" minlength="2" maxlength="100" required></div>}
  <div class="field"><label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="email" maxlength="254" required></div>
  @if (mode !== 'recover') {<div class="field"><label for="password">Senha</label><input id="password" type="password" name="password" [attr.autocomplete]="mode === 'login' ? 'current-password' : 'new-password'" [attr.minlength]="mode === 'register' ? 8 : null" maxlength="128" required></div>}
  @if (mode === 'register') {<p class="muted small">Ao se cadastrar você aceita os <a href="/termos-de-uso">Termos</a> e a <a href="/privacidade">Política de Privacidade</a>.</p>}
  <button class="button" type="submit" style="width:100%">{{mode === 'login' ? 'Entrar' : mode === 'register' ? 'Criar conta' : 'Enviar instruções'}}</button>
</form>
@if (error) {<p class="status error" role="alert">{{error}}</p>}
@if (success) {<p class="status ok" role="status">{{success}}</p>}
<div class="flex small" style="margin-top:19px">
  <a href="/login">Entrar</a><a href="/register">Criar conta</a><a href="/recover">Esqueci a senha</a>
</div></section></main>
`})
export class AuthPage {
  private readonly route=inject(ActivatedRoute);
  readonly mode=(this.route.snapshot.data['mode'] as 'login'|'register'|'recover')||'login';
  readonly error=this.route.snapshot.queryParamMap.get('erro')?.slice(0,300)||'';
  readonly success=this.route.snapshot.queryParamMap.get('sucesso')?.slice(0,300)||'';
}

@Component({standalone:true,imports:[RouterLink],changeDetection:ChangeDetectionStrategy.OnPush,template:`
<main class="container">
  <p class="eyebrow">Sua área de criação</p><h1>Meu painel</h1>
  <p class="lead">Bem-vindo de volta. O que vamos criar hoje?</p>
  <section class="panel" style="margin-top:28px"><h2>Criar template Blogger</h2>
    <p class="muted">Escolha um nicho, cores, fontes e layout. Baixe o XML validado pelo compilador.</p>
    <a routerLink="/dashboard/gerador-blogger" class="button">Abrir meu gerador</a>
  </section>
  <div class="grid cards-top">
    <a routerLink="/dashboard/historico" class="panel"><h3>Histórico</h3><p class="muted">Recupere seus XML e projetos anteriores.</p></a>
    <a routerLink="/dashboard/arquivos" class="panel"><h3>Arquivos na nuvem</h3><p class="muted">Envie e gerencie seus arquivos e cotas disponíveis.</p></a>
    <a routerLink="/dashboard/plano-essencial" class="panel"><h3>Plano Essencial</h3><p class="muted">R$ 5,00 por 30 dias, sem renovação automática.</p></a>
    <a routerLink="/dashboard/configuracoes" class="panel"><h3>Minha conta</h3><p class="muted">Confira seu cadastro, preferências e informações.</p></a>
  </div>
</main>
`})
export class DashboardPage {}

interface HistoricItem {id:string;arquivo:string;siteName:string;tamanhoBytes:number;criadoEm:string;}
@Component({standalone:true,changeDetection:ChangeDetectionStrategy.OnPush,template:`
<main class="container"><p class="eyebrow">Minha conta · Histórico</p><h1>Templates anteriores</h1>
<p class="lead">Os registros e arquivos de versões antigas continuam preservados.</p>
<section class="panel">
@if (loading()) {<p class="status">Carregando histórico…</p>}
@else if (error()) {<p class="status error" role="alert">{{error()}}</p>}
@else if (!items().length) {<p class="muted">Nenhum arquivo anterior encontrado.</p>}
@else {<div class="table-scroll"><table><thead><tr><th>Projeto</th><th>Criado</th><th>Tamanho</th><th>Ação</th></tr></thead>
<tbody>@for (item of items();track item.id) {<tr><td><strong>{{item.siteName}}</strong><p class="muted small">{{item.arquivo}}</p></td>
<td>{{item.criadoEm}}</td><td>{{(item.tamanhoBytes/1048576).toFixed(2)}} MB</td>
<td><a [href]="'/dashboard/compilacao/'+encode(item.id)+'/download'" class="button button-outline button-small">Baixar ZIP</a></td></tr>}</tbody></table></div>}
</section><p class="muted small">Até 30 registros recentes. Downloads são autorizados por sua sessão no servidor.</p>
</main>`})
export class HistoryPage implements OnInit {
  private readonly api=inject(SoftloadApi);
  readonly items=signal<HistoricItem[]>([]);readonly loading=signal(true);readonly error=signal('');
  encode(value:string):string{return encodeURIComponent(value);}
  async ngOnInit():Promise<void>{
    try {const r=await this.api.json<{compilacoes:HistoricItem[]}>('/api/historico');this.items.set(r.compilacoes||[]);}
    catch(e){this.error.set(e instanceof Error?e.message:'Histórico indisponível.');}
    finally{this.loading.set(false);}
  }
}

interface StoredFile{id:string;name:string;bytes:number;state:string;canDownload:boolean;}
interface FilesResult{enabled:boolean;csrfToken:string;items:StoredFile[];limitMb:number;usedMb:number;}
@Component({standalone:true,changeDetection:ChangeDetectionStrategy.OnPush,template:`
<main class="container"><p class="eyebrow">Minha conta · Cloud Storage</p><h1>Meus arquivos</h1>
<p class="lead">Armazene templates Blogger, imagens e outros arquivos elegíveis em sua conta.</p>
@if (error()) {<p role="alert" class="status error">{{error()}}</p>}
@if (loading()) {<p class="status">Carregando arquivos…</p>}
@else if (data();as store) {
  @if (!store.enabled) {<section class="panel"><h2>Armazenamento temporariamente indisponível</h2><p class="muted">Os uploads estão em homologação. Seu histórico anterior permanece acessível.</p><a href="/dashboard/historico">Consultar histórico</a></section>}
  @else {
    <section class="panel" style="margin-bottom:20px"><h2>Sua cota</h2>
      <p>{{store.usedMb}} MB utilizados de {{store.limitMb}} MB disponíveis.</p>
      <progress [value]="store.usedMb" [max]="store.limitMb" style="width:100%;height:14px"></progress>
      <p class="muted small">Conta gratuita: até 5 MB. Essencial: até 50 MB enquanto ativo. Arquivo individual: até 5 MB.</p>
    </section>
    <section class="panel" style="margin-bottom:20px"><h2>Enviar arquivo</h2>
      <div class="field"><label for="upload">XML, PNG, JPG, WebP, GIF, JSON ou ZIP</label><input #upload id="upload" type="file" accept=".xml,.png,.jpg,.jpeg,.webp,.gif,.json,.zip"></div>
      <button class="button" [disabled]="busy()" (click)="sendFile(upload.files?.[0])">{{busy()?'Enviando…':'Salvar na nuvem'}}</button>
      <p class="status" role="status">{{message()}}</p>
    </section>
    <section class="panel"><h2>Arquivos salvos</h2>
      @if (!store.items.length) {<p class="muted">Nenhum arquivo nesta área. <a href="/dashboard/historico">Consulte o histórico anterior</a>.</p>}
      @else {<div class="table-scroll"><table><thead><tr><th>Arquivo</th><th>Tamanho</th><th>Situação</th><th>Ações</th></tr></thead>
      <tbody>@for(file of store.items;track file.id){<tr><td>{{file.name}}</td><td>{{(file.bytes/1048576).toFixed(2)}} MB</td>
      <td>{{file.state === 'ready' ? (file.canDownload ? 'Disponível':'Recuperação encerrada') : 'Em processamento'}}</td>
      <td><div class="flex">
        @if (file.state==='ready' && file.canDownload) {<a [href]="'/dashboard/arquivos/'+file.id+'/download'" class="button button-outline button-small">Baixar</a>}
        @if (file.state==='ready' || file.state==='deleting') {<button class="button button-danger button-small" [disabled]="busy()" (click)="remove(file)">Excluir</button>}
      </div></td></tr>}</tbody></table></div>}
    </section>
  }
}
</main>`})
export class FilesPage implements OnInit {
  private readonly api=inject(SoftloadApi);
  readonly data=signal<FilesResult|null>(null);readonly loading=signal(true);readonly busy=signal(false);
  readonly error=signal('');readonly message=signal('');
  ngOnInit():void{void this.refresh();}
  private async refresh():Promise<void>{
    try{this.data.set(await this.api.json<FilesResult>('/api/frontend/files'));this.error.set('');}
    catch(e){this.error.set(e instanceof Error?e.message:'Falha ao listar arquivos.');}
    finally{this.loading.set(false);}
  }
  async sendFile(file:File|undefined):Promise<void>{
    const d=this.data();if(!d?.enabled||this.busy())return;
    if(!file || !file.size || file.size>5*1024*1024){this.error.set('Escolha um arquivo válido de até 5 MB.');return;}
    this.busy.set(true);this.error.set('');this.message.set('Enviando…');
    try{
      const r=await fetch('/dashboard/arquivos/upload',{method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/octet-stream','X-Lite-CSRF':d.csrfToken,'X-File-Name':encodeURIComponent(file.name)},body:file});
      const result=await r.json() as {erro?:string};
      if(!r.ok)throw new Error(result.erro||'Falha no envio.');
      this.message.set('Arquivo enviado.');await this.refresh();
    }catch(e){this.error.set(e instanceof Error?e.message:'Falha no envio.');this.message.set('');}
    finally{this.busy.set(false);}
  }
  async remove(file:StoredFile):Promise<void>{
    const d=this.data();if(!d||this.busy()||!confirm('Excluir permanentemente o arquivo '+file.name+'?'))return;
    this.busy.set(true);this.error.set('');
    try{
      const payload=new URLSearchParams({liteFilesCsrf:d.csrfToken});
      const r=await fetch('/dashboard/arquivos/'+encodeURIComponent(file.id)+'/excluir',{method:'POST',credentials:'same-origin',
        headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},body:payload.toString()});
      if(!r.ok)throw new Error('Não foi possível excluir o arquivo.');
      this.message.set('Arquivo excluído.');await this.refresh();
    }catch(e){this.error.set(e instanceof Error?e.message:'Falha ao excluir.');}
    finally{this.busy.set(false);}
  }
}

@Component({standalone:true,changeDetection:ChangeDetectionStrategy.OnPush,template:`
<main class="container"><p class="eyebrow">Minha conta</p><h1>Configurações</h1>
@if(api.data()?.user;as u){
  <section class="panel" style="margin-bottom:20px">
    <h2>Cadastro</h2><dl class="stack"><div><dt class="muted">Nome</dt><dd>{{u.nome||'Não informado'}}</dd></div>
    <div><dt class="muted">E-mail</dt><dd>{{u.email}}</dd></div><div><dt class="muted">Plano</dt><dd>{{u.plano||'Gratuito'}}</dd></div></dl>
    <p class="muted small">A confirmação de pagamentos e renovações é feita pelo servidor.</p>
  </section>
}
<div class="grid">
  <a href="/dashboard/plano-essencial" class="panel"><h3>Plano Essencial</h3><p class="muted">Conheça a oferta de R$ 5 por 30 dias.</p></a>
  <a href="/dashboard/arquivos" class="panel"><h3>Meus arquivos</h3><p class="muted">Consulte suas cotas e envios.</p></a>
  <a href="/dashboard/historico" class="panel"><h3>Histórico</h3><p class="muted">Acesse seus downloads antigos.</p></a>
</div><section class="panel" style="margin-top:22px">
  <h2>Privacidade e suporte</h2><p class="muted">Solicite esclarecimentos e seus direitos de dados pelo canal de contato.</p>
  <a href="/contato">Entrar em contato</a> · <a href="/privacidade">Privacidade</a> · <a href="/termos-de-uso">Termos</a>
</section></main>`})
export class AccountPage {readonly api=inject(SoftloadApi);constructor(){void this.api.bootstrap().catch(()=>{});}}

@Component({standalone:true,imports:[FormsModule],changeDetection:ChangeDetectionStrategy.OnPush,template:`
<main class="container"><p class="eyebrow">Acesso Essencial · Blogger XML</p><h1>Mais liberdade para criar.</h1>
<div class="panel" style="max-width:810px;border-color:#258cac">
  <p class="eyebrow">Pagamento único · 30 dias</p><div class="metric">R$ 5,00</div>
  <p class="lead">Acesso por 30 dias sem renovação automática, com compilação XML sem IA.</p>
  <ul class="muted">
    <li>Gerações e downloads ilimitados durante o acesso ativo, sujeitos à proteção antiabuso</li>
    <li>15 nichos de partida e criação do zero</li><li>Paletas, fontes, grades e barra lateral</li>
    <li>50 MB de armazenamento durante a vigência; 5 MB gratuitos</li>
    <li>Prévia ilustrativa e XML validado pelo compilador</li>
  </ul>
  <p class="muted small">O checkout e a ativação dependem da confirmação no Mercado Pago. Arquivos novos sujeitos à política poderão ser eliminados depois da vigência e cinco dias de recuperação.</p>
  <label class="check-line"><input type="checkbox" [(ngModel)]="accepted" name="accepted">
  <span>Li e aceito os <a href="/termos-de-uso" target="_blank" rel="noopener">Termos de Uso</a> e a <a href="/privacidade" target="_blank" rel="noopener">Política de Privacidade</a>, incluindo os prazos de armazenamento e recuperação.</span></label>
  <div style="margin-top:24px">
    @if(api.data();as d){
      @if(d.checkoutEnabled){
        <button class="button" style="width:100%" [disabled]="busy()||!accepted" (click)="checkout()">{{busy()?'Preparando pagamento…':'Continuar para pagamento de R$ 5'}}</button>
      } @else {<button class="button" disabled style="width:100%">Pagamento temporariamente indisponível</button>
        <p class="muted">A homologação do checkout ainda está em andamento. Nenhuma cobrança será iniciada.</p>}
    }@else{<p class="muted">Carregando condições de contratação…</p>}
    @if(message()){<p class="status error" role="alert">{{message()}}</p>}
  </div>
</div>
</main>`})
export class PlanPage {
  readonly api=inject(SoftloadApi);readonly busy=signal(false);readonly message=signal('');
  accepted=false;
  constructor(){void this.api.bootstrap().catch(()=>{});}
  async checkout():Promise<void>{
    if(this.busy()||!this.accepted||!this.api.data()?.checkoutEnabled)return;
    this.busy.set(true);this.message.set('');
    try{
      const r=await this.api.post<{checkoutUrl:string}>('/dashboard/checkout-create',{plano:'essencial',aceitePoliticaArmazenamento:true});
      if(!/^https:\/\/([\w.-]+\.)?mercadopago\.com(\.br)?\//i.test(r.checkoutUrl))throw new Error('Link de pagamento inválido.');
      window.location.assign(r.checkoutUrl);
    }catch(e){this.message.set(e instanceof Error?e.message:'Não foi possível iniciar o pagamento.');this.busy.set(false);}
  }
}

@Component({standalone:true,imports:[FormsModule],changeDetection:ChangeDetectionStrategy.OnPush,template:`
<main class="container"><section class="panel" style="max-width:630px;margin:auto">
  <p class="eyebrow">Contato</p><h1>Como podemos ajudar?</h1>
  <p class="muted">Descreva sua dúvida sobre o Blogger, sua conta ou seus templates.</p>
  @if(error){<p class="status error" role="alert">{{error}}</p>}
  @if(success){<p class="status ok" role="status">{{success}}</p>}
  <form method="post" action="/contato" (submit)="validate($event)">
    <div class="field"><label for="nome">Nome</label><input id="nome" name="nome" autocomplete="name" maxlength="80" required></div>
    <div class="field"><label for="email">E-mail</label><input id="email" name="email" autocomplete="email" type="email" required></div>
    <div class="field"><label for="mensagem">Mensagem · até 100 palavras</label>
      <textarea id="mensagem" name="mensagem" [(ngModel)]="message" required rows="6"></textarea>
      <span class="muted small">{{wordCount()}} / 100 palavras</span></div>
    <button class="button" type="submit">Enviar mensagem</button><p class="muted small">Limite de uma mensagem por minuto. Não envie código HTML.</p>
  </form>
</section></main>`})
export class ContactPage {
  private readonly route=inject(ActivatedRoute);
  readonly error=this.route.snapshot.queryParamMap.get('erro')?.slice(0,300)||'';
  readonly success=this.route.snapshot.queryParamMap.get('sucesso')?.slice(0,300)||'';
  message='';
  wordCount():number{return this.message.trim().split(/\s+/).filter(Boolean).length;}
  validate(event:Event):void {if(this.wordCount()>100){event.preventDefault();alert('A mensagem deve conter até 100 palavras.');}}
}

@Component({standalone:true,changeDetection:ChangeDetectionStrategy.OnPush,template:`
<main class="container" style="max-width:940px">
@if (error()) {<p role="alert" class="status error">{{error()}}</p>}
@else if (!html()) {<p class="muted">Carregando informações legais…</p>}
@else {<article class="legal-article" [innerHTML]="html()"></article>}
</main>`,
styles:[`.legal-article ::ng-deep h1{font-size:2.25rem}.legal-article ::ng-deep h2{font-size:1.35rem;margin-top:30px}.legal-article ::ng-deep p{color:#b7c9df;line-height:1.8}`]})
export class LegalPage implements OnInit {
  private readonly route=inject(ActivatedRoute);
  readonly html=signal('');readonly error=signal('');
  async ngOnInit():Promise<void>{
    const name=this.route.snapshot.data['kind']==='terms'?'terms':'privacy';
    try {const r=await fetch('/assets/legal/'+name+'.html',{credentials:'same-origin'});
      if(!r.ok)throw new Error('Documento indisponível.');
      this.html.set(await r.text());
    }catch(e){this.error.set(e instanceof Error?e.message:'Documento indisponível.');}
  }
}

interface AdminUser {email:string;nome:string;plano:string;is_active:boolean;storage_usado_mb:string;}
@Component({standalone:true,changeDetection:ChangeDetectionStrategy.OnPush,template:`
<main class="container"><p class="eyebrow">Administração · Acesso restrito</p><h1>Softload · Administração</h1>
@if(error()){<p role="alert" class="status error">{{error()}}</p>}
<div class="grid" style="margin-bottom:20px">
  @for(metric of metrics();track metric.key){<div class="panel"><p class="muted">{{metric.key}}</p><div class="metric">{{metric.value}}</div></div>}
</div>
<section class="panel"><div class="space-between"><h2>Usuários</h2><button class="button button-outline button-small" (click)="refresh()">Atualizar</button></div>
<div class="table-scroll"><table><thead><tr><th>Conta</th><th>Plano</th><th>Armazenamento</th><th>Ação</th></tr></thead>
<tbody>@for(u of users();track u.email){<tr><td>{{u.nome}}<br><span class="muted small">{{u.email}}</span></td>
<td>{{u.plano}} {{u.is_active?'· ativo':''}}</td><td>{{u.storage_usado_mb}} MB</td>
<td><button class="button button-outline button-small" [disabled]="busy()" (click)="changePlan(u)">{{u.is_active?'Revogar':'Ativar Essencial'}}</button></td></tr>}</tbody></table></div>
@if(nextCursor()){<button class="button button-outline button-small" style="margin-top:15px" (click)="more()">Mais usuários</button>}
</section></main>`})
export class AdminPage implements OnInit {
  private readonly api=inject(SoftloadApi);
  readonly metrics=signal<Array<{key:string;value:string}>>([]);readonly users=signal<AdminUser[]>([]);
  readonly nextCursor=signal<string|null>(null);readonly error=signal('');readonly busy=signal(false);
  ngOnInit():void{void this.refresh();}
  async refresh():Promise<void> {
    this.error.set('');
    try {const [k,u]=await Promise.all([this.api.json<Record<string,string|number>>('/eu/api/kpis'),this.api.json<{usuarios:AdminUser[];nextCursor:string|null}>('/eu/api/usuarios?limit=25')]);
      this.metrics.set(Object.entries(k).map(([key,value])=>({key,value:String(value)})));this.users.set(u.usuarios);this.nextCursor.set(u.nextCursor);
    }catch(e){this.error.set(e instanceof Error?e.message:'Administração indisponível.');}
  }
  async more():Promise<void>{
    const cursor=this.nextCursor();if(!cursor)return;
    try{const u=await this.api.json<{usuarios:AdminUser[];nextCursor:string|null}>('/eu/api/usuarios?limit=25&cursor='+encodeURIComponent(cursor));
      this.users.update(old=>[...old,...u.usuarios]);this.nextCursor.set(u.nextCursor);
    }catch(e){this.error.set(e instanceof Error?e.message:'Não foi possível carregar mais usuários.');}
  }
  async changePlan(u:AdminUser):Promise<void>{
    const action=u.is_active?'revogar o acesso':'ativar 30 dias Essencial';
    if(this.busy()||!confirm('Deseja '+action+' para '+u.email+'?'))return;
    this.busy.set(true);
    try{await this.api.post('/eu/api/usuario/'+encodeURIComponent(u.email)+'/premium',{ativo:!u.is_active,plano:u.is_active?'free':'essencial'});await this.refresh();}
    catch(e){this.error.set(e instanceof Error?e.message:'Falha ao alterar a conta.');}
    finally{this.busy.set(false);}
  }
}
