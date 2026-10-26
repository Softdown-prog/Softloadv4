import type { RouteExports as CompilerExports } from '../routes/dashboard_routes/chat/chatTemplateCompiler';
export type WorkspaceManifest = Parameters<CompilerExports['_snapshotDeManifesto']>[1];
export interface WorkspaceSnapshot extends Record<string, unknown> {
    compilacaoId?: string | null; siteName?: string | null; colorPreset?: string; typography?: string;
    gridLayout?: string; nichoTema?: string | null; xmlPath?: string | null; gcPath?: string | null;
    manifesto?: WorkspaceManifest | null; snapshotEm?: unknown;
}
export interface WorkspaceRecord {
    nome?: string; criadoEm?: unknown; ultimaAtualizacao?: unknown; criadoEmFmt?: string;
    sessoes?: Array<WorkspaceRecord & {id: string}>;
    snapshot?: WorkspaceSnapshot | null; chatSessionId?: string | null;
    edicaoPendente?: { campos: unknown; resumo: string; criadoEm?: {toMillis(): number} } | null;
    manifesto?: WorkspaceManifest | null; manifestoPath?: string | null;
    siteName?: string; colorPreset?: string; typography?: string; gridLayout?: string; nichoTema?: string;
    xmlPath?: string; gcPath?: string; wsSessionId?: string; geradoPorIA?: boolean;
    origem?: string; resumoMudancas?: string; tamanhoBytes?: number;
    creditos?: number; creditos_ciclo_total?: number; creditos_expira_em?: string;
}
export interface AccountRecord {
    email?: string; nome?: string; plano?: string; is_active?: boolean;
    creditos?: number; creditos_ciclo_total?: number; creditos_expira_em?: string;
    creditos_gpt?: number; storage_usado_mb?: number; tentativas_compilacao?: number;
    premium_ate?: string; criado_em?: string; mp_payment_id?: string; plano_pendente?: string | null;
    sess?: {user?: import('./routeHttp').RouteUser};
}
