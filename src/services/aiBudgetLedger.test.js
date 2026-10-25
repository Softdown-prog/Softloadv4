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
      return {doc(id) {
        const key=name+'/'+id;
        return {id,key,collection(subname) {
          const prefix=key+'/'+subname+'/';
          return {
            doc(docId) {
              const k=prefix+docId;
              return {id:docId,key:k,async get(){
                const row=docs.get(k);
                return {id:docId,exists:!!row,data:()=>row && structuredClone(row)};
              }};
            },
            orderBy(field,direction) {
              assert.equal(field,'criadoEm'); assert.equal(direction,'desc');
              let after=null;
              const query = {
                startAfter(snap) {
                  after = snap.id;
                  return query;
                },
                limit(n) {
                  return {
                    async get() {
                      let rows = [...docs.entries()].filter(([k]) => k.startsWith(prefix))
                        .sort((a, b) => b[1].criadoEm.localeCompare(a[1].criadoEm)
                          || b[0].localeCompare(a[0]));
                      if (after) {
                        const at = rows.findIndex(([k]) => k === prefix + after);
                        rows = at < 0 ? [] : rows.slice(at + 1);
                      }
                      return {docs: rows.slice(0, n).map(([k,v]) => ({
                        id: k.slice(prefix.length), data: () => structuredClone(v),
                      }))};
                    },
                  };
                },
              };
              return query;
            },
          };
        }};
      }};
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
  const req=id=>b.livro.reservar({email:'alice@example.test',operacaoId:id,reservaMicroBrl:900_000});
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

test('consulta V2 reflete saldo reservado e gasto, sem novas escritas',async()=>{
  const b=banco();user(b.docs,'alice@example.test','pro');
  const before=await b.livro.consultar('ALICE@EXAMPLE.TEST');
  assert.deepEqual(before,{
    plano:'pro',cicloExpiraEm:'2099-12-30T00:00:00.000Z',
    limiteMicroBrl:6_000_000,gastoMicroBrl:0,reservadoMicroBrl:0,
  });
  const r=await b.livro.reservar({email:'alice@example.test',operacaoId:'preview',reservaMicroBrl:300000});
  const inFlight=await b.livro.consultar('alice@example.test');
  assert.equal(inFlight.reservadoMicroBrl,300000);
  await b.livro.liquidar({reciboId:r.reciboId,custoRealMicroBrl:175000});
  const after=await b.livro.consultar('alice@example.test');
  assert.equal(after.reservadoMicroBrl,0);
  assert.equal(after.gastoMicroBrl,175000);
  assert.equal(b.docs.size,3); // não cria registro por consulta
});

test('consulta V2 falha fechada para falta de usuário, ciclo e adulteração',async()=>{
  const b=banco();
  await codigo(b.livro.consultar(''), 'CONSULTA_INVALIDA');
  await codigo(b.livro.consultar('alice@example.test'),'USUARIO_NAO_ENCONTRADO');
  user(b.docs,'alice@example.test','pro',true,'2000-01-01');
  await codigo(b.livro.consultar('alice@example.test'),'CICLO_EXPIRADO');
  user(b.docs,'alice@example.test','premium',true);
  const snap=await b.livro.consultar('alice@example.test');
  assert.equal(snap.plano,'pro');
  user(b.docs,'alice@example.test','studio',false);
  assert.equal((await b.livro.consultar('alice@example.test')).limiteMicroBrl,50000);
  const b2=banco();user(b2.docs);
  const r=await b2.livro.reservar({email:'alice@example.test',operacaoId:'corrupt',reservaMicroBrl:1000});
  const ledgerKey=[...b2.docs.keys()].find(k=>k.startsWith('ia_orcamentos/'));
  b2.docs.get(ledgerKey).gastoMicroBrl=-5;
  await codigo(b2.livro.consultar('alice@example.test'),'ORCAMENTO_CORROMPIDO');
});

