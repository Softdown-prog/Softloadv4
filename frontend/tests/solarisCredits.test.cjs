'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const vm=require('node:vm');
function imported(filename,dependencies={}) {
  const source=fs.readFileSync(path.join(__dirname,'../services/',filename+'.ts'),'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(js,{module,exports:module.exports,require:id=>{
    if(!(id in dependencies))throw Error('Unexpected import '+id);
    return dependencies[id];
  },Number,Date},{filename:filename+'.js'});
  return module.exports;
}
const parser=imported('creditsV2');
const {consultarSaldoSolaris}=imported('solarisCredits',{'./creditsV2':parser});
const v2={versao:2,modo:'ativo',cicloExpiraEm:'2099-01-01T00:00:00Z',
 saldo:{creditosDoCiclo:550,creditosDisponiveis:319,creditosConsumidos:201,creditosReservados:30,creditosExcedentes:0,preliminar:true}};
const response=(status,payload)=>({ok:status>=200&&status<300,status,json:async()=>payload});
test('V2 ativo exibe saldo do livro-razão sem consultar carteira legado',async()=>{
 let n=0;
 const s=await consultarSaldoSolaris(async(url,opts)=>{
  n++;assert.equal(url,'/api/ai-credits/v2');assert.equal(opts.credentials,'same-origin');
  assert.equal(opts.cache,'no-store');return response(200,v2);
 });
 assert.equal(s.fonte,'v2');assert.equal(s.disponiveis,319);
 assert.equal(s.total,550);assert.equal(n,1);
});
test('V2 desligado permite carteira legado, sem prometer créditos extras',async()=>{
 const urls=[];
 const s=await consultarSaldoSolaris(async url=>{
  urls.push(url);
  return url.includes('/ai-credits/')?response(404,{codigo:'CREDITOS_V2_DESABILITADOS'})
    :response(200,{creditosGemini:3,creditosGeminiTotal:5});
 });
 assert.equal(s.fonte,'legado');assert.equal(s.disponiveis,3);
 assert.equal(s.total,5);
 assert.equal(urls.length,2);
});
test('V2 somente prévia preserva carteira legado',async()=>{
 const s=await consultarSaldoSolaris(async url=>url.includes('/ai-credits/')
   ?response(200,{...v2,modo:'previsualizacao'})
   :response(200,{creditosGemini:4,creditosGeminiTotal:9}));
 assert.equal(s.fonte,'legado');assert.equal(s.disponiveis,4);
});
test('erro no orçamento ativo, conta ausente, 402 e rede não mostram saldo legado',async()=>{
 for(const resp of [response(503,{erro:'offline'}),response(404,{erro:'Conta não encontrada.'}),
                    response(402,{erro:'Ciclo expirado'}),response(200,{...v2,saldo:{creditosDisponiveis:-2}})]){
  let calls=0;
  const s=await consultarSaldoSolaris(async()=>{calls++;return resp});
  assert.equal(s.fonte,'indisponivel');assert.equal(calls,1);
 }
 const s=await consultarSaldoSolaris(async()=>{throw Error('offline')});
 assert.equal(s.fonte,'indisponivel');
});
test('saldo legado inválido não é exibido',async()=>{
 const s=await consultarSaldoSolaris(async url=>url.includes('/ai-credits/')
   ?response(404,{codigo:'CREDITOS_V2_DESABILITADOS'})
   :response(200,{creditosGemini:'99',creditosGeminiTotal:500}));
 assert.equal(s.fonte,'indisponivel');
});
