'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarHandlerChatSolaris } = require('./solarisChatHandler');
const { criarHandlerUploadSolaris } = require('./solarisUploadHandler');

function fakeResponse() {
  const events = [];
  return {
    events, statusCode: 200, jsonBody: undefined, ended: false, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(value) { this.jsonBody = value; },
    setHeader(name, value) { this.headers[name] = value; },
    flushHeaders() {},
    write(wire) { assert.match(wire, /^data: /); events.push(JSON.parse(wire.slice(6).trim())); },
    end() { this.ended = true; },
  };
}

function fakeChatDeps() {
  const calls = { debit: [], saved: [], loaded: [], projects: [] };
  const dependencies = {
    chatStorage: {
      newSessionId: () => '1790000000000_zzzz',
      async loadSession() { return null; },
      async saveSession(...args) { calls.saved.push(args); },
    },
    db: {
      collection(name) {
        if (name === 'chat_stream_requests') return { doc(id) { return { id }; } };
        return { async add() {} };
      },
      async runTransaction(callback) {
        return callback({async get() {return {exists:false};},set(){}});
      },
    },
    admin: { firestore: { FieldValue: { serverTimestamp: () => 'now' } } },
    async debitarCreditos(...args) { calls.debit.push(args); },
    solarisChat: { async *perguntarStream(_message, _history, tokens) {
      tokens.total = 8; tokens.input = 3; tokens.output = 5;
      yield 'Olá, '; yield 'Solaris!';
    } },
    modelRouter: {},
    orquestrador: { async gerarProjeto() { throw Error('geração não esperada'); } },
    async carregarProjeto(...args) { calls.loaded.push(args); return null; },
    async apagarProjeto() {},
    async salvarProjeto(...args) { calls.projects.push(args); return { ok: true }; },
    lerProjetoParaPersistir: () => [],
    deletarArquivo: () => {},
    criarArquivo: () => {},
    listarProjeto: () => [],
    async criarZip() { throw Error('ZIP não esperado'); },
    async responderOuEditarProjeto() { throw Error('editor não esperado'); },
    removerMarcadorTruncado: t => t,
    detectarMarcador: () => null,
  };
  return { dependencies, calls };
}

function fakeUploadDeps() {
  const calls = { extracted: [], persisted: [], debits: [], removed: [] };
  const dependencies = {
    upload: { single(name) {
      assert.equal(name, 'arquivo');
      return (req, _res, callback) => {
        req.file = { buffer: Buffer.from('PK\u0003\u0004') };
        callback();
      };
    } },
    chatStorage: { newSessionId: () => '1790000000000_zzzz' },
    async extrairZipViaSandbox(buffer) {
      calls.extracted.push(buffer);
      return { totalArquivos: 1, arquivos: [{ caminho: 'index.html', conteudo: '<h1>ok</h1>' }] };
    },
    criarArquivo() { return { ok: true }; },
    listarProjeto() { return ['index.html']; },
    lerArquivo() { return { ok: true, conteudo: '<h1>ok</h1>' }; },
    detectarFramework() { return { melhorPalpite: 'html5', candidatos: [{framework: 'html5',score:4,evidencias:['HTML']}] }; },
    async inspecionarProjeto() { return { ok: false, motivo: 'indisponível' }; },
    modelRouter: {},
    async debitarCreditos(...args) { calls.debits.push(args); },
    async apagarProjeto(...args) { calls.removed.push(args); },
    async salvarProjeto(...args) { calls.persisted.push(args); return { ok: true }; },
  };
  return { dependencies, calls };
}
const req = (body = {}, user = {uid: 'u-123', email: 'dev@example.test', plano: 'free'}) => ({
  body: { requestId: '2f071443-bd75-4fc3-98d8-d2aacbb626c8', ...body }, session: {user},
});

