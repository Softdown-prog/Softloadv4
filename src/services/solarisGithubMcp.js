'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const ENDPOINT = 'https://api.githubcopilot.com/mcp/readonly';
const MAX_RESPONSE = 1024 * 1024;
const MAX_CONTEXT = 16000;
const PROTOCOL = '2025-06-18';
function asObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw Error('Resposta MCP inválida.');
    return value;
}
function parseMcpPayload(raw, id) {
    if (raw.length > MAX_RESPONSE)
        throw Error('Resposta MCP excedeu o limite.');
    const payloads = raw.trimStart().startsWith('{') ? [raw] : raw.split(/\r?\n\r?\n/)
        .map(event => event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n'))
        .filter(Boolean);
    for (const text of payloads) {
        let parsed;
        try {
            parsed = asObject(JSON.parse(text));
        }
        catch {
            continue;
        }
        if (parsed.id !== id)
            continue;
        if (parsed.error)
            throw Error('O servidor GitHub MCP rejeitou a operação.');
        return asObject(parsed.result);
    }
    throw Error('Resposta MCP sem resultado da chamada.');
}
function safePath(raw) {
    if (typeof raw !== 'string' || raw.length > 240 || raw.includes('\\') || /[\x00-\x1f]/.test(raw))
        throw Error('Caminho de arquivo inválido.');
    if (raw && raw.split('/').some(part => !part || part === '.' || part === '..'))
        throw Error('Caminho de arquivo inválido.');
    return raw;
}
async function connectGithubMcp(accessToken, repository, fetchImpl) {
    if (!/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(repository) || !accessToken)
        throw Error('Credenciais do repositório inválidas.');
    const [owner, repo] = repository.split('/');
    let counter = 0;
    let session = '';
    async function send(method, params, notify = false) {
        const id = ++counter;
        const headers = {
            Authorization: 'Bearer ' + accessToken,
            Accept: 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            'MCP-Protocol-Version': PROTOCOL,
            'X-MCP-Readonly': 'true',
            'X-MCP-Toolsets': 'repos',
            ...(session ? { 'Mcp-Session-Id': session } : {})
        };
        const payload = notify ? { jsonrpc: '2.0', method } : { jsonrpc: '2.0', id, method, params: params || {} };
        const response = await fetchImpl(ENDPOINT, {
            method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(12000)
        });
        if (!response.ok)
            throw Error('GitHub MCP não respondeu. Verifique a autorização OAuth e as permissões da App.');
        const sessionHeader = response.headers.get('mcp-session-id');
        if (sessionHeader && /^[\x21-\x7e]{1,200}$/.test(sessionHeader))
            session = sessionHeader;
        if (notify)
            return {};
        return parseMcpPayload(await response.text(), id);
    }
    const init = await send('initialize', {
        protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'softload-solaris', version: '1.0.0' }
    });
    if (typeof init.protocolVersion !== 'string')
        throw Error('Handshake MCP inválido.');
    await send('notifications/initialized', undefined, true);
    const catalog = await send('tools/list');
    const toolNames = Array.isArray(catalog.tools) ? catalog.tools.map(tool => asObject(tool).name) : [];
    if (!toolNames.includes('get_file_contents'))
        throw Error('GitHub MCP não disponibilizou a ferramenta de leitura.');
    return {
        async readPath(path) {
            const safe = safePath(path);
            const response = await send('tools/call', {
                name: 'get_file_contents', arguments: { owner, repo, path: safe }
            });
            if (response.isError === true)
                throw Error('O GitHub MCP não conseguiu ler o caminho solicitado.');
            const content = Array.isArray(response.content) ? response.content : [];
            const text = content.filter(part => asObject(part).type === 'text')
                .map(part => String(asObject(part).text || '')).join('\n');
            if (!text)
                throw Error('Arquivo ou diretório sem texto legível no GitHub MCP.');
            return text.slice(0, MAX_CONTEXT);
        },
        async close() { }
    };
}
function createSolarisGithubMcp(githubApp, { fetchImpl = fetch } = {}) {
    if (!githubApp || typeof githubApp.withSelectedRepo !== 'function')
        throw TypeError('GitHub App obrigatória.');
    return {
        async open(uid, requestedRepo) {
            return githubApp.withSelectedRepo(uid, async ({ repository, accessToken }) => {
                if (repository.toLowerCase() !== requestedRepo.toLowerCase())
                    throw Error('Repositório MCP divergente do vínculo da sessão.');
                return connectGithubMcp(accessToken, repository, fetchImpl);
            });
        }
    };
}
module.exports = { createSolarisGithubMcp, parseMcpPayload, safePath };
