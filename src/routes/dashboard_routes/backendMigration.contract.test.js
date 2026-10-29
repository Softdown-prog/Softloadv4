'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadRouter(file) {
    const registrations = [];
    const exigirLogin = (_req, _res, next) => next();
    const router = { get(route, ...handlers) { registrations.push({ route, handlers }); }, post(route,...handlers) { registrations.push({ route, handlers }); } };
    const sandbox = {
        exports: {},
        module: { exports: {} },
        process: {env:{BLOGGER_ESSENCIAL_CHECKOUT_ENABLED:'false'}},
        require(spec) {
            if (spec === 'express') return { Router: () => router };
            if (spec === '../../middlewares/authGuard') return { exigirLogin };
            if (file === 'compiler.js') {
                if (spec === 'express-rate-limit') return () => (_req,_res,next)=>next();
                if (spec === '../../core/compilerWorker') return { executarCompilacao: () => ({xmlFinal:'<html/>',slug:'teste'}) };
                if (spec === '../../core/xmlValidator') return {validarXmlCompilado:()=>[],validarXmlEstrutura:()=>({erros:[]}),validarSemanticaBlogger:()=>({erros:[]})};
                if (spec === '../../core/presets') return {COLOR_PRESETS:{'tech-blue':{label:'Azul'}},TYPOGRAPHY_PRESETS:{inter:{label:'Inter'}}};
                if (spec === '../../core/nichoTaxonomy') return {NICHO_PAGE_TYPE_MAP:{'noticias-mag-news':'portal-noticias'},PAGE_TYPES_SEM_CHASSIS_DEDICADO:new Set()};
                if (spec === '../../services/firebase') return {db:{}};
            }
            throw new Error('Dependência inesperada: ' + spec);
        },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), sandbox, { filename: file });
    assert.equal(sandbox.module.exports, router);
    return { registrations, exigirLogin };
}

test('compilador integra SSR procedural e redirects legados protegidos', () => {
    const { registrations, exigirLogin } = loadRouter('compiler.js');
    assert.ok(registrations.some(x=>x.route==='/dashboard/gerador-blogger'));
    assert.ok(registrations.some(x=>x.route==='/dashboard/gerador-blogger/download'));
    const legadas=registrations.filter(x=>['/dashboard/compiler','/dashboard/compiler-blogger-xml'].includes(x.route));
    assert.equal(legadas.length,2);
    for (const registration of legadas) {
        assert.equal(registration.handlers[0], exigirLogin);
        const received=[];
        registration.handlers[1]({}, {redirect(status,to){received.push(status,to);}});
        assert.deepEqual(received,[302,'/dashboard/gerador-blogger']);
    }
});

for (const [file, url, page, viewExpected] of [
    ['configuracoes.js', '/dashboard/configuracoes', 'configuracoes', 'pages/configuracoes-simples'],
    ['upgrade.js', '/dashboard/upgrade', 'plano-essencial', 'pages/plano-essencial'],
]) {
    test('rota protegida ' + file + ' renderiza EJS e preserva o usuário de sessão', () => {
        const { registrations, exigirLogin } = loadRouter(file);
        const selected=registrations.find(x=>x.route===url);
        assert.ok(selected);
        assert.equal(selected.handlers[0], exigirLogin);
        const results = [];
        const user = { uid: 'id-de-teste' };
        selected.handlers[1]({ session: { user } }, { render(view, locals) { results.push({ view, locals }); } });
        assert.equal(results[0].view, viewExpected);
        assert.equal(results[0].locals.activePage, page);
        assert.equal(results[0].locals.user, user);
        if (file === 'upgrade.js') {
          const essential=registrations.find(x=>x.route==='/dashboard/plano-essencial');
          assert.ok(essential,'Nova rota de pagamento EJS não encontrada');
          assert.equal(essential.handlers[0],exigirLogin);
          const views=[];
          essential.handlers[1]({session:{user}},{render(view,locals){views.push({view,locals});}});
          assert.equal(views[0].view,'pages/plano-essencial');
          assert.equal(views[0].locals.user,user);
          assert.equal(views[0].locals.checkoutEnabled,false);
        }
    });
}
