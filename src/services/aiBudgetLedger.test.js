'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarLivroRazaoIa, OrcamentoIaIndisponivel } = require('./aiBudgetLedger');

// Fake transacional: serializa commits para reproduzir o conflito otimista do Firestore.
function banco() {
  const docs = new Map();
  let fila = Promise.resolve();
  const db = {
    collection(name) {
      return {doc(id) {return {id, key:name+'/'+id};}};
    },
    runTransaction(work) {
      const previous = fila;
      let unlock;
      fila = new Promise(resolve => {unlock=resolve;});
      return (async () => {
        await previous;
        try {
          const writes = [];
          const tx = {
            async get(ref) {
              const d = docs.get(ref.key);
              return {exists:!!d,data:()=>d && structuredClone(d)};
            },
            set(ref,data) {writes.push([ref.key,structuredClone(data)]);},
          };
          const result = await work(tx);
          for(const [k,v] of writes) docs.set(k,v);
          return result;
        } finally {unlock();}
      })();
    },
  };
  return {db,docs,livro:criarLivroRazaoIa(db)};
}
function user(docs, email='alice@example.test', plano='studio', active=true, expiry='2099-12-30T00:00:00.000Z') {
  docs.set('clientes_premium/'+email,{is_active:active,plano,creditos_expira_em:expiry});
}
async function codigo(promise,code) {
  await assert.rejects(promise,err=>err instanceof OrcamentoIaIndisponivel&&err.codigo===code);
}

test('reserva, liquida consumo real e evita débito repetido',async()=>{
  const b=banco();user(b.docs);
  const input={email:'ALICE@EXAMPLE.TEST',operacaoId:'pro-run-1',reservaMicroBrl:70000};
  const r=await b.livro.reservar(input);
  assert.equal(r.status,'reservado');
  assert.equal(r.limiteMicroBrl,12_000_000);
  assert.equal(r.reservadoMicroBrl,70000);
  assert.equal(await b.livro.liquidar({reciboId:r.reciboId,custoRealMicroBrl:50000}),'liquidado');
  assert.equal(await b.livro.liquidar({reciboId:r.reciboId,custoRealMicroBrl:50000}),'liquidado');
  const ledger=[...b.docs.entries()].find(([key])=>key.startsWith('ia_orcamentos/'))[1];
  assert.equal(ledger.gastoMicroBrl,50000);
  assert.equal(ledger.reservadoMicroBrl,0);
  assert.equal((await b.livro.reservar(input)).status,'liquidado');
});

