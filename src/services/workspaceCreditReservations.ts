import type { Firestore } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
interface WorkspaceWallet { creditos?: unknown; creditos_expira_em?: unknown }
export interface WorkspaceUsage { input?: number; output?: number }
export interface WorkspaceSettlement { creditos: number; descobertos: number; estimado: boolean; idempotente: boolean }
interface WorkspaceReservation {
  status: string; creditosReservados: number; ciclo: string | null;
  creditosDebitados: number; creditosDescobertos?: number; estimado?: boolean;
}
const { db, admin } = require('./firebase') as {
  db: Firestore; admin: { firestore: { FieldValue: typeof import('firebase-admin/firestore').FieldValue } };
};
'use strict';
// Reservas transacionais por solicitação Workspace (carteira Gemini existente).
// A reserva retira temporariamente créditos do saldo: outras rotas nunca
// conseguem gastar o mesmo saldo durante a geração.


const FV=admin.firestore.FieldValue;
const MAX_RESERVA=12;
const RECOVERY_AFTER_MS = 2 * 60 * 60 * 1000; // margem superior ao tempo normal de geração
const RECOVERY_BATCH=25;
export class WorkspaceCreditError extends Error {
  status: number;
  code: string;
  constructor(message: string, status=402, code='SEM_CREDITOS') { super(message);this.status=status;this.code=code; }
}
function money(value: unknown): value is number{return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;}
function ref(email: string, id: string) {
  if(typeof email!=='string'||!email.includes('@')||email.length>254)
    throw new WorkspaceCreditError('Conta inválida.',401,'SESSAO_EXPIRADA');
  if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))
    throw new WorkspaceCreditError('Operação inválida.',400,'OPERACAO_INVALIDA');
  const user=db.collection('clientes_premium').doc(email.toLowerCase());
  const chave = createHash('sha256').update(email.toLowerCase()+':'+id).digest('hex');
  return {user,reserva:user.collection('workspace_reservas').doc(id),
    recibo:user.collection('billing_logs').doc('ws-'+id),
    fila:db.collection('workspace_recovery_queue').doc(chave)};
}
function ciclo(data: WorkspaceWallet | null | undefined): string | null {return typeof data?.creditos_expira_em==='string'?data.creditos_expira_em:null;}
function expired(value: string | null | undefined) {return value && (!Number.isFinite(Date.parse(value))||Date.parse(value)<Date.now());}
function erroSaldo(){return new WorkspaceCreditError('Créditos Gemini insuficientes para utilizar a IA do Workspace.');}
export async function reservarWorkspace(email: string, operacaoId: string) {
  const {user,reserva,fila}=ref(email,operacaoId);
  return db.runTransaction(async tx=>{
    const [s,r]=await Promise.all([tx.get(user),tx.get(reserva)]);
    if(r.exists) throw new WorkspaceCreditError('Solicitação já reservada.',409,'OPERACAO_DUPLICADA');
    if(!s.exists)throw erroSaldo();
    const d: WorkspaceWallet=s.data()||{},wallet=d.creditos;
    if(!money(wallet)||wallet<1||expired(ciclo(d)))throw erroSaldo();
    const creditos=Math.min(MAX_RESERVA,wallet);
    tx.update(user,{creditos:FV.increment(-creditos)});
    const agora=Date.now();
    tx.set(reserva,{status:'reserved',creditosReservados:creditos,
      ciclo:ciclo(d),criadoEm:FV.serverTimestamp(),criadoMs:agora});
    // Outbox transacional: evita perda da reserva se a VPS cair sem finally.
    tx.set(fila,{email:email.toLowerCase(),operacaoId,criadoMs:agora});
    return {creditosReservados:creditos,operacaoId};
  });
}
export async function iniciarWorkspace(email: string, operacaoId: string) {
  const {reserva}=ref(email,operacaoId);
  return db.runTransaction(async tx=>{
    const snap=await tx.get(reserva);
    const d=snap.exists?snap.data():null;
    if(!d||d.status!=='reserved')throw new WorkspaceCreditError('Reserva inválida.',409,'RESERVA_INVALIDA');
    tx.update(reserva,{status:'running'});
  });
}
function tokensValidos(a: number, b: number){return Number.isSafeInteger(a)&&a>=0&&Number.isSafeInteger(b)&&b>=0&&a+b<=10_000_000;}
/**
 * Liquida uma única vez. Uma falha ambígua com o provedor já acionado mantém
 * a reserva como débito estimado: não devolve dinheiro que pode ter sido gasto.
 * Se a resposta real ultrapassar a reserva, tenta pagar o extra com o saldo
 * disponível e registra déficit (sem saldo negativo).
 */
