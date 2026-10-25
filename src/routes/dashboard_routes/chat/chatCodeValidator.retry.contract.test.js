'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, 'chatCodeValidator.js'), 'utf8');
function fixture({ failStream = false, noValidCode = false } = {}) {
    const calls = { gpt: 0, gemini: 0 };
    const fence = String.fromCharCode(96).repeat(3);
    const sourceRaw = fence + 'js\nbad(\n' + fence;
    const fixedRaw = fence + 'js\nfixed()\n' + fence;
    const module = { exports: {} };
    const events = [];
    const fake = {
        '../../../services/openaiService': { async *gerarChatGptStream() {
            calls.gpt++;
            if (failStream) throw Error('simulated provider failure');
            yield fixedRaw.slice(0, 8);
            yield fixedRaw.slice(8);
        } },
        '../../../services/geminiService': { async *gerarChatStream() {
            calls.gemini++;
            yield fixedRaw;
        } },
        '../../../core/codeValidator': {
            validateResponseBlocks() {
                return { allOk: false, results: [{ ok: false, skipped: false, errors: ['erro de sintaxe'], type: 'js' }] };
            },
            validateCode(text) { return { ok: !noValidCode && text === 'fixed()' }; },
            extractCodeBlocks(text) {
                const raw = text.includes('fixed()') ? fixedRaw : sourceRaw;
                return [{ raw, code: raw === fixedRaw ? 'fixed()' : 'bad(', lang: 'js' }];
            },
        },
        '../../../core/repairEngine': {
            repararXml() { throw Error('xml should not be attempted'); },
            repararCssTruncado() { throw Error('css should not be attempted'); },
        },
    };
    vm.runInNewContext(code, {
        module, exports: {}, console: { warn() {} },
        require(spec) { if (!Object.hasOwn(fake, spec)) throw Error('unmocked '+spec); return fake[spec]; }
    }, { filename: 'chatCodeValidator.js' });
    return { ...module.exports, calls, events, sourceRaw, fixedRaw };
}
test('retry GPT substitui apenas bloco validado e emite patch por IA', async () => {
    const f=fixture();
    const original='Código:\n'+f.sourceRaw+'\nFim.';
    const data=await f._validarECorrigir(original,'corrija o js',true,{},event=>f.events.push(event));
    assert.equal(f.calls.gpt,1);
    assert.equal(f.calls.gemini,0);
    assert.equal(data.finalText,'Código:\n'+f.fixedRaw+'\nFim.');
    assert.equal(data.validation.fixMethod,'ia');
    assert.equal(data.validation.retried,true);
    assert.equal(data.validation.fixApplied,true);
    assert.equal(f.events[0].type,'status');
    assert.equal(f.events[1].type,'code_patch');
    assert.equal(f.events[1].method,'ia');
});
test('falha do provedor ou bloco inválido preserva código original e sinaliza erro', async () => {
    for(const f of [fixture({failStream:true}),fixture({noValidCode:true})]){
        const result=await f._validarECorrigir(f.sourceRaw,'corrija',true,{},()=>{});
        assert.equal(result.finalText,f.sourceRaw);
        assert.equal(result.validation.fixFailed,true);
        assert.equal(result.validation.retried,true);
        assert.equal(result.validation.fixApplied,false);
    }
});
