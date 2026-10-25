/**
 * Livro razão de orçamento de IA. Sem efeitos de rede fora do Firestore injetado.
 * NÃO é ativado nas rotas até que todos os caminhos do Gemini tenham reserva.
 * Cada ciclo é identificado pelo vencimento de créditos mantido no banco;
 * nunca por um parâmetro controlado pelo cliente.
 */
import { createHash } from 'node:crypto';
import { TETOS_IA_EXPERIMENTAIS_CENTAVOS } from './geminiCost';
import { converterCustoEmCreditosV2 } from './aiCreditsV2';

type StatusRecibo = 'reservado' | 'liquidado' | 'cancelado';
interface DadosUsuario { plano?: string; is_active?: boolean; creditos_expira_em?: string }
interface DadosOrcamento {
    limiteMicroBrl?: number;
    reservadoMicroBrl?: number;
    gastoMicroBrl?: number;
}
export interface ContextoExtratoIa {
    ferramenta: 'solaris-chat' | 'solaris-upload' | 'solaris-visual';
    modelo: string;
    projeto?: string;
}
export interface LancamentoExtratoIa extends ContextoExtratoIa {
    id: string;
    criadoEm: string;
    liquidadoEm: string;
    creditos: number;
    estimado: boolean;
}
interface DadosRecibo {
    contexto?: ContextoExtratoIa;
    criadoEm?: string;
    status: StatusRecibo;
    ledgerId: string;
    reservaMicroBrl: number;
    custoRealMicroBrl?: number;
}
interface Snapshot<T> { exists: boolean; data(): T | undefined }
interface QueryDoc<T> { readonly id: string; data(): T | undefined }
interface ConsultaExtrato {
    limit(count: number): { get(): Promise<{ docs: QueryDoc<LancamentoExtratoIa>[] }> };
    startAfter(cursor: Snapshot<LancamentoExtratoIa>): ConsultaExtrato;
}
interface Subcolecao {
    doc<T>(id: string): DocRef<T>;
    orderBy(field: string, direction: 'desc'): ConsultaExtrato;
}
interface DocRef<T> {
    readonly id: string;
    collection(name: string): Subcolecao;
    get(): Promise<Snapshot<T>>;
}
interface Transacao {
    get<T>(ref: DocRef<T>): Promise<Snapshot<T>>;
    set<T>(ref: DocRef<T>, data: T): void;
}
export interface FirestoreOrcamento {
    collection(name: string): { doc<T>(id: string): DocRef<T> };
    runTransaction<T>(action: (tx: Transacao) => Promise<T>): Promise<T>;
}
export interface ReservaInput {
    email: string;
    operacaoId: string;
    reservaMicroBrl: number;
    contexto?: ContextoExtratoIa;
}
export interface ReservaResultado {
    status: StatusRecibo;
    reciboId: string;
    limiteMicroBrl: number;
    gastoMicroBrl: number;
    reservadoMicroBrl: number;
}
export interface LiquidacaoInput {
    reciboId: string;
    custoRealMicroBrl: number;
    estimado?: boolean;
}
export class OrcamentoIaIndisponivel extends Error {
    constructor(public readonly codigo: string) {
        super(codigo);
        this.name = 'OrcamentoIaIndisponivel';
    }
}
const TOTAL_MICROS_POR_CENTAVO = 10_000;
const LIMITES = TETOS_IA_EXPERIMENTAIS_CENTAVOS as Record<string, number>;

function sha(chave: string): string {
    return createHash('sha256').update(chave).digest('hex');
}
function microValido(v: number): boolean {
    return Number.isSafeInteger(v) && v >= 0;
}
function lerSaldo(v: unknown): number {
    if (v === undefined) return 0;
    if (typeof v !== 'number' || !microValido(v)) throw new OrcamentoIaIndisponivel('ORCAMENTO_CORROMPIDO');
    return v;
}
function limitePlano(dados: DadosUsuario): number {
    if (dados.is_active !== true) return LIMITES.free * TOTAL_MICROS_POR_CENTAVO;
    const plano = dados.plano === 'premium' ? 'pro' : dados.plano === 'start' ? 'starter' : dados.plano;
    if (!plano || !Object.hasOwn(LIMITES, plano)) throw new OrcamentoIaIndisponivel('PLANO_DESCONHECIDO');
    return LIMITES[plano] * TOTAL_MICROS_POR_CENTAVO;
}
function idReciboValido(id: string): boolean {
    return /^[a-f0-9]{64}$/.test(id);
}
function validarContexto(ctx: ContextoExtratoIa | undefined): ContextoExtratoIa | undefined {
    if (ctx === undefined) return undefined;
    if (!ctx || !['solaris-chat', 'solaris-upload', 'solaris-visual'].includes(ctx.ferramenta)
        || typeof ctx.modelo !== 'string' || !/^gemini-[a-z0-9.-]{3,60}$/.test(ctx.modelo)
        || (ctx.projeto !== undefined && (typeof ctx.projeto !== 'string' || !/^[A-Za-z0-9_-]{6,80}$/.test(ctx.projeto)))) {
        throw new OrcamentoIaIndisponivel('CONTEXTO_INVALIDO');
    }
    return { ferramenta: ctx.ferramenta, modelo: ctx.modelo, ...(ctx.projeto ? { projeto: ctx.projeto } : {}) };
}

