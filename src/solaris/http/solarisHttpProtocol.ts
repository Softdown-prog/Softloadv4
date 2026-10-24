/** Limites e formato do protocolo HTTP/SSE do Solaris Code. Dados do cliente não são confiáveis. */
export interface SolarisHistoricoCliente {
    role: 'user' | 'assistant';
    content: string;
    ts?: string;
}
export interface SolarisHistoricoMotor {
    autor: 'usuario' | 'solaris';
    texto: string;
}
export interface SolarisTokensSse {
    total: number;
    input: number;
    output: number;
}
export interface SolarisZipSse {
    base64: string;
    nome: string;
    totalArquivos: number;
}
export type SolarisSseEvent =
    | { type: 'status'; label: string }
    | { type: 'chunk'; text: string }
    | { type: 'done'; reply: string; sessionId: string; tokens: SolarisTokensSse; zip: SolarisZipSse | null }
    | { type: 'error'; message: string };

export type ValidacaoMensagemSolaris =
    | { ok: true; mensagem: string }
    | { ok: false; erro: string };
export type ValidacaoSessaoSolaris =
    | { ok: true; sessionId: string | null }
    | { ok: false; erro: string };

const LIMITE_MENSAGEM = 2000;
const LIMITE_HISTORICO = 10;
// Compatível com os IDs gerados pelo chatStorage (timestamp + _ + sufixo)
// e IDs UUID/base64url já usados em outros clientes. Nunca permite path separators.
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export function validarMensagemSolaris(value: unknown): ValidacaoMensagemSolaris {
    if (typeof value !== 'string' || !value.trim()) {
        return { ok: false, erro: 'Mensagem não pode estar vazia.' };
    }
    const mensagem = value.trim();
    if (mensagem.length > LIMITE_MENSAGEM) {
        return { ok: false, erro: 'Mensagem muito longa. Máximo 2000 caracteres.' };
    }
    return { ok: true, mensagem };
}

export function validarSessaoSolaris(value: unknown): ValidacaoSessaoSolaris {
    if (value === null || value === undefined || value === '') {
        return { ok: true, sessionId: null };
    }
    if (typeof value !== 'string' || !SESSION_ID_PATTERN.test(value)) {
        return { ok: false, erro: 'Identificador de sessão inválido.' };
    }
    return { ok: true, sessionId: value };
}

export function sanitizarHistoricoSolaris(value: unknown): SolarisHistoricoCliente[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is SolarisHistoricoCliente => (
        item !== null
        && typeof item === 'object'
        && typeof item.content === 'string'
        && (item.role === 'user' || item.role === 'assistant')
    )).slice(-LIMITE_HISTORICO);
}

export function historicoParaMotorSolaris(historico: SolarisHistoricoCliente[]): SolarisHistoricoMotor[] {
    return historico.map(h => ({
        autor: h.role === 'user' ? 'usuario' : 'solaris',
        texto: h.content,
    }));
}

export function serializarEventoSseSolaris(event: SolarisSseEvent): string {
    // O protocolo usa apenas linhas "data:"; JSON.stringify escapa novas linhas
    // dentro do conteúdo, impedindo que texto do modelo injete eventos SSE.
    return `data: ${JSON.stringify(event)}\n\n`;
}
