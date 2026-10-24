'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const forge = require('./assetForge');
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'forge-test-'));
const recipeId = 'tools/visitor_forge_2d/examples/park_clock_tower_sign_01.json';

test('catalog and contracts reject non-data execution and traversal', () => {
    assert.ok(forge.catalog().recipes.length > 50);
    assert.equal(forge.readRecipe(recipeId).command, 'draw-recipe');
    assert.throws(() => forge.readRecipe('../../games/game.json'));
    assert.throws(() => forge.validateTask({ id: '../escape', command: 'html5-runtime' }));
    assert.throws(() => forge.validateTask({ id: 'x', command: 'shell' }));
    assert.throws(() => forge.validateTask({ id: 'x', command: 'draw-graph', recipeId }));
    assert.throws(() => forge.validarAssets([{ id: 'x', command: 'html5-runtime' }, { id: 'x', command: 'html5-runtime' }]));
    assert.throws(() => forge.validateTask({ id: 'x', command: 'audio-synth', recipe: { contract: 'CH_AUDIO_GENERATION_V1', provider: { type: 'command', command: ['sh'] } } }));
});

test('real shape PNG, portable provenance, immutable bundles, symlink protection', async () => {
    const baseDir = temp(), outside = temp();
    try {
        const asset = await forge.render({ id: 'sign', command: 'draw-recipe', recipeId }, { baseDir });
        const png = asset.files.find(f => f.caminho.endsWith('.png'));
        assert.equal(fs.readFileSync(path.join(baseDir, png.caminho)).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        assert.equal(asset.reviewRequired, true);
        assert.ok(!fs.readFileSync(path.join(baseDir, 'assets/sign/solaris-asset.json'), 'utf8').includes(os.tmpdir()));
        await assert.rejects(forge.render({ id: 'sign', command: 'draw-recipe', recipeId }, { baseDir }), /já existe/);
        fs.symlinkSync(outside, path.join(baseDir, 'escape'));
        assert.throws(() => forge.safePath(baseDir, 'escape/output.png'), /Symlink/);
    } finally { fs.rmSync(baseDir, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('new-project pipeline renders assets before code and ships binary bytes in ZIP', async () => {
    const { criarOrquestrador } = require('../pipeline/orchestrator');
    const baseDir = temp();
    let calls = 0;
    try {
        const modelRouter = { async executarTarefaArquitetura({ prompt }) {
            calls++;
            if (calls === 1) {
                assert.match(prompt, /A7 Forge/);
                return { text: JSON.stringify({ framework: 'html5', objetivo: 'Jogo HTML5 Canvas',
                    assets: [{ id: 'sign', command: 'draw-recipe', recipeId }, { id: 'engine', command: 'html5-runtime' }],
                    arquivos: [{ caminho: 'index.html', tipo: 'html', descricao: 'Canvas application' }] }) };
            }
            assert.match(prompt, /assets\/sign\/.+\.png/);
            assert.match(prompt, /assets\/engine\/runtime.mjs/);
            return { text: '<!doctype html><html lang="pt-BR"><head><title>Canvas</title></head><body><canvas id="game"></canvas></body></html>' };
        } };
        const result = await criarOrquestrador({ modelRouter }).gerarProjeto({ objetivo: 'Jogo HTML5 Canvas', framework: 'html5', baseDir });
        assert.equal(result.ok, true, JSON.stringify(result.erros));
        assert.equal(result.assets.length, 2);
        assert.equal(result.zipBuffer.readUInt32LE(0), 0x04034b50);
        fs.writeFileSync(path.join(baseDir, 'project.zip'), result.zipBuffer);
        const png = result.assets[0].files.find(f => f.caminho.endsWith('.png')).caminho;
        const { execFileSync } = require('node:child_process');
        assert.deepEqual(execFileSync('unzip', ['-p', path.join(baseDir, 'project.zip'), png]), fs.readFileSync(path.join(baseDir, png)));
        assert.match(fs.readFileSync(path.join(baseDir, 'solaris.md'), 'utf8'), /assets\/sign/);
    } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});

test('editor keeps asset proposal pending and applies real files only in a later turn', async () => {
    const { responderOuEditarProjeto } = require('../pipeline/projectEditor');
    const baseDir = temp();
    const common = { baseDir, framework: 'html5', arquivos: [], historico: [], mensagem: 'Gere módulos Canvas',
        aplicarMudancasReal: async changes => {
            for (const m of changes) { const dest = path.join(baseDir, m.caminho); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, m.conteudoNovo); }
        } };
    try {
        const first = await responderOuEditarProjeto({ ...common, modelRouter: { async executarTarefaComFerramentas({ executorFerramenta }) {
            assert.ok((await executorFerramenta('catalogoAssetForge', {})).recipes.length > 0);
            assert.equal((await executorFerramenta('proporAssetForge', { id: 'engine', command: 'html5-runtime', resumo: 'Motor Canvas' })).sucesso, true);
            assert.ok((await executorFerramenta('aplicarMudancasPendentes', {})).erro);
            assert.equal(fs.existsSync(path.join(baseDir, 'assets/engine')), false);
            return { texto: 'Confirma?', iteracoes: 1 };
        } } });
        assert.equal(first.propostasFinais.length, 1);
        const second = await responderOuEditarProjeto({ ...common, mensagem: 'Pode aplicar', propostasPendentes: first.propostasFinais,
            modelRouter: { async executarTarefaComFerramentas({ executorFerramenta }) {
                const applied = await executorFerramenta('aplicarMudancasPendentes', {});
                assert.equal(applied.sucesso, true, applied.erro);
                return { texto: 'Salvo', iteracoes: 1 };
            } } });
        assert.equal(second.propostasFinais.length, 0);
        assert.ok(fs.existsSync(path.join(baseDir, 'assets/engine/runtime.mjs')));
    } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});

test('pixel character and animation packaging produce real sheets; frame traversal is refused', async () => {
    const baseDir = temp();
    try {
        const character = await forge.render({ id: 'hero', command: 'render-pixel-character', recipeId: 'tools/visitor_forge_2d/examples/pixel_character_adventurer_01.json' }, { baseDir });
        const manifestFile = character.files.find(f => f.caminho.endsWith('.animation.json'));
        const manifest = JSON.parse(fs.readFileSync(path.join(baseDir, manifestFile.caminho), 'utf8'));
        const recipe = { contract: 'A7_FORGE_2D_ANIMATION_V1', id: 'walk', pixelArt: true, anchor: manifest.anchor,
            frames: character.files.filter(f => f.caminho.includes('/frames/') && f.caminho.endsWith('.png')).slice(0, 2).map(f => f.caminho) };
        const packed = await forge.render({ id: 'walk', command: 'pack-animation', recipe }, { baseDir });
        assert.ok(packed.files.some(f => f.caminho.endsWith('_spritesheet.png')));
        assert.ok(packed.files.some(f => f.caminho.endsWith('.gif')));
        await assert.rejects(forge.render({ id: 'escape', command: 'pack-animation', recipe: { ...recipe, frames: ['../outside.png', '../outside.png'] } }, { baseDir }), /fora do projeto/);
    } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
});
