'use strict';
// Entire persistence lifecycle with fake GCS, Firestore, and the existing quota pool.
// Nothing contacts the real Firebase project.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const objects = new Map();
const tracking = new Map();
const locks = new Map();
let failLockCreate = null;
let beforeSave = null;
let beforeDownload = null;
const quota = { used: 0, released: 0, confirmed: 0, failReserve: false };
let failSave = null;
let failDelete = null;
let failSaveAfterWrite = null;
let failTrackingSetAfterWrite = false;
let failTrackingDelete = false;
const deleteHistory = [];
const bucket = {
  file(key) {
    return {
      async save(data) {
        if (beforeSave) await beforeSave(key);
        if (failSave && failSave(key)) throw Error('GCS write denied');
        objects.set(key, Buffer.from(data));
        if (failSaveAfterWrite && failSaveAfterWrite(key)) throw Error('GCS acknowledgement lost');
      },
      async download() {
        if (beforeDownload) await beforeDownload(key);
        if (!objects.has(key)) throw Object.assign(Error('No such object'), {code:404});
        return [Buffer.from(objects.get(key))];
      }
    };
  },
  async deleteFiles({prefix}) {
    if (failDelete && failDelete(prefix)) throw Error('GCS delete denied');
    deleteHistory.push(prefix);
    for (const key of [...objects.keys()]) if (key.startsWith(prefix)) objects.delete(key);
  },
};
const db = {
  collection(name) { return {
    doc(id) {
      if (name === 'solaris_projetos_bloqueios') return {
        async create(value) {
          if (failLockCreate) throw failLockCreate;
          if (locks.has(id)) throw Object.assign(Error('lock already exists'), {code:6});
          locks.set(id, {...value});
        },
        async get() {
          const value = locks.get(id);
          return {exists: Boolean(value), data: () => value ? {...value} : null, updateTime: value ? 'fake-update-time' : undefined};
        },
        async delete() { locks.delete(id); },
      };
      return {
      async get() {
        const data = tracking.get(id);
        return { exists: Boolean(data), data() { return {...data}; } };
      },
      async set(data) {
        tracking.set(id, {...data});
        if (failTrackingSetAfterWrite) {
          failTrackingSetAfterWrite=false;
          throw Error('Firestore acknowledgement lost');
        }
      },
      async delete() {
        if (failTrackingDelete) throw Error('Firestore delete denied');
        tracking.delete(id);
      },
    }; },
    async get() { return { docs: [...tracking.entries()].map(([id, value]) => ({
      id, data: () => ({...value}),
    })) }; },
  }; },
};
const deps = [
  ['../../services/firebase', {bucket, db}],
  ['../../services/storageService', {
    async reservarCota(_email,_plano,bytes) {
      if (quota.failReserve) throw Error('Limite de armazenamento');
      return {async confirmarUso(actual) {
        assert.equal(actual,bytes);
        quota.used+=actual;
        quota.confirmed+=actual;
      }};
    },
    async liberarCota(_email,bytes) { quota.used-=bytes; quota.released+=bytes; },
  }]
];
for(const [rel,exports] of deps) {
  const id=require.resolve(rel);
  require.cache[id]={id,filename:id,loaded:true,exports};
}
const {salvarProjeto,carregarProjeto,apagarProjeto,apagarProjetosExpirados} = require('./projectStorage');
const uid='user-test',sessionId='session-test',email='test@example.test';
const manifestKey='users/user-test/solaris-projects/session-test/manifesto.json';
const trackedId='user-test_session-test';
const config=arquivos=>({uid,sessionId,email,plano:'free',framework:'html5',arquivos});
function reset() {
  objects.clear();tracking.clear();locks.clear();deleteHistory.length=0;
  quota.used=0;quota.released=0;quota.confirmed=0;quota.failReserve=false;
  failSave=null;failDelete=null;failSaveAfterWrite=null;failTrackingSetAfterWrite=false;failTrackingDelete=false;
  failLockCreate=null;beforeSave=null;beforeDownload=null;
}
async function readProject() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'solaris-storage-test-'));
  try {
    const result=await carregarProjeto(uid,sessionId,root);
    if (!result) return null;
    return {framework:result.framework,files:result.arquivos.map(name=>[name,fs.readFileSync(path.join(root,name),'utf8')])};
  } finally {fs.rmSync(root,{force:true,recursive:true});}
}
async function initial() {
  return salvarProjeto(config([{caminho:'old.txt',conteudo:'previous version'}]));
}

