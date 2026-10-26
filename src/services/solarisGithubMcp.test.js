'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createSolarisGithubMcp,parseMcpPayload,safePath}=require('./solarisGithubMcp');
const msg=(id,result)=>({jsonrpc:'2.0',id,result});
test('MCP remoto negocia protocolo, descobre ferramenta e lê apenas repositório vinculado',async()=>{
  const sent=[];
  const app={withSelectedRepo(uid,fn){
    assert.equal(uid,'alice');return fn({repository:'alice/demo',accessToken:'secret-test-token'});
  }};
  const fake=async(url,options)=>{
    assert.equal(url,'https://api.githubcopilot.com/mcp/readonly');
    assert.equal(options.headers.Authorization,'Bearer secret-test-token');
    assert.equal(options.headers['X-MCP-Readonly'],'true');
    const call=JSON.parse(options.body);sent.push(call);
    const result=call.method==='initialize'?{protocolVersion:'2025-06-18',capabilities:{tools:{}}}:
      call.method==='tools/list'?{tools:[{name:'get_file_contents'},{name:'create_or_update_file'}]}:
      call.method==='tools/call'?{content:[{type:'text',text:'arquivo TypeScript'}]}:{};
    return {ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify(msg(call.id,result))};
  };
  const client=await createSolarisGithubMcp(app,{fetchImpl:fake}).open('alice','alice/demo');
  assert.equal(await client.readPath('src/main.ts'),'arquivo TypeScript');
  assert.deepEqual(sent.map(x=>x.method),['initialize','notifications/initialized','tools/list','tools/call']);
  assert.deepEqual(sent[3].params,{name:'get_file_contents',arguments:{owner:'alice',repo:'demo',path:'src/main.ts'}});
  assert.equal(sent.some(x=>x.params?.name==='create_or_update_file'),false);
  assert.ok(!JSON.stringify(sent).includes('secret-test-token'));
  await client.close();
});
test('cliente rejeita outro repo ANTES do primeiro request remoto',async()=>{
  let calls=0;
  const app={withSelectedRepo(uid,fn){return fn({repository:'alice/demo',accessToken:'token'});}};
  await assert.rejects(()=>createSolarisGithubMcp(app,{fetchImpl:async()=>{calls++;throw Error('should not call');}}).open('alice','other/repo'),/divergente/);
  assert.equal(calls,0);
});
test('parser SSE e validação de caminhos recusam entrada maliciosa',()=>{
  assert.deepEqual(parseMcpPayload('event: message\ndata: '+JSON.stringify(msg(4,{tools:[]}))+'\n\n',4),{tools:[]});
  assert.throws(()=>parseMcpPayload(JSON.stringify(msg(1,{})),3),/sem resultado/);
  assert.throws(()=>safePath('../.env'),/inválido/);
  assert.throws(()=>safePath('src//file'),/inválido/);
  assert.equal(safePath('src/index.ts'),'src/index.ts');
});
test('a ausência de ferramenta de leitura falha fechado',async()=>{
  const app={withSelectedRepo(uid,fn){return fn({repository:'alice/demo',accessToken:'token'});}};
  const fake=async(url,options)=>{
    const call=JSON.parse(options.body);
    const result=call.method==='initialize'?{protocolVersion:'2025-06-18'}:
      call.method==='tools/list'?{tools:[{name:'create_or_update_file'}]}:{};
    return {ok:true,status:200,headers:{get:()=>null},text:async()=>JSON.stringify(msg(call.id,result))};
  };
  await assert.rejects(()=>createSolarisGithubMcp(app,{fetchImpl:fake}).open('alice','alice/demo'),/não disponibilizou/);
});
