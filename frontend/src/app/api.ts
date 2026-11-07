import { Injectable, signal } from '@angular/core';

export interface Account { uid: string; nome?: string; email: string; plano?: string; is_super_admin?: boolean; }
export interface Option { id: string; nome: string; hex?: string; bg?: string; surface?: string; text?: string; footer?: string; pageType?: string; aviso?: string | null; }
export interface Example { id: string; nome: string; descricao?: string; categoria?: string; nichoTema: string; colorPreset?: string; typography?: string; gridLayout?: string; sidebarPosition?: string; }
export interface BootstrapData {
  user: Account | null;
  guestMode: boolean;
  guestToken: string;
  downloadPath: string;
  cores: Option[];
  fontes: Option[];
  nichos: Option[];
  exemplos: Example[];
  checkoutEnabled: boolean;
  filesEnabled: boolean;
}
@Injectable({providedIn: 'root'})
export class SoftloadApi {
  readonly data = signal<BootstrapData | null>(null);
  readonly error = signal('');
  private loading?: Promise<BootstrapData>;
  async bootstrap(): Promise<BootstrapData> {
    if (!this.loading) {
      this.loading = this.json<BootstrapData>('/api/frontend/bootstrap').then(data => {
        this.data.set(data);
        this.error.set('');
        return data;
      }).catch(error => {
        this.error.set(error instanceof Error ? error.message : 'Não foi possível carregar sua conta.');
        this.loading = undefined;
        throw error;
      });
    }
    return this.loading;
  }
  async json<T>(url: string, init?: RequestInit): Promise<T> {
    // Build headers last: RequestInit.headers in a POST must not overwrite the
    // JSON content negotiation used by Express/Nest authorization contracts.
    // Headers also accepts object, tuple and Headers instances safely.
    const headers = new Headers(init?.headers);
    headers.set('Accept', 'application/json');
    const response = await fetch(url, {credentials: 'same-origin', ...init, headers});
    if (!response.ok) {
      let message = 'Falha ao acessar o servidor.';
      try { const body: {erro?:string;error?:string} = await response.json(); message = body.erro || body.error || message; }
      catch { message = response.status === 401 ? 'Sua sessão expirou. Entre novamente.' : message; }
      throw new Error(message);
    }
    return await response.json() as T;
  }
  async post<T>(url: string, body: unknown): Promise<T> {
    return this.json<T>(url, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
  }
}
