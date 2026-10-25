/** Contratos de crédito do backend. O runtime continua no espelho CommonJS. */
export interface CreditGrant { creditos: number; expira_em: string | null }
interface CreditDocData {
  is_active?: boolean;
  creditos?: number;
  creditos_expira_em?: string;
  creditos_gpt?: number;
  creditos_gpt_expira_em?: string;
  creditos_bloggerai?: number;
  creditos_bloggerai_expira_em?: string;
}
interface CreditSnapshot { exists: boolean; data(): CreditDocData }
interface FirestoreCreditTransaction {
  get(ref: CreditDocumentRef): Promise<CreditSnapshot>;
  update(ref: CreditDocumentRef, data: Record<string, unknown>): void;
}
interface FirestoreBillingLogs {
  add(data: Record<string, unknown>): Promise<unknown>;
}
interface CreditDocumentRef {
  update(data: Record<string, unknown>): Promise<unknown>;
  set(data: Record<string, unknown>, options: { merge: true }): Promise<unknown>;
  collection(name: string): FirestoreBillingLogs;
}
interface FirestoreCredits {
  collection(name: string): {doc(email: string): CreditDocumentRef};
  runTransaction(task: (tx: FirestoreCreditTransaction) => Promise<void>): Promise<void>;
}
interface FieldValueApi {
  increment(delta: number): unknown;
  serverTimestamp(): unknown;
}
declare function require(path: string): unknown;
declare const console: {error(...args: unknown[]): void};
const { db, admin } = require('./firebase') as {db: FirestoreCredits; admin: {firestore: {FieldValue: FieldValueApi}}};
const FV = admin.firestore.FieldValue;

const TOKENS_POR_CREDITO = 1000;
const EXPIRY_DAYS = 30;

// Créditos Gemini por plano por ciclo de 30 dias
export const PLAN_CREDITS: Record<string, number> = {
    free:    5,
    starter: 500,
    pro:     2000,
    studio:  5500,
    premium: 2000, // backward compat — usuários existentes com plano='premium'
};

// Provedor externo temporariamente sem orçamento de API.
// Manter o contrato para registros legados, mas não conceder novas cotas.
export const GPT_PLAN_CREDITS: Record<string, number> = {
    free:    0,
    starter: 0,
    pro:     0,
    studio:  0,
    premium: 0,
};

// Créditos do Gerador de Templates IA por plano por ciclo de 30 dias
// Campo Firestore: creditos_bloggerai — mesmo pool do Gemini, contabilizado separado
// Free = 0 (gerador exige plano pago)
export const BLOGGERAI_PLAN_CREDITS: Record<string, number> = {
    free:    0,
    starter: 500,
    premium: 2000,
    pro:     2000,
    studio:  5500,
};

export function calcularCreditos(inputTokens: number, outputTokens: number): number {
    return Math.ceil((inputTokens + outputTokens) / TOKENS_POR_CREDITO);
}

function dataExpiracao(): string {
    const d = new Date();
    d.setDate(d.getDate() + EXPIRY_DAYS);
    return d.toISOString();
}

// Aloca créditos do plano e define nova expiração (chamado no webhook de pagamento e no cadastro)
export async function concederCreditos(email: string, plano: string): Promise<CreditGrant> {
    const creditos = PLAN_CREDITS[plano] ?? PLAN_CREDITS.free;
    const expira_em = dataExpiracao();
    await db.collection('clientes_premium').doc(email.toLowerCase()).update({
        creditos,
        creditos_ciclo_total: creditos,
        creditos_expira_em:   expira_em,
    });
    return { creditos, expira_em };
}

export async function debitarCreditos(email: string, inputTokens: number, outputTokens: number): Promise<number> {
    if (!inputTokens && !outputTokens) return 0;

    const creditosADebitar = calcularCreditos(inputTokens, outputTokens);
    const userRef = db.collection('clientes_premium').doc(email.toLowerCase());

    await db.runTransaction(async (tx) => {
        const doc = await tx.get(userRef);
        if (!doc.exists) throw new Error('Usuário não encontrado');

        const dados = doc.data();
        // Assinantes ativos: créditos são contadores de analytics — nunca bloqueia por saldo
        if (!dados.is_active) {
            const expirado = dados.creditos_expira_em && new Date(dados.creditos_expira_em) < new Date();
            const saldo = expirado ? 0 : (dados.creditos ?? 0);
            if (saldo < creditosADebitar) throw new Error('Créditos insuficientes');
        }

        tx.update(userRef, { creditos: FV.increment(-creditosADebitar) });
    });

    userRef.collection('billing_logs').add({
        input_tokens:    inputTokens,
        output_tokens:   outputTokens,
        credits_debited: creditosADebitar,
        criado_em:       FV.serverTimestamp(),
    }).catch(e => console.error('[BILLING] log error:', e.message));

    return creditosADebitar;
}

