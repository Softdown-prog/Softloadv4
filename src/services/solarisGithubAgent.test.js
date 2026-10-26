'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createSolarisGithubAgent}=require('./solarisGithubAgent');
const {GithubOperationError}=require('./solarisGithubOperations');

function fixture(mcp=null) {
 const rows=new Map(),calls=[];
 const doc=id=>({
   id,async get(){return {exists:rows.has(id),data(){return rows.get(id);}};},
   async set(val){rows.set(id,val);},
   async update(part){rows.set(id,{...rows.get(id),...part});}
 });
 const db={
   collection(name){assert.equal(name,'solaris_github_proposals');return {doc};},
   async runTransaction(fn){
     const tx={
       get:ref=>ref.get(),
       update(ref,val){rows.set(ref.id,{...rows.get(ref.id),...val});}
     };
     return fn(tx);
   }
 };
 let selected='alice/demo';
 const app={async status(){return {connected:true,repository:selected}}};
 const ops={async execute(uid,action){
   assert.equal(uid,'uid');
   calls.push(action);
   if(action.action==='repository_get')return {repository:'alice/demo',defaultBranch:'main'};
   if(action.action==='file_read')return {sha:'old-sha',content:'export const a=1;'};
   if(action.action==='branch_create')return {branch:action.branch};
   if(action.action==='file_commit')return {commit:'sha-commit'};
   if(action.action==='pull_request_create')return {number:8,url:'https://github.com/alice/demo/pull/8'};
   throw Error('unexpected action');
 }};
 const agent=createSolarisGithubAgent(db,app,ops,mcp);
 return {agent,calls,rows,setSelected:x=>{selected=x;}};
}
async function propose(f,overrides={}){
 return f.agent.prepare({uid:'uid',repository:'alice/demo',message:'Refatore a.ts',history:[],context:'repo alice/demo',
 modelRouter:{
   async executarTarefaComFerramentas({executorFerramenta}) {
      await executorFerramenta('lerArquivoGithub',{path:'src/a.ts'});
      const result=await executorFerramenta('proporArquivoGithub',{
        path:'src/a.ts',summary:'refactor a',content:'export const a=2;' });
      assert.equal(result.pending,true);
      return {texto:'Alteração proposta.',tokens:{total:3,input:2,output:1}};
   }
 },...overrides});
}
test('Gemini pode ler e propor, mas não executar qualquer escrita',async()=>{
 const f=fixture();
 const result=await propose(f);
 assert.match(result.text,/aprovação/);
 assert.equal(result.tokens.total,3);
 assert.deepEqual(f.calls.map(x=>x.action),['repository_get','file_read']);
 const p=await f.agent.pending('uid');
 assert.equal(p.state,'pending');
 assert.equal(p.files[0].proposedContent,'export const a=2;');
 assert.equal(p.files[0].currentSha,'old-sha');
});
test('aprovação humana cria branch, commit e PR draft uma única vez',async()=>{
 const f=fixture();await propose(f);
 const value=await f.agent.approve('uid');
 assert.equal(value.result.prNumber,8);
 assert.equal(f.calls.find(x=>x.action==='pull_request_create').draft,true);
 assert.equal(f.calls.find(x=>x.action==='file_commit').expectedSha,'old-sha');
 assert.ok(f.calls.every(x=>x.branch!=='main' || x.action==='file_read'));
 await assert.rejects(()=>f.agent.approve('uid'),/utilizada/);
 const status=await f.agent.pending('uid');
 assert.equal(status.state,'completed');
 assert.equal(status.files.length,0);
});
test('trocar o repo após gerar proposta bloqueia aplicação',async()=>{
 const f=fixture();await propose(f);f.setSelected('alice/outro');
 await assert.rejects(()=>f.agent.approve('uid'),/Conexão GitHub mudou/);
 assert.equal(f.calls.some(x=>x.action==='branch_create'),false);
});
test('não é possível propor arquivo sem leitura prévia',async()=>{
 const f=fixture();
 const response=await f.agent.prepare({uid:'uid',repository:'alice/demo',message:'Atualize arquivo',
  context:'repo',history:[],modelRouter:{async executarTarefaComFerramentas({executorFerramenta}){
   const p=await executorFerramenta('proporArquivoGithub',{path:'src/a.ts',
     content:'new',summary:'do it'});
   assert.match(p.error,/Leia primeiro/);
   return {texto:'Nada aplicado.',tokens:{total:1,input:1,output:0}};
  }}});
 assert.doesNotMatch(response.text,/Preparei/);
 assert.equal((await f.agent.pending('uid')).state,'none');
});
test('proposta rejeitada não gera commit',async()=>{
 const f=fixture();await propose(f);await f.agent.reject('uid');
 assert.equal((await f.agent.pending('uid')).state,'cancelled');
 await assert.rejects(()=>f.agent.approve('uid'),/utilizada/);
 assert.equal(f.calls.some(x=>x.action==='branch_create'),false);
});

test('MCP consulta somente leitura integrada ao loop do Solaris',async()=>{
 const remoteReads=[];
 const f=fixture({async open(uid,repo){
  assert.equal(uid,'uid');assert.equal(repo,'alice/demo');
  return {async readPath(path){remoteReads.push(path);return 'conteúdo remoto';},async close(){}};
 }});
 const result=await f.agent.prepare({uid:'uid',repository:'alice/demo',message:'Leia README',history:[],context:'repo',
  modelRouter:{async executarTarefaComFerramentas({tools,executorFerramenta}){
   assert.ok(tools[0].functionDeclarations.some(d=>d.name==='consultarMcpGithub'));
   const result=await executorFerramenta('consultarMcpGithub',{path:'README.md'});
   assert.equal(result.readonly,true);assert.equal(result.content,'conteúdo remoto');
   return {texto:'Consulta feita pelo MCP.',tokens:{total:1,input:1,output:0}};
  }}});
 assert.match(result.text,/MCP/);
 assert.deepEqual(remoteReads,['README.md']);
 assert.deepEqual(f.calls.map(x=>x.action),['repository_get']);
});
