'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarModelRouter } = require('./modelRouter');

test('Solaris registra custo estimado por chamada sem incluir prompts e sem afetar a resposta', async () => {
    const original = console.info;
    const logs = [];
    console.info = (...args) => logs.push(args);
    try {
        const router = criarModelRouter(() => ({
            models: {
                async generateContent() {
                    return {text:'ok',usageMetadata:{promptTokenCount:2000,candidatesTokenCount:300,thoughtsTokenCount:100,cachedContentTokenCount:200}};
                },
                async generateContentStream() {
                    async function* chunks() {
                        yield {text:'A'};
                        yield {text:'B',usageMetadata:{promptTokenCount:100,candidatesTokenCount:20,thoughtsTokenCount:5}};
                    }
                    return chunks();
                },
            },
            chats: {create() {return {async sendMessage(){return {candidates:[{content:{parts:[{text:'done'}]}}],usageMetadata:{promptTokenCount:250,candidatesTokenCount:50}}}};}},
        }));
        assert.equal(await router.executarTriagem({prompt:'texto de teste'}),'ok');
        assert.equal((await router.executarTarefaArquitetura({prompt:'projeto'})).text,'ok');
        const parts=[];
        for await (const chunk of router.executarTriagemStream({prompt:'chat'})) parts.push(chunk);
        assert.deepEqual(parts,['A','B']);
        assert.equal((await router.executarTarefaComFerramentas({prompt:'editar',executorFerramenta:async()=>({ok:true})})).texto,'done');
        const registros=logs.filter(args=>args[0]==='[GEMINI-COST]').map(args=>JSON.parse(args[1]));
        assert.deepEqual(registros.map(r=>r.operacao),['triagem','arquitetura','stream','ferramentas']);
        assert.ok(registros.every(r=>r.origem==='solaris' && r.custo_microbrl>0 && r.estimativa===true));
        assert.equal(registros[0].entrada_cache,200);
        assert.equal(registros[0].saida,400); // tokens de pensamento inclusos
        assert.ok(registros.every(r=>!JSON.stringify(r).includes('texto de teste')));
    } finally {
        console.info=original;
    }
});
