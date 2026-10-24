'use strict';

/**
 * Testes do dossieWriter — adicionarPeca().
 *
 * Usa "appstore-bulma-mobile" (chassis=blog, pageType=catalogo-produtos em
 * nichoTaxonomy.js) como nicho de teste — mesmo nome de um nicho real, só
 * pra herdar um chassis/pageType já válido em nichoTaxonomy.js (evita
 * inventar entrada fake ali só pra teste). Desde que os 14 nichos foram
 * migrados, esse nome SEMPRE tem um dossiê real em produção — o arquivo
 * original é lido e guardado em memória antes do teste sobrescrever com o
 * DOSSIE_BASE de teste, e restaurado byte-a-byte no finally, nunca perdendo
 * dado real.
 *
 * Execute: node src/core/compilerEngine/dossieWriter.test.js
 */

const fs = require('fs');
const path = require('path');
const { limparCache } = require('./dossieLoader');
const { adicionarPeca, substituirPecas, substituirDossieCompleto } = require('./dossieWriter');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

const NICHO = 'appstore-bulma-mobile';
const TEMAS_DIR = path.join(__dirname, '../../../src/rag/rag-ia-compiler/pipeline/temas');
const CAMINHO = path.join(TEMAS_DIR, `tema-${NICHO}-dossie.json`);

const conteudoOriginal = fs.existsSync(CAMINHO) ? fs.readFileSync(CAMINHO, 'utf-8') : null;

const DOSSIE_BASE = {
    nicho: NICHO,
    versaoDossie: 1,
    chassis: 'blog',
    pageType: 'catalogo-produtos',
    tokensCss: { light_mode: { '--tw-primary': '#000' } },
    pecas: [
        { id: 'existente', tipo: 'modulo', protegida: false, domIds: [], css: '.x{}', html: '', js: '' },
    ],
};

