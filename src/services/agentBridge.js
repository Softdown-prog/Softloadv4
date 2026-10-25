'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const { randomUUID } = require('crypto');
const { GoogleAuth } = require('google-auth-library');

const googleAuth = new GoogleAuth();

const CAPABILIDADE_POR_PREFIXO = {
    file: 'filesystem', shell: 'shell', git: 'git', github: 'github', storage: 'storage',
    artifact: 'artifacts', build: 'build', test: 'test', package: 'package', process: 'process',
    'code.analyze': 'code-analysis', 'code.search': 'code-search', project: 'project-inspector',
    'web.search': 'web-search', 'web.fetch': 'web-fetch', websandbox: 'web-sandbox', archive: 'archive',
    knowledge: 'knowledge-search', mcp: 'mcp', escalation: 'escalation',
};

function _configurar() {
    const url = process.env.WORKER_AGENT_SERVICE_URL;
    if (!url)
        throw new Error('WORKER_AGENT_SERVICE_URL não configurada para o Worker Agent.');
    return { url: url.replace(/\/+$/, ''), segredo: process.env.WORKER_SHARED_SECRET || null };
}

function _lerAutorizacao(headers) {
    return headers.Authorization || headers.authorization
        || (typeof headers.get === 'function' ? headers.get('authorization') : null);
}

async function _obterTokenIdentidade(url) {
    const cliente = await googleAuth.getIdTokenClient(new URL(url).origin);
    const authorization = _lerAutorizacao(await cliente.getRequestHeaders());
    if (!authorization)
        throw new Error('Não foi possível obter um ID token para o Worker Agent.');
    return authorization;
}

function _paraSnakeCase(chave) {
    return chave.replace(/[A-Z]/g, (letra) => `_${letra.toLowerCase()}`);
}

function _taskParaAcao(task, id = 'acao-1') {
    if (!task || typeof task.type !== 'string' || !task.type.includes('.')) {
        throw new Error('Worker Agent: task.type deve ter o formato "capability.operation".');
    }
    const [prefixo, ...operacaoPartes] = task.type.split('.');
    const operacao = operacaoPartes.join('.');
    const capability = CAPABILIDADE_POR_PREFIXO[`${prefixo}.${operacao}`] || CAPABILIDADE_POR_PREFIXO[prefixo];
    if (!capability)
        throw new Error(`Worker Agent: task.type não é exposto pela API remota: ${task.type}.`);

    const input = Object.fromEntries(Object.entries(task)
        .filter(([chave]) => chave !== 'type')
        .map(([chave, valor]) => [_paraSnakeCase(chave), valor]));
    return { id, capability, operation: operacao, input };
}

class RemoteAgent {
    constructor({ role = 'solaris-chat', fetchImpl = fetch, obterTokenIdentidade = _obterTokenIdentidade, idGenerator = randomUUID } = {}) {
        this.role = role;
        this.fetchImpl = fetchImpl;
        this.obterTokenIdentidade = obterTokenIdentidade;
        this.idGenerator = idGenerator;
        this.running = false;
    }

    async start() { this.running = true; }
    async stop() { this.running = false; }

    async execute(task) {
        if (!this.running)
            throw new Error('Agent ainda não foi iniciado');
        const { url, segredo } = _configurar();
        const headers = { 'Content-Type': 'application/json' };
        if (segredo)
            headers['x-worker-secret'] = segredo;
        if (process.env.WORKER_AGENT_IAM_AUTH === 'true')
            headers.Authorization = await this.obterTokenIdentidade(url);

        const actionId = this.idGenerator();
        const response = await this.fetchImpl(`${url}/run`, {
            method: 'POST', headers,
            body: JSON.stringify({ request_id: this.idGenerator(), task: 'execute', actions: [_taskParaAcao(task, actionId)] }),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok)
            throw new Error(`Worker Agent respondeu ${response.status}: ${body.message || body.error || 'erro desconhecido'}`);
        const result = body.results?.find((item) => item.actionId === actionId);
        if (!result)
            throw new Error('Worker Agent retornou resposta sem resultado para a action enviada.');
        return result;
    }
}

module.exports = {
    getAgent: async (role = 'solaris-chat') => new RemoteAgent({ role }),
    RemoteAgent,
    _taskParaAcao,
    _lerAutorizacao,
};
