/**
 * Endpoint de consulta V2 — somente leitura, desligado por padrão.
 * Nunca aplica debito no legado nem revela custo/margem em reais.
 */
import { converterSaldoEmCreditosV2, type OrcamentoMicroBrl } from './aiCreditsV2';

export interface RequestCreditosV2 {
    session?: { user?: { email?: string } };
    query?: { cursor?: unknown };
}
export interface ResponseCreditosV2 {
    setHeader(name: string, value: string): unknown;
    status(code: number): ResponseCreditosV2;
    json(body: unknown): unknown;
}
export interface SaldoInternoV2 extends OrcamentoMicroBrl {
    plano: string;
    cicloExpiraEm: string;
}
export interface DependenciasResumoCreditosV2 {
    consultarSaldo(email: string): Promise<SaldoInternoV2>;
    habilitado?: () => boolean;
}
export function criarHandlerResumoCreditosV2({
    consultarSaldo,
    habilitado = () => process.env.AI_CREDITS_V2_PREVIEW === 'true',
}: DependenciasResumoCreditosV2) {
    return async (req: RequestCreditosV2, res: ResponseCreditosV2): Promise<unknown> => {
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
            const saldo = converterSaldoEmCreditosV2(valores);
            if (!saldo) return res.status(503).json({ erro: 'Saldo de créditos indisponível.' });
            return res.json({ versao: 2, modo: 'previsualizacao', plano, cicloExpiraEm, saldo });
        } catch (err) {
            const codigo = (err as {codigo?: string} | null)?.codigo;
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
export interface RegistroPublicoExtratoV2 {
    id: string;
    ferramenta: 'solaris-chat' | 'solaris-upload';
    modelo: string;
    projeto?: string;
    criadoEm: string;
    creditos: number;
    estimado: boolean;
}
export function criarHandlerHistoricoCreditosV2({
    listar,
    habilitado = () => process.env.AI_CREDITS_V2_PREVIEW === 'true',
}: {
    listar(email: string, cursor?: string): Promise<RegistroPublicoExtratoV2[] | {
        itens: RegistroPublicoExtratoV2[];
        proximoCursor: string | null;
    }>;
    habilitado?: () => boolean;
}) {
    return async (req: RequestCreditosV2, res: ResponseCreditosV2): Promise<unknown> => {
        res.setHeader('Cache-Control', 'no-store, private');
        if (!req.session?.user?.email) {
            return res.status(401).json({ erro: 'Sessão expirada. Faça login novamente.' });
        }
        if (!habilitado()) return res.status(404).json({ erro: 'Extrato indisponível.' });
        const cursor = req.query?.cursor;
        if (cursor !== undefined && (typeof cursor !== 'string' || !/^[a-f0-9]{64}$/.test(cursor))) {
            return res.status(400).json({ erro: 'Cursor de consulta inválido.' });
        }
        try {
            const pagina = await listar(req.session.user.email, cursor);
            const registros = Array.isArray(pagina) ? pagina : pagina.itens;
            const proximoCursor = Array.isArray(pagina) ? null : pagina.proximoCursor;
            const itens = registros.slice(0, 40).map(r => ({
                id: r.id,
                ferramenta: r.ferramenta,
                modelo: r.modelo,
                ...(r.projeto ? { projeto: r.projeto } : {}),
                criadoEm: r.criadoEm,
                creditos: r.creditos,
                estimado: r.estimado,
            }));
            return res.json({ versao: 2, modo: 'previsualizacao', itens, proximoCursor });
        } catch (e) {
            const codigo = (e as {codigo?: string} | null)?.codigo;
            if (codigo === 'CICLO_EXPIRADO') {
                return res.status(402).json({ erro: 'O ciclo de créditos expirou.' });
            }
            if (codigo === 'CURSOR_INVALIDO' || codigo === 'CONSULTA_INVALIDA') {
                return res.status(400).json({ erro: 'Cursor de consulta inválido.' });
            }
            return res.status(503).json({ erro: 'Não foi possível consultar o extrato.' });
        }
    };
}
