'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createGithubOperations, filePath, branchName} = require('./solarisGithubOperations');

function harness() {
  const calls = [];
  const file = {type:'file',path:'src/a.ts',sha:'old-sha',size:4,encoding:'base64',
    content:Buffer.from('old!').toString('base64')};
  const responses = {
    '/repos/alice/demo': {full_name:'alice/demo',default_branch:'main',private:true,
      html_url:'https://github.com/alice/demo',permissions:{push:true}},
    '/repos/alice/demo/contents/src%2Fa.ts?ref=main':file,
    '/repos/alice/demo/contents/src/a.ts?ref=main':file,
    '/repos/alice/demo/git/ref/heads/main': {object:{sha:'base-sha'}},
    '/repos/alice/demo/git/refs': {ref:'refs/heads/solaris/feature',object:{sha:'base-sha'}},
    '/repos/alice/demo/contents/src/a.ts': {commit:{sha:'commit-sha'},content:{sha:'new-sha'}},
    '/repos/alice/demo/pulls': {number:4,title:'Change',html_url:'https://github.com/alice/demo/pull/4',state:'open'}
  };
  const fetchImpl = async (url,options) => {
    assert.match(url,/^https:\/\/api\.github\.com\/repos\/alice\/demo/);
    assert.equal(options.headers.Authorization,'Bearer private-test-token');
    calls.push({url,options});
    const path = new URL(url).pathname + new URL(url).search;
    const x = responses[path];
    return {ok:!!x,status:x?200:404,json:async()=>x};
  };
  const service = createGithubOperations({
    withSelectedRepo(uid, fn) {
      assert.equal(uid,'user-1');
      return fn({repository:'alice/demo',accessToken:'private-test-token'});
    }
  },{fetchImpl});
  return {service,calls};
}

test('valida URLs internas, nomes e impede traversal',()=>{
  assert.equal(filePath('src/a.ts'),'src/a.ts');
  assert.throws(()=>filePath('../.env'),/Caminho/);
  assert.throws(()=>filePath('.github/workflows/build.yml',true),/sensíveis/);
  assert.throws(()=>filePath('secrets.pem',true),/sensíveis/);
  assert.equal(branchName('solaris/refactor'), 'solaris/refactor');
  assert.throws(()=>branchName('foo..bar'),/branch/);
});
test('sem confirmação, nenhuma gravação alcança a API GitHub',async()=>{
  const {service,calls}=harness();
  await assert.rejects(()=>service.execute('user-1',{action:'file_commit',path:'src/a.ts',
    content:'new!',message:'change'}),/Confirmação/);
  await assert.rejects(()=>service.execute('user-1',{action:'pull_request_create',
    head:'solaris/a',title:'Change'}),/Confirmação/);
  await assert.rejects(()=>service.execute('user-1',{action:'delete_repository',confirm:true}),/não permitida/);
  assert.equal(calls.length,0);
});
test('lê arquivos com SHA sem devolver credenciais e escopo único',async()=>{
  const {service,calls}=harness();
  const data=await service.execute('user-1',{action:'file_read',path:'src/a.ts',branch:'main'});
  assert.equal(data.content,'old!');
  assert.equal(data.sha,'old-sha');
  assert.ok(!JSON.stringify(data).includes('private-test-token'));
  assert.equal(calls.length,1);
});
test('commit exige SHA para atualizar arquivo e autorização da main',async()=>{
  const {service,calls}=harness();
  const input={action:'file_commit',confirm:true,path:'src/a.ts',content:'new!',
    message:'Refactor a.ts',allowDefaultBranch:true};
  await assert.rejects(()=>service.execute('user-1',input),/SHA/);
  assert.equal(calls.filter(c=>c.options.method==='PUT').length,0);
  const ok=await service.execute('user-1',{...input,expectedSha:'old-sha'});
  assert.equal(ok.commit,'commit-sha');
  const put=calls.find(c=>c.options.method==='PUT');
  assert.equal(JSON.parse(put.options.body).sha,'old-sha');
  assert.equal(Buffer.from(JSON.parse(put.options.body).content,'base64').toString(),'new!');
});
test('cria branch e pull request somente no repo vinculado',async()=>{
  const {service,calls}=harness();
  const branch=await service.execute('user-1',{action:'branch_create',confirm:true,
    branch:'solaris/feature'});
  assert.equal(branch.branch,'solaris/feature');
  await assert.rejects(()=>service.execute('user-1',{action:'branch_create',confirm:true,
    branch:'release'}),/solaris/);
  const pr=await service.execute('user-1',{action:'pull_request_create',confirm:true,
    head:'solaris/feature',title:'Change'});
  assert.equal(pr.number,4);
  assert.equal(JSON.parse(calls.find(c=>c.url.endsWith('/pulls')).options.body).base,'main');
});
