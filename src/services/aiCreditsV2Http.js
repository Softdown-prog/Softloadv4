"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.criarHandlerResumoCreditosV2 = criarHandlerResumoCreditosV2;
exports.criarHandlerHistoricoCreditosV2 = criarHandlerHistoricoCreditosV2;
/**
 * Endpoint de consulta V2 — somente leitura, desligado por padrão.
 * Nunca aplica debito no legado nem revela custo/margem em reais.
 */
const aiCreditsV2_1 = require("./aiCreditsV2");
function criarHandlerResumoCreditosV2({ consultarSaldo, habilitado = () => process.env.AI_CREDITS_V2_PREVIEW === 'true', }) {
    return async (req, res) => {
        res.setHeader('Cache-Control', 'no-store, private');
        if (!req.session?.user?.email) {
            return res.status(401).json({ erro: 'Sessão expirada. Faça login novamente.' });
        }
        if (!habilitado()) {
            return res.status(404).json({ erro: 'Prévia de créditos indisponível.' });
        }
        try {
            // O email vem EXCLUSIVAMENTE da sessão autenticada.
            const { plano, cicloExpiraEm, ...valores } = await consultarSaldo(req.session.user.email);
            const saldo = (0, aiCreditsV2_1.converterSaldoEmCreditosV2)(valores);
            if (!saldo)
                return res.status(503).json({ erro: 'Saldo de créditos indisponível.' });
            return res.json({ versao: 2, modo: 'previsualizacao', plano, cicloExpiraEm, saldo });
        }
        catch (err) {
            const codigo = err?.codigo;
            if (codigo === 'CICLO_EXPIRADO') {
                return res.status(402).json({ erro: 'O ciclo de créditos expirou.', codigo });
            }
            if (codigo === 'USUARIO_NAO_ENCONTRADO') {
                return res.status(404).json({ erro: 'Conta não encontrada.' });
            }
            // Nunca devolver erro bruto do Firestore, email, custo interno ou token.
            return res.status(503).json({ erro: 'Não foi possível consultar os créditos.' });
        }
    };
}

/** Histórico do próprio usuário; nunca devolve custo monetário, prompt ou outro usuário. */
function criarHandlerHistoricoCreditosV2({ listar, habilitado = () => process.env.AI_CREDITS_V2_PREVIEW === 'true', }) {
    return async (req, res) => {
        res.setHeader('Cache-Control', 'no-store, private');
        if (!req.session?.user?.email) {
            return res.status(401).json({ erro: 'Sessão expirada. Faça login novamente.' });
        }
        if (!habilitado())
            return res.status(404).json({ erro: 'Extrato indisponível.' });
        try {
            const registros = await listar(req.session.user.email);
            const itens = registros.slice(0, 40).map(r => ({
                id: r.id,
                ferramenta: r.ferramenta,
                modelo: r.modelo,
                ...(r.projeto ? { projeto: r.projeto } : {}),
                criadoEm: r.criadoEm,
                creditos: r.creditos,
                estimado: r.estimado,
            }));
            return res.json({ versao: 2, modo: 'previsualizacao', itens });
        }
        catch (e) {
            const codigo = e?.codigo;
            if (codigo === 'CICLO_EXPIRADO') {
                return res.status(402).json({ erro: 'O ciclo de créditos expirou.' });
            }
            return res.status(503).json({ erro: 'Não foi possível consultar o extrato.' });
        }
    };
}
