'use strict';

/**
 * Testes de projectInspector.js — sem bater na API real do Gemini: injeta
 * um `modelRouter` fake com executarTarefaComFerramentas() controlado.
 * _executorFerramenta é testado à parte contra um baseDir real (temp dir),
 * pra confirmar que as 3 ferramentas (readFile/listFiles/searchInProject)
 * de fato leem o que foi escrito, confinadas ao projeto.
 *
 * Execute: node src/solaris/pipeline/projectInspector.test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { criarArquivo } = require('../tools/fileTools');
const { inspecionarProjeto, INSPECAO_TOOLS, _executorFerramenta } = require('./projectInspector');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

function fakeModelRouter(implementacao) {
    const chamadas = [];
    return {
        chamadas,
        async executarTarefaComFerramentas(opts) {
            chamadas.push(opts);
            return implementacao(opts);
        },
    };
}

async function run() {
    // A. inspecionarProjeto — sucesso, repassa tools/systemInstruction certos.
    {
        const modelRouter = fakeModelRouter(async () => ({ texto: 'Resumo do projeto.', iteracoes: 3, tokens: { total: 50, input: 30, output: 20 } }));
        const r = await inspecionarProjeto({ baseDir: '/tmp/x', framework: 'flask', arquivos: ['app.py'], modelRouter });
        assert('ok:true com resumo', r.ok === true && r.resumo === 'Resumo do projeto.');
        assert('iteracoes/tokens repassados', r.iteracoes === 3 && r.tokens.total === 50);
        assert('tools = INSPECAO_TOOLS', modelRouter.chamadas[0].tools === INSPECAO_TOOLS);
        assert('systemInstruction definido', typeof modelRouter.chamadas[0].systemInstruction === 'string' && modelRouter.chamadas[0].systemInstruction.length > 0);
        assert('prompt menciona o framework', modelRouter.chamadas[0].prompt.includes('flask'));
        assert('executorFerramenta é função', typeof modelRouter.chamadas[0].executorFerramenta === 'function');
    }

    // B. inspecionarProjeto — modelRouter lança (cota/chave/timeout) → degrada, não propaga.
    {
        const modelRouter = fakeModelRouter(async () => { throw new Error('RESOURCE_EXHAUSTED'); });
        const r = await inspecionarProjeto({ baseDir: '/tmp/x', framework: null, arquivos: [], modelRouter });
        assert('falha de IA vira ok:false, nunca lança', r.ok === false && /RESOURCE_EXHAUSTED/.test(r.motivo));
    }

    // C. inspecionarProjeto — esgotamento de tool calls (texto vazio) também vira ok:false.
    {
        const modelRouter = fakeModelRouter(async () => ({ texto: '', iteracoes: 8, tokens: { total: 0, input: 0, output: 0 } }));
        const r = await inspecionarProjeto({ baseDir: '/tmp/x', framework: null, arquivos: [], modelRouter });
        assert('texto vazio vira ok:false com motivo', r.ok === false && typeof r.motivo === 'string');
    }

    // D. inspecionarProjeto — parâmetros obrigatórios ausentes lançam.
    {
        let erro = null;
        try { await inspecionarProjeto({ arquivos: [], modelRouter: fakeModelRouter(async () => ({})) }); } catch (e) { erro = e; }
        assert('sem baseDir lança', erro && /obrigatórios/.test(erro.message));
    }

    // E. _executorFerramenta — readFile/listFiles/searchInProject contra um baseDir real.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-projectinspector-test-'));
        criarArquivo(dir, 'app.py', 'from flask import Flask\napp = Flask(__name__)');
        criarArquivo(dir, 'templates/index.html', '<h1>Oi</h1>');

        const lido = await _executorFerramenta(dir, 'readFile', { caminho: 'app.py' });
        assert('readFile: lê conteúdo real', lido.conteudo.includes('Flask(__name__)'));

        const ausente = await _executorFerramenta(dir, 'readFile', { caminho: 'nao-existe.py' });
        assert('readFile: arquivo ausente devolve erro, não lança', typeof ausente.erro === 'string');

        const listados = await _executorFerramenta(dir, 'listFiles', {});
        assert('listFiles: lista os 2 arquivos', listados.arquivos.length === 2 && listados.arquivos.includes('app.py'));

        const busca = await _executorFerramenta(dir, 'searchInProject', { termo: 'flask' });
        assert('searchInProject: acha a ocorrência case-insensitive', busca.totalEncontrado === 2, JSON.stringify(busca));

        const desconhecida = await _executorFerramenta(dir, 'ferramentaQueNaoExiste', {});
        assert('ferramenta desconhecida devolve erro, não lança', typeof desconhecida.erro === 'string');

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // F. _executorFerramenta — readFile recusa arquivo grande demais (>60KB).
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-projectinspector-test-'));
        criarArquivo(dir, 'grande.txt', 'x'.repeat(70 * 1024));
        const r = await _executorFerramenta(dir, 'readFile', { caminho: 'grande.txt' });
        assert('readFile: arquivo grande demais devolve erro sugerindo searchInProject', /grande demais/.test(r.erro) && /searchInProject/.test(r.erro));
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

run().then(() => {
    console.log(`\n${failed === 0 ? '✅' : '❌'} projectInspector: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
});
