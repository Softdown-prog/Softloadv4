require('./test/isolatedTelemetry.cjs');
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { criarCarregadorChassis } = require('./workerChassis');
const { carregarChassisParaNicho } = require('./compilerWorker');
const { NICHO_CHASSIS_MAP, chassisParaNicho } = require('./nichoTaxonomy');

// Baseline independente: exata precedência e operação do loader JavaScript anterior.
const workerDir = __dirname;
let baselineCache = null;
function legacyChassis(nichoTema) {
    function templateParaNicho(nicho) {
        if (!nicho) return 'base';
        const key = String(nicho).replace(/^tema-/, '').toLowerCase().trim();
        return chassisParaNicho(key) || 'base';
    }
    function load(tipo = 'base') {
        const name = tipo === 'base' ? 'template_base.xml' : 'template_' + tipo + '.xml';
        const filePath = path.join(workerDir, '../blogger/templates', name);
        let xml;
        try { xml = fs.readFileSync(filePath, 'utf-8'); }
        catch (err) {
            if (tipo !== 'base') return load('base');
            throw new Error('[CHASSIS] Falha ao ler template_base.xml: ' + err.message);
        }
        if (!xml || xml.length < 200) throw new Error('[CHASSIS] ' + name + ' está vazio ou corrompido.');
        if (xml.includes('[[BLOGGER_INCLUDABLES_PADRAO]]')) {
            if (baselineCache === null) {
                baselineCache = fs.readFileSync(path.join(workerDir,
                    '../blogger/templates/_partials/blogger-includables-padrao.xml'), 'utf-8');
            }
            xml = xml.split('[[BLOGGER_INCLUDABLES_PADRAO]]').join(baselineCache);
        }
        return xml;
    }
    const key = nichoTema ? String(nichoTema).replace(/^tema-/, '').toLowerCase().trim() : '';
    if (key && fs.existsSync(path.join(workerDir, '../blogger/templates', 'template_' + key + '.xml'))) {
        return load(key);
    }
    return load(templateParaNicho(nichoTema));
}

let verified = 0;
for (const nicho of [null, undefined, '', 'nao-existe', ...Object.keys(NICHO_CHASSIS_MAP)]) {
    for (const variant of (nicho ? [nicho, 'tema-' + nicho] : [nicho])) {
        assert.equal(carregarChassisParaNicho(variant), legacyChassis(variant), 'Divergência XML para ' + variant);
        verified++;
    }
}

// Sistema de arquivos virtual: fallback, limpeza, cache, priorização e erros.
const BASE = '/src/blogger/templates';
const partialPath = BASE + '/_partials/blogger-includables-padrao.xml';
function makeLoader(changes = {}, opts = {}) {
    const files = Object.assign({
        [BASE + '/template_base.xml']: 'B'.repeat(201),
        [BASE + '/template_blog.xml']: 'F'.repeat(201),
        [BASE + '/template_gamer.xml']: 'G'.repeat(210) + '[[BLOGGER_INCLUDABLES_PADRAO]]' + '[[BLOGGER_INCLUDABLES_PADRAO]]',
        [partialPath]: '<b:includable id="shared"/>',
    }, changes);
    const reads = [], exists = [], warns = [];
    const load = criarCarregadorChassis({
        workerDir: '/src/core',
        joinPath: path.posix.join,
        readFileSync: (file, enc) => {
            assert.equal(enc, 'utf-8');
            reads.push(file);
            if (!(file in files) || files[file] === null) throw new Error('ENOENT: ' + file);
            return files[file];
        },
        existsSync: file => { exists.push(file); return file in files && files[file] !== null; },
        chassisParaNicho: name => name === 'gamer' ? 'blog' : name === 'missing' ? 'blog' : null,
        warn: msg => warns.push(msg),
        ...opts,
    });
    return {load,reads,exists,warns,files};
}
{
    const m = makeLoader();
    const result = m.load('tema-gamer');
    assert.ok(result.startsWith('G'.repeat(210)), 'Arquivo próprio vence família');
    assert.equal(result.split('<b:includable id="shared"/>').length - 1, 2);
    assert.equal(m.reads.filter(x => x === partialPath).length, 1);
    assert.equal(m.load('gamer'), result);
    assert.equal(m.reads.filter(x => x === partialPath).length, 1, 'Includable lido uma vez por loader');
    assert.deepEqual(m.warns, []);
}
{
    const m = makeLoader({[BASE + '/template_gamer.xml']: null});
    assert.equal(m.load('gamer'), 'F'.repeat(201), 'Sem arquivo próprio usa chassis da família');
    assert.deepEqual(m.warns, []);
}
{
    const m = makeLoader({[BASE + '/template_gamer.xml']: null,[BASE + '/template_blog.xml']: null});
    assert.equal(m.load('gamer'), 'B'.repeat(201), 'Família ausente recua para base');
    assert.deepEqual(m.warns, ['[CHASSIS] template_blog.xml não encontrado, usando base.']);
}
{
    const m = makeLoader({[BASE + '/template_gamer.xml']: null});
    assert.equal(m.load('nicho-invalido'), 'B'.repeat(201), 'Nicho desconhecido carrega base');
    assert.equal(m.load(null), 'B'.repeat(201));
}
{
    const m = makeLoader({[BASE + '/template_gamer.xml']: 'invalid'});
    assert.throws(() => m.load('gamer'), /\[CHASSIS\] template_gamer.xml está vazio ou corrompido\./);
    assert.deepEqual(m.warns, [], 'Arquivo existente, mas curto, não faz fallback');
}
{
    const m = makeLoader({[BASE + '/template_gamer.xml']: null,[BASE + '/template_base.xml']: null});
    assert.throws(() => m.load(null), /\[CHASSIS\] Falha ao ler template_base.xml: ENOENT/);
}
{
    const m = makeLoader({[partialPath]:null});
    assert.throws(() => m.load('gamer'), /ENOENT/, 'Falha na leitura do partial propaga sem fallback');
}
{
    const m = makeLoader({[BASE + '/template_gamer.xml']: 'G'.repeat(210)}, {
        existsSync: file => file === BASE + '/template_gamer.xml',
        readFileSync: (file, _enc) => {
            if (file.endsWith('template_gamer.xml')) throw new Error('falha inesperada');
            return 'B'.repeat(201);
        },
    });
    assert.equal(m.load('gamer'), 'B'.repeat(201));
    assert.deepEqual(m.warns, ['[CHASSIS] template_gamer.xml não encontrado, usando base.']);
}
{
    const m = makeLoader({[BASE + '/template_base.xml']: 'B'.repeat(200)});
    assert.equal(m.load(null).length, 200, 'Limite de 200 chars aceito');
}
console.log('✅ workerChassis: ' + verified + ' XMLs reais idênticos e 8 grupos de regressões de I/O.');
