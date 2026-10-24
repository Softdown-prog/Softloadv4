'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const filename = require.resolve('./blueprintSelector');
const code = fs.readFileSync(filename, 'utf8');
function ambiente({criticas=[],erros=[],correcoes=[],gemini={},falhar=false}={}) {
    const calls=[], state={criticas,erros,correcoes,gemini,falhar};
    let resultadoCritics;
    const mocks={
        '../services/geminiService': {gerarJson: async (prompt,sistema,opts)=>{
            calls.push('Gemini');
            assert.ok(prompt.includes('Temas disponíveis:'));
            assert.ok(prompt.includes('colorPresets válidos:'));
            assert.ok(sistema.includes('APENAS JSON válido'));
            assert.equal(opts.maxOutputTokens,250);
            if(state.falhar) throw Error('Gemini indisponível');
            return state.gemini;
        }},
        './blueprintCritics': {
            criticarBlueprint(bp) {
                calls.push('Critics');
                resultadoCritics={...bp};
                return {blueprint:resultadoCritics, criticas:state.criticas, erros:state.erros, correcoes:state.correcoes};
            },
            NICHO_TEMAS_VALIDOS:new Set(['gamer-playerone','saas-nexus']),
        },
        '../ai/blueprintSchema':{ENUMS:{colorPreset:['tech-blue','gamer-dark'],menuType:['classic','offcanvas']}},
    };
    const m=new Module(filename,module);
    m.filename=filename;
    m.paths=module.paths;
    m.require=id => mocks[id] ?? require(id);
    m._compile(code,filename);
    return {api:m.exports, calls, state, get critics(){return resultadoCritics;}};
}
(async()=>{
    const original={siteName:'Portal Real',nichoTema:'gamer-playerone',colorPreset:'gamer-dark'};
    const ok=ambiente();
    assert.deepEqual(Object.keys(ok.api),['refinarBlueprint']);
    const untouched=await ok.api.refinarBlueprint(original);
    assert.deepEqual(ok.calls,['Critics']);
    assert.strictEqual(untouched.blueprint,ok.critics);
    assert.notStrictEqual(untouched.blueprint,original);
    assert.deepEqual(untouched.report,{criticas:[],erros:[],correcoes:[],refined:false});
    assert.deepEqual(original,{siteName:'Portal Real',nichoTema:'gamer-playerone',colorPreset:'gamer-dark'});

    const fatal=ambiente({erros:['siteName ausente'],criticas:['incompatível']});
    const fat=await fatal.api.refinarBlueprint({siteName:''});
    assert.deepEqual(fatal.calls,['Critics'],'erros fatais não chamam Gemini');
    assert.deepEqual(fat.report.erros,['siteName ausente']);
    assert.equal(fat.report.refined,false);

    const selection=ambiente({criticas:['incompatível'],correcoes:['corrigido'],gemini:{
        colorPreset:'tech-blue',foo:'não permitido',siteName:'INJETADO',
        postModules:['reading-time','back-to-top'],darkMode:'toggle-btn',
        gridLayout:null
    }});
    const r=await selection.api.refinarBlueprint({...original,postModules:['reading-time','share-buttons']});
    assert.deepEqual(selection.calls,['Critics','Gemini']);
    assert.equal(r.blueprint.siteName,'Portal Real','campo não autorizado não é aplicado');
    assert.equal(r.blueprint.foo,undefined,'campo fora whitelist não aplicado');
    assert.equal(r.blueprint.colorPreset,'tech-blue');
    assert.equal(r.blueprint.darkMode,'toggle-btn');
    assert.equal(r.blueprint.gridLayout,undefined,'valor null não substitui');
    assert.deepEqual(r.blueprint.postModules,['reading-time','share-buttons','back-to-top'],'arrays unidos sem duplicatas');
    assert.equal(r.report.refined,true);
    assert.equal(r.report.refinamentosAplicados,4,'contagem preserva os campos na whitelist inclusive null');
    assert.deepEqual(r.report.correcoes,['corrigido']);

    const unknown=ambiente({gemini:{typography:'inter'}});
    const ur=await unknown.api.refinarBlueprint({siteName:'Portal Real',nichoTema:'nicho-inexistente'});
    assert.deepEqual(unknown.calls,['Critics','Gemini'],'nicho fora catálogo chama refinador');
    assert.equal(ur.blueprint.typography,'inter');

    const disabled=ambiente({criticas:['ajustar'],gemini:{footerStyle:'',sidebarPosition:null}});
    const dr=await disabled.api.refinarBlueprint(original);
    assert.equal(dr.blueprint.footerStyle,undefined,'string vazia não sobrescreve');
    assert.equal(dr.blueprint.sidebarPosition,undefined,'null não sobrescreve');
    assert.equal(dr.report.refined,true,'contagem histórica inclui campos ignorados');

    const offline=ambiente({criticas:['ajustar'],falhar:true});
    const off=await offline.api.refinarBlueprint(original);
    assert.deepEqual(offline.calls,['Critics','Gemini']);
    assert.strictEqual(off.blueprint,offline.critics);
    assert.equal(off.report.refined,false,'falha Gemini não bloqueia seleção');
    assert.ok(!('refinamentosAplicados' in off.report));

    const unusable=ambiente({criticas:['ajustar'],gemini:'texto'});
    const ub=await unusable.api.refinarBlueprint(original);
    assert.equal(ub.report.refined,false,'resposta primitiva não altera campos');
    const ignored=ambiente({criticas:['ajustar'],gemini:{siteName:'Falso',outro:'valor'}});
    const ig=await ignored.api.refinarBlueprint(original);
    assert.equal(ig.report.refined,false,'campos todos fora da whitelist deixam refined false');

    console.log('✅ blueprintSelector: críticos, gate fatal, whitelist, dedup, fallback e catálogo.');
})().catch(err=>{console.error(err);process.exitCode=1;});
