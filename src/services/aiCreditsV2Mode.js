"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.modoCreditosSolarisV2 = modoCreditosSolarisV2;
exports.criarGateCreditosSolarisV2 = criarGateCreditosSolarisV2;
exports.debitoLegadoSolaris = debitoLegadoSolaris;
function modoCreditosSolarisV2(env = process.env) {
    if (env.SOLARIS_AI_CREDITS_V2 !== 'true')
        return 'legado';
    if (env.SOLARIS_AI_BUDGET_ENFORCE !== 'true' || env.SOLARIS_AI_BUDGET_FLASH !== 'true') {
        return 'configuracao_incompleta';
    }
    return 'ativo';
}
function criarGateCreditosSolarisV2({ verificarLegado, consultar, modo = () => modoCreditosSolarisV2(), }) {
    return async (req, res, next) => {
        const escolha = modo();
        if (escolha === 'legado')
            return verificarLegado(req, res, next);
        if (escolha !== 'ativo') {
            return res.status(503).json({ erro: 'Créditos de IA temporariamente indisponíveis.', codigo: 'CREDITOS_V2_CONFIGURACAO' });
        }
        const email = req.session?.user?.email;
        if (!email)
            return res.status(401).json({ erro: 'Sessão expirada.' });
        try {
            const saldo = await consultar(email);
            const livre = saldo.limiteMicroBrl - saldo.gastoMicroBrl - saldo.reservadoMicroBrl;
            // Reserva por chamada executa o teste atômico final. Esse gate só
            // evita criar trabalho quando o ciclo já não tem um crédito inteiro.
            if (!Number.isSafeInteger(livre) || livre < 10_000) {
                return res.status(402).json({
                    erro: 'Seus créditos de IA deste ciclo acabaram.',
                    codigo: 'CREDITOS_V2_ESGOTADOS',
                });
            }
            return next();
        }
        catch (error) {
            const codigo = error?.codigo;
            if (codigo === 'CICLO_EXPIRADO') {
                return res.status(402).json({ erro: 'Seu ciclo de créditos expirou.', codigo: 'CICLO_EXPIRADO' });
            }
            // Falha de Firestore não autoriza chamadas pagas sem orçamento.
            return res.status(503).json({ erro: 'Não foi possível verificar os créditos de IA.' });
        }
    };
}
/** Evita segunda cobrança em token/1000 nos handlers legados do Solaris. */
function debitoLegadoSolaris(modo, debitar) {
    return modo === 'ativo'
        ? async (..._args) => 0
        : debitar;
}