test('extrato V2 é transacional, idempotente, privado e só inclui liquidados',async()=>{
  const b=banco();user(b.docs,'alice@example.test','pro');
  const contexto={ferramenta:'solaris-chat',modelo:'gemini-2.5-pro',projeto:'ProjetoAbc123'};
  const a=await b.livro.reservar({email:'alice@example.test',operacaoId:'chamada-1',reservaMicroBrl:90000,contexto});
  assert.deepEqual(await b.livro.listarExtrato('alice@example.test'),[]);
  await b.livro.liquidar({reciboId:a.reciboId,custoRealMicroBrl:21000});
  await b.livro.liquidar({reciboId:a.reciboId,custoRealMicroBrl:21000});
  const eventos=await b.livro.listarExtrato('ALICE@EXAMPLE.TEST');
  assert.equal(eventos.length,1);
  assert.equal(eventos[0].creditos,3);
  assert.equal(eventos[0].modelo,'gemini-2.5-pro');
  assert.equal(eventos[0].projeto,'ProjetoAbc123');
  assert.equal(eventos[0].ferramenta,'solaris-chat');
  assert.equal(eventos[0].estimado,false);
  assert.ok(!JSON.stringify(eventos).includes('alice@example.test'));
  const contas=[...b.docs.entries()].filter(([key])=>key.includes('/extrato/'));
  assert.equal(contas.length,1);
  assert.equal(contas[0][1].id,a.reciboId);
  assert.equal((await b.livro.consultar('alice@example.test')).gastoMicroBrl,21000);
  user(b.docs,'bob@example.test','pro');
  assert.deepEqual(await b.livro.listarExtrato('bob@example.test'),[]);
});
test('recibo estimado distingue ausência de uso; cancelado não gera lançamento',async()=>{
  const b=banco();user(b.docs);
  const context={ferramenta:'solaris-upload',modelo:'gemini-2.5-pro'};
  const a=await b.livro.reservar({email:'alice@example.test',operacaoId:'est1',reservaMicroBrl:45000,contexto:context});
  const c=await b.livro.reservar({email:'alice@example.test',operacaoId:'cancel1',reservaMicroBrl:500,contexto:context});
  await b.livro.cancelar(c.reciboId);
  await b.livro.liquidar({reciboId:a.reciboId,custoRealMicroBrl:45000,estimado:true});
  const events=await b.livro.listarExtrato('alice@example.test');
  assert.equal(events.length,1);assert.equal(events[0].estimado,true);
  assert.equal(events[0].creditos,5);
});
test('contexto é restrito e repetição incompatível não reabre recibo',async()=>{
  const b=banco();user(b.docs);
  const ok={email:'alice@example.test',operacaoId:'ctx-test',reservaMicroBrl:10000,
    contexto:{ferramenta:'solaris-chat',modelo:'gemini-2.5-flash',projeto:'project-123456'}};
  const r=await b.livro.reservar(ok);
  await codigo(b.livro.reservar({...ok,contexto:{...ok.contexto,modelo:'gemini-2.5-pro'}}),'RECIBO_INCOMPATIVEL');
  for (const ctx of [
    {ferramenta:'solaris-chat',modelo:'gemini-2.5-pro',projeto:'not safe /'},
    {ferramenta:'admin',modelo:'gemini-2.5-pro'},
    {ferramenta:'solaris-chat',modelo:'OpenAI'},
  ]) {
    await codigo(b.livro.reservar({...ok,operacaoId:'other-'+Math.random(),contexto:ctx}),'CONTEXTO_INVALIDO');
  }
  await codigo(b.livro.listarExtrato('alice@example.test',500),'CONSULTA_INVALIDA');
  assert.equal((await b.livro.listarExtrato('alice@example.test')).length,0);
});

test('paginacao do extrato percorre todas as operacoes sem repetir recibos',async()=>{
  const b=banco();user(b.docs,'alice@example.test','studio');
  const base='alice@example.test';
  const dates=['2026-10-25T10:00:00.000Z','2026-10-25T10:01:00.000Z','2026-10-25T10:02:00.000Z'];
  for(let i=0;i<45;i++){
    const r=await b.livro.reservar({email:base,operacaoId:'page-'+i,reservaMicroBrl:10000,
      contexto:{ferramenta:'solaris-chat',modelo:'gemini-2.5-pro',projeto:'proj_ABC123'}});
    await b.livro.liquidar({reciboId:r.reciboId,custoRealMicroBrl:10000});
  }
  // Forca empates em criadoEm para testar cursor por snapshot (id ordena empates).
  const extratos=[...b.docs.entries()].filter(([k])=>k.includes('/extrato/'));
  for(let i=0;i<extratos.length;i++)extratos[i][1].criadoEm=dates[i%3];
  let cursor;const ids=[];
  const sizes=[];
  do {
    const page=await b.livro.listarExtratoPagina(base,20,cursor);
    ids.push(...page.itens.map(x=>x.id)); sizes.push(page.itens.length);
    cursor=page.proximoCursor || undefined;
  } while(cursor);
  assert.deepEqual(sizes,[20,20,5]);
  assert.equal(ids.length,45);
  assert.equal(new Set(ids).size,45);
  const page1=await b.livro.listarExtratoPagina(base,20);
  assert.equal((await b.livro.listarExtrato(base,20)).length,20);
  assert.match(page1.proximoCursor,/^[a-f0-9]{64}$/);
  user(b.docs,'bob@example.test','studio');
  await codigo(b.livro.listarExtratoPagina('bob@example.test',20,page1.proximoCursor),'CURSOR_INVALIDO');
  await codigo(b.livro.listarExtratoPagina(base,20,'abc'),'CONSULTA_INVALIDA');
  await codigo(b.livro.listarExtratoPagina(base,41),'CONSULTA_INVALIDA');
});

test('auditoria visual usa mesmo ledger V2 e gera recibo com contexto próprio',async()=>{
  const b=banco();user(b.docs,'alice@example.test','starter');
  const req={email:'alice@example.test',operacaoId:'visual-1',reservaMicroBrl:10000,
    contexto:{ferramenta:'solaris-visual',modelo:'gemini-2.5-flash'}};
  const r=await b.livro.reservar(req);
  await b.livro.liquidar({reciboId:r.reciboId,custoRealMicroBrl:3800});
  const itens=await b.livro.listarExtrato('alice@example.test');
  assert.equal(itens.length,1);
  assert.equal(itens[0].ferramenta,'solaris-visual');
  assert.equal(itens[0].creditos,1);
});
