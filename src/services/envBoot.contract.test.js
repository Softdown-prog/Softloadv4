'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeEnvBoot(env = {}) {
    const mod = { exports: {} };
    const logs = [];
    const source = fs.readFileSync(path.join(__dirname, 'envBoot.js'), 'utf8');
    vm.runInNewContext(source, {
        module: mod,
        exports: mod.exports,
        process: { env },
        console: { log: (...args) => logs.push(args), error: (...args) => logs.push(args) },
    }, { filename: 'envBoot.js' });
    return { api: mod.exports, logs };
}

function allVars(api) {
    return Object.fromEntries([...api.OBRIGATORIAS, ...api.OPCIONAIS].map(key => [key, 'valor-de-teste']));
}

test('variáveis obrigatórias ausentes bloqueiam boot sem expor valores sensíveis', () => {
    const { api, logs } = makeEnvBoot({});
    const result = api.validarEnvBoot({});
    assert.equal(result.ok, false);
    assert.deepEqual(Array.from(result.faltandoObrigatorias), ['SESSION_SECRET', 'FIREBASE_API_KEY', 'FIREBASE_APP_ID']);
    assert.equal(result.faltandoOpcionais.length, api.OPCIONAIS.length);
    assert.deepEqual(logs, []);
});

test('integração opcional ausente não bloqueia inicialização', () => {
    const { api } = makeEnvBoot();
    const env = allVars(api);
    delete env.GEMINI_API_KEY;
    const result = api.validarEnvBoot(env);
    assert.equal(result.ok, true);
    assert.deepEqual(Array.from(result.faltandoObrigatorias), []);
    assert.deepEqual(Array.from(result.faltandoOpcionais), ['GEMINI_API_KEY']);
});

test('env padrão é lido sem alterar process.env global; valores vazios estão ausentes', () => {
    const { api } = makeEnvBoot({ SESSION_SECRET: '', FIREBASE_API_KEY: 'api', FIREBASE_APP_ID: 'app' });
    const result = api.validarEnvBoot();
    assert.equal(result.ok, false);
    assert.deepEqual(Array.from(result.faltandoObrigatorias), ['SESSION_SECRET']);
    const validEnv = allVars(api);
    assert.equal(api.validarEnvBoot(validEnv).ok, true);
    assert.equal(result.ok, false);
});

test('contrato preserva classificação e ordem dos nomes aceitos', () => {
    const { api } = makeEnvBoot();
    assert.deepEqual(Array.from(api.OBRIGATORIAS), ['SESSION_SECRET', 'FIREBASE_API_KEY', 'FIREBASE_APP_ID']);
    assert.deepEqual(Array.from(api.OPCIONAIS), [
        'GEMINI_API_KEY', 'OPENAI_API_KEY', 'RESEND_API_KEY', 'PIXABAY_API_KEY',
        'MP_ACCESS_TOKEN', 'MP_WEBHOOK_SECRET', 'GCS_BUCKET_NAME', 'SOLARIS_CLEANUP_SECRET',
    ]);
    const unknownOnly = api.validarEnvBoot({ INTEGRACAO_DESCONHECIDA: 'valor' });
    assert.equal(unknownOnly.ok, false);
});
