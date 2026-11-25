import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SoftloadApi } from '../api';

interface AdminUser {
  email: string;
  nome: string;
  plano: string;
  is_active: boolean;
  storage_usado_mb: string;
  tentativas_compilacao: number;
  criado_em: string;
  premium_ate: string | null;
}

interface UserPage {
  usuarios: AdminUser[];
  nextCursor: string | null;
}

type RecoveryResult =
  | { status: 'recuperado'; premium_ate: string }
  | { status: 'ja_processado' };

const METRICS = [
  { key: 'totalUsuarios', label: 'Cadastros' },
  { key: 'totalPremium', label: 'Planos ativos' },
  { key: 'totalFree', label: 'Contas gratuitas' },
  { key: 'storageTotal', label: 'Armazenamento (MB)' },
  { key: 'compilacoesTotal', label: 'Compilações' },
  { key: 'expirando7dias', label: 'Vencem em até 7 dias' },
];

@Component({
  standalone: true,
  imports: [DatePipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin.html',
})
export class AdminPage implements OnInit {
  private readonly api = inject(SoftloadApi);
  readonly usersOnly = inject(ActivatedRoute).snapshot.data['usersOnly'] === true;
  readonly metricLabels = METRICS;
  readonly metrics = signal<Record<string, string | number> | null>(null);
  readonly users = signal<AdminUser[]>([]);
  readonly nextCursor = signal<string | null>(null);
  readonly error = signal('');
  readonly result = signal<RecoveryResult | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);

  ngOnInit(): void {
    void this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    this.error.set('');
    try {
      const [users, metrics] = await Promise.all([
        this.api.json<UserPage>('/eu/api/usuarios?limit=25'),
        this.usersOnly ? null : this.api.json<Record<string, string | number>>('/eu/api/kpis'),
      ]);
      this.users.set(users.usuarios);
      this.nextCursor.set(users.nextCursor);
      this.metrics.set(metrics);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Administração indisponível.');
    } finally {
      this.loading.set(false);
    }
  }

  async more(): Promise<void> {
    const cursor = this.nextCursor();
    if (!cursor || this.loading() || this.busy()) return;
    this.loading.set(true);
    this.error.set('');
    try {
      const page = await this.api.json<UserPage>('/eu/api/usuarios?limit=25&cursor=' + encodeURIComponent(cursor));
      this.users.update(users => [...users, ...page.usuarios]);
      this.nextCursor.set(page.nextCursor);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Não foi possível carregar mais usuários.');
    } finally {
      this.loading.set(false);
    }
  }

  async recoverPayment(event: Event, email: string, paymentId: string): Promise<void> {
    event.preventDefault();
    if (this.busy() || this.loading()) return;
    this.busy.set(true);
    this.error.set('');
    this.result.set(null);
    try {
      const result = await this.api.post<RecoveryResult>('/eu/api/pagamentos/recuperar', {
        email: email.trim(),
        pagamentoId: paymentId.trim(),
      });
      this.result.set(result);
      if (result.status === 'recuperado') await this.refresh();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Falha ao recuperar pagamento.');
    } finally {
      this.busy.set(false);
    }
  }

  async changePlan(user: AdminUser): Promise<void> {
    if (this.busy() || this.loading()) return;
    const action = user.is_active ? 'revogar o acesso' : 'conceder 30 dias de Essencial sem vincular um pagamento';
    if (!confirm('Deseja ' + action + ' para ' + user.email + '?')) return;
    this.busy.set(true);
    this.error.set('');
    this.result.set(null);
    try {
      await this.api.post('/eu/api/usuario/' + encodeURIComponent(user.email) + '/premium', {
        ativo: !user.is_active,
        plano: user.is_active ? 'free' : 'essencial',
      });
      await this.refresh();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Falha ao alterar a conta.');
    } finally {
      this.busy.set(false);
    }
  }
}