test('chat mantém streaming SSE, histórico, tokens, débito e persistência', async () => {
  const { dependencies, calls } = fakeChatDeps();
  const response = fakeResponse();
  await criarHandlerChatSolaris(dependencies)(req({
    message: '  preciso de ajuda  ', sessionId: '1790000000000_abcd',
    history: [{role: 'user',content: 'contexto'}, {role:'system',content:'ignore'}],
  }), response);
  assert.equal(response.ended, true);
  assert.equal(response.headers['Content-Type'], 'text/event-stream; charset=utf-8');
  assert.deepEqual(response.events.map(e => e.type), ['status', 'chunk', 'chunk', 'done']);
  assert.equal(response.events[3].reply, 'Olá, Solaris!');
  assert.deepEqual(response.events[3].tokens, {total: 8,input:3,output:5});
  assert.equal(response.events[3].sessionId,'1790000000000_abcd');
  assert.equal(calls.loaded.length,1);
  assert.equal(calls.saved.length,1);
  assert.deepEqual(calls.debit[0].slice(0,3), ['dev@example.test',3,5]);
  assert.match(calls.debit[0][3], /^[a-zA-Z0-9_-]{12,128}$/);
  const stored=calls.saved[0][3];
  assert.equal(stored.messages.length,3);
  assert.equal(stored.messages[0].content, 'contexto');
});

test('chat rejeita mensagens e IDs inválidos antes de gerar SSE ou cobrar', async () => {
  const { dependencies, calls }=fakeChatDeps();
  const handler=criarHandlerChatSolaris(dependencies);
  for(const body of [{message: 1},{message:'x',sessionId:'../../admin'}]) {
    const response=fakeResponse();
    await handler(req(body),response);
    assert.equal(response.statusCode,400);
    assert.equal(response.events.length,0);
    assert.equal(response.ended,false);
  }
  assert.equal(calls.debit.length,0);
  assert.equal(calls.loaded.length,0);
});

test('upload envia só conteúdo ao sandbox, detecta framework e mantém sessão', async () => {
  const {dependencies,calls}=fakeUploadDeps();
  const response=fakeResponse();
  criarHandlerUploadSolaris(dependencies)(req({sessionId:'1790000000000_abcd'}),response);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(response.statusCode,200);
  assert.equal(response.jsonBody.ok,true);
  assert.equal(response.jsonBody.framework,'html5');
  assert.equal(response.jsonBody.temProjeto,true);
  assert.equal(response.jsonBody.sessionId,'1790000000000_abcd');
  assert.equal(calls.extracted.length,1);
  assert.equal(calls.persisted.length,1);
  assert.equal(calls.removed.length,0); // replacement never deletes the old project first
  assert.equal(calls.debits.length,0);
});

test('upload rejeita sessão inválida antes do sandbox e não persiste', async () => {
  const {dependencies,calls}=fakeUploadDeps();
  const response=fakeResponse();
  criarHandlerUploadSolaris(dependencies)(req({sessionId:'../segredo'}),response);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(response.statusCode,400);
  assert.equal(response.jsonBody.error,'Identificador de sessão inválido.');
  assert.equal(calls.extracted.length,0);
  assert.equal(calls.persisted.length,0);
});

test('upload mantém resposta genérica para ZIP rejeitado pelo sandbox', async () => {
  const {dependencies,calls}=fakeUploadDeps();
  dependencies.extrairZipViaSandbox=async()=>{throw Error('internal path /tmp/secret');};
  const response=fakeResponse();
  criarHandlerUploadSolaris(dependencies)(req({sessionId:'1790000000000_abcd'}),response);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(response.statusCode,400);
  assert.ok(!JSON.stringify(response.jsonBody).includes('/tmp/secret'));
  assert.equal(calls.persisted.length,0);
});


test('chat usa streaming normal mesmo se projeto no GCS estiver indisponível', async () => {
  const {dependencies,calls}=fakeChatDeps();
  dependencies.carregarProjeto=async()=>{throw Error('GCS offline');};
  const response=fakeResponse();
  await criarHandlerChatSolaris(dependencies)(req({message:'bom dia'}),response);
  assert.deepEqual(response.events.map(e=>e.type),['status','chunk','chunk','done']);
  assert.equal(response.ended,true);
  assert.equal(calls.debit.length,1);
  assert.equal(calls.saved.length,1);
});

