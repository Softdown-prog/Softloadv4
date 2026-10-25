/**
 * Livro razão de orçamento de IA. Sem efeitos de rede fora do Firestore injetado.
 * NÃO é ativado nas rotas até que todos os caminhos do Gemini tenham reserva.
 * Cada ciclo é identificado pelo vencimento de créditos mantido no banco;
 * nunca por um parâmetro controlado pelo cliente.
 */
import { createHash } from 'node:crypto';
import { TETOS_IA_EXPERIMENTAIS_CENTAVOS } from './geminiCost';

type StatusRecibo = 'reservado' | 'liquidado' | 'cancelado';
interface DadosUsuario { plano?: string; is_active?: boolean; creditos_expira_em?: string }
interface DadosOrcamento {
    limiteMicroBrl?: number;
    reservadoMicroBrl?: number;
    gastoMicroBrl?: number;
}
interface DadosRecibo {
    status: StatusRecibo;
    ledgerId: string;
    reservaMicroBrl: number;
    custoRealMicroBrl?: number;
}
interface Snapshot<T> { exists: boolean; data(): T | undefined }
interface DocRef<T> { readonly id: string }
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
        async reservar({ email, operacaoId, reservaMicroBrl }: ReservaInput): Promise<ReservaResultado> {
            const emailNormalizado = String(email || '').trim().toLowerCase();
            if (!emailNormalizado.includes('@') || emailNormalizado.length > 254
                || !operacaoId || operacaoId.length > 160 || !microValido(reservaMicroBrl) || reservaMicroBrl === 0) {
                throw new OrcamentoIaIndisponivel('RESERVA_INVALIDA');
            }
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
                    if (!r || r.ledgerId !== ledgerId || r.reservaMicroBrl !== reservaMicroBrl) {
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
                tx.set(reciboRef, { status: 'reservado', ledgerId, reservaMicroBrl });
                return { status: 'reservado', reciboId, limiteMicroBrl,
                    gastoMicroBrl, reservadoMicroBrl: reservadoMicroBrl + reservaMicroBrl };
            });
        },

        async liquidar({ reciboId, custoRealMicroBrl }: LiquidacaoInput): Promise<StatusRecibo> {
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
