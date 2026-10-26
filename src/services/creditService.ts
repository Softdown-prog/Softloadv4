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
  input_tokens?: number;
  output_tokens?: number;
  credits_debited?: number;
}
interface CreditSnapshot { exists: boolean; data(): CreditDocData }
interface FirestoreCreditTransaction {
  get(ref: CreditDocumentRef): Promise<CreditSnapshot>;
  update(ref: CreditDocumentRef, data: Record<string, unknown>): void;
  set(ref: CreditDocumentRef, data: Record<string, unknown>): void;
}
interface FirestoreBillingLogs {
  add(data: Record<string, unknown>): Promise<unknown>;
  doc(id: string): CreditDocumentRef;
}
interface CreditDocumentRef {
  update(data: Record<string, unknown>): Promise<unknown>;
  set(data: Record<string, unknown>, options: { merge: true }): Promise<unknown>;
  collection(name: string): FirestoreBillingLogs;
}
interface BillingObject {
  name: string;
  save(content: string, options: { contentType: string; resumable: boolean; preconditionOpts: { ifGenerationMatch: number | string } }): Promise<unknown>;
  download(): Promise<[{ toString(encoding: string): string }]>;
  getMetadata(): Promise<[{ generation: string }]>;
  delete(options: { ignoreNotFound: boolean }): Promise<unknown>;
}
interface BillingBucket {
  file(path: string): BillingObject;
  getFiles(options: { prefix: string; maxResults: number; autoPaginate: false; startOffset?: string }): Promise<[BillingObject[]]>;
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
declare const console: {error(...args: unknown[]): void; info(...args: unknown[]): void};
declare function setTimeout(callback: () => void, delay: number): unknown;
const { db, admin, bucket } = require('./firebase') as {db: FirestoreCredits; admin: {firestore: {FieldValue: FieldValueApi}}; bucket?: BillingBucket};
const FV = admin.firestore.FieldValue;

const TOKENS_POR_CREDITO = 1000;
const EXPIRY_DAYS = 30;
const BILLING_RETRY_PREFIX = 'billing/pending/';
const BILLING_CURSOR_OBJECT = 'billing/state/recovery-cursor.json';
type EstadoCursor = { cursor: string | null; generation: string | number };

/** O estado fica fora de billing/pending/ para não virar uma cobrança falsa.
 *  GCS 404 indica ausência de cursor (primeira execução). Outros erros
 *  interrompem a recuperação para não encobrir falhas de armazenamento. */
async function lerCursorRecuperacao(): Promise<EstadoCursor> {
  const file = bucket!.file(BILLING_CURSOR_OBJECT);
  try {
    const [metadata] = await file.getMetadata();
    const [bytes] = await file.download();
    const valor = JSON.parse(bytes.toString('utf8')) as { versao?: number; cursor?: unknown };
    if (valor?.versao !== 1 || (valor.cursor !== null
      && (typeof valor.cursor !== 'string' || !valor.cursor.startsWith(BILLING_RETRY_PREFIX)
        || valor.cursor.length > 260))) {
      throw new Error('Cursor persistido inválido');
    }
    return { cursor: valor.cursor, generation: metadata.generation };
  } catch (e) {
    if ((e as { code?: number } | null)?.code === 404) return { cursor: null, generation: 0 };
    throw e;
  }
}
/** CAS impede uma instância mais lenta de sobrescrever o avanço de outra.
 *  Um conflito 412 não é erro: a próxima execução lê o cursor atualizado. */
async function gravarCursorRecuperacao(cursor: string | null, generation: string | number): Promise<boolean> {
  try {
    await bucket!.file(BILLING_CURSOR_OBJECT).save(JSON.stringify({ versao: 1, cursor }), {
      contentType: 'application/json', resumable: false,
      preconditionOpts: { ifGenerationMatch: generation },
    });
    return true;
  } catch (e) {
    if ((e as { code?: number } | null)?.code !== 412) throw e;
    // Outro worker venceu o CAS. Preservar o cursor vencedor.
    return false;
  }
}

interface CobrancaPendente {
  versao: 1;
  operacaoId: string;
  email: string;
  inputTokens: number;
  outputTokens: number;
  criadoEm: string;
}
function registroPendenteIgual(v: CobrancaPendente, email: string, input: number, output: number, operacaoId: string): boolean {
  return v.versao === 1 && v.email === email && v.inputTokens === input
    && v.outputTokens === output && v.operacaoId === operacaoId;
}
function cobrancaPendenteValida(v: CobrancaPendente, nome: string): boolean {
  return !!v && v.versao === 1 && typeof v.email === 'string' && v.email.includes('@')
    && typeof v.operacaoId === 'string' && /^[a-zA-Z0-9_-]{12,128}$/.test(v.operacaoId)
    && nome === BILLING_RETRY_PREFIX + v.operacaoId + '.json'
    && Number.isSafeInteger(v.inputTokens) && v.inputTokens >= 0
    && Number.isSafeInteger(v.outputTokens) && v.outputTokens >= 0;
}

/** Reexecuta débitos registrados antes da falha do Firestore. Cada operação
 *  possui recibo transacional, então múltiplos workers são seguros. */
export async function recuperarCobrancasPendentes(maxResults = 25): Promise<{ processadas: number; falhas: number; conflitosCursor: number }> {
  if (!bucket) return { processadas: 0, falhas: 0, conflitosCursor: 0 };
  const limite = Number.isSafeInteger(maxResults) ? Math.max(1, Math.min(maxResults, 100)) : 25;
  async function obterLote(inicio: string | null): Promise<BillingObject[]> {
    // O startOffset do GCS é inclusivo; buscamos um extra e excluímos
    // explicitamente o objeto anterior para manter no máximo "limite".
    const [files] = await bucket!.getFiles({
      prefix: BILLING_RETRY_PREFIX, maxResults: limite + (inicio ? 1 : 0),
      autoPaginate: false, ...(inicio ? { startOffset: inicio } : {}),
    });
    return files.filter(file => !inicio || file.name > inicio).slice(0, limite);
  }
  const anterior = await lerCursorRecuperacao();
  let files = await obterLote(anterior.cursor);
  if (files.length === 0 && anterior.cursor) {
    // A lista chegou ao fim; o próximo ciclo deve voltar ao começo.
    files = await obterLote(null);
  }
  const proximoCursor = files.length ? files[files.length - 1].name : null;
  let processadas = 0;
  let falhas = 0;
  let conflitosCursor = 0;
  for (const file of files) {
    try {
      const [bytes] = await file.download();
      const cob = JSON.parse(bytes.toString('utf8')) as CobrancaPendente;
      if (!cobrancaPendenteValida(cob, file.name)) throw new Error('Pendência inválida');
      await debitarCreditos(cob.email, cob.inputTokens, cob.outputTokens, cob.operacaoId);
      // O débito apaga a pendência após a transação; delete tolera corridas.
      await file.delete({ ignoreNotFound: true });
      processadas++;
    } catch (err) {
      falhas++;
      console.error('[BILLING] Recuperação pendente falhou:', file.name, err);
    }
  }
  // Persistir depois de processar: após uma queda, reexecutar o lote
  // anterior não duplica débitos por causa dos recibos transacionais.
  if (proximoCursor !== anterior.cursor) {
    try {
      const salvo = await gravarCursorRecuperacao(proximoCursor, anterior.generation);
      if (!salvo) {
        conflitosCursor++;
        // Conflito esperado sob concorrência; não é falha de cobrança.
        console.info('[BILLING] Cursor GCS avançado por outro worker; retomando na próxima verificação.');
      }
    } catch (e) {
      falhas++;
      console.error('[BILLING] Falha ao persistir cursor GCS:', e);
    }
  }
  return { processadas, falhas, conflitosCursor };
}

// Créditos Gemini por plano por ciclo de 30 dias
export const PLAN_CREDITS: Record<string, number> = {
    free:    5,
    starter: 150,
    pro:     600,
    studio:  1200,
    premium: 600, // backward compat — usuários existentes com plano='premium'
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
    starter: 150,
    premium: 600,
    pro:     600,
    studio:  1200,
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

/**
 * Com operacaoId gerado pelo servidor, o recibo e o saldo são transacionados
 * juntos no Firestore. Repetir uma cobrança depois de timeout/retry não
 * desconta novamente e um ID com outro consumo é recusado.
 * Chamadas legadas sem operacaoId preservam o comportamento anterior.
 */
export async function debitarCreditos(
    email: string, inputTokens: number, outputTokens: number, operacaoId?: string,
): Promise<number> {
    if (operacaoId !== undefined && (typeof operacaoId !== 'string' || !/^[a-zA-Z0-9_-]{12,128}$/.test(operacaoId))) {
        throw new Error('Identificador de cobrança inválido');
    }
    if (!inputTokens && !outputTokens) return 0;

    const creditosADebitar = calcularCreditos(inputTokens, outputTokens);
    const emailNormalizado = email.toLowerCase();
    const userRef = db.collection('clientes_premium').doc(emailNormalizado);
    const reciboRef = operacaoId ? userRef.collection('billing_logs').doc(operacaoId) : null;

    // GCS é uma outbox independente do Firestore. Falha do GCS não impede
    // tentar o débito normal; se ambos falharem, o handler registra o erro.
    let arquivoPendente: BillingObject | null = null;
    if (operacaoId && bucket) {
      const file = bucket.file(BILLING_RETRY_PREFIX + operacaoId + '.json');
      const payload: CobrancaPendente = {
        versao: 1, operacaoId, email: emailNormalizado, inputTokens, outputTokens,
        criadoEm: new Date().toISOString(),
      };
      try {
        await file.save(JSON.stringify(payload), {
          contentType: 'application/json', resumable: false,
          preconditionOpts: { ifGenerationMatch: 0 },
        });
        arquivoPendente = file;
      } catch (err) {
        const code = (err as {code?: number} | null)?.code;
        if (code === 412) {
          const [bytes] = await file.download();
          const anterior = JSON.parse(bytes.toString('utf8')) as CobrancaPendente;
          if (!registroPendenteIgual(anterior, emailNormalizado, inputTokens, outputTokens, operacaoId)) {
            throw new Error('Identificador de cobrança pendente com consumo diferente');
          }
          arquivoPendente = file;
        } else {
          console.error('[BILLING] Não foi possível persistir pendência no GCS:', err);
        }
      }
    }

    const executarTransacao = () => db.runTransaction(async (tx) => {
        // Firestore exige todas as leituras antes das escritas. As duas
        // leituras estão dentro da mesma transação para deduplicar sob concorrência.
        const doc = await tx.get(userRef);
        const recibo = reciboRef ? await tx.get(reciboRef) : null;
        if (recibo?.exists) {
            const anterior = recibo.data();
            if (anterior.input_tokens !== inputTokens || anterior.output_tokens !== outputTokens
                || anterior.credits_debited !== creditosADebitar) {
                throw new Error('Identificador de cobrança reutilizado com consumo diferente');
            }
            return;
        }
        if (!doc.exists) throw new Error('Usuário não encontrado');

        const dados = doc.data();
        // A transação respeita o saldo de todos os planos, inclusive pagos,
        // impedindo saldo negativo após chamadas concorrentes.
        const expirado = dados.creditos_expira_em && new Date(dados.creditos_expira_em) < new Date();
        const saldo = expirado ? 0 : (dados.creditos ?? 0);
        if (saldo < creditosADebitar) throw new Error('Créditos insuficientes');

        tx.update(userRef, { creditos: FV.increment(-creditosADebitar) });
        if (reciboRef) {
            tx.set(reciboRef, {
                input_tokens: inputTokens,
                output_tokens: outputTokens,
                credits_debited: creditosADebitar,
                criado_em: FV.serverTimestamp(),
            });
        }
    });

    // Em respostas 4/10/14 (deadline/ABORTED/UNAVAILABLE) o commit pode
    // ter ocorrido antes da perda da confirmação. A mesma chave garante
    // que repetir a transação não retire créditos pela segunda vez.
    let tentativas = 0;
    while (true) {
        try {
            await executarTransacao();
            break;
        } catch (e) {
            const codigo = (e as {code?: number | string} | null)?.code;
            if (!reciboRef || tentativas >= 2 || ![4, 10, 14, '4', '10', '14'].includes(codigo as number)) {
                throw e;
            }
            tentativas++;
            await new Promise<void>(resolve => setTimeout(resolve, tentativas * 50));
        }
    }

    // Sem chave, manter o log legado. Com chave, o recibo já foi gravado
    // atomicamente junto do débito e não se deve gerar um segundo log.
    if (!reciboRef) {
        userRef.collection('billing_logs').add({
            input_tokens:    inputTokens,
            output_tokens:   outputTokens,
            credits_debited: creditosADebitar,
            criado_em:       FV.serverTimestamp(),
        }).catch(e => console.error('[BILLING] log error:', e.message));
    }

    // O recibo no Firestore está confirmado. Falhar em remover o arquivo
    // não duplica o débito: o próximo worker verá o recibo existente.
    if (arquivoPendente) {
      try {
        await arquivoPendente.delete({ ignoreNotFound: true });
      } catch (err) {
        console.error('[BILLING] Pendência já liquidada, limpeza GCS falhou:', err);
      }
    }
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

