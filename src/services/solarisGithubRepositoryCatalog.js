'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.listGithubRepositories = listGithubRepositories;
async function listGithubRepositories(token, fetchImpl = fetch) {
    if (!token)
        throw new Error('Reconecte sua conta GitHub.');
    const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    const request = async (path) => {
        const response = await fetchImpl('https://api.github.com' + path, { headers, signal: AbortSignal.timeout(12000) });
        if (!response.ok)
            throw new Error('Não foi possível listar repositórios autorizados.');
        const data = await response.json();
        if (!data || typeof data !== 'object' || Array.isArray(data))
            throw new Error('Resposta inválida do GitHub.');
        return data;
    };
    const first = await request('/user/installations?per_page=6');
    const installations = Array.isArray(first.installations) ? first.installations : [];
    const result = new Map();
    let truncated = installations.length > 5 || (typeof first.total_count === 'number' && first.total_count > 5);
    for (const entry of installations.slice(0, 5)) {
        if (!entry || typeof entry !== 'object' || !('id' in entry))
            continue;
        const id = entry.id;
        if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0)
            continue;
        const page = await request('/user/installations/' + id + '/repositories?per_page=100');
        const repos = Array.isArray(page.repositories) ? page.repositories : [];
        if (typeof page.total_count === 'number' && page.total_count > repos.length)
            truncated = true;
        for (const item of repos) {
            if (!item || typeof item !== 'object')
                continue;
            const row = item;
            if (typeof row.full_name !== 'string' || !/^[a-z0-9-]{1,39}\/[a-z0-9_.-]{1,100}$/i.test(row.full_name))
                continue;
            result.set(row.full_name.toLowerCase(), { name: row.full_name, private: row.private === true, canPush: row.permissions?.push === true });
        }
    }
    return { repositories: [...result.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, 100), truncated: truncated || result.size > 100 };
}
