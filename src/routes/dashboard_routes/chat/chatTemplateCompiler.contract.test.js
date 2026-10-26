'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'chatTemplateCompiler.js'),'utf8');
function fixture({errors=[],counterFails=false,compileFails=false}={}){
    const calls={events:[],compiled:[],updates:[],refines:[]};
    const increment={incremented:true};
    const timestamp={timestamp:true};
    const db={collection(name){
        assert.equal(name,'clientes_premium');
        return {doc(email){
            assert.equal(email,'user@example.test');
            return {async update(fields){calls.updates.push(fields);if(counterFails)throw Error('Firestore offline');}};
        }};
    }};
    const refined={refinarBlueprint:async bp=>{
        calls.refines.push(bp);
        return {blueprint:bp,report:{correcoes:[],criticas:[],erros:errors}};
    }};
    const deps={
        '../../../services/firebase':{db,admin:{firestore:{FieldValue:{serverTimestamp(){return timestamp;}}}}},
        '../../../core/compilerPipeline':{async compilarComPipeline(...args){
            calls.compiled.push(args);
            if(compileFails)throw Error('Quota exhausted');
            return {downloadUrl:'https://example.test/compilacao/version-123/download',xmlPath:'v.xml',gcPath:'gs://bucket/v.xml'};
        }},
        '../../../core/blueprintSelector':refined,
        '../../../core/blueprintCritics':{NICHO_PAGE_TYPE_MAP:{'gamer-playerone':'blogger-feed'},PAGE_TYPES_SEM_SIDEBAR:new Set(['landing-page'])},
        '../../../core/nichoModuleDefaults':{modulosPadraoDoNicho:()=>({contactForm:false,statsWidget:true,menuType:'classico'})},
        'firebase-admin':{firestore:{FieldValue:{increment(n){assert.equal(n,1);return increment;}}}}
    };
    const module={exports:{}};
    vm.runInNewContext(code,{
        module,exports:{},require(spec){if(!Object.hasOwn(deps,spec))throw Error('Unexpected require '+spec);return deps[spec];},
        console:{log(){},warn(){}}
    },{filename:'chatTemplateCompiler.js'});
    return {api:module.exports,calls,timestamp,increment,user:{email:'USER@EXAMPLE.TEST',uid:'test'},send:e=>calls.events.push(e)};
}
test('invalid or technical site names never reach compiler',async()=>{
    const f=fixture();
    for(const siteName of ['', 'gamer-playerone','Template','MEU SITE']){
        assert.throws(()=>f.api._blueprintParaManifesto({siteName}),/siteName inválido/);
    }
    assert.equal(f.calls.compiled.length,0);
});
test('converts required name, description, modules, no-sidebar, badges and native options',()=>{
    const f=fixture();
    const x=f.api._blueprintParaManifesto({
        siteName:'Loja de Games',nichoTema:'gamer-playerone',pageType:'landing-page',
        description:'A'.repeat(280),coreFeatures:['seo-premium','lazy-load'],
        postModules:['reading-time','cookie-banner','comments-native'],
        moduleOverrides:{statsWidget:false,contactForm:true},
        categoryBadges:['FPS',{nome:'RPG',bg:'#123',text:'#fff'}],
        customCss:'body{color:red}',darkTheme:true
    });
    assert.equal(x.siteName,'Loja de Games');
    assert.equal(x.description.length,240);
    assert.equal(x.modules.statsWidget,false);
    assert.equal(x.modules.contactForm,true);
    assert.equal(x.modules.readingTime,true);
    assert.equal(x.modules.cookieBanner,true);
    assert.equal(x.modules.commentsSystem,'nativo');
    assert.equal(x.sidebarPosition,'none');
    assert.equal(x.enableSeo,true);
    assert.equal(x.lazyLoad,true);
    assert.equal(x.categoryBadges.length,2);
    assert.equal(x.categoryBadges[0].nome,'FPS');
    assert.equal(x.categoryBadges[1].bg,'#123');
    assert.equal(x.customCss,'body{color:red}');
    assert.equal(x.darkTheme,true);
});
test('compilation keeps workspace ids, increments counter and saves preview paths',async()=>{
    const f=fixture();
    const ids={wsProjetoId:'project-1',wsSessionId:'session-1'};
    const result=await f.api._compilarParaChat({siteName:'Loja Azul',nichoTema:'gamer-playerone'},f.user,f.send,ids);
    assert.equal(f.calls.compiled.length,1);
    assert.equal(f.calls.compiled[0][4],ids);
    assert.equal(f.calls.events[0].label,'Validando blueprint...');
    assert.equal(result.snapshot.compilacaoId,'version-123');
    assert.equal(result.snapshot.xmlPath,'v.xml');
    assert.equal(result.snapshot.gcPath,'gs://bucket/v.xml');
    assert.equal(result.snapshot.snapshotEm,f.timestamp);
    assert.equal(result.snapshot.manifesto.siteName,'Loja Azul');
    assert.equal(f.calls.updates[0].tentativas_compilacao,f.increment);
});
test('critic errors and pipeline failures prevent phantom downloads',async()=>{
    const invalid=fixture({errors:['Blueprint rejeitado']});
    await assert.rejects(()=>invalid.api._compilarParaChat({siteName:'Loja Azul'},invalid.user,invalid.send),/Blueprint inválido/);
    assert.equal(invalid.calls.compiled.length,0);
    const quota=fixture({compileFails:true});
    await assert.rejects(()=>quota.api._compilarParaChat({siteName:'Loja Azul'},quota.user,quota.send),/Quota exhausted/);
    assert.equal(quota.calls.updates.length,0);
});
test('failed compilation counter does not invalidate existing completed download',async()=>{
    const f=fixture({counterFails:true});
    const result=await f.api._compilarParaChat({siteName:'Loja Azul'},f.user,f.send);
    assert.match(result.downloadUrl,/version-123/);
    assert.equal(f.calls.updates.length,1);
});