try {
    fs.writeFileSync(CAMINHO, JSON.stringify(DOSSIE_BASE, null, 2), 'utf-8');
    limparCache();

    // A. Peça válida é gravada com sucesso e persiste no arquivo.
    {
        const peca = { id: 'nova-peca', tipo: 'widget', protegida: false, domIds: ['np'], css: '', html: '<div id="np"></div>', js: '' };
        const { ok, erros } = adicionarPeca(NICHO, peca);
        assert('peça válida: ok=true', ok === true, erros.join(' | '));

        const gravado = JSON.parse(fs.readFileSync(CAMINHO, 'utf-8'));
        assert('peça persistida no arquivo', gravado.pecas.some(p => p.id === 'nova-peca'));
        assert('peça original preservada', gravado.pecas.some(p => p.id === 'existente'));
    }

    // B. id duplicado é rejeitado, nada é gravado.
    {
        const antes = fs.readFileSync(CAMINHO, 'utf-8');
        const { ok, erros } = adicionarPeca(NICHO, { id: 'existente', tipo: 'modulo', protegida: false, domIds: [], css: '.y{}', html: '', js: '' });
        assert('id duplicado: ok=false', ok === false);
        assert('id duplicado: mensagem menciona colisão', erros.some(e => e.includes('já existe')), erros.join(' | '));
        const depois = fs.readFileSync(CAMINHO, 'utf-8');
        assert('id duplicado: arquivo não foi alterado', antes === depois);
    }

    // C. Peça que tornaria o dossiê inválido (html sem domIds) é rejeitada, nada é gravado.
    {
        const antes = fs.readFileSync(CAMINHO, 'utf-8');
        const { ok, erros } = adicionarPeca(NICHO, { id: 'peca-invalida', tipo: 'hero', protegida: false, domIds: [], css: '', html: '<div id="x"></div>', js: '' });
        assert('peça que invalidaria o dossiê: ok=false', ok === false);
        assert('peça que invalidaria o dossiê: menciona motivo', erros.some(e => e.includes('inválido')), erros.join(' | '));
        const depois = fs.readFileSync(CAMINHO, 'utf-8');
        assert('peça inválida: arquivo não foi alterado', antes === depois);
    }

    // D. Nicho sem dossiê algum (legado de verdade) é rejeitado.
    {
        const { ok, erros } = adicionarPeca('culinaria-nicho-inexistente', { id: 'x', tipo: 'modulo', protegida: false, domIds: [], css: '.a{}', html: '', js: '' });
        assert('nicho sem dossiê: ok=false', ok === false);
        assert('nicho sem dossiê: menciona cano legado', erros.some(e => e.includes('cano legado')), erros.join(' | '));
    }

    // E. substituirPecas — troca o array pecas inteiro (não só adiciona).
    {
        fs.writeFileSync(CAMINHO, JSON.stringify(DOSSIE_BASE, null, 2), 'utf-8');
        limparCache();

        const novasPecas = [
            { id: 'design-real-1', tipo: 'modulo', protegida: false, domIds: [], css: '.a{color:var(--tw-primary)}', html: '', js: '' },
            { id: 'design-real-2', tipo: 'modulo', protegida: false, domIds: [], css: '.b{}', html: '', js: '' },
        ];
        const { ok, erros } = substituirPecas(NICHO, novasPecas);
        assert('substituirPecas: ok=true', ok === true, erros.join(' | '));

        const gravado = JSON.parse(fs.readFileSync(CAMINHO, 'utf-8'));
        assert('substituirPecas: peça antiga ("existente") NÃO está mais no dossiê', !gravado.pecas.some(p => p.id === 'existente'));
        assert('substituirPecas: as 2 peças novas estão no dossiê', gravado.pecas.length === 2 && gravado.pecas.every(p => p.id.startsWith('design-real')));
    }

    // F. substituirPecas — array vazio agora é ACEITO (dossieValidator só
    // avisa, não rejeita, pecas vazio — necessário pra zerar nichos sem
    // fonte real ainda, ver Fase 3 da reconstrução de dossiês a partir de
    // exemplos/*.xml). Só array não-array continua rejeitado.
    {
        fs.writeFileSync(CAMINHO, JSON.stringify(DOSSIE_BASE, null, 2), 'utf-8');
        limparCache();

        const { ok, erros } = substituirPecas(NICHO, []);
        assert('substituirPecas array vazio: ok=true', ok === true, erros.join(' | '));

        const gravado = JSON.parse(fs.readFileSync(CAMINHO, 'utf-8'));
        assert('substituirPecas array vazio: dossiê gravado com pecas=[]', Array.isArray(gravado.pecas) && gravado.pecas.length === 0);
    }

    // F2. substituirPecas — valor que não é array é rejeitado.
    {
        fs.writeFileSync(CAMINHO, JSON.stringify(DOSSIE_BASE, null, 2), 'utf-8');
        limparCache();
        const antes = fs.readFileSync(CAMINHO, 'utf-8');

        const { ok, erros } = substituirPecas(NICHO, null);
        assert('substituirPecas com null: ok=false', ok === false);
        assert('substituirPecas com null: menciona motivo', erros.some(e => e.includes('array')), erros.join(' | '));

        const depois = fs.readFileSync(CAMINHO, 'utf-8');
        assert('substituirPecas com null: arquivo não foi alterado', antes === depois);
    }

    // G. substituirPecas — peça inválida no array resultante impede a gravação inteira.
    {
        fs.writeFileSync(CAMINHO, JSON.stringify(DOSSIE_BASE, null, 2), 'utf-8');
        limparCache();
        const antes = fs.readFileSync(CAMINHO, 'utf-8');

        const pecasComUmaInvalida = [
            { id: 'ok-1', tipo: 'modulo', protegida: false, domIds: [], css: '.a{}', html: '', js: '' },
            { id: 'invalida', tipo: 'hero', protegida: false, domIds: [], css: '', html: '<div id="x"></div>', js: '' }, // html sem domIds
        ];
        const { ok, erros } = substituirPecas(NICHO, pecasComUmaInvalida);
        assert('substituirPecas com 1 peça inválida: ok=false (tudo ou nada)', ok === false, erros.join(' | '));

        const depois = fs.readFileSync(CAMINHO, 'utf-8');
        assert('substituirPecas com 1 peça inválida: arquivo não foi alterado', antes === depois);
    }

    // H. substituirPecas — nicho sem dossiê é rejeitado (mesma regra de adicionarPeca).
    {
        const { ok, erros } = substituirPecas('culinaria-nicho-inexistente', [{ id: 'x', tipo: 'modulo', protegida: false, domIds: [], css: '.a{}', html: '', js: '' }]);
        assert('substituirPecas nicho sem dossiê: ok=false', ok === false);
        assert('substituirPecas nicho sem dossiê: menciona cano legado', erros.some(e => e.includes('cano legado')), erros.join(' | '));
    }

    // I. substituirDossieCompleto — troca tokensCss E pecas juntos, preserva
    // nicho/versaoDossie/chassis/pageType.
    {
        fs.writeFileSync(CAMINHO, JSON.stringify(DOSSIE_BASE, null, 2), 'utf-8');
        limparCache();

        const { ok, erros } = substituirDossieCompleto(NICHO, {
            tokensCss: { light_mode: { '--tw-primary': '#123456' } },
            pecas: [{ id: 'reconstruido-1', tipo: 'modulo', protegida: false, domIds: [], css: '.z{color:var(--tw-primary)}', html: '', js: '' }],
        });
        assert('substituirDossieCompleto: ok=true', ok === true, erros.join(' | '));

        const gravado = JSON.parse(fs.readFileSync(CAMINHO, 'utf-8'));
        assert('substituirDossieCompleto: tokensCss trocado', gravado.tokensCss.light_mode['--tw-primary'] === '#123456');
        assert('substituirDossieCompleto: pecas trocadas', gravado.pecas.length === 1 && gravado.pecas[0].id === 'reconstruido-1');
        assert('substituirDossieCompleto: nicho/chassis/pageType preservados',
            gravado.nicho === NICHO && gravado.chassis === 'blog' && gravado.pageType === 'catalogo-produtos');
    }

    // J. substituirDossieCompleto — aceita pecas=[] (zerar nicho sem fonte).
    {
        fs.writeFileSync(CAMINHO, JSON.stringify(DOSSIE_BASE, null, 2), 'utf-8');
        limparCache();

        const { ok, erros } = substituirDossieCompleto(NICHO, { tokensCss: { light_mode: {} }, pecas: [] });
        assert('substituirDossieCompleto pecas=[]: ok=true', ok === true, erros.join(' | '));

        const gravado = JSON.parse(fs.readFileSync(CAMINHO, 'utf-8'));
        assert('substituirDossieCompleto pecas=[]: dossiê zerado gravado', gravado.pecas.length === 0 && Object.keys(gravado.tokensCss.light_mode).length === 0);
    }

    // K. substituirDossieCompleto — resultado inválido não é gravado (tudo ou nada).
    {
        fs.writeFileSync(CAMINHO, JSON.stringify(DOSSIE_BASE, null, 2), 'utf-8');
        limparCache();
        const antes = fs.readFileSync(CAMINHO, 'utf-8');

        const { ok, erros } = substituirDossieCompleto(NICHO, {
            tokensCss: { light_mode: {} },
            pecas: [{ id: 'invalida', tipo: 'hero', protegida: false, domIds: [], css: '', html: '<div id="x"></div>', js: '' }],
        });
        assert('substituirDossieCompleto inválido: ok=false', ok === false);

        const depois = fs.readFileSync(CAMINHO, 'utf-8');
        assert('substituirDossieCompleto inválido: arquivo não foi alterado', antes === depois);
    }

    // L. substituirDossieCompleto — nicho sem dossiê é rejeitado.
    {
        const { ok, erros } = substituirDossieCompleto('culinaria-nicho-inexistente', { tokensCss: { light_mode: {} }, pecas: [] });
        assert('substituirDossieCompleto nicho sem dossiê: ok=false', ok === false);
        assert('substituirDossieCompleto nicho sem dossiê: menciona cano legado', erros.some(e => e.includes('cano legado')), erros.join(' | '));
    }

} finally {
    if (conteudoOriginal !== null) {
        fs.writeFileSync(CAMINHO, conteudoOriginal, 'utf-8');
    } else if (fs.existsSync(CAMINHO)) {
        fs.unlinkSync(CAMINHO);
    }
    if (fs.existsSync(`${CAMINHO}.tmp`)) fs.unlinkSync(`${CAMINHO}.tmp`);
    limparCache();
}

console.log(`\n${failed === 0 ? '✅' : '❌'} dossieWriter: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
