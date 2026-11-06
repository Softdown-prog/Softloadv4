import { ChangeDetectionStrategy, Component, inject, OnInit } from '@angular/core';
import { RouterLink, RouterOutlet, Routes } from '@angular/router';
import { SoftloadApi } from './api';
import { EditorPage } from './editor';
import { HomePage, AuthPage, DashboardPage, HistoryPage, FilesPage, AccountPage, PlanPage, ContactPage, LegalPage, AdminPage } from './pages';

export const routes: Routes = [
  {path:'', component:HomePage, title:'Softload — Templates Blogger'},
  {path:'criar', component:EditorPage, title:'Criar template Blogger'},
  {path:'login', component:AuthPage, data:{mode:'login'}, title:'Entrar — Softload'},
  {path:'register', component:AuthPage, data:{mode:'register'}, title:'Criar conta — Softload'},
  {path:'recover', component:AuthPage, data:{mode:'recover'}, title:'Recuperar senha — Softload'},
  {path:'dashboard', component:DashboardPage, title:'Meu painel — Softload'},
  {path:'dashboard/gerador-blogger', component:EditorPage, title:'Meu gerador — Softload'},
  {path:'dashboard/historico', component:HistoryPage, title:'Histórico — Softload'},
  {path:'dashboard/arquivos', component:FilesPage, title:'Arquivos — Softload'},
  {path:'dashboard/configuracoes', component:AccountPage, title:'Configurações — Softload'},
  {path:'dashboard/upgrade', component:PlanPage, title:'Plano Essencial — Softload'},
  {path:'dashboard/plano-essencial', component:PlanPage, title:'Plano Essencial — Softload'},
  {path:'contato', component:ContactPage, title:'Contato — Softload'},
  {path:'termos-de-uso', component:LegalPage, data:{kind:'terms'}, title:'Termos de Uso — Softload'},
  {path:'privacidade', component:LegalPage, data:{kind:'privacy'}, title:'Privacidade — Softload'},
  {path:'eu', component:AdminPage, title:'Administração — Softload'},
  {path:'eu/usuarios', component:AdminPage, title:'Usuários — Softload'},
  {path:'**', redirectTo:''}
];
@Component({
  selector:'sl-root', standalone:true, imports:[RouterLink,RouterOutlet],
  changeDetection:ChangeDetectionStrategy.OnPush,
  template:`
    <a class="skip-link" href="#main">Pular para o conteúdo</a>
    <header class="site-header">
      <nav class="navigation container" aria-label="Navegação principal">
        <a routerLink="/" class="brand"><span class="brand-mark">S</span><span>softload<span class="brand-dot">.</span></span></a>
        <div class="nav-actions">
          <a routerLink="/criar">Criar template</a>
          @if (api.data()?.user) {
            <a routerLink="/dashboard">Meu painel</a>
            <a href="/logout" class="nav-muted">Sair</a>
          } @else {
            <a routerLink="/login" class="nav-muted">Entrar</a>
            <a routerLink="/register" class="button button-small">Criar conta</a>
          }
        </div>
      </nav>
    </header>
    <div id="main"><router-outlet/></div>
    <footer class="site-footer">
      <div class="container footer-inner"><span>© Softload · Templates Blogger XML sem IA</span>
      <nav aria-label="Informações legais"><a routerLink="/contato">Contato</a><a routerLink="/termos-de-uso">Termos</a><a routerLink="/privacidade">Privacidade</a></nav></div>
    </footer>
  `
})
export class AppComponent implements OnInit {
  readonly api = inject(SoftloadApi);
  ngOnInit(): void { void this.api.bootstrap().catch(() => {}); }
}