test('falha da sessão anterior deixa o editor funcionar sem propostas', async () => {
  const {dependencies,calls}=fakeChatDeps();
  dependencies.carregarProjeto=async()=>({framework:'html5',arquivos:['index.html']});
  dependencies.chatStorage.loadSession=async()=>{throw Error('timeout');};
  let proposals;
  dependencies.responderOuEditarProjeto=async options=>{
    proposals=options.propostasPendentes;
    return {ok:true,resposta:'Arquivo analisado.',propostasFinais:[],mudancasAplicadas:[],tokens:{input:2,output:4,total:6}};
  };
  const response=fakeResponse();
  await criarHandlerChatSolaris(dependencies)(req({message:'revise index.html'}),response);
  assert.deepEqual(proposals,[]);
  assert.deepEqual(response.events.map(e=>e.type),['status','chunk','done']);
  assert.deepEqual(calls.debit[0].slice(0,3),['dev@example.test',2,4]);
});

test('sessão anterior com propostas de formato inválido não derruba o editor', async () => {
  const {dependencies}=fakeChatDeps();
  dependencies.carregarProjeto=async()=>({framework:'html5',arquivos:['index.html']});
  dependencies.chatStorage.loadSession=async()=>({meta:{edicaoProjetoPendente:{caminho:'index.html'}}});
  let proposals;
  dependencies.responderOuEditarProjeto=async options=>{
    proposals=options.propostasPendentes;
    return {ok:true,resposta:'Tudo certo',propostasFinais:[],mudancasAplicadas:[],tokens:{input:1,output:2,total:3}};
  };
  const response=fakeResponse();
  await criarHandlerChatSolaris(dependencies)(req({message:'inspecione'}),response);
  assert.deepEqual(proposals,[]);
  assert.equal(response.events.at(-1).type,'done');
});

test('editor com tokens malformados usa estimativa em vez de cobrar contagens inválidas', async () => {
  const {dependencies,calls}=fakeChatDeps();
  dependencies.carregarProjeto=async()=>({framework:'html5',arquivos:[]});
  dependencies.responderOuEditarProjeto=async()=>({
    ok:true,resposta:'resultado',propostasFinais:[],mudancasAplicadas:[],
    tokens:{total:Infinity,input:-1000,output:'500'},
  });
  const response=fakeResponse();
  await criarHandlerChatSolaris(dependencies)(req({message:'teste'}),response);
  assert.deepEqual(response.events.at(-1).tokens,{total:0,input:0,output:0});
  assert.deepEqual(calls.debit[0].slice(0,3),['dev@example.test',Math.ceil(5/3.5),Math.ceil(9/3.5)]);
});

test('falha ao salvar sessão não impede SSE nem cobrança', async () => {
  const {dependencies,calls}=fakeChatDeps();
  dependencies.chatStorage.saveSession=async()=>{throw Error('GCS quota');};
  const response=fakeResponse();
  await criarHandlerChatSolaris(dependencies)(req({message:'teste'}),response);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(response.events.at(-1).type,'done');
  assert.equal(response.ended,true);
  assert.equal(calls.debit.length,1);
});

test('falha da cobrança não descarta sessão nem esconde resposta', async () => {
  const {dependencies,calls}=fakeChatDeps();
  dependencies.debitarCreditos=async()=>{throw Error('billing offline');};
  const response=fakeResponse();
  await criarHandlerChatSolaris(dependencies)(req({message:'teste'}),response);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(response.events.at(-1).type,'done');
  assert.equal(calls.saved.length,1);
});

test('upload entrega detecção mesmo quando salvar no GCS falha', async () => {
  const {dependencies,calls}=fakeUploadDeps();
  dependencies.salvarProjeto=async()=>{throw Error('GCS quota');};
  const response=fakeResponse();
  criarHandlerUploadSolaris(dependencies)(req({sessionId:'1790000000000_abcd'}),response);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(response.jsonBody.ok,true);
  assert.equal(response.jsonBody.temProjeto,false);
  assert.equal(calls.debits.length,0);
});

