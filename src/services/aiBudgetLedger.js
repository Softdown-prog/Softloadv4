"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OrcamentoIaIndisponivel = void 0;
exports.criarLivroRazaoIa = criarLivroRazaoIa;
/**
 * Livro razão de orçamento de IA. Sem efeitos de rede fora do Firestore injetado.
 * NÃO é ativado nas rotas até que todos os caminhos do Gemini tenham reserva.
 * Cada ciclo é identificado pelo vencimento de créditos mantido no banco;
 * nunca por um parâmetro controlado pelo cliente.
 */
const node_crypto_1 = require("node:crypto");
const geminiCost_1 = require("./geminiCost");
const aiCreditsV2_1 = require("./aiCreditsV2");
class OrcamentoIaIndisponivel extends Error {
    codigo;
    constructor(codigo) {
        super(codigo);
        this.codigo = codigo;
        this.name = 'OrcamentoIaIndisponivel';
    }
}
exports.OrcamentoIaIndisponivel = OrcamentoIaIndisponivel;
const TOTAL_MICROS_POR_CENTAVO = 10_000;
const LIMITES = geminiCost_1.TETOS_IA_EXPERIMENTAIS_CENTAVOS;
function sha(chave) {
    return (0, node_crypto_1.createHash)('sha256').update(chave).digest('hex');
}
function microValido(v) {
    return Number.isSafeInteger(v) && v >= 0;
}
function lerSaldo(v) {
    if (v === undefined)
        return 0;
    if (typeof v !== 'number' || !microValido(v))
        throw new OrcamentoIaIndisponivel('ORCAMENTO_CORROMPIDO');
    return v;
}
function limitePlano(dados) {
    if (dados.is_active !== true)
        return LIMITES.free * TOTAL_MICROS_POR_CENTAVO;
    const plano = dados.plano === 'premium' ? 'pro' : dados.plano === 'start' ? 'starter' : dados.plano;
    if (!plano || !Object.hasOwn(LIMITES, plano))
        throw new OrcamentoIaIndisponivel('PLANO_DESCONHECIDO');
    return LIMITES[plano] * TOTAL_MICROS_POR_CENTAVO;
}
function idReciboValido(id) {
    return /^[a-f0-9]{64}$/.test(id);
}
function validarContexto(ctx) {
    if (ctx === undefined)
        return undefined;
    if (!ctx || !['solaris-chat', 'solaris-upload'].includes(ctx.ferramenta)
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
function criarLivroRazaoIa(db) {
    const usuarios = db.collection('clientes_premium');
    const orcamentos = db.collection('ia_orcamentos');
    const recibos = db.collection('ia_orcamento_recibos');
    return {
        /** Consulta atômica somente leitura do ciclo ativo para o painel de créditos V2. */
        async consultar(email) {
            const emailNormalizado = String(email || '').trim().toLowerCase();
            if (!emailNormalizado.includes('@') || emailNormalizado.length > 254) {
                throw new OrcamentoIaIndisponivel('CONSULTA_INVALIDA');
            }
            return db.runTransaction(async (tx) => {
                const userSnap = await tx.get(usuarios.doc(emailNormalizado));
                if (!userSnap.exists)
                    throw new OrcamentoIaIndisponivel('USUARIO_NAO_ENCONTRADO');
                const dados = userSnap.data() || {};
                const ciclo = dados.creditos_expira_em;
                if (!ciclo || !Number.isFinite(Date.parse(ciclo)) || Date.parse(ciclo) <= Date.now()) {
                    throw new OrcamentoIaIndisponivel('CICLO_EXPIRADO');
                }
                const limiteMicroBrl = limitePlano(dados);
                const orcamentoSnap = await tx.get(orcamentos.doc(sha(emailNormalizado + '|' + ciclo)));
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
        async listarExtrato(email, limite = 20) {
            return (await this.listarExtratoPagina(email, limite)).itens;
        },
        /**
         * Paginação estável, vinculada ao usuário e ao ciclo pela subcoleção.
         * O cursor é apenas o ID do recibo; nunca contém email, conteúdo ou custo.
         */
        async listarExtratoPagina(email, limite = 20, apos) {
            if (!Number.isSafeInteger(limite) || limite < 1 || limite > 40
                || (apos !== undefined && !idReciboValido(apos))) {
                throw new OrcamentoIaIndisponivel('CONSULTA_INVALIDA');
            }
            const { cicloExpiraEm } = await this.consultar(email);
            const idCiclo = sha(email.trim().toLowerCase() + '|' + cicloExpiraEm);
            const extrato = orcamentos.doc(idCiclo).collection('extrato');
            let query = extrato.orderBy('criadoEm', 'desc');
            if (apos) {
                const anterior = await extrato.doc(apos).get();
                if (!anterior.exists)
                    throw new OrcamentoIaIndisponivel('CURSOR_INVALIDO');
                query = query.startAfter(anterior);
            }
            const snapshot = await query.limit(limite + 1).get();
            const selecionados = snapshot.docs.slice(0, limite);
            const itens = selecionados.map(doc => doc.data()).filter((v) => !!v && typeof v.id === 'string' && idReciboValido(v.id)
                && typeof v.criadoEm === 'string' && Number.isFinite(Date.parse(v.criadoEm))
                && typeof v.creditos === 'number' && microValido(v.creditos)
                && (v.ferramenta === 'solaris-chat' || v.ferramenta === 'solaris-upload'));
            return {
                itens,
                proximoCursor: snapshot.docs.length > limite && selecionados.length > 0
                    ? selecionados[selecionados.length - 1].id : null,
            };
        },
        async reservar({ email, operacaoId, reservaMicroBrl, contexto }) {
            const emailNormalizado = String(email || '').trim().toLowerCase();
            if (!emailNormalizado.includes('@') || emailNormalizado.length > 254
                || !operacaoId || operacaoId.length > 160 || !microValido(reservaMicroBrl) || reservaMicroBrl === 0) {
                throw new OrcamentoIaIndisponivel('RESERVA_INVALIDA');
            }
            const contextoValidado = validarContexto(contexto);
            const userRef = usuarios.doc(emailNormalizado);
            return db.runTransaction(async (tx) => {
                const usuario = await tx.get(userRef);
                if (!usuario.exists)
                    throw new OrcamentoIaIndisponivel('USUARIO_NAO_ENCONTRADO');
                const dados = usuario.data() || {};
                const ciclo = dados.creditos_expira_em;
                if (!ciclo || !Number.isFinite(Date.parse(ciclo)) || Date.parse(ciclo) <= Date.now()) {
                    throw new OrcamentoIaIndisponivel('CICLO_EXPIRADO');
                }
                const limiteMicroBrl = limitePlano(dados);
                const ledgerId = sha(emailNormalizado + '|' + ciclo);
                const reciboId = sha(ledgerId + '|' + operacaoId);
                const ledgerRef = orcamentos.doc(ledgerId);
                const reciboRef = recibos.doc(reciboId);
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
        async liquidar({ reciboId, custoRealMicroBrl, estimado = false }) {
            if (!idReciboValido(reciboId) || !microValido(custoRealMicroBrl)) {
                throw new OrcamentoIaIndisponivel('LIQUIDACAO_INVALIDA');
            }
            const reciboRef = recibos.doc(reciboId);
            return db.runTransaction(async (tx) => {
                const reciboSnap = await tx.get(reciboRef);
                if (!reciboSnap.exists)
                    throw new OrcamentoIaIndisponivel('RECIBO_AUSENTE');
                const recibo = reciboSnap.data();
                if (recibo.status !== 'reservado')
                    return recibo.status;
                const ledgerRef = orcamentos.doc(recibo.ledgerId);
                const ledgerSnap = await tx.get(ledgerRef);
                if (!ledgerSnap.exists)
                    throw new OrcamentoIaIndisponivel('ORCAMENTO_AUSENTE');
                const ledger = ledgerSnap.data();
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
                    const creditos = (0, aiCreditsV2_1.converterCustoEmCreditosV2)(custoRealMicroBrl);
                    if (creditos === null)
                        throw new OrcamentoIaIndisponivel('ORCAMENTO_CORROMPIDO');
                    const lancamento = {
                        id: reciboId, ...recibo.contexto, criadoEm: recibo.criadoEm,
                        liquidadoEm: new Date().toISOString(), creditos, estimado,
                    };
                    // Lançamento e gasto formam uma ÚNICA transação idempotente.
                    tx.set(ledgerRef.collection('extrato').doc(reciboId), lancamento);
                }
                return 'liquidado';
            });
        },
        /**
         * Cancelar SOMENTE se o provedor comprovadamente não foi chamado.
         * Timeout, erro HTTP após envio ou falha ambígua: liquidar a reserva
         * integralmente como estimativa até reconciliar com a fatura.
         */
        async cancelar(reciboId) {
            if (!idReciboValido(reciboId))
                throw new OrcamentoIaIndisponivel('RECIBO_INVALIDO');
            const reciboRef = recibos.doc(reciboId);
            return db.runTransaction(async (tx) => {
                const reciboSnap = await tx.get(reciboRef);
                if (!reciboSnap.exists)
                    throw new OrcamentoIaIndisponivel('RECIBO_AUSENTE');
                const recibo = reciboSnap.data();
                if (recibo.status !== 'reservado')
                    return recibo.status;
                const ledgerRef = orcamentos.doc(recibo.ledgerId);
                const ledgerSnap = await tx.get(ledgerRef);
                if (!ledgerSnap.exists)
                    throw new OrcamentoIaIndisponivel('ORCAMENTO_AUSENTE');
                const ledger = ledgerSnap.data();
                const reservado = lerSaldo(ledger.reservadoMicroBrl);
                if (reservado < recibo.reservaMicroBrl)
                    throw new OrcamentoIaIndisponivel('ORCAMENTO_CORROMPIDO');
                tx.set(ledgerRef, { limiteMicroBrl: lerSaldo(ledger.limiteMicroBrl),
                    gastoMicroBrl: lerSaldo(ledger.gastoMicroBrl),
                    reservadoMicroBrl: reservado - recibo.reservaMicroBrl });
                tx.set(reciboRef, { ...recibo, status: 'cancelado' });
                return 'cancelado';
            });
        },
    };
}