test('primeiro save publica arquivos versionados e leitura mantém contrato', async()=>{
  reset();
  const saved=await initial();
  assert.equal(saved.ok,true);
  const root=JSON.parse(objects.get(manifestKey));
  assert.ok(root.versao);
  assert.equal((await readProject()).files[0][1],'previous version');
  assert.equal(tracking.get(trackedId).tamanhoBytes,quota.used);
});

test('arquivo parcialmente gravado falha sem substituir projeto nem descontar cota',async()=>{
  reset();await initial();
  const before=Buffer.from(objects.get(manifestKey)), charged=quota.used;
  failSave=key=>key.endsWith('/files/blocked.txt');
  await assert.rejects(salvarProjeto(config([
    {caminho:'okay.txt',conteudo:'new'},
    {caminho:'blocked.txt',conteudo:'bad'},
  ])),/GCS write denied/);
  assert.deepEqual(objects.get(manifestKey),before);
  assert.equal(quota.used,charged);
  assert.deepEqual((await readProject()).files,[['old.txt','previous version']]);
  assert.equal([...objects.keys()].filter(k=>k.includes('/versions/')).length,1);
});

test('falha ao publicar manifesto reverte tracking, crédito e staging',async()=>{
  reset();await initial();
  const before=Buffer.from(objects.get(manifestKey)), old=tracking.get(trackedId);
  const charged=quota.used;
  failSave=key=>key===manifestKey;
  await assert.rejects(salvarProjeto(config([{caminho:'new.txt',conteudo:'new'}])),/GCS write denied/);
  assert.deepEqual(objects.get(manifestKey),before);
  assert.deepEqual(tracking.get(trackedId),old);
  assert.equal(quota.used,charged);
  assert.deepEqual((await readProject()).files,[['old.txt','previous version']]);
});

test('substituição bem-sucedida remove arquivos antigos somente depois do commit',async()=>{
  reset();await initial();
  const previous=JSON.parse(objects.get(manifestKey));
  const next=await salvarProjeto(config([{caminho:'new.txt',conteudo:'replacement'}]));
  assert.equal(next.ok,true);
  assert.notEqual(JSON.parse(objects.get(manifestKey)).versao,previous.versao);
  assert.equal([...objects.keys()].some(k=>k.includes(previous.versao+'/')),false);
  assert.equal(quota.used,next.tamanhoBytes);
  assert.equal(tracking.get(trackedId).activeTamanhoBytes,next.tamanhoBytes);
  assert.deepEqual((await readProject()).files,[['new.txt','replacement']]);
});

test('falha de limpeza preserva versão nova e mantém a cota antiga contabilizada',async()=>{
  reset();const first=await initial();
  failDelete=prefix=>prefix.includes('/versions/');
  const second=await salvarProjeto(config([{caminho:'new.txt',conteudo:'after cleanup error'}]));
  assert.equal(second.ok,true);
  assert.ok(quota.used>=first.tamanhoBytes+second.tamanhoBytes);
  assert.deepEqual((await readProject()).files,[['new.txt','after cleanup error']]);
  assert.equal(tracking.get(trackedId).activeTamanhoBytes,second.tamanhoBytes);
  failDelete=null;
  const third=await salvarProjeto(config([{caminho:'third.txt',conteudo:'newest'}]));
  assert.equal(third.ok,true);
  assert.equal(quota.used,first.tamanhoBytes+third.tamanhoBytes);
  assert.deepEqual((await readProject()).files,[['third.txt','newest']]);
});

