'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

function loadStats() {
    const js = ts.transpileModule(read('frontend/services/dashboardStats.ts'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        reportDiagnostics: true,
    });
    assert.equal((js.diagnostics || []).length, 0);
    const module = { exports: {} };
    vm.runInNewContext(js.outputText, { module, exports: module.exports }, { filename: 'dashboardStats.js' });
    return module.exports;
}

test('dashboard: indicadores reais validados e datas seguras', () => {
    const { normalizarDashboardStats, formatarDataConta } = loadStats();
    const expected = {
        tentativasCompilacao: 1, storageUsadoMb: 2.5, storageLimitMb: 100,
        creditos: 30, creditosCicloTotal: 150, totalProjetos: 2,
        creditosExpiraEm: '2027-01-01',
    };
    assert.equal(JSON.stringify(normalizarDashboardStats(expected)), JSON.stringify(expected));
    for (const data of [
        null, [], {},
        { ...expected, creditos: '30' },
        { ...expected, storageUsadoMb: -1 },
        { ...expected, totalProjetos: Number.NaN },
        { ...expected, creditosCicloTotal: Number.POSITIVE_INFINITY },
        { ...expected, creditosExpiraEm: 'data falsa' },
    ]) {
        assert.equal(normalizarDashboardStats(data), null, 'saldo não pode ser inventado');
    }
    assert.equal(formatarDataConta('data falsa'), null);
    assert.equal(formatarDataConta(undefined), null);
    assert.ok(formatarDataConta('2027-01-01'));
});

test('dashboard: caminhos reais de aprendizado, criação e projetos com texto para iniciantes', () => {
    const src = read('frontend/pages/DashboardHome.tsx');
    assert.match(src, /Seu primeiro projeto começa aqui/);
    assert.match(src, /Conte o que quer criar/);
    assert.match(src, /Revise antes de salvar ou publicar/);
    assert.match(src, /Criar meu primeiro blog/);
    assert.match(src, /Criar um site ou código/);
    assert.match(src, /Continuar meus projetos/);
    for (const route of ['/dashboard/chat', '/dashboard/solaris', '/dashboard/workspace']) {
        assert.ok(src.includes(route), route);
    }
    assert.match(src, /normalizarDashboardStats\(await res\.json\(\)\)/);
    assert.match(src, /setTentativaStats\(n => n \+ 1\)/);
    assert.match(src, /Nenhum saldo foi presumido/);
    assert.match(src, /previaV2\?\.modo === 'ativo'/);
    assert.match(src, /id="consumo-ia"/);
    assert.doesNotMatch(src, /Math\.random\(/);
});

test('dashboard: falha de carregamento da conta mostra recuperação sem liberar conteúdo', () => {
    const src = read('frontend/layouts/DashboardLayout.tsx');
    assert.match(src, /Abrindo seu painel/);
    assert.match(src, /Não conseguimos abrir seu painel/);
    assert.match(src, /setTentativaConta\(n => n \+ 1\)/);
    assert.match(src, /href="\/logout"/);
    assert.match(src, /<Outlet context=\{\{ user \}\}/);
    assert.doesNotMatch(src, /if \(!config\) return null/);
});

test('dashboard: estilos responsivos sem animações forçadas', () => {
    const css = read('public/css/softload.css');
    assert.match(css, /\.sl-dashboard-get-started/);
    assert.match(css, /\.sl-dashboard-steps/);
    assert.match(css, /\.sl-dashboard-quicklink-action/);
    assert.match(css, /prefers-reduced-motion:reduce/);
    const src = read('frontend/pages/DashboardHome.tsx');
    const tsx = ts.transpileModule(src, {
        fileName: 'DashboardHome.tsx',
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
        reportDiagnostics: true,
    });
    assert.equal((tsx.diagnostics || []).length, 0);
});