/**
 * Reserva atômica. Duas solicitações disputando o mesmo saldo devem competir
 * pela escrita do mesmo documento do ciclo (controle de conflito Firestore).
 * A mesma operação só pode ser reservada uma vez; não reabre cancelamentos.
 */
export function criarLivroRazaoIa(db: FirestoreOrcamento) {
    const usuarios = db.collection('clientes_premium');
    const orcamentos = db.collection('ia_orcamentos');
    const recibos = db.collection('ia_orcamento_recibos');

    return {
        /** Consulta atômica somente leitura do ciclo ativo para o painel de créditos V2. */
        async consultar(email: string): Promise<{
            plano: string;
            cicloExpiraEm: string;
            limiteMicroBrl: number;
            gastoMicroBrl: number;
            reservadoMicroBrl: number;
        }> {
            const emailNormalizado = String(email || '').trim().toLowerCase();
            if (!emailNormalizado.includes('@') || emailNormalizado.length > 254) {
                throw new OrcamentoIaIndisponivel('CONSULTA_INVALIDA');
            }
            return db.runTransaction(async (tx) => {
                const userSnap = await tx.get(usuarios.doc<DadosUsuario>(emailNormalizado));
                if (!userSnap.exists) throw new OrcamentoIaIndisponivel('USUARIO_NAO_ENCONTRADO');
                const dados = userSnap.data() || {};
                const ciclo = dados.creditos_expira_em;
                if (!ciclo || !Number.isFinite(Date.parse(ciclo)) || Date.parse(ciclo) <= Date.now()) {
                    throw new OrcamentoIaIndisponivel('CICLO_EXPIRADO');
                }
                const limiteMicroBrl = limitePlano(dados);
                const orcamentoSnap = await tx.get(orcamentos.doc<DadosOrcamento>(sha(emailNormalizado + '|' + ciclo)));
                const orcamento = orcamentoSnap.data() || {};
                const gastoMicroBrl = lerSaldo(orcamento.gastoMicroBrl);
                const reservadoMicroBrl = lerSaldo(orcamento.reservadoMicroBrl);
                if (!Number.isSafeInteger(gastoMicroBrl + reservadoMicroBrl)) {
                    throw new OrcamentoIaIndisponivel('ORCAMENTO_CORROMPIDO');
                }
                const plano = dados.is_active === true
                    ? (dados.plano === 'premium' ? 'pro' : dados.plano === 'start' ? 'starter' : dados.plano || 'free')
                    : 'free';
                return { plano, cicloExpiraEm: ciclo, limiteMicroBrl, gastoMicroBrl, reservadoMicroBrl };
            });
        },

        /** Compatibilidade: a consulta antiga continua retornando a primeira página. */
        async listarExtrato(email: string, limite = 20): Promise<LancamentoExtratoIa[]> {
            return (await this.listarExtratoPagina(email, limite)).itens;
        },

        /**
         * Paginação estável, vinculada ao usuário e ao ciclo pela subcoleção.
         * O cursor é apenas o ID do recibo; nunca contém email, conteúdo ou custo.
         */
        async listarExtratoPagina(email: string, limite = 20, apos?: string): Promise<{
            itens: LancamentoExtratoIa[];
            proximoCursor: string | null;
        }> {
            if (!Number.isSafeInteger(limite) || limite < 1 || limite > 40
                || (apos !== undefined && !idReciboValido(apos))) {
                throw new OrcamentoIaIndisponivel('CONSULTA_INVALIDA');
            }
            const { cicloExpiraEm } = await this.consultar(email);
            const idCiclo = sha(email.trim().toLowerCase() + '|' + cicloExpiraEm);
            const extrato = orcamentos.doc<DadosOrcamento>(idCiclo).collection('extrato');
            let query = extrato.orderBy('criadoEm', 'desc');
            if (apos) {
                const anterior = await extrato.doc<LancamentoExtratoIa>(apos).get();
                if (!anterior.exists) throw new OrcamentoIaIndisponivel('CURSOR_INVALIDO');
                query = query.startAfter(anterior);
            }
            const snapshot = await query.limit(limite + 1).get();
            const selecionados = snapshot.docs.slice(0, limite);
            const itens = selecionados.map(doc => doc.data()).filter((v): v is LancamentoExtratoIa =>
                !!v && typeof v.id === 'string' && idReciboValido(v.id)
                && typeof v.criadoEm === 'string' && Number.isFinite(Date.parse(v.criadoEm))
                && typeof v.creditos === 'number' && microValido(v.creditos)
                && (v.ferramenta === 'solaris-chat' || v.ferramenta === 'solaris-upload' || v.ferramenta === 'solaris-visual'));
            return {
                itens,
                proximoCursor: snapshot.docs.length > limite && selecionados.length > 0
                    ? selecionados[selecionados.length - 1].id : null,
            };
        },

        async reservar({ email, operacaoId, reservaMicroBrl, contexto }: ReservaInput): Promise<ReservaResultado> {
            const emailNormalizado = String(email || '').trim().toLowerCase();
            if (!emailNormalizado.includes('@') || emailNormalizado.length > 254
                || !operacaoId || operacaoId.length > 160 || !microValido(reservaMicroBrl) || reservaMicroBrl === 0) {
                throw new OrcamentoIaIndisponivel('RESERVA_INVALIDA');
            }
            const contextoValidado = validarContexto(contexto);
            const userRef = usuarios.doc<DadosUsuario>(emailNormalizado);
            return db.runTransaction(async (tx) => {
                const usuario = await tx.get(userRef);
                if (!usuario.exists) throw new OrcamentoIaIndisponivel('USUARIO_NAO_ENCONTRADO');
                const dados = usuario.data() || {};
                const ciclo = dados.creditos_expira_em;
                if (!ciclo || !Number.isFinite(Date.parse(ciclo)) || Date.parse(ciclo) <= Date.now()) {
                    throw new OrcamentoIaIndisponivel('CICLO_EXPIRADO');
                }
                const limiteMicroBrl = limitePlano(dados);
                const ledgerId = sha(emailNormalizado + '|' + ciclo);
                const reciboId = sha(ledgerId + '|' + operacaoId);
                const ledgerRef = orcamentos.doc<DadosOrcamento>(ledgerId);
                const reciboRef = recibos.doc<DadosRecibo>(reciboId);
                // Todas as leituras antecedem qualquer escrita da transação.
                const [ledgerSnap, reciboSnap] = await Promise.all([tx.get(ledgerRef), tx.get(reciboRef)]);
                const ledger = ledgerSnap.data() || {};
                const gastoMicroBrl = lerSaldo(ledger.gastoMicroBrl);
                const reservadoMicroBrl = lerSaldo(ledger.reservadoMicroBrl);
                if (reciboSnap.exists) {
                    const r = reciboSnap.data();
                    if (!r || r.ledgerId !== ledgerId || r.reservaMicroBrl !== reservaMicroBrl
                        || JSON.stringify(r.contexto) !== JSON.stringify(contextoValidado)) {
                        throw new OrcamentoIaIndisponivel('RECIBO_INCOMPATIVEL');
                    }
                    return { status: r.status, reciboId, limiteMicroBrl, gastoMicroBrl, reservadoMicroBrl };
                }
                if (!Number.isSafeInteger(gastoMicroBrl + reservadoMicroBrl + reservaMicroBrl)
                    || gastoMicroBrl + reservadoMicroBrl + reservaMicroBrl > limiteMicroBrl) {
                    throw new OrcamentoIaIndisponivel('ORCAMENTO_INSUFICIENTE');
                }
                tx.set(ledgerRef, {
                    limiteMicroBrl, gastoMicroBrl,
                    reservadoMicroBrl: reservadoMicroBrl + reservaMicroBrl,
                });
                tx.set(reciboRef, { status: 'reservado', ledgerId, reservaMicroBrl,
                    ...(contextoValidado ? { contexto: contextoValidado, criadoEm: new Date().toISOString() } : {}) });
                return { status: 'reservado', reciboId, limiteMicroBrl,
                    gastoMicroBrl, reservadoMicroBrl: reservadoMicroBrl + reservaMicroBrl };
            });
        },

        async liquidar({ reciboId, custoRealMicroBrl, estimado = false }: LiquidacaoInput): Promise<StatusRecibo> {
            if (!idReciboValido(reciboId) || !microValido(custoRealMicroBrl)) {
                throw new OrcamentoIaIndisponivel('LIQUIDACAO_INVALIDA');
            }
            const reciboRef = recibos.doc<DadosRecibo>(reciboId);
            return db.runTransaction(async (tx) => {
                const reciboSnap = await tx.get(reciboRef);
                if (!reciboSnap.exists) throw new OrcamentoIaIndisponivel('RECIBO_AUSENTE');
                const recibo = reciboSnap.data()!;
                if (recibo.status !== 'reservado') return recibo.status;
                const ledgerRef = orcamentos.doc<DadosOrcamento>(recibo.ledgerId);
                const ledgerSnap = await tx.get(ledgerRef);
                if (!ledgerSnap.exists) throw new OrcamentoIaIndisponivel('ORCAMENTO_AUSENTE');
                const ledger = ledgerSnap.data()!;
                const reservado = lerSaldo(ledger.reservadoMicroBrl);
                const gasto = lerSaldo(ledger.gastoMicroBrl);
                if (reservado < recibo.reservaMicroBrl || !Number.isSafeInteger(gasto + custoRealMicroBrl)) {
                    throw new OrcamentoIaIndisponivel('ORCAMENTO_CORROMPIDO');
                }
                tx.set(ledgerRef, { limiteMicroBrl: lerSaldo(ledger.limiteMicroBrl),
                    gastoMicroBrl: gasto + custoRealMicroBrl,
                    reservadoMicroBrl: reservado - recibo.reservaMicroBrl });
                tx.set(reciboRef, { ...recibo, status: 'liquidado', custoRealMicroBrl });
                if (recibo.contexto && recibo.criadoEm) {
                    const creditos = converterCustoEmCreditosV2(custoRealMicroBrl);
                    if (creditos === null) throw new OrcamentoIaIndisponivel('ORCAMENTO_CORROMPIDO');
                    const lancamento: LancamentoExtratoIa = {
                        id: reciboId, ...recibo.contexto, criadoEm: recibo.criadoEm,
                        liquidadoEm: new Date().toISOString(), creditos, estimado,
                    };
                    // Lançamento e gasto formam uma ÚNICA transação idempotente.
                    tx.set(ledgerRef.collection('extrato').doc<LancamentoExtratoIa>(reciboId), lancamento);
                }
                return 'liquidado';
            });
        },

        /**
         * Cancelar SOMENTE se o provedor comprovadamente não foi chamado.
         * Timeout, erro HTTP após envio ou falha ambígua: liquidar a reserva
         * integralmente como estimativa até reconciliar com a fatura.
         */
        async cancelar(reciboId: string): Promise<StatusRecibo> {
            if (!idReciboValido(reciboId)) throw new OrcamentoIaIndisponivel('RECIBO_INVALIDO');
            const reciboRef = recibos.doc<DadosRecibo>(reciboId);
            return db.runTransaction(async (tx) => {
                const reciboSnap = await tx.get(reciboRef);
                if (!reciboSnap.exists) throw new OrcamentoIaIndisponivel('RECIBO_AUSENTE');
                const recibo = reciboSnap.data()!;
                if (recibo.status !== 'reservado') return recibo.status;
                const ledgerRef = orcamentos.doc<DadosOrcamento>(recibo.ledgerId);
                const ledgerSnap = await tx.get(ledgerRef);
                if (!ledgerSnap.exists) throw new OrcamentoIaIndisponivel('ORCAMENTO_AUSENTE');
                const ledger = ledgerSnap.data()!;
                const reservado = lerSaldo(ledger.reservadoMicroBrl);
                if (reservado < recibo.reservaMicroBrl) throw new OrcamentoIaIndisponivel('ORCAMENTO_CORROMPIDO');
                tx.set(ledgerRef, { limiteMicroBrl: lerSaldo(ledger.limiteMicroBrl),
                    gastoMicroBrl: lerSaldo(ledger.gastoMicroBrl),
                    reservadoMicroBrl: reservado - recibo.reservaMicroBrl });
                tx.set(reciboRef, { ...recibo, status: 'cancelado' });
                return 'cancelado';
            });
        },
    };
}
