'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const filename = require.resolve('./templateEditWorker');
const originalSource = fs.readFileSync(filename, 'utf8');

function criarAmbiente() {
    const chamadas = [];
    const state = { falharCompile: false, falharPersist: false };
    let compiled = null;
    let saved = null;
    const mod = new Module(filename, module);
    mod.filename = filename;
    mod.paths = module.paths;
    const mocks = {
        './compilerWorker': {
            executarCompilacao(manifesto) {
                chamadas.push('compile');
                compiled = manifesto;
                if (state.falharCompile) throw new Error('falha intencional');
                return { xmlFinal: '<html></html>', slug: 'slug-teste', siteNameSanitizado: 'Meu Site' };
            }
        },
        './compilerPipeline': {
            async finalizarCompilacao(xml, context, user, status) {
                chamadas.push('finalize');
                saved = { xml, context, user };
                assert.equal(xml, '<html></html>');
                assert.equal(user.uid, 'uid-teste');
                assert.equal(typeof status, 'function');
                if (state.falharPersist) throw new Error('falha ao persistir');
                return { downloadUrl: '/download/1', gcPath: 'bucket/one.zip', xmlPath: 'bucket/one.xml' };
            }
        }
    };
    mod.require = id => mocks[id] ?? require(id);
    mod._compile(originalSource, filename);
    return { api: mod.exports, chamadas, state, get compiled(){return compiled;},get saved(){return saved;} };
}

const user = { uid: 'uid-teste', email: 'user@example.test', plano: 'free' };
(async () => {
    const env = criarAmbiente();
    assert.deepEqual(Object.keys(env.api), [
        'mergeManifesto', 'aplicarEdicao', 'reverterParaVersao', '_resumirManifesto'
    ], 'API CommonJS e ordem pública preservadas');

    const input = {
        siteName:'Meu Site', colorPreset:'tech-blue',
        modules:{ darkMode:false, backToTop:true },
        categoryBadges:[{nome:'Antigo'}],
        heroHtml:'B'.repeat(180)
    };
    const patch = { modules:{ darkMode:true }, categoryBadges:[{nome:'Novo'}], colorPreset:'gamer-dark' };
    const merged = env.api.mergeManifesto(input,patch);
    assert.deepEqual(merged.modules,{darkMode:true,backToTop:true},'merge profundo apenas nos módulos');
    assert.deepEqual(merged.categoryBadges,[{nome:'Novo'}],'substituir badges como array completo');
    assert.equal(merged.colorPreset,'gamer-dark');
    assert.deepEqual(input.modules,{darkMode:false,backToTop:true},'não mutar manifesto original');
    assert.deepEqual(input.categoryBadges,[{nome:'Antigo'}]);
    assert.notStrictEqual(merged,input);
    assert.notStrictEqual(merged.modules,input.modules);
    assert.deepEqual(env.api.mergeManifesto(input,{}), input, 'patch vazio conserva valores');
    const summarized = env.api._resumirManifesto(input);
    assert.equal(summarized.heroHtml, 'B'.repeat(160)+'…(truncado, 180 chars totais)');
    assert.equal(input.heroHtml.length,180,'resumo não altera original');
    assert.equal(env.api._resumirManifesto({heroHtml:'A'.repeat(160)}).heroHtml.length,160,'160 não trunca');
    for (const campo of ['customCss','staticSections','svgLogo']) {
        assert.ok(env.api._resumirManifesto({[campo]:'x'.repeat(161)})[campo].endsWith('…(truncado, 161 chars totais)'));
    }
    const statuses = [];
    const edit = await env.api.aplicarEdicao(input,patch,user,s=>statuses.push(s),'project-id','session-id','Troca de cores');
    assert.deepEqual(statuses,['Recompilando template com as alterações...']);
    assert.deepEqual(env.chamadas,['compile','finalize']);
    assert.deepEqual(edit,{
        downloadUrl:'/download/1',xmlPath:'bucket/one.xml',gcPath:'bucket/one.zip',manifesto:merged
    });
    assert.strictEqual(env.compiled,env.saved.context.manifesto);
    assert.equal(env.saved.context.origem,'chat-edicao');
    assert.equal(env.saved.context.enriched,false);
    assert.equal(env.saved.context.wsProjetoId,'project-id');
    assert.equal(env.saved.context.wsSessionId,'session-id');
    assert.equal(env.saved.context.resumoMudancas,'Troca de cores');

    const fallback = criarAmbiente();
    await fallback.api.aplicarEdicao(input,{},user);
    assert.deepEqual([fallback.saved.context.wsProjetoId,fallback.saved.context.wsSessionId,fallback.saved.context.resumoMudancas],[null,null,null]);

    const revertEnv = criarAmbiente();
    const antigaVersao = {siteName:'Site Legado',colorPreset:'tech-blue',modules:{darkMode:false}};
    const revertStatus=[];
    const reverted = await revertEnv.api.reverterParaVersao(antigaVersao,user,s=>revertStatus.push(s),'project-id','session-id');
    assert.deepEqual(revertStatus,['Recompilando a versão selecionada...']);
    assert.deepEqual(revertEnv.chamadas,['compile','finalize']);
    assert.strictEqual(revertEnv.compiled,antigaVersao,'reverter deve usar versão original exata, sem merge');
    assert.strictEqual(revertEnv.saved.context.manifesto,antigaVersao);
    assert.strictEqual(reverted.manifesto,antigaVersao);
    assert.equal(revertEnv.saved.context.origem,'revert');
    assert.equal(revertEnv.saved.context.enriched,false);
    assert.equal(revertEnv.saved.context.wsProjetoId,'project-id');
    assert.equal(revertEnv.saved.context.wsSessionId,'session-id');
    assert.ok(!('resumoMudancas' in revertEnv.saved.context));

    const brokeEdit=criarAmbiente();brokeEdit.state.falharCompile=true;
    await assert.rejects(brokeEdit.api.aplicarEdicao(input,patch,user), /\[EDIT-WORKER\/COMPILE\] falha intencional/);
    assert.deepEqual(brokeEdit.chamadas,['compile'],'sem gravar edição que não compila');
    const brokeRevert=criarAmbiente();brokeRevert.state.falharCompile=true;
    await assert.rejects(brokeRevert.api.reverterParaVersao(input,user), /\[EDIT-WORKER\/REVERT\] falha intencional/);
    assert.deepEqual(brokeRevert.chamadas,['compile'],'sem gravar revertido que não compila');
    const persistFailure=criarAmbiente();persistFailure.state.falharPersist=true;
    await assert.rejects(persistFailure.api.aplicarEdicao(input,patch,user), /falha ao persistir/);
    assert.deepEqual(persistFailure.chamadas,['compile','finalize'],'erro de persistência propagado');
    console.log('✅ templateEditWorker: merge, resumo, edição, reversão, histórico e falhas.');
})().catch(err=>{console.error(err);process.exitCode=1;});
