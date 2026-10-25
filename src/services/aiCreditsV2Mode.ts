/**
 * Cutover controlado dos créditos Solaris V2.
 * Não permite ativar V2 com Flash livre de reserva, nem usar contadores
 * legados como segunda cobrança de uma operação já liquidada no ledger.
 */
export interface EnvCreditosSolarisV2 {
    SOLARIS_AI_CREDITS_V2?: string;
    SOLARIS_AI_BUDGET_ENFORCE?: string;
    SOLARIS_AI_BUDGET_FLASH?: string;
}
export type ModoCreditosSolarisV2 = 'legado' | 'ativo' | 'configuracao_incompleta';
export function modoCreditosSolarisV2(env: EnvCreditosSolarisV2 = process.env): ModoCreditosSolarisV2 {
    if (env.SOLARIS_AI_CREDITS_V2 !== 'true') return 'legado';
    if (env.SOLARIS_AI_BUDGET_ENFORCE !== 'true' || env.SOLARIS_AI_BUDGET_FLASH !== 'true') {
        return 'configuracao_incompleta';
    }
    return 'ativo';
}

export interface ResultadoSaldoV2 {
    limiteMicroBrl: number;
    gastoMicroBrl: number;
    reservadoMicroBrl: number;
}
export interface ReqGateV2 { session?: { user?: { email?: string } } }
export interface ResGateV2 {
    status(code: number): ResGateV2;
    json(body: unknown): unknown;
}
export function criarGateCreditosSolarisV2({
    verificarLegado, consultar, modo = () => modoCreditosSolarisV2(),
}: {
    verificarLegado(req: ReqGateV2, res: ResGateV2, next: () => void): unknown;
    consultar(email: string): Promise<ResultadoSaldoV2>;
    modo?: () => ModoCreditosSolarisV2;
}) {
    return async (req: ReqGateV2, res: ResGateV2, next: () => void): Promise<unknown> => {
        const escolha = modo();
        if (escolha === 'legado') return verificarLegado(req, res, next);
        if (escolha !== 'ativo') {
            return res.status(503).json({ erro: 'Créditos de IA temporariamente indisponíveis.', codigo: 'CREDITOS_V2_CONFIGURACAO' });
        }
        const email = req.session?.user?.email;
        if (!email) return res.status(401).json({ erro: 'Sessão expirada.' });
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
        } catch (error) {
            const codigo = (error as { codigo?: string } | null)?.codigo;
            if (codigo === 'CICLO_EXPIRADO') {
                return res.status(402).json({ erro: 'Seu ciclo de créditos expirou.', codigo: 'CICLO_EXPIRADO' });
            }
            // Falha de Firestore não autoriza chamadas pagas sem orçamento.
            return res.status(503).json({ erro: 'Não foi possível verificar os créditos de IA.' });
        }
    };
}
/** Evita segunda cobrança em token/1000 nos handlers legados do Solaris. */
export function debitoLegadoSolaris(modo: ModoCreditosSolarisV2, debitar: (...args: any[]) => Promise<unknown>) {
    return modo === 'ativo'
        ? async (..._args: unknown[]): Promise<number> => 0
        : debitar;
}