test('upload debita inspeção apenas com números reais', async () => {
  const {dependencies,calls}=fakeUploadDeps();
  dependencies.inspecionarProjeto=async()=>({ok:true,resumo:'HTML simples',tokens:{input:8,output:13,total:21}});
  const response=fakeResponse();
  criarHandlerUploadSolaris(dependencies)(req({sessionId:'1790000000000_abcd'}),response);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(response.jsonBody.analiseIA,'HTML simples');
  assert.deepEqual(calls.debits[0],['dev@example.test',8,13]);
});

test('upload rejeita metadados inválidos de billing sem perder a resposta', async () => {
  const {dependencies,calls}=fakeUploadDeps();
  dependencies.inspecionarProjeto=async()=>({ok:true,resumo:'relatório',tokens:{input:'8',output:-13,total:100}});
  const response=fakeResponse();
  criarHandlerUploadSolaris(dependencies)(req({sessionId:'1790000000000_abcd'}),response);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(response.jsonBody.ok,true);
  assert.equal(calls.debits.length,0);
});

test('chat aplica edição sem apagar projeto anterior antes de salvar', async () => {
  const {dependencies,calls}=fakeChatDeps();
  dependencies.carregarProjeto=async()=>({framework:'html5',arquivos:['index.html']});
  dependencies.apagarProjeto=async()=>{throw Error('apagarProjeto não deveria ser chamado');};
  dependencies.lerProjetoParaPersistir=()=>[{caminho:'index.html',conteudo:Buffer.from('atualizado')}];
  dependencies.criarZip=async()=>Buffer.from('ZIP');
  dependencies.responderOuEditarProjeto=async options=>{
    await options.aplicarMudancasReal([{caminho:'index.html',operacao:'editar',conteudoNovo:'atualizado'}]);
    return {ok:true,resposta:'Edição aplicada',mudancasAplicadas:[{caminho:'index.html'}],propostasFinais:[],tokens:{input:3,output:5,total:8}};
  };
  const response=fakeResponse();
  await criarHandlerChatSolaris(dependencies)(req({message:'aplique edição'}),response);
  assert.equal(response.events.at(-1).type,'done');
  assert.equal(response.events.at(-1).zip.nome,'projeto-solaris-atualizado.zip');
  assert.equal(calls.projects.length,1);
  assert.equal(calls.projects[0][0].framework,'html5');
});

test('upload informa conflito 409 e não declara upload como persistido',async()=>{
  const {dependencies}=fakeUploadDeps();
  dependencies.salvarProjeto=async()=>{throw Object.assign(Error('busy'),{code:'SOLARIS_PROJECT_BUSY',status:409});};
  const response=fakeResponse();
  criarHandlerUploadSolaris(dependencies)(req({sessionId:'1790000000000_abcd'}),response);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(response.statusCode,409);
  assert.equal(response.jsonBody.code,'SOLARIS_PROJECT_BUSY');
  assert.match(response.jsonBody.error,/atualizado em outra solicitação/);
  assert.equal(response.jsonBody.temProjeto,undefined);
});

test('chat não mascara conflito na edição com resposta genérica',async()=>{
  const {dependencies}=fakeChatDeps();
  dependencies.carregarProjeto=async()=>({framework:'html5',arquivos:['index.html']});
  let normalCalled=false;
  dependencies.solarisChat.perguntarStream=async function*(){normalCalled=true;yield 'texto incorreto'};
  dependencies.responderOuEditarProjeto=async({aplicarMudancasReal})=>{
    await aplicarMudancasReal([{caminho:'index.html',operacao:'editar',conteudoNovo:'novo'}]);
    return {ok:true,resposta:'salvo',propostasFinais:[],mudancasAplicadas:[],tokens:{total:0,input:0,output:0}};
  };
  dependencies.salvarProjeto=async()=>{throw Object.assign(Error('busy'),{code:'SOLARIS_PROJECT_BUSY',status:409});};
  const response=fakeResponse();
  await criarHandlerChatSolaris(dependencies)(req({message:'edite index.html'}),response);
  assert.equal(normalCalled,false);
  assert.equal(response.events.at(-1).type,'error');
  assert.match(response.events.at(-1).message,/atualizado em outra solicitação/);
  assert.ok(response.events.every(x=>x.type!=='done'));
  assert.equal(response.ended,true);
});

