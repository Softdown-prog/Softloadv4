'use strict';
// API de ferramentas GitHub para a conta e o repositório explicitamente vinculados.
// A credencial OAuth permanece no backend; nunca é entregue ao browser nem ao LLM.
const MAX_TEXT_BYTES = 96 * 1024;

class GithubOperationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'GithubOperationError';
    this.status = status;
  }
}
function nonEmpty(value, label, max = 120) {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new GithubOperationError(label + ' inválido.');
  return value.trim();
}
function filePath(value, forWrite = false) {
  const p = nonEmpty(value, 'Caminho do arquivo', 240);
  const parts = p.split('/');
  if (p.includes('\\') || parts.some(s => !s || s === '.' || s === '..' || /[\x00-\x1f]/.test(s)))
    throw new GithubOperationError('Caminho de arquivo não permitido.');
  if (forWrite && (parts[0] === '.git' ||
      (parts[0] === '.github' && parts[1] === 'workflows') ||
      parts.some(s => /^(?:\.env(?:\..*)?|id_rsa|id_ed25519)$/i.test(s) || /\.(?:pem|key|p12)$/i.test(s))))
    throw new GithubOperationError('Arquivos sensíveis e workflows exigem um fluxo administrativo separado.', 403);
  return parts.map(encodeURIComponent).join('/');
}
function branchName(value) {
  const name = nonEmpty(value, 'Branch', 100);
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(name) ||
      name.includes('..') || name.includes('//') || name.endsWith('/') ||
      name.endsWith('.') || name.endsWith('.lock') || name.includes('@{'))
    throw new GithubOperationError('Nome de branch inválido.');
  return name;
}
function confirmWrite(input) {
  if (input.confirm !== true)
    throw new GithubOperationError('Confirmação explícita obrigatória para gravar no GitHub.', 403);
}
function createGithubOperations(githubApp, { fetchImpl = fetch } = {}) {
  if (!githubApp || typeof githubApp.withSelectedRepo !== 'function')
    throw new TypeError('GitHub App com vínculo por usuário é obrigatório.');

  return {
    async execute(uid, input) {
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new GithubOperationError('Operação GitHub inválida.');
      const action = nonEmpty(input.action, 'Ação', 40);
      const allowed = ['repository_get', 'file_read', 'branch_create', 'file_commit', 'pull_request_create', 'pull_requests_list'];
      if (!allowed.includes(action)) throw new GithubOperationError('Operação GitHub não permitida.', 403);
      if (['branch_create', 'file_commit', 'pull_request_create'].includes(action)) confirmWrite(input);
      return githubApp.withSelectedRepo(uid, async ({ repository, accessToken }) => {
        const root = 'https://api.github.com/repos/' + repository;
        const request = async (suffix, { method = 'GET', body } = {}) => {
          const response = await fetchImpl(root + suffix, {
            method,
            headers: {
              Authorization: 'Bearer ' + accessToken,
              Accept: 'application/vnd.github+json',
              'X-GitHub-Api-Version': '2022-11-28',
              ...(body !== undefined ? {'Content-Type': 'application/json'} : {})
            },
            ...(body !== undefined ? {body: JSON.stringify(body)} : {}),
            signal: AbortSignal.timeout(15000)
          });
          if (!response.ok) {
            const code = [401, 403, 404, 409, 422].includes(response.status) ? response.status : 502;
            throw new GithubOperationError(
              code === 403 ? 'GitHub recusou a permissão da conta ou do repositório.' :
              code === 404 ? 'Recurso não encontrado ou não autorizado no GitHub.' :
              code === 409 ? 'Conflito de versão no GitHub. Atualize o arquivo antes de tentar novamente.' :
              code === 422 ? 'O GitHub rejeitou os dados da operação.' :
              'A API do GitHub não concluiu a operação.', code);
          }
          return response.status === 204 ? null : response.json();
        };
        const info = async () => {
          const data = await request('');
          if (String(data.full_name || '').toLowerCase() !== repository.toLowerCase())
            throw new GithubOperationError('Repositório inesperado na resposta do GitHub.', 403);
          return data;
        };
        const summary = data => ({
          repository: data.full_name,
          defaultBranch: data.default_branch,
          private: !!data.private,
          canPush: data.permissions?.push === true,
          url: data.html_url
        });
        switch (action) {
          case 'repository_get': return summary(await info());
          case 'file_read': {
            const pathname = filePath(input.path);
            const ref = input.branch ? branchName(input.branch) : (await info()).default_branch;
            const data = await request('/contents/' + pathname + '?ref=' + encodeURIComponent(ref));
            if (data.type !== 'file' || data.encoding !== 'base64' || typeof data.content !== 'string' ||
                !Number.isFinite(data.size) || data.size > MAX_TEXT_BYTES)
              throw new GithubOperationError('Somente arquivos de texto pequenos são suportados.', 413);
            const text = Buffer.from(data.content.replace(/\s/g, ''), 'base64').toString('utf8');
            if (text.includes('\0') || Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES)
              throw new GithubOperationError('Arquivo binário ou acima do limite.', 413);
            return {repository, path: data.path, branch: ref, sha: data.sha, content: text};
          }
          case 'pull_requests_list': {
            const data = await request('/pulls?state=open&per_page=20');
            return {repository, pullRequests: Array.isArray(data) ? data.map(p => ({
              number: p.number, title: p.title, url: p.html_url, state: p.state,
              head: p.head?.ref, base: p.base?.ref
            })) : []};
          }
          case 'branch_create': {
            const name = branchName(input.branch);
            if (!name.startsWith('solaris/'))
              throw new GithubOperationError('Novas branches do agente devem começar com solaris/.', 403);
            const base = branchName(input.base || (await info()).default_branch);
            const ref = await request('/git/ref/heads/' + base.split('/').map(encodeURIComponent).join('/'));
            const data = await request('/git/refs', {
              method: 'POST', body: {ref: 'refs/heads/' + name, sha: ref.object.sha}
            });
            return {repository, branch: name, ref: data.ref, sha: data.object?.sha};
          }
          case 'file_commit': {
            const p = filePath(input.path, true);
            const content = nonEmpty(input.content, 'Conteúdo', MAX_TEXT_BYTES);
            if (Buffer.byteLength(content, 'utf8') > MAX_TEXT_BYTES)
              throw new GithubOperationError('Conteúdo acima de 96 KiB.', 413);
            const message = nonEmpty(input.message, 'Mensagem de commit', 240);
            const base = (await info()).default_branch;
            const branch = branchName(input.branch || base);
            if (branch === base && input.allowDefaultBranch !== true)
              throw new GithubOperationError('Gravação na branch principal exige autorização explícita.', 403);
            let existing = null;
            try {
              existing = await request('/contents/' + p + '?ref=' + encodeURIComponent(branch));
            } catch (error) {
              if (!(error instanceof GithubOperationError) || error.status !== 404) throw error;
            }
            if (existing && existing.type !== 'file') throw new GithubOperationError('O caminho não é um arquivo.');
            const expected = input.expectedSha;
            if (existing && (!expected || existing.sha !== expected))
              throw new GithubOperationError('Arquivo alterado ou SHA não informado: leia a versão atual primeiro.', 409);
            if (!existing && expected)
              throw new GithubOperationError('Arquivo não existe na branch selecionada.', 409);
            const body = {message, branch, content: Buffer.from(content, 'utf8').toString('base64')};
            if (existing) body.sha = existing.sha;
            const result = await request('/contents/' + p, {method: 'PUT', body});
            return {repository, branch, path: decodeURIComponent(p), commit: result.commit?.sha,
              url: result.commit?.html_url || null, fileSha: result.content?.sha};
          }
          case 'pull_request_create': {
            const meta = await info();
            const title = nonEmpty(input.title, 'Título', 180);
            const head = branchName(input.head);
            const base = branchName(input.base || meta.default_branch);
            if (head === base) throw new GithubOperationError('Head e base não podem ser iguais.');
            if (typeof input.body !== 'undefined' &&
                (typeof input.body !== 'string' || input.body.length > 8000))
              throw new GithubOperationError('Descrição inválida.');
            const pr = await request('/pulls', {method: 'POST', body: {
              title, head, base, body: input.body || '', draft: input.draft === true
            }});
            return {repository, number: pr.number, title: pr.title, url: pr.html_url, state: pr.state};
          }
        }
      });
    }
  };
}
module.exports = { createGithubOperations, GithubOperationError, filePath, branchName };
