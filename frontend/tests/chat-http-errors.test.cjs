'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('todos os chats exibem mensagens apropriadas para falhas HTTP sem retry pago',()=>{
  const files=['frontend/pages/Chat.tsx','frontend/pages/WorkspaceChat.tsx','frontend/pages/Solaris.tsx'];
  for(const file of files){
    const code=read(file);
    assert.match(code,/extrairErroRespostaChat\(response\)/,'tratamento ausente: '+file);
  }
  const js=ts.transpileModule(read('frontend/services/chatHttpErrors.ts'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
    reportDiagnostics:true
  });
  assert.equal((js.diagnostics||[]).length,0);
  const mod={exports:{}};
  vm.runInNewContext(js.outputText,{module:mod,exports:mod.exports});
  const {mensagemErroChat}=mod.exports;
  assert.match(mensagemErroChat(404),/serviço de chat/);
  assert.doesNotMatch(mensagemErroChat(404),/modelo não encontrado/i);
  assert.match(mensagemErroChat(429),/limite de solicitações/i);
  assert.match(mensagemErroChat(401),/sessão expirou/i);
  assert.match(mensagemErroChat(402),/créditos/i);
  assert.match(mensagemErroChat(409),/histórico/i);
  assert.match(mensagemErroChat(503),/indisponível/i);
  assert.equal(mensagemErroChat(402,{error:'Créditos expirados.'}),'Créditos expirados.');
});

test('mensagens não expõem HTML do proxy nem confundem 429 com 404',async()=>{
  const js=ts.transpileModule(read('frontend/services/chatHttpErrors.ts'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  });
  const mod={exports:{}};
  vm.runInNewContext(js.outputText,{module:mod,exports:mod.exports});
  const {extrairErroRespostaChat}=mod.exports;
  const result=await extrairErroRespostaChat({
    status:404,
    headers:{get:()=> 'text/html'},
    async json(){throw Error('HTML não é JSON');}
  });
  assert.match(result,/Recarregue a página/);
  const limit=await extrairErroRespostaChat({
    status:429,
    headers:{get:()=> 'application/json'},
    async json(){return {error:'secret-key-should-not-be-exposed'};}
  });
  assert.match(limit,/limite de solicitações/i);
  assert.ok(!limit.includes('secret-key'));
});
