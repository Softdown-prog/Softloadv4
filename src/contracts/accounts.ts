export interface AccountRecord {
    email?: string; nome?: string; plano?: string; is_active?: boolean;
    creditos?: number; creditos_ciclo_total?: number; creditos_expira_em?: string;
    creditos_gpt?: number; storage_usado_mb?: number; tentativas_compilacao?: number;
    premium_ate?: string; criado_em?: string; mp_payment_id?: string; plano_pendente?: string | null;
    sess?: {user?: import('./routeHttp').RouteUser};
}
