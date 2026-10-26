'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
/** Permite Workspace em todos os planos; IA só com créditos Gemini reais. */
function criarGateCreditosWorkspace({ db, clock = () => Date.now() }) {
    if (!db || typeof db.collection !== 'function')
        throw new TypeError('Firestore obrigatório');
    return async function verificarCreditosWorkspace(req, res, next) {
        const email = req.session?.user?.email;
        if (typeof email !== 'string' || !email.trim())
            return res.status(401).json({ erro: 'Faça login para usar a IA do Workspace.', codigo: 'SESSAO_EXPIRADA' });
        try {
            const doc = await db.collection('clientes_premium').doc(email.toLowerCase()).get();
            if (!doc.exists)
                return res.status(402).json({ erro: 'Esta conta ainda não tem créditos Gemini.', codigo: 'SEM_CREDITOS' });
            const dados = doc.data() || {};
            if (dados.creditos_expira_em) {
                const expire = typeof dados.creditos_expira_em.toDate === 'function'
                    ? dados.creditos_expira_em.toDate().getTime() : new Date(dados.creditos_expira_em).getTime();
                if (!Number.isFinite(expire) || expire < clock())
                    return res.status(402).json({ erro: 'Seus créditos Gemini expiraram.', codigo: 'CREDITOS_EXPIRADOS' });
            }
            if (typeof dados.creditos !== 'number' || !Number.isFinite(dados.creditos) || dados.creditos <= 0)
                return res.status(402).json({ erro: 'Seus créditos Gemini acabaram. Recarregue para continuar.', codigo: 'SEM_CREDITOS' });
            return next();
        }
        catch (e) {
            console.error('[WORKSPACE] Falha ao verificar saldo:', e?.message || 'erro');
            return res.status(503).json({ erro: 'Não foi possível consultar seus créditos.', codigo: 'SALDO_INDISPONIVEL' });
        }
    };
}
module.exports = { criarGateCreditosWorkspace };
