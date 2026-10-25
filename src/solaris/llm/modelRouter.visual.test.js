'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarModelRouter, MODEL_FLASH } = require('./modelRouter');
const png = Buffer.from('89504e470d0a1a0a10111213','hex');
const screenshot = {mimeType:'image/png',dataBase64:png.toString('base64'),bytes:png.length,fullPage:true};
test('Flash recebe screenshot como image/png real (inlineData), sem Pro, cap 1024',async()=>{
    const calls=[];
    const router=criarModelRouter(()=>({
        models:{async generateContent(input){calls.push(input);return {text:'Texto visual',usageMetadata:{
            promptTokenCount:280,candidatesTokenCount:90,totalTokenCount:370,
        }};}},
    }));
    const result=await router.executarAuditoriaVisual({screenshot});
    assert.equal(result.texto,'Texto visual');
    assert.deepEqual(result.tokens,{input:280,output:90,total:370});
    assert.equal(calls[0].model,MODEL_FLASH);
    assert.equal(calls[0].config.maxOutputTokens,1024);
    assert.equal(calls[0].contents[0].role,'user');
    assert.equal(calls[0].contents[0].parts[1].inlineData.mimeType,'image/png');
    assert.equal(calls[0].contents[0].parts[1].inlineData.data,screenshot.dataBase64);
    assert.ok(!calls[0].contents[0].parts[0].text.includes(screenshot.dataBase64));
    assert.match(calls[0].config.systemInstruction,/não confiável/);
});
test('não envia PNG inválido ou maior que 512KiB ao provedor',async()=>{
    let calls=0;
    const router=criarModelRouter(()=>({models:{async generateContent(){calls++;return {text:'ok'};}}}));
    for(const shot of [null,{...screenshot,mimeType:'text/html'},{...screenshot,bytes:512*1024+1}]){
        await assert.rejects(router.executarAuditoriaVisual({screenshot:shot}),/PNG inválido/);
    }
    assert.equal(calls,0);
});
