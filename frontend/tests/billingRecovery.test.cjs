'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const file = path.resolve(__dirname, '../services/billingRecovery.ts');
const source = fs.readFileSync(file, 'utf8');
const transpiled = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const moduleObject = { exports: {} };
vm.runInNewContext(transpiled.outputText, {
    module: moduleObject, exports: moduleObject.exports, Date, Number, String, Math,
}, { filename: file });
const { parseBillingRecoveryStatus, classificarRecuperacao } = moduleObject.exports;
const now = Date.parse('2026-10-25T18:00:00.000Z');
function state(overrides = {}) {
    return parseBillingRecoveryStatus({
        estado: 'ok', emExecucao: false, ultimaExecucaoEm: new Date(now - 60_000).toISOString(),
        processadas: 3, falhas: 0, conflitosCursor: 0, quantidadeAmostrada: 2,
        maisAntigaMinutos: 5, falhasConsecutivas: 0, ilegivel: 0,
        amostraLimitada: false, alertaAtivo: false,
        webhookConfigurado: true, erroNotificacao: false,
        ...overrides,
    });
}

test('dados válidos mostram último ciclo e nunca fingem total histórico', () => {
    const data = state();
    assert.equal(data.processadas, 3);
    assert.equal(data.quantidadeAmostrada, 2);
    assert.equal(classificarRecuperacao(data, false, now).gravidade, 'ok');
});

test('sem execução ainda não há saldo nem contadores disponíveis', () => {
    const data = parseBillingRecoveryStatus({estado: 'nao_iniciado', emExecucao: false});
    assert.equal(data.processadas, null);
    assert.equal(data.quantidadeAmostrada, null);
    assert.equal(classificarRecuperacao(data, false, now).gravidade, 'neutro');
});

test('dados errados não são convertidos em zeros tranquilizadores', () => {
    assert.throws(() => parseBillingRecoveryStatus({estado: 'boa'}), /inválida/);
    assert.throws(() => parseBillingRecoveryStatus(null), /inválida/);
    const data = state({processadas: -7, falhas: '0', maisAntigaMinutos: Infinity});
    assert.equal(data.processadas, null);
    assert.equal(data.falhas, null);
    assert.equal(data.maisAntigaMinutos, null);
});

test('alerta, erro de API, amostra limitada e dados antigos são sinalizados', () => {
    assert.equal(classificarRecuperacao(state({estado:'alerta',alertaAtivo:true}), false, now).gravidade, 'erro');
    assert.equal(classificarRecuperacao(state(), true, now).gravidade, 'erro');
    assert.equal(classificarRecuperacao(state({amostraLimitada:true}), false, now).gravidade, 'atencao');
    assert.equal(classificarRecuperacao(state({maisAntigaMinutos:60}), false, now).gravidade, 'atencao');
    assert.equal(classificarRecuperacao(state({ultimaExecucaoEm:new Date(now-11*60000).toISOString()}), false, now).titulo, 'Dados desatualizados');
});

test('painel usa endpoint administrativo autenticado, polling e atualização manual', () => {
    const panel = fs.readFileSync(path.resolve(__dirname, '../components/admin/BillingRecoveryPanel.tsx'), 'utf8');
    const dashboard = fs.readFileSync(path.resolve(__dirname, '../pages/admin/Dashboard.tsx'), 'utf8');
    assert.match(panel, /fetch\('\/eu\/api\/billing\/recuperacao'/);
    assert.match(panel, /credentials: 'same-origin'/);
    assert.match(panel, /cache: 'no-store'/);
    assert.match(panel, /setInterval\(\(\) => \{ void carregar\(\); \}, 60000\)/);
    assert.match(panel, /clearInterval\(interval\)/);
    assert.match(panel, /onClick=\{\(\) => \{ void carregar\(\); \}\}/);
    assert.match(panel, /Amostra/);
    assert.match(dashboard, /<BillingRecoveryPanel \/>/);
});


test('disputa de cursor é visível sem marcar cobrança como falha',()=>{
    const data=state({conflitosCursor:2, falhas:0});
    assert.equal(data.conflitosCursor,2);
    assert.equal(classificarRecuperacao(data,false,now).gravidade,'ok');
    const panel=fs.readFileSync(path.resolve(__dirname,'../components/admin/BillingRecoveryPanel.tsx'),'utf8');
    assert.match(panel,/Disputas do cursor GCS/);
    assert.match(panel,/fmt\(status\?\.conflitosCursor\)/);
});