test('chat recusa edição desatualizada sem resposta genérica nem confirmação de sucesso',async()=>{
  const {dependencies}=fakeChatDeps();
  dependencies.carregarProjeto=async()=>({framework:'html5',arquivos:['index.html'],versao:'snapshot-antigo'});
  let normalCalled=false;
  let received;
  dependencies.solarisChat.perguntarStream=async function*(){normalCalled=true;yield 'inadequado'};
  dependencies.responderOuEditarProjeto=async({aplicarMudancasReal})=>{
    await aplicarMudancasReal([{caminho:'index.html',operacao:'editar',conteudoNovo:'edicao antiga'}]);
    return {ok:true,resposta:'alterado',propostasFinais:[],mudancasAplicadas:[],tokens:{total:0,input:0,output:0}};
  };
  dependencies.salvarProjeto=async options=>{
    received=options;
    throw Object.assign(Error('version mismatch'),{code:'SOLARIS_PROJECT_STALE',status:409});
  };
  const response=fakeResponse();
  await criarHandlerChatSolaris(dependencies)(req({message:'edite meu projeto'}),response);
  assert.equal(received.expectedVersion,'snapshot-antigo');
  assert.equal(normalCalled,false);
  assert.equal(response.events.at(-1).type,'error');
  assert.match(response.events.at(-1).message,/projeto mudou/);
  assert.ok(response.events.every(e=>e.type!=='done'));
  assert.equal(response.ended,true);
});

test('Solaris aguarda saveSession e debitarCreditos antes do done', async () => {
  let soltarSave, soltarDebit;
  const gateSave = new Promise(resolve => { soltarSave = resolve; });
  const gateDebit = new Promise(resolve => { soltarDebit = resolve; });
  const { dependencies, calls } = fakeChatDeps();
  dependencies.chatStorage.saveSession = async (...args) => {
    await gateSave; calls.saved.push(args);
  };
  dependencies.debitarCreditos = async (...args) => {
    await gateDebit; calls.debit.push(args);
  };
  const response = fakeResponse();
  const pending = criarHandlerChatSolaris(dependencies)(req({message:'teste'}), response);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(response.events.some(e => e.type === 'done'), false);
  assert.equal(response.ended, false);
  soltarSave();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(response.events.some(e => e.type === 'done'), false);
  assert.equal(response.ended, false);
  soltarDebit();
  await pending;
  assert.equal(calls.saved.length, 1);
  assert.equal(calls.debit.length, 1);
  assert.equal(response.events.at(-1).type, 'done');
  assert.equal(response.ended, true);
});

test('Solaris alerta falta de persistência sem evitar o débito real', async () => {
  const {dependencies,calls} = fakeChatDeps();
  dependencies.chatStorage.saveSession = async () => {throw Error('GCS offline');};
  const response = fakeResponse();
  await criarHandlerChatSolaris(dependencies)(req({message:'teste'}),response);
  assert.equal(calls.debit.length,1);
  assert.match(response.events.at(-1).reply,/não consegui salvar esta conversa no histórico/i);
  assert.equal(response.ended,true);
});

test('Solaris não perde histórico quando a cobrança falha', async () => {
  const {dependencies,calls} = fakeChatDeps();
  dependencies.debitarCreditos = async () => {throw Error('Firestore billing');};
  const response = fakeResponse();
  await criarHandlerChatSolaris(dependencies)(req({message:'teste'}),response);
  assert.equal(calls.saved.length,1);
  assert.match(response.events.at(-1).reply,/não foi possível confirmar a atualização dos créditos/i);
});