test('falha ao deletar projeto mantém manifesto, tracking e crédito para retry',async()=>{
  reset();await initial();const before=quota.used;
  failDelete=()=>true;
  await assert.rejects(apagarProjeto(uid,sessionId),/GCS delete denied/);
  assert.ok(objects.has(manifestKey));
  assert.ok(tracking.has(trackedId));
  assert.equal(quota.used,before);
  failDelete=null;
  await apagarProjeto(uid,sessionId);
  assert.equal(objects.size,0);
  assert.equal(tracking.size,0);
  assert.equal(quota.used,0);
});

test('quota recusada antes da escrita não afeta a versão anterior',async()=>{
  reset();await initial();
  const old=Buffer.from(objects.get(manifestKey)),before=quota.used;
  quota.failReserve=true;
  await assert.rejects(salvarProjeto(config([{caminho:'new.txt',conteudo:'not allowed'}])),/Limite/);
  assert.deepEqual(objects.get(manifestKey),old);
  assert.equal(quota.used,before);
});

test('legado sem versão continua legível após mudança do formato GCS',async()=>{
  reset();
  const prefix='users/user-test/solaris-projects/session-test/';
  objects.set(prefix+'manifesto.json',Buffer.from(JSON.stringify({
    sessionId,framework:'html5',arquivos:['legacy.txt'],criadoEm:new Date().toISOString(),
  })));
  objects.set(prefix+'files/legacy.txt',Buffer.from('formato original'));
  assert.deepEqual((await readProject()).files,[['legacy.txt','formato original']]);
});

test('TTL padrão mantém projeto novo e remove somente rastreamento vencido', async () => {
  reset(); await initial();
  const recent = await apagarProjetosExpirados();
  assert.deepEqual(recent, {apagados: [], erros: []});
  assert.ok(objects.has(manifestKey));
  tracking.get(trackedId).criadoEm = '2020-01-01T00:00:00.000Z';
  const result = await apagarProjetosExpirados();
  assert.deepEqual(result, {apagados: [trackedId], erros: []});
  assert.equal(objects.size, 0);
  assert.equal(tracking.size, 0);
  assert.equal(quota.used, 0);
});

test('TTL inválido nunca consulta Firestore nem apaga projeto', async () => {
  reset(); await initial();
  const bytes = quota.used;
  for (const dias of [0, -1, -30, 0.5, Infinity, NaN, '0', '30']) {
    await assert.rejects(apagarProjetosExpirados({diasParaExpirar: dias}), RangeError);
    assert.ok(objects.has(manifestKey));
    assert.equal(quota.used, bytes);
    assert.equal(deleteHistory.length, 0);
  }
});

test('rastreamento expirado com identidade divergente não exclui outra sessão', async () => {
  reset(); await initial();
  const prev = {...tracking.get(trackedId)};
  tracking.set('forged_other', {...prev, criadoEm: '2020-01-01T00:00:00.000Z'});
  tracking.set(trackedId, {...prev, criadoEm: '2020-01-01T00:00:00.000Z', uid: '../user-test'});
  const result = await apagarProjetosExpirados();
  assert.deepEqual(result.apagados, []);
  assert.deepEqual(result.erros.map(item => item.id).sort(), ['forged_other', trackedId].sort());
  assert.ok(objects.has(manifestKey));
  assert.equal(deleteHistory.length, 0);
});

test('exclusão direta recusa identificadores inseguros antes de tocar GCS', async () => {
  reset(); await initial();
  for (const [user, sessao] of [['..', sessionId], [uid, '../other'], ['', sessionId], [uid, ''], [null, sessionId], [uid, 'x\\y']]) {
    await assert.rejects(apagarProjeto(user, sessao), TypeError);
  }
  assert.ok(objects.has(manifestKey));
  assert.equal(deleteHistory.length, 0);
});

