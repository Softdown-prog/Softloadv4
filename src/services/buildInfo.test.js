'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.join(__dirname, 'buildInfo.js'), 'utf8');
function loadBuildInfo(files = {}) {
    const calls = [];
    const mod = { exports: {} };
    vm.runInNewContext(code, {
        module: mod,
        exports: mod.exports,
        __dirname,
        require(id) {
            if (id === 'path') return path;
            if (id === 'fs') return {
                readFileSync(file, encoding) {
                    assert.equal(encoding, 'utf-8');
                    calls.push(path.relative(path.resolve(__dirname, '../..'), file));
                    const key = path.basename(file);
                    if (!Object.hasOwn(files, key)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
                    const value = files[key];
                    if (value instanceof Error) throw value;
                    return value;
                },
            };
            throw new Error('Dependência inesperada: ' + id);
        },
    }, {filename:'buildInfo.js'});
    return { info: mod.exports, calls };
}

test('Docker: expõe commit, data e build time e lê só arquivos de metadados', () => {
    const { info, calls } = loadBuildInfo({
        GIT_SHA: '   0123456789abcdef  \n',
        GIT_DATE: '2026-10-25T09:00:00Z\n',
        BUILD_TIME: '2026-10-25T09:01:00Z\n',
    });
    assert.deepEqual(JSON.parse(JSON.stringify(info)), {
        gitSha: '0123456789abcdef',
        gitDate: '2026-10-25T09:00:00Z',
        buildTime: '2026-10-25T09:01:00Z',
    });
    assert.deepEqual(calls, ['GIT_SHA', 'GIT_DATE', 'BUILD_TIME']);
});

test('dev: ausência de GIT_SHA/GIT_DATE/BUILD_TIME mantém fallback', () => {
    const { info } = loadBuildInfo();
    assert.equal(info.gitSha, 'dev-local');
    assert.equal(info.gitDate, null);
    assert.equal(info.buildTime, null);
});

test('arquivos vazios, whitespace ou erro de leitura não propagam exceção', () => {
    const { info } = loadBuildInfo({
        GIT_SHA: ' \n ',
        GIT_DATE: new Error('EACCES'),
        BUILD_TIME: ' 2026-10-25 12:00:00 ',
    });
    assert.equal(info.gitSha, 'dev-local');
    assert.equal(info.gitDate, null);
    assert.equal(info.buildTime, '2026-10-25 12:00:00');
});

test('metadados parcialmente presentes não ganham valores fictícios', () => {
    const { info } = loadBuildInfo({ GIT_SHA: 'commit-real' });
    assert.equal(info.gitSha, 'commit-real');
    assert.equal(info.gitDate, null);
    assert.equal(info.buildTime, null);
});
