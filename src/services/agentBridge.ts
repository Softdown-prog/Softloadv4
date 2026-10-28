'use strict';
interface BridgeHeaders { Authorization?: string; authorization?: string; get?(name: string): string | null }
interface BridgeTokenClient { getRequestHeaders(): Promise<BridgeHeaders> }
interface BridgeGoogleAuth { getIdTokenClient(audience: string): Promise<BridgeTokenClient> }
interface BridgeAgentAction { id: string; capability: string; operation: string; input: Record<string, unknown> }
interface BridgeTask { type: string; [property: string]: unknown }
interface BridgeResult { actionId: string; [property: string]: unknown }
interface BridgeResponse { ok: boolean; status: number; json(): Promise<{ message?: string; error?: string; results?: BridgeResult[] }> }
interface BridgeRequest { method: 'POST'; headers: Record<string, string>; body: string; signal: unknown }
type BridgeFetch = (url: string, options: BridgeRequest) => Promise<BridgeResponse>;
interface BridgeOptions {
    role?: string;
    fetchImpl?: BridgeFetch;
    obterTokenIdentidade?: (url: string) => Promise<string>;
    idGenerator?: () => string;
}
declare const require: (id: string) => unknown;
declare const module: { exports: unknown };
declare const fetch: BridgeFetch;
declare const AbortSignal: { timeout(ms: number): unknown };
declare const process: { env: Record<string, string | undefined> };
declare const URL: new(url: string) => { origin: string };


const { randomUUID } = require('crypto') as { randomUUID(): string };
const { GoogleAuth } = require('google-auth-library') as { GoogleAuth: new () => BridgeGoogleAuth };

const googleAuth = new GoogleAuth();

const CAPABILIDADE_POR_PREFIXO: Record<string, string> = {
    forge: 'forge',
    file: 'filesystem', shell: 'shell', git: 'git', github: 'github', storage: 'storage',
    artifact: 'artifacts', build: 'build', test: 'test', package: 'package', process: 'process',
    'code.analyze': 'code-analysis', 'code.search': 'code-search', project: 'project-inspector',
    'web.search': 'web-search', 'web.fetch': 'web-fetch', websandbox: 'web-sandbox', archive: 'archive',
    knowledge: 'knowledge-search', mcp: 'mcp', escalation: 'escalation',
};

function _configurar(): { url: string; segredo: string | null } {
    const url = process.env.WORKER_AGENT_SERVICE_URL;
    if (!url) throw new Error('WORKER_AGENT_SERVICE_URL não configurada para o Worker Agent.');
    return { url: url.replace(/\/+$/, ''), segredo: process.env.WORKER_SHARED_SECRET || null };
}

function _lerAutorizacao(headers: BridgeHeaders): string | null | undefined {
    return headers.Authorization || headers.authorization
        || (typeof headers.get === 'function' ? headers.get('authorization') : null);
}

async function _obterTokenIdentidade(url: string): Promise<string> {
    const cliente = await googleAuth.getIdTokenClient(new URL(url).origin);
    const authorization = _lerAutorizacao(await cliente.getRequestHeaders());
    if (!authorization) throw new Error('Não foi possível obter um ID token para o Worker Agent.');
    return authorization;
}

function _paraSnakeCase(chave: string): string {
    return chave.replace(/[A-Z]/g, (letra) => `_${letra.toLowerCase()}`);
}

function _taskParaAcao(task: BridgeTask | null | undefined, id: string = 'acao-1'): BridgeAgentAction {
    if (!task || typeof task.type !== 'string' || !task.type.includes('.')) {
        throw new Error('Worker Agent: task.type deve ter o formato "capability.operation".');
    }
    const [prefixo, ...operacaoPartes] = task.type.split('.');
    const operacao = operacaoPartes.join('.');
    const capability = CAPABILIDADE_POR_PREFIXO[`${prefixo}.${operacao}`] || CAPABILIDADE_POR_PREFIXO[prefixo];
    if (!capability) throw new Error(`Worker Agent: task.type não é exposto pela API remota: ${task.type}.`);

    const input = Object.fromEntries(Object.entries(task)
        .filter(([chave]) => chave !== 'type')
        .map(([chave, valor]) => [_paraSnakeCase(chave), valor]));
    return { id, capability, operation: operacao, input };
}

class RemoteAgent {
    declare role: string;
    declare fetchImpl: BridgeFetch;
    declare obterTokenIdentidade: (url: string) => Promise<string>;
    declare idGenerator: () => string;
    declare running: boolean;

    constructor({ role = 'solaris-chat', fetchImpl = fetch, obterTokenIdentidade = _obterTokenIdentidade, idGenerator = randomUUID }: BridgeOptions = {}) {
        this.role = role;
        this.fetchImpl = fetchImpl;
        this.obterTokenIdentidade = obterTokenIdentidade;
        this.idGenerator = idGenerator;
        this.running = false;
    }

    async start() { this.running = true; }
    async stop() { this.running = false; }

    async execute(task: BridgeTask): Promise<BridgeResult> {
        if (!this.running) throw new Error('Agent ainda não foi iniciado');
        const { url, segredo } = _configurar();
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (segredo) headers['x-worker-secret'] = segredo;
        if (process.env.WORKER_AGENT_IAM_AUTH === 'true') headers.Authorization = await this.obterTokenIdentidade(url);

        const actionId = this.idGenerator();
        const response = await this.fetchImpl(`${url}/run`, {
            method: 'POST', headers, signal: AbortSignal.timeout(15000),
            body: JSON.stringify({ request_id: this.idGenerator(), task: 'execute', actions: [_taskParaAcao(task, actionId)] }),
        });
        const body = await response.json().catch(() => ({} as { message?: string; error?: string; results?: BridgeResult[] }));
        if (!response.ok) throw new Error(`Worker Agent respondeu ${response.status}: ${body.message || body.error || 'erro desconhecido'}`);
        const result = body.results?.find((item) => item.actionId === actionId);
        if (!result) throw new Error('Worker Agent retornou resposta sem resultado para a action enviada.');
        return result;
    }
}

module.exports = {
    getAgent: async (role = 'solaris-chat') => new RemoteAgent({ role }),
    RemoteAgent,
    _taskParaAcao,
    _lerAutorizacao,
};

export {};

/** Exact CommonJS dependency surface consumed by the HTTP routes. */
export type RouteExports = { getAgent: (role?: string) => Promise<RemoteAgent> };