test('falha na exclusão TTL é registrada e varredura prossegue sem perder crédito', async () => {
  reset(); await initial();
  const prev = tracking.get(trackedId);
  prev.criadoEm = '2020-01-01T00:00:00.000Z';
  const used = quota.used;
  failDelete = prefix => prefix.includes(sessionId);
  const result = await apagarProjetosExpirados({diasParaExpirar: 30});
  assert.deepEqual(result.apagados, []);
  assert.equal(result.erros.length, 1);
  assert.equal(result.erros[0].id, trackedId);
  assert.ok(objects.has(manifestKey));
  assert.equal(quota.used, used);
});

test('duas gravações da mesma sessão não competem e a segunda não debita cota', async () => {
  reset();
  await initial();
  const original=JSON.parse(objects.get(manifestKey)).versao;
  let resume, entered;
  const ready=new Promise(resolve=>{entered=resolve;});
  const suspended=new Promise(resolve=>{resume=resolve;});
  beforeSave=async key=>{if(key.endsWith('/files/slow.txt')){entered(); await suspended;}};
  const first=salvarProjeto(config([{caminho:'slow.txt',conteudo:'first'}]));
  await ready;
  const charged=quota.used;
  await assert.rejects(salvarProjeto(config([{caminho:'second.txt',conteudo:'second'}])),
    err=>err.code==='SOLARIS_PROJECT_BUSY'&&err.status===409);
  assert.equal(quota.used,charged);
  assert.equal(JSON.parse(objects.get(manifestKey)).versao,original);
  assert.equal(locks.size,1);
  resume();
  await first;
  assert.equal(locks.size,0);
  assert.deepEqual((await readProject()).files,[['slow.txt','first']]);
});

test('limpeza e exclusão não apagam arquivos durante uma gravação ativa', async () => {
  reset();
  await initial();
  let resume, entered;
  const ready=new Promise(resolve=>{entered=resolve;});
  const suspended=new Promise(resolve=>{resume=resolve;});
  beforeSave=async key=>{if(key.endsWith('/files/slow.txt')){entered(); await suspended;}};
  const saving=salvarProjeto(config([{caminho:'slow.txt',conteudo:'new'}]));
  await ready;
  const charged=quota.used;
  await assert.rejects(apagarProjeto(uid,sessionId),err=>err.code==='SOLARIS_PROJECT_BUSY');
  assert.ok(objects.has(manifestKey));
  assert.equal(quota.used,charged);
  resume();
  await saving;
  assert.equal(locks.size,0);
  await apagarProjeto(uid,sessionId);
  assert.equal(objects.size,0);
  assert.equal(quota.used,0);
});

test('erro da escrita libera lock; a próxima gravação consegue prosseguir', async () => {
  reset(); await initial();
  failSave=key=>key.endsWith('/files/reject.txt');
  await assert.rejects(salvarProjeto(config([{caminho:'reject.txt',conteudo:'bad'}])),/GCS write denied/);
  assert.equal(locks.size,0);
  failSave=null;
  const next=await salvarProjeto(config([{caminho:'success.txt',conteudo:'ok'}]));
  assert.equal(next.ok,true);
  assert.equal(locks.size,0);
  assert.deepEqual((await readProject()).files,[['success.txt','ok']]);
});

test('Firestore indisponível durante create falha sem modificar GCS ou cota', async () => {
  reset(); await initial();
  const original=Buffer.from(objects.get(manifestKey));
  const used=quota.used;
  failLockCreate=Error('Firestore unavailable');
  await assert.rejects(salvarProjeto(config([{caminho:'new.txt',conteudo:'no'}])),/Firestore unavailable/);
  assert.deepEqual(objects.get(manifestKey),original);
  assert.equal(quota.used,used);
  assert.equal(locks.size,0);
});

