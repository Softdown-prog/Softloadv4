'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveGithubChatAccess = resolveGithubChatAccess;
function resolveGithubChatAccess(status, repository) {
    const requested = String(repository || '').trim().replace(/^https:\/\/github\.com\//i, '').replace(/\.git\/?$/, '').replace(/\/$/, '');
    if (!/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(requested)) {
        throw new Error('Informe um repositório GitHub válido antes de continuar.');
    }
    if (status.connected) {
        if (!status.repository) {
            throw new Error('Conta GitHub conectada. Clique em Vincular repositório antes de usar o agente.');
        }
        if (status.repository.toLowerCase() !== requested.toLowerCase()) {
            throw new Error('O repositório informado não está vinculado. Vincule este repositório antes de continuar.');
        }
        return { mode: 'agent', repository: status.repository };
    }
    // Tokens vencidos nunca devem cair silenciosamente no modo de leitura pública.
    if (status.account || status.repository) {
        throw new Error('Sua autorização GitHub expirou. Reconecte a conta para continuar.');
    }
    return { mode: 'public-readonly', repository: requested };
}