export async function liquidarWorkspace(email: string, operacaoId: string, {input=0,output=0}: WorkspaceUsage = {}): Promise<WorkspaceSettlement> {
  if(!tokensValidos(input,output))throw new WorkspaceCreditError('Uso inválido.',400,'USO_INVALIDO');
  const {user,reserva,recibo,fila}=ref(email,operacaoId);
  return db.runTransaction(async tx=>{
    const [u,r,b]=await Promise.all([tx.get(user),tx.get(reserva),tx.get(recibo)]);
    const data=r.exists?r.data() as WorkspaceReservation:null;
    if(!data)throw new WorkspaceCreditError('Reserva não encontrada.',409,'RESERVA_INEXISTENTE');
    if(data.status==='settled') {
      // Auto-reparo para casos em que a fila foi mantida por versão antiga.
      tx.delete(fila);
      return {creditos:data.creditosDebitados,
        descobertos:data.creditosDescobertos||0,estimado:!!data.estimado,idempotente:true};
    }
    if(!['reserved','running'].includes(data.status))throw new WorkspaceCreditError('Reserva em estado inválido.',409,'RESERVA_INVALIDA');
    if(!u.exists)throw new WorkspaceCreditError('Conta não encontrada.',503,'FALHA_COBRANCA');
    const d: WorkspaceWallet=u.data()||{},wallet=d.creditos;
    if(!money(wallet))throw new WorkspaceCreditError('Saldo inválido.',503,'FALHA_COBRANCA');
    const estimado=data.status==='running'&&input+output===0;
    const necessario=estimado?data.creditosReservados:Math.ceil((input+output)/1000);
    const reservados=data.creditosReservados;
    if(!money(reservados))throw new WorkspaceCreditError('Reserva corrompida.',503,'FALHA_COBRANCA');
    const mesmoCiclo=ciclo(d)===data.ciclo&&!expired(data.ciclo);
    const devolucao=mesmoCiclo?Math.max(0,reservados-necessario):0;
    const extra=mesmoCiclo?Math.min(wallet,Math.max(0,necessario-reservados)):0;
    const descobertos=Math.max(0,necessario-reservados-extra);
    const debitados=Math.min(necessario,reservados)+extra;
    if(devolucao||extra)tx.update(user,{creditos:FV.increment(devolucao-extra)});
    const entry={status:'settled',creditosReservados:reservados,creditosDebitados:debitados,
      creditosDescobertos:descobertos,estimado,inputTokens:input,outputTokens:output,
      finalizadoEm:FV.serverTimestamp()};
    tx.update(reserva,entry);
    tx.delete(fila);
    if(!b.exists)tx.set(recibo,{tipo:'workspace',input_tokens:input,output_tokens:output,
      credits_debited:debitados,credits_uncovered:descobertos,estimated:estimado,
      criado_em:FV.serverTimestamp()});
    return {creditos:debitados,descobertos,estimado,idempotente:false};
  });
}
/**
 * Chamado pelo monitor já existente no processo (a cada 5 minutos).
 * Reserva 'reserved' sem chamada iniciada é devolvida; 'running'
 * é consumida integralmente como estimativa, para não liberar custo da API.
 * Rodadas concorrentes usam a idempotência da transação liquidarWorkspace.
 */
export async function recuperarReservasWorkspace({agora=Date.now(),limite=RECOVERY_BATCH}: { agora?: number; limite?: number } = {}) {
  const corte=agora-RECOVERY_AFTER_MS;
  const limiteSeguro=Number.isSafeInteger(limite)?Math.min(Math.max(1,limite),RECOVERY_BATCH):RECOVERY_BATCH;
  const docs=await db.collection('workspace_recovery_queue')
    .where('criadoMs','<=',corte).orderBy('criadoMs').limit(limiteSeguro).get();
  const resultado={examinadas:0,recuperadas:0,falhas:0};
  for(const doc of docs.docs) {
    resultado.examinadas++;
    const entry=doc.data()||{};
    if(typeof entry.email!=='string'||typeof entry.operacaoId!=='string') {
      // Nunca apagar um item ilegível sem auditoria: deve ser investigado.
      resultado.falhas++;
      console.error('[WORKSPACE-BILLING] Entrada de recuperação ilegível.');
      continue;
    }
    try {
      await liquidarWorkspace(entry.email,entry.operacaoId,{});
      resultado.recuperadas++;
    } catch(err) {
      resultado.falhas++;
      console.error('[WORKSPACE-BILLING] Recuperação pendente:',(err as { code?: string } | null)?.code||'erro');
    }
  }
  return resultado;
}