test('TTL não exclui sessão vencida que ainda tem gravação ativa', async () => {
  reset(); await initial();
  tracking.get(trackedId).criadoEm='2020-01-01T00:00:00.000Z';
  let resume, entered;
  const ready=new Promise(resolve=>{entered=resolve;});
  const suspended=new Promise(resolve=>{resume=resolve;});
  beforeSave=async key=>{if(key.endsWith('/files/slow.txt')){entered(); await suspended;}};
  const saving=salvarProjeto(config([{caminho:'slow.txt',conteudo:'live'}]));
  await ready;
  const result=await apagarProjetosExpirados();
  assert.deepEqual(result.apagados,[]);
  assert.equal(result.erros.length,1);
  assert.equal(result.erros[0].id,trackedId);
  assert.ok(objects.has(manifestKey));
  resume();
  await saving;
  assert.equal(locks.size,0);
});

test('edição com snapshot antigo rejeita conflito sem alterar arquivos nem cota',async()=>{
  reset();
  await initial();
  const firstSnapshot=JSON.parse(objects.get(manifestKey)).versao;
  const upload=await salvarProjeto(config([{caminho:'new.txt',conteudo:'uploaded after editor read'}]));
  const currentManifest=Buffer.from(objects.get(manifestKey));
  const quotaBefore=quota.used, confirmBefore=quota.confirmed, deletions=deleteHistory.length;
  await assert.rejects(
    salvarProjeto({...config([{caminho:'old-editor.txt',conteudo:'would overwrite upload'}]),expectedVersion:firstSnapshot}),
    err=>err.code==='SOLARIS_PROJECT_STALE'&&err.status===409
  );
  assert.deepEqual(objects.get(manifestKey),currentManifest);
  assert.equal(quota.used,quotaBefore);
  assert.equal(quota.confirmed,confirmBefore);
  assert.equal(deleteHistory.length,deletions);
  assert.equal(quota.used,upload.tamanhoBytes);
  assert.deepEqual((await readProject()).files,[['new.txt','uploaded after editor read']]);
  assert.equal(locks.size,0);
});

test('edição baseada na versão atual publica normalmente e expõe nova versão',async()=>{
  reset(); await initial();
  const loaded=JSON.parse(objects.get(manifestKey));
  const updated=await salvarProjeto({...config([{caminho:'edited.txt',conteudo:'edited latest'}]),expectedVersion:loaded.versao});
  assert.equal(updated.ok,true);
  const root=JSON.parse(objects.get(manifestKey));
  assert.notEqual(root.versao,loaded.versao);
  assert.equal(quota.used,updated.tamanhoBytes);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solaris-storage-version-'));
  try {
    const project=await carregarProjeto(uid,sessionId,dir);
    assert.equal(project.versao,root.versao);
    assert.deepEqual(project.arquivos,['edited.txt']);
  } finally {fs.rmSync(dir,{force:true,recursive:true});}
});

test('snapshot legado sem versao permite uma única edição com expectedVersion null',async()=>{
  reset();
  const prefix='users/user-test/solaris-projects/session-test/';
  objects.set(prefix+'manifesto.json',Buffer.from(JSON.stringify({sessionId,framework:'html5',arquivos:['legacy.txt'],criadoEm:new Date().toISOString()})));
  objects.set(prefix+'files/legacy.txt',Buffer.from('legacy'));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solaris-legacy-version-'));
  try {assert.equal((await carregarProjeto(uid,sessionId,dir)).versao,null);}
  finally {fs.rmSync(dir,{recursive:true,force:true});}
  const result=await salvarProjeto({...config([{caminho:'new.txt',conteudo:'converted'}]),expectedVersion:null});
  assert.equal(result.ok,true);
  await assert.rejects(salvarProjeto({...config([{caminho:'oops.txt',conteudo:'stale legacy'}]),expectedVersion:null}),err=>err.code==='SOLARIS_PROJECT_STALE');
  assert.deepEqual((await readProject()).files,[['new.txt','converted']]);
});

