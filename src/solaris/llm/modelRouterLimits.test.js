const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');

test('saída de triagem, streaming e Pro respeita limites inclusive com configuração inválida',()=>{
  for(const [value,pro,flash] of [['',8192,2048],['60000',8192,2048],['Infinity',8192,2048],
    ['-1',8192,2048],['256',256,256],['16384',16384,2048]]){
    const result=spawnSync(process.execPath,['-e',`
      const configs=[];
      const {criarModelRouter}=require('./modelRouter');
      const router=criarModelRouter({clientFactory:()=>({models:{
        generateContent:async p=>{configs.push(p.config.maxOutputTokens);return {text:'ok'};},
        generateContentStream:async function*(p){configs.push(p.config.maxOutputTokens);yield {text:'ok'};}
      }})});
      (async()=>{
        await router.executarTriagem({prompt:'oi'});
        await router.executarTarefaArquitetura({prompt:'gerar'});
        for await(const chunk of router.executarTriagemStream({prompt:'oi'})){}
        console.log(JSON.stringify(configs));
      })().catch(()=>process.exit(1));
    `],{cwd:__dirname,env:{...process.env,SOLARIS_MAX_OUTPUT_TOKENS:value},encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim().split('\n').at(-1)),[flash,pro,flash]);
  }
});