test('duas reservas simultâneas não passam do teto',async()=>{
  const b=banco();user(b.docs,'alice@example.test','starter');
  const req=id=>b.livro.reservar({email:'alice@example.test',operacaoId:id,reservaMicroBrl:1_500_000});
  const r=await Promise.allSettled([req('a'),req('b')]);
  assert.equal(r.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(r.filter(x=>x.status==='rejected'&&x.reason.codigo==='ORCAMENTO_INSUFICIENTE').length,1);
});

test('mesma operação simultânea é idempotente, e troca de valor é rejeitada',async()=>{
  const b=banco();user(b.docs);
  const inp={email:'alice@example.test',operacaoId:'same',reservaMicroBrl:25000};
  const [a,c]=await Promise.all([b.livro.reservar(inp),b.livro.reservar(inp)]);
  assert.equal(a.reciboId,c.reciboId);
  const ledger=[...b.docs.entries()].find(([key])=>key.startsWith('ia_orcamentos/'))[1];
  assert.equal(ledger.reservadoMicroBrl,25000);
  await codigo(b.livro.reservar({...inp,reservaMicroBrl:24000}),'RECIBO_INCOMPATIVEL');
});

test('cancelamento devolve a reserva uma vez e nunca reabre operação cancelada',async()=>{
  const b=banco();user(b.docs);
  const input={email:'alice@example.test',operacaoId:'no-call',reservaMicroBrl:100000};
  const r=await b.livro.reservar(input);
  assert.equal(await b.livro.cancelar(r.reciboId),'cancelado');
  assert.equal(await b.livro.cancelar(r.reciboId),'cancelado');
  assert.equal((await b.livro.reservar(input)).status,'cancelado');
  const ledger=[...b.docs.entries()].find(([key])=>key.startsWith('ia_orcamentos/'))[1];
  assert.equal(ledger.reservadoMicroBrl,0);
  assert.equal(ledger.gastoMicroBrl,0);
});

test('overage real aparece no gasto sem esconder custo e impede futuras reservas',async()=>{
  const b=banco();user(b.docs,'alice@example.test','free',false);
  const r=await b.livro.reservar({email:'alice@example.test',operacaoId:'a',reservaMicroBrl:20000});
  await b.livro.liquidar({reciboId:r.reciboId,custoRealMicroBrl:65000});
  await codigo(b.livro.reservar({email:'alice@example.test',operacaoId:'b',reservaMicroBrl:1000}),'ORCAMENTO_INSUFICIENTE');
  const ledger=[...b.docs.entries()].find(([key])=>key.startsWith('ia_orcamentos/'))[1];
  assert.equal(ledger.gastoMicroBrl,65000);
});

test('renovação cria documento de ciclo separado sem corromper ciclo anterior',async()=>{
  const b=banco();user(b.docs);
  const a=await b.livro.reservar({email:'alice@example.test',operacaoId:'x',reservaMicroBrl:100000});
  user(b.docs,'alice@example.test','studio',true,'2099-12-31T00:00:00.000Z');
  const newCycle=await b.livro.reservar({email:'alice@example.test',operacaoId:'x',reservaMicroBrl:100000});
  assert.notEqual(a.reciboId,newCycle.reciboId);
  await b.livro.liquidar({reciboId:a.reciboId,custoRealMicroBrl:120000});
  assert.equal(b.docs.size,5);
  const ledgers=[...b.docs.entries()].filter(([k])=>k.startsWith('ia_orcamentos/')).map(x=>x[1]);
  assert.deepEqual(ledgers.map(x=>x.gastoMicroBrl).sort((a,b)=>a-b),[0,120000]);
});

test('ciclo expirado, usuário ausente, documento adulterado e entradas inválidas falham fechados',async()=>{
  const b=banco();
  await codigo(b.livro.reservar({email:'none@example.test',operacaoId:'a',reservaMicroBrl:1}),'USUARIO_NAO_ENCONTRADO');
  user(b.docs,'alice@example.test','studio',true,'2000-01-01T00:00:00Z');
  await codigo(b.livro.reservar({email:'alice@example.test',operacaoId:'a',reservaMicroBrl:1}),'CICLO_EXPIRADO');
  user(b.docs);
  for (const v of [-1,0,NaN,Infinity,1.5]) {
    await codigo(b.livro.reservar({email:'alice@example.test',operacaoId:'a',reservaMicroBrl:v}),'RESERVA_INVALIDA');
  }
  await codigo(b.livro.liquidar({reciboId:'wrong',custoRealMicroBrl:0}),'LIQUIDACAO_INVALIDA');
  user(b.docs,'alice@example.test','unknown');
  await codigo(b.livro.reservar({email:'alice@example.test',operacaoId:'a',reservaMicroBrl:1}),'PLANO_DESCONHECIDO');
});

test('nunca persiste email em chaves de recibos ou orçamento',async()=>{
  const b=banco();user(b.docs);
  await b.livro.reservar({email:'alice@example.test',operacaoId:'my-op',reservaMicroBrl:1200});
  const keys=[...b.docs.keys()].filter(x=>!x.startsWith('clientes_premium/'));
  assert.equal(keys.length,2);
  assert.ok(keys.every(k=>!k.includes('alice@')&&!k.includes('my-op')));
});
