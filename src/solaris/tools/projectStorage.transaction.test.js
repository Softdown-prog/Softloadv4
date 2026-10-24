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
const quota = { used: 0, released: 0, confirmed: 0, failReserve: false };
let failSave = null;
let failDelete = null;
const deleteHistory = [];
const bucket = {
  file(key) {
    return {
      async save(data) {
        if (failSave && failSave(key)) throw Error('GCS write denied');
        objects.set(key, Buffer.from(data));
      },
      async download() {
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
  collection() { return {
    doc(id) { return {
      async get() {
        const data = tracking.get(id);
        return { exists: Boolean(data), data() { return {...data}; } };
      },
      async set(data) { tracking.set(id, {...data}); },
      async delete() { tracking.delete(id); },
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
  objects.clear();tracking.clear();deleteHistory.length=0;
  quota.used=0;quota.released=0;quota.confirmed=0;quota.failReserve=false;
  failSave=null;failDelete=null;
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