test('versao esperada invalida falha antes de reservar armazenamento',async()=>{
  reset(); await initial();
  const before=quota.used;
  await assert.rejects(salvarProjeto({...config([{caminho:'bad.txt',conteudo:'bad'}]),expectedVersion:42}),TypeError);
  assert.equal(quota.used,before);
  assert.equal(locks.size,0);
});

test('leitura refaz snapshot quando versão antiga desaparece durante substituição', async () => {
  reset();
  await salvarProjeto(config([
    {caminho:'alpha.txt',conteudo:'antigo A'},
    {caminho:'beta.txt',conteudo:'antigo B'},
  ]));
  let switched=false;
  beforeDownload=async key=>{
    if (!switched && key.includes('/versions/') && key.endsWith('/files/beta.txt')) {
      switched=true;
      await salvarProjeto(config([
        {caminho:'alpha.txt',conteudo:'novo A'},
        {caminho:'beta.txt',conteudo:'novo B'},
      ]));
    }
  };
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'solaris-read-race-'));
  try {
    const project=await carregarProjeto(uid,sessionId,root);
    assert.equal(switched,true);
    assert.equal(project.versao,JSON.parse(objects.get(manifestKey)).versao);
    assert.equal(fs.readFileSync(path.join(root,'alpha.txt'),'utf8'),'novo A');
    assert.equal(fs.readFileSync(path.join(root,'beta.txt'),'utf8'),'novo B');
    assert.equal(quota.used,tracking.get(trackedId).tamanhoBytes);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('leitura de legado refaz snapshot se upload remove a geração sem versão', async () => {
  reset();
  const prefix='users/user-test/solaris-projects/session-test/';
  objects.set(manifestKey,Buffer.from(JSON.stringify({sessionId,framework:'html5',arquivos:['legacy.txt'],criadoEm:new Date().toISOString()})));
  objects.set(prefix+'files/legacy.txt',Buffer.from('legado'));
  let replaced=false;
  beforeDownload=async key=>{
    if (!replaced && key.endsWith('/files/legacy.txt')) {
      replaced=true;
      await salvarProjeto(config([{caminho:'modern.txt',conteudo:'atual'}]));
    }
  };
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'solaris-legacy-race-'));
  try {
    const project=await carregarProjeto(uid,sessionId,root);
    assert.equal(replaced,true);
    assert.ok(project.versao);
    assert.deepEqual(project.arquivos,['modern.txt']);
    assert.deepEqual(fs.readdirSync(root),['modern.txt']);
    assert.equal(fs.readFileSync(path.join(root,'modern.txt'),'utf8'),'atual');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('manifesto íntegro com blob ausente falha sem criar arquivos parciais', async () => {
  reset();
  await salvarProjeto(config([
    {caminho:'exists.txt',conteudo:'texto válido'},
    {caminho:'missing.txt',conteudo:'texto removido'},
  ]));
  const rootManifest=JSON.parse(objects.get(manifestKey));
  objects.delete(`users/${uid}/solaris-projects/${sessionId}/versions/${rootManifest.versao}/files/missing.txt`);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'solaris-broken-read-'));
  try {
    await assert.rejects(carregarProjeto(uid,sessionId,root),err=>err.code===404);
    assert.deepEqual(fs.readdirSync(root),[]);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('erro transitório de leitura não cai em retry e não deixa conteúdo parcial', async () => {
  reset();
  await salvarProjeto(config([{caminho:'exists.txt',conteudo:'x'},{caminho:'blocked.txt',conteudo:'y'}]));
  let hits=0;
  beforeDownload=async key=>{
    if (key.endsWith('/files/blocked.txt')) {
      hits++;
      throw Object.assign(Error('GCS unavailable'),{code:503});
    }
  };
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'solaris-503-read-'));
  try {
    await assert.rejects(carregarProjeto(uid,sessionId,root),err=>err.code===503);
    assert.equal(hits,1);
    assert.deepEqual(fs.readdirSync(root),[]);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('manifesto removido entre snapshots retorna null e não escreve arquivos', async () => {
  reset();
  await salvarProjeto(config([{caminho:'original.txt',conteudo:'original'}]));
  let removed=false;
  beforeDownload=async key=>{
    if (!removed && key.endsWith('/files/original.txt')) {
      removed=true;
      objects.delete(manifestKey);
      const old=JSON.parse(objects.get(manifestKey) || '{}');
      // Simula exclusão: só o manifesto precisa desaparecer para impedir retry.
      void old;
      throw Object.assign(Error('No such object'),{code:404});
    }
  };
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'solaris-removed-read-'));
  try {
    const project=await carregarProjeto(uid,sessionId,root);
    assert.equal(project,null);
    assert.deepEqual(fs.readdirSync(root),[]);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('manifesto gravado mas ACK perdido mantém versão publicada e crédito correto',async()=>{
  reset(); await initial();
  const former=JSON.parse(objects.get(manifestKey));
  failSaveAfterWrite=key=>key===manifestKey;
  const saved=await salvarProjeto(config([{caminho:'accepted.txt',conteudo:'confirmed'}]));
  assert.equal(saved.ok,true);
  const current=JSON.parse(objects.get(manifestKey));
  assert.notEqual(current.versao,former.versao);
  assert.deepEqual((await readProject()).files,[['accepted.txt','confirmed']]);
  assert.equal(quota.used,saved.tamanhoBytes);
  assert.equal(tracking.get(trackedId).tamanhoBytes,saved.tamanhoBytes);
  assert.equal([...objects.keys()].some(k=>k.includes(former.versao+'/')),false);
});

test('ACK do Firestore perdido após escrita reverte rastreamento e cota',async()=>{
  reset();await initial();
  const previous=Buffer.from(objects.get(manifestKey));
  const record={...tracking.get(trackedId)};
  const charged=quota.used;
  failTrackingSetAfterWrite=true;
  await assert.rejects(salvarProjeto(config([{caminho:'unpublished.txt',conteudo:'pending'}])),/Firestore acknowledgement lost/);
  assert.deepEqual(objects.get(manifestKey),previous);
  assert.deepEqual(tracking.get(trackedId),record);
  assert.equal(quota.used,charged);
  assert.equal([...objects.keys()].filter(k=>k.includes('/versions/')).length,1);
});

test('falha verificando publicação incerta preserva arquivos e cota',async()=>{
  reset();await initial();
  let verification=false;
  failSaveAfterWrite=key=>{if(key===manifestKey){verification=true;return true;}return false;};
  beforeDownload=async key=>{
    if(verification && key===manifestKey) throw Object.assign(Error('GCS read unavailable'),{code:503});
  };
  const priorVersion=JSON.parse(objects.get(manifestKey)).versao;
  await assert.rejects(salvarProjeto(config([{caminho:'possible.txt',conteudo:'must survive'}])),/GCS acknowledgement lost/);
  beforeDownload=null;
  const published=JSON.parse(objects.get(manifestKey));
  assert.notEqual(published.versao,priorVersion);
  assert.deepEqual((await readProject()).files,[['possible.txt','must survive']]);
  assert.equal(quota.used,tracking.get(trackedId).tamanhoBytes);
  assert.equal(locks.size,0);
});

test('falha no delete de rastreamento não libera cota e permite retry',async()=>{
  reset();await initial();const charged=quota.used;
  failTrackingDelete=true;
  await assert.rejects(apagarProjeto(uid,sessionId),/Firestore delete denied/);
  assert.equal(quota.used,charged);
  assert.equal(tracking.size,1);
  assert.equal(objects.size,0);
  failTrackingDelete=false;
  await apagarProjeto(uid,sessionId);
  assert.equal(quota.used,0);
  assert.equal(tracking.size,0);
});
