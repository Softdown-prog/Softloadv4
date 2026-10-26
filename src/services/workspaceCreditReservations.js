'use strict';
// Reservas transacionais por solicitação Workspace (carteira Gemini existente).
// A reserva retira temporariamente créditos do saldo: outras rotas nunca
// conseguem gastar o mesmo saldo durante a geração.
const { randomUUID } = require('node:crypto');
const { db, admin } = require('./firebase');
const FV=admin.firestore.FieldValue;
const MAX_RESERVA=12;
class WorkspaceCreditError extends Error {
  constructor(message, status=402, code='SEM_CREDITOS') { super(message);this.status=status;this.code=code; }
}
function money(value){return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;}
function ref(email,id) {
  if(typeof email!=='string'||!email.includes('@')||email.length>254)
    throw new WorkspaceCreditError('Conta inválida.',401,'SESSAO_EXPIRADA');
  if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))
    throw new WorkspaceCreditError('Operação inválida.',400,'OPERACAO_INVALIDA');
  const user=db.collection('clientes_premium').doc(email.toLowerCase());
  return {user,reserva:user.collection('workspace_reservas').doc(id),
    recibo:user.collection('billing_logs').doc('ws-'+id)};
}
function ciclo(data) {return typeof data?.creditos_expira_em==='string'?data.creditos_expira_em:null;}
function expired(value) {return value && (!Number.isFinite(Date.parse(value))||Date.parse(value)<Date.now());}
function erroSaldo(){return new WorkspaceCreditError('Créditos Gemini insuficientes para utilizar a IA do Workspace.');}
async function reservarWorkspace(email,operacaoId) {
  const {user,reserva}=ref(email,operacaoId);
  return db.runTransaction(async tx=>{
    const [s,r]=await Promise.all([tx.get(user),tx.get(reserva)]);
    if(r.exists) throw new WorkspaceCreditError('Solicitação já reservada.',409,'OPERACAO_DUPLICADA');
    if(!s.exists)throw erroSaldo();
    const d=s.data()||{},wallet=d.creditos;
    if(!money(wallet)||wallet<1||expired(ciclo(d)))throw erroSaldo();
    const creditos=Math.min(MAX_RESERVA,wallet);
    tx.update(user,{creditos:FV.increment(-creditos)});
    tx.set(reserva,{status:'reserved',creditosReservados:creditos,
      ciclo:ciclo(d),criadoEm:FV.serverTimestamp(),criadoMs:Date.now()});
    return {creditosReservados:creditos,operacaoId};
  });
}
async function iniciarWorkspace(email,operacaoId) {
  const {reserva}=ref(email,operacaoId);
  return db.runTransaction(async tx=>{
    const snap=await tx.get(reserva);
    const d=snap.exists?snap.data():null;
    if(!d||d.status!=='reserved')throw new WorkspaceCreditError('Reserva inválida.',409,'RESERVA_INVALIDA');
    tx.update(reserva,{status:'running'});
  });
}
function tokensValidos(a,b){return Number.isSafeInteger(a)&&a>=0&&Number.isSafeInteger(b)&&b>=0&&a+b<=10_000_000;}
/**
 * Liquida uma única vez. Uma falha ambígua com o provedor já acionado mantém
 * a reserva como débito estimado: não devolve dinheiro que pode ter sido gasto.
 * Se a resposta real ultrapassar a reserva, tenta pagar o extra com o saldo
 * disponível e registra déficit (sem saldo negativo).
 */
async function liquidarWorkspace(email,operacaoId,{input=0,output=0}={}) {
  if(!tokensValidos(input,output))throw new WorkspaceCreditError('Uso inválido.',400,'USO_INVALIDO');
  const {user,reserva,recibo}=ref(email,operacaoId);
  return db.runTransaction(async tx=>{
    const [u,r,b]=await Promise.all([tx.get(user),tx.get(reserva),tx.get(recibo)]);
    const data=r.exists?r.data():null;
    if(!data)throw new WorkspaceCreditError('Reserva não encontrada.',409,'RESERVA_INEXISTENTE');
    if(data.status==='settled')return {creditos:data.creditosDebitados,
      descobertos:data.creditosDescobertos||0,estimado:!!data.estimado,idempotente:true};
    if(!['reserved','running'].includes(data.status))throw new WorkspaceCreditError('Reserva em estado inválido.',409,'RESERVA_INVALIDA');
    if(!u.exists)throw new WorkspaceCreditError('Conta não encontrada.',503,'FALHA_COBRANCA');
    const d=u.data()||{},wallet=d.creditos;
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
    if(!b.exists)tx.set(recibo,{tipo:'workspace',input_tokens:input,output_tokens:output,
      credits_debited:debitados,credits_uncovered:descobertos,estimated:estimado,
      criado_em:FV.serverTimestamp()});
    return {creditos:debitados,descobertos,estimado,idempotente:false};
  });
}
module.exports={reservarWorkspace,iniciarWorkspace,liquidarWorkspace,WorkspaceCreditError};