// ── GPT 5.4 credit functions ──────────────────────────────────────────────

export async function concederCreditosGpt(email: string, plano: string): Promise<CreditGrant> {
    const creditos = GPT_PLAN_CREDITS[plano] ?? 0;
    if (creditos === 0) return { creditos: 0, expira_em: null };
    const expira_em = dataExpiracao();
    // set+merge: cria o doc se não existir (.update() lançava NOT_FOUND para usuários novos)
    await db.collection('clientes_premium').doc(email.toLowerCase()).set({
        creditos_gpt:             creditos,
        creditos_gpt_ciclo_total: creditos,
        creditos_gpt_expira_em:   expira_em,
    }, { merge: true });
    return { creditos, expira_em };
}

export async function debitarCreditosGpt(email: string, inputTokens: number, outputTokens: number): Promise<number> {
    if (!inputTokens && !outputTokens) return 0;

    const creditosADebitar = calcularCreditos(inputTokens, outputTokens);
    const userRef = db.collection('clientes_premium').doc(email.toLowerCase());

    await db.runTransaction(async (tx) => {
        const doc = await tx.get(userRef);
        // Doc ausente = usuário sem campo creditos_gpt — debita silenciosamente (analytics apenas)
        if (!doc.exists) return;

        const dados = doc.data();
        // Campo ausente = créditos nunca provisionados — não bloqueia, só loga
        if (dados.creditos_gpt === undefined) return;

        const expirado = dados.creditos_gpt_expira_em && new Date(dados.creditos_gpt_expira_em) < new Date();
        const saldo = expirado ? 0 : (dados.creditos_gpt ?? 0);
        if (saldo < creditosADebitar) return; // saldo insuficiente — não bloqueia (fire-and-forget)

        tx.update(userRef, { creditos_gpt: FV.increment(-creditosADebitar) });
    });

    userRef.collection('billing_logs').add({
        modelo:          'gpt-5.4-nano',
        input_tokens:    inputTokens,
        output_tokens:   outputTokens,
        credits_debited: creditosADebitar,
        criado_em:       FV.serverTimestamp(),
    }).catch(e => console.error('[BILLING-GPT] log error:', e.message));

    return creditosADebitar;
}

// ── Gerador de Templates IA credit functions ──────────────────────────────

export async function concederCreditosBloggerAi(email: string, plano: string): Promise<CreditGrant> {
    const creditos = BLOGGERAI_PLAN_CREDITS[plano] ?? 0;
    if (creditos === 0) return { creditos: 0, expira_em: null };
    const expira_em = dataExpiracao();
    await db.collection('clientes_premium').doc(email.toLowerCase()).set({
        creditos_bloggerai:             creditos,
        creditos_bloggerai_ciclo_total: creditos,
        creditos_bloggerai_expira_em:   expira_em,
    }, { merge: true });
    return { creditos, expira_em };
}

export async function debitarCreditosBloggerAi(email: string, inputTokens: number, outputTokens: number): Promise<number> {
    if (!inputTokens && !outputTokens) return 0;

    const creditosADebitar = calcularCreditos(inputTokens, outputTokens);
    const userRef = db.collection('clientes_premium').doc(email.toLowerCase());

    await db.runTransaction(async (tx) => {
        const doc = await tx.get(userRef);
        if (!doc.exists) throw new Error('Usuário não encontrado');

        const dados = doc.data();
        // Assinantes ativos: créditos são analytics — nunca bloqueia por saldo
        if (!dados.is_active) {
            const expirado = dados.creditos_bloggerai_expira_em && new Date(dados.creditos_bloggerai_expira_em) < new Date();
            const saldo = expirado ? 0 : (dados.creditos_bloggerai ?? 0);
            if (saldo < creditosADebitar) throw new Error('Créditos BloggerAI insuficientes');
        }

        tx.update(userRef, { creditos_bloggerai: FV.increment(-creditosADebitar) });
    });

    userRef.collection('billing_logs').add({
        tipo:            'bloggerai',
        input_tokens:    inputTokens,
        output_tokens:   outputTokens,
        credits_debited: creditosADebitar,
        criado_em:       FV.serverTimestamp(),
    }).catch(e => console.error('[BILLING-BLOGGERAI] log error:', e.message));

    return creditosADebitar;
}