test('ferramenta Asset Forge 2D ativa contexto sem alterar mensagem armazenada', async () => {
  const { dependencies,calls }=fakeChatDeps();
  dependencies.contextoForgeWorker=async()=> 'A7 Forge 2D: sprites disponíveis no Worker';
  let injectedPrompt='';
  dependencies.solarisChat.perguntarStream=async function*(message,_history,tokens) {
    injectedPrompt=message;
    Object.assign(tokens,{total:2,input:1,output:1});
    yield 'Posso gerar sprites proceduralmente.';
  };
  const response=fakeResponse();
  await criarHandlerChatSolaris(dependencies)(req({message:'quero um personagem',tool:'asset-forge-2d'}),response);
  assert.match(injectedPrompt,/A7 Forge 2D/);
  assert.match(injectedPrompt,/sprites/);
  assert.match(injectedPrompt,/Pedido do usuário: quero um personagem/);
  assert.equal(calls.saved[0][3].messages.at(-2).content,'quero um personagem');
  assert.equal(response.events.at(-1).type,'done');
});

test('chat Assets consulta Worker HTTP autenticado real antes de enviar contexto ao modelo', {
  skip: !require('fs').existsSync(require('path').resolve(__dirname,'../../../agent/node_modules/express')),
}, async()=>{
  const {createApp}=await import('../../../agent/src/server.js');
  const snapshot={...process.env};
  process.env.WORKER_SHARED_SECRET='integration-secret';
  const {Agent}=await import('../../../agent/src/agent.js');
  const agent=new Agent();
  // Catalog is read-only: no workspace needs to be initialized or shared.
  agent.running=true;
  const server=createApp(agent).listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  process.env.WORKER_AGENT_SERVICE_URL='http://127.0.0.1:'+server.address().port;
  process.env.WORKER_AGENT_IAM_AUTH='false';
  try {
    const {dependencies,calls}=fakeChatDeps();
    let prompt='';
    dependencies.solarisChat.perguntarStream=async function*(message){prompt=message;yield 'Catálogo consultado; nenhum arquivo renderizado.';};
    const response=fakeResponse();
    await criarHandlerChatSolaris(dependencies)(req({message:'quais assets posso criar?',tool:'asset-forge-2d'}),response);
    assert.match(prompt,/Catálogo consultado no Worker/);
    assert.match(prompt,/recipeId/);
    assert.equal(response.events.at(-1).type,'done');
    assert.equal(calls.saved.length,1);
  } finally {await new Promise(resolve=>server.close(resolve));process.env=snapshot;}
});

test('modo GitHub usa contexto do repositorio validado e preserva o texto original',async()=>{
  const { dependencies,calls }=fakeChatDeps();
  let asked='',prompt='';
  dependencies.contextoRepositorioPublico=async repo=>{
    asked=repo;
    return 'GitHub público: Softdown-prog/Softloadv4, branch main (somente leitura)';
  };
  dependencies.solarisChat.perguntarStream=async function*(message,_history,tokens) {
    prompt=message;
    Object.assign(tokens,{total:2,input:1,output:1});
    yield 'Repo consultado';
  };
  const response=fakeResponse();
  await criarHandlerChatSolaris(dependencies)(req({message:'me explique o projeto',tool:'github',
    githubRepository:'https://github.com/Softdown-prog/Softloadv4.git'}),response);
  assert.equal(asked,'Softdown-prog/Softloadv4');
  assert.match(prompt,/branch main/);
  assert.match(prompt,/Pedido do usuário: me explique o projeto/);
  assert.equal(calls.saved[0][3].messages.at(-2).content,'me explique o projeto');
  assert.equal(response.events.at(-1).type,'done');
});

test('ferramenta desconhecida ou URL GitHub suspeita e rejeitada antes do debit',async()=>{
  const {dependencies,calls}=fakeChatDeps();
  for (const body of [
    {tool:'github',githubRepository:'https://myserver.local/private'},
    {tool:'github',githubRepository:'https://github.com/owner/repo/tree/main'},
    {tool:'shell'},
  ]) {
    const response=fakeResponse();
    await criarHandlerChatSolaris(dependencies)(req({message:'teste',...body}),response);
    assert.equal(response.statusCode,400);
    assert.equal(response.events.length,0);
  }
  assert.equal(calls.debit.length,0);
});
