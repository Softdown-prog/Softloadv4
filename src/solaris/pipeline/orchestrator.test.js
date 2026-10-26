'use strict';

/**
 * Testes de orchestrator.js — modelRouter fake injetado, sem bater na
 * API real do Gemini.
 *
 * Execute: node src/solaris/pipeline/orchestrator.test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { criarOrquestrador } = require('./orchestrator');
const { listarProjeto } = require('../tools/fileTools');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

const MANIFESTO_OK = {
    framework: 'html5',
    objetivo: 'Landing page pra academia online',
    paginas: ['Home'],
    componentes: ['hero'],
    arquivos: [
        { caminho: 'index.html', tipo: 'html', descricao: 'Página inicial com hero e CTA.' },
        { caminho: 'style.css', tipo: 'css', descricao: 'Estilo do hero.' },
    ],
    dependencias: [],
};

function fakeModelRouter({ manifestoTexto, arquivoTexto } = {}) {
    const chamadasTriagem = [];
    const chamadasArquitetura = [];
    return {
        chamadasTriagem,
        chamadasArquitetura,
        async executarTriagem(params) {
            chamadasTriagem.push(params);
            return '{}';
        },
        async executarTarefaArquitetura(params) {
            chamadasArquitetura.push(params);
            // 1ª chamada arquitetura = manifesto (tem responseSchema); demais = arquivo.
            const texto = params.responseSchema ? manifestoTexto : arquivoTexto;
            return { text: texto };
        },
    };
}

async function run() {
    // A. gerarManifesto usa executarTarefaArquitetura (Pro), não executarTriagem.
    {
        const router = fakeModelRouter({ manifestoTexto: JSON.stringify(MANIFESTO_OK) });
        const orq = criarOrquestrador({ modelRouter: router });
        const { ok, manifesto, erros } = await orq.gerarManifesto({ objetivo: 'x', framework: 'html5' });
        assert('gerarManifesto ok', ok === true, erros ? erros.join(' | ') : '');
        assert('gerarManifesto usa executarTarefaArquitetura (Pro)', router.chamadasArquitetura.length === 1);
        assert('gerarManifesto NÃO usa executarTriagem (Flash)', router.chamadasTriagem.length === 0);
        assert('manifesto retornado tem os 2 arquivos', manifesto.arquivos.length === 2);
    }

    // B. gerarManifesto com resposta não-JSON não lança, retorna ok:false.
    {
        const router = fakeModelRouter({ manifestoTexto: 'isso não é json' });
        const orq = criarOrquestrador({ modelRouter: router });
        const { ok, erros } = await orq.gerarManifesto({ objetivo: 'x', framework: 'html5' });
        assert('manifesto não-JSON: ok false, sem lançar', ok === false && erros.length > 0);
    }

    // C. gerarArquivo roda o Worker certo pro tipo (html) e reporta diagnóstico.
    {
        const router = fakeModelRouter({ arquivoTexto: '<div id="x"></div><div id="x"></div>' });
        const orq = criarOrquestrador({ modelRouter: router });
        const r = await orq.gerarArquivo({ manifesto: MANIFESTO_OK, arquivo: MANIFESTO_OK.arquivos[0] });
        assert('gerarArquivo retorna conteúdo', r.conteudo.includes('<div'));
        assert('gerarArquivo roda htmlWorker (diagnóstico presente)', r.diagnostico !== null);
        assert('gerarArquivo reporta id duplicado como aviso', r.diagnostico.avisos.some((a) => a.includes('duplicado')));
    }

    // D. gerarArquivo pra tipo sem Worker (md — sem sintaxe pra validar,
    // nenhum Worker faz sentido pra esse tipo) não lança, avisa.
    {
        const router = fakeModelRouter({ arquivoTexto: '# Título\n\nTexto qualquer.' });
        const orq = criarOrquestrador({ modelRouter: router });
        const r = await orq.gerarArquivo({ manifesto: MANIFESTO_OK, arquivo: { caminho: 'x.md', tipo: 'md', descricao: '' } });
        assert('tipo sem Worker: ok true (não bloqueia)', r.ok === true);
        assert('tipo sem Worker: aviso explícito', r.avisoSemWorker && r.avisoSemWorker.includes('md'));
    }

    // D2. gerarArquivo roda o phpWorker de verdade pro tipo "php".
    {
        const router = fakeModelRouter({ arquivoTexto: '<?php\nfunction foo( {\n' });
        const orq = criarOrquestrador({ modelRouter: router });
        const r = await orq.gerarArquivo({ manifesto: MANIFESTO_OK, arquivo: { caminho: 'x.php', tipo: 'php', descricao: '' } });
        assert('tipo php: roda phpWorker (diagnóstico presente)', r.diagnostico !== null);
        assert('tipo php: sintaxe quebrada reporta erro', r.diagnostico.ok === false, JSON.stringify(r.diagnostico));
    }

    // D3. gerarArquivo roda o ejsWorker de verdade pro tipo "ejs".
    {
        const router = fakeModelRouter({ arquivoTexto: '<h1><%= titulo %></h1>' });
        const orq = criarOrquestrador({ modelRouter: router });
        const r = await orq.gerarArquivo({ manifesto: MANIFESTO_OK, arquivo: { caminho: 'x.ejs', tipo: 'ejs', descricao: '' } });
        assert('tipo ejs: roda ejsWorker (diagnóstico presente)', r.diagnostico !== null);
        assert('tipo ejs: sintaxe válida reporta ok', r.diagnostico.ok === true, JSON.stringify(r.diagnostico));
    }

    // D4. gerarArquivo roda o jsonWorker de verdade pro tipo "json".
    {
        const router = fakeModelRouter({ arquivoTexto: '{ "nome": "x" }' });
        const orq = criarOrquestrador({ modelRouter: router });
        const r = await orq.gerarArquivo({ manifesto: MANIFESTO_OK, arquivo: { caminho: 'x.json', tipo: 'json', descricao: '' } });
        assert('tipo json: roda jsonWorker (diagnóstico presente)', r.diagnostico !== null);
        assert('tipo json: sintaxe válida reporta ok', r.diagnostico.ok === true, JSON.stringify(r.diagnostico));
    }

    // D5. gerarArquivo roda o pythonWorker de verdade pro tipo "py"
    // (Flask/Django — ver comentário de orchestrator.js e
    // workers/pythonWorker.js pro racional do shell-out ast.parse).
    {
        const router = fakeModelRouter({ arquivoTexto: 'def foo(\n    return 1\n' });
        const orq = criarOrquestrador({ modelRouter: router });
        const r = await orq.gerarArquivo({ manifesto: MANIFESTO_OK, arquivo: { caminho: 'x.py', tipo: 'py', descricao: '' } });
        assert('tipo py: roda pythonWorker (diagnóstico presente)', r.diagnostico !== null);
        assert('tipo py: sintaxe quebrada reporta erro', r.diagnostico.ok === false, JSON.stringify(r.diagnostico));
    }

    // E. gerarProjeto encadeia manifesto → todos os arquivos.
    {
        // Conteúdo válido tanto como HTML quanto como CSS (comentário CSS
        // é ignorado por qualquer parser HTML tolerante) — mantém o Worker
        // de cada arquivo do manifesto (html + css) satisfeito de verdade.
        const router = fakeModelRouter({
            manifestoTexto: JSON.stringify(MANIFESTO_OK),
            arquivoTexto: '/* conteudo valido pros dois tipos */',
        });
        const orq = criarOrquestrador({ modelRouter: router });
        const { ok, arquivos } = await orq.gerarProjeto({ objetivo: 'x', framework: 'html5' });
        assert('gerarProjeto ok', ok === true);
        assert('gerarProjeto gera 1 arquivo por entrada do manifesto', arquivos.length === MANIFESTO_OK.arquivos.length);
        assert('gerarProjeto chama arquitetura 1x (manifesto) + 1x por arquivo', router.chamadasArquitetura.length === 1 + MANIFESTO_OK.arquivos.length);
    }

    // F. sem modelRouter injetado, lança erro claro na criação (não em runtime silencioso).
    {
        let erro = null;
        try { criarOrquestrador({}); } catch (e) { erro = e; }
        assert('sem modelRouter: lança na criação', erro && /modelRouter é obrigatório/.test(erro.message));
    }

    // G. gerarProjeto com baseDir persiste os arquivos de verdade e fecha com ZIP.
    {
        const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-orchestrator-test-'));
        const router = fakeModelRouter({
            manifestoTexto: JSON.stringify(MANIFESTO_OK),
            arquivoTexto: '/* conteudo valido pros dois tipos */',
        });
        const orq = criarOrquestrador({ modelRouter: router });
        const { ok, zipBuffer } = await orq.gerarProjeto({ objetivo: 'x', framework: 'html5', baseDir });

        assert('gerarProjeto com baseDir ok', ok === true);
        assert('index.html foi persistido de verdade em disco', fs.existsSync(path.join(baseDir, 'index.html')));
        assert('style.css foi persistido de verdade em disco', fs.existsSync(path.join(baseDir, 'style.css')));
        assert('solaris.md foi escrito junto (coerência do projeto)', fs.existsSync(path.join(baseDir, 'solaris.md')));
        assert('listarProjeto vê os 3 arquivos persistidos (2 do manifesto + solaris.md)', listarProjeto(baseDir).length === 3);
        const solarisMd = fs.readFileSync(path.join(baseDir, 'solaris.md'), 'utf-8');
        assert('solaris.md documenta o objetivo do manifesto', solarisMd.includes(MANIFESTO_OK.objetivo));
        assert('solaris.md documenta os arquivos do manifesto', solarisMd.includes('index.html') && solarisMd.includes('style.css'));
        assert('gerarProjeto retorna um zipBuffer (Buffer não-vazio)', Buffer.isBuffer(zipBuffer) && zipBuffer.length > 0);

        fs.rmSync(baseDir, { recursive: true, force: true });
    }

    // H. gerarProjeto SEM baseDir não toca disco, zipBuffer fica null (retrocompatível com a Fase 0).
    {
        const router = fakeModelRouter({
            manifestoTexto: JSON.stringify(MANIFESTO_OK),
            arquivoTexto: '/* conteudo valido pros dois tipos */',
        });
        const orq = criarOrquestrador({ modelRouter: router });
        const { ok, zipBuffer } = await orq.gerarProjeto({ objetivo: 'x', framework: 'html5' });
        assert('sem baseDir: gerarProjeto ainda funciona (só em memória)', ok === true);
        assert('sem baseDir: zipBuffer é null (nada foi empacotado)', zipBuffer === null);
    }

    // I. gerarProjeto com baseDir e algum arquivo inválido NÃO gera ZIP (nunca entrega sem validação).
    {
        const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-orchestrator-invalido-'));
        const router = fakeModelRouter({
            manifestoTexto: JSON.stringify(MANIFESTO_OK),
            arquivoTexto: '.btn { color: ;', // CSS inválido — quebra o Worker de CSS
        });
        const orq = criarOrquestrador({ modelRouter: router });
        const { ok, zipBuffer } = await orq.gerarProjeto({ objetivo: 'x', framework: 'html5', baseDir });
        assert('projeto com arquivo inválido: ok false', ok === false);
        assert('projeto com arquivo inválido: NÃO gera ZIP', zipBuffer === null);
        fs.rmSync(baseDir, { recursive: true, force: true });
    }

    // J. gerarManifesto injeta contexto do catálogo RAG (src/solaris/rag/)
    // no prompt quando o objetivo casa com uma categoria conhecida — Fase 2
    // do roadmap (base de conhecimento populada no repositório).
    {
        const router = fakeModelRouter({ manifestoTexto: JSON.stringify(MANIFESTO_OK) });
        const orq = criarOrquestrador({ modelRouter: router });
        await orq.gerarManifesto({ objetivo: 'quero criar um blog de culinária pra postar receitas', framework: 'html5' });
        const promptEnviado = router.chamadasArquitetura[0].prompt;
        assert('prompt do manifesto inclui contexto de categoria reconhecida', promptEnviado.includes('Contexto de referência'));
        assert('prompt do manifesto inclui o id da categoria casada', promptEnviado.includes('"blog"'));
    }

    // K. gerarManifesto sem categoria reconhecida no objetivo NÃO injeta
    // contexto nenhum (comportamento da Fase 0/1 preservado).
    {
        const router = fakeModelRouter({ manifestoTexto: JSON.stringify(MANIFESTO_OK) });
        const orq = criarOrquestrador({ modelRouter: router });
        await orq.gerarManifesto({ objetivo: 'xyzabc123 nada a ver com nenhuma categoria conhecida qwerty', framework: 'html5' });
        const promptEnviado = router.chamadasArquitetura[0].prompt;
        assert('prompt sem categoria reconhecida não inclui contexto', !promptEnviado.includes('Contexto de referência'));
    }
    // L. Uma consulta semântica por projeto, reaproveitada no manifesto e nos arquivos.
    {
        let consultas = 0;
        const buscarConhecimento = async ({ topK }) => {
            consultas++;
            assert('topK do gerador é limitado a 3', topK === 3);
            return { resultados: [{ entryId: 'html5-seguranca', texto: 'Validar dados de formulários.' }] };
        };
        const router = fakeModelRouter({
            manifestoTexto: JSON.stringify(MANIFESTO_OK),
            arquivoTexto: '/* conteudo valido pros dois tipos */',
        });
        const orq = criarOrquestrador({ modelRouter: router, buscarConhecimento });
        const { ok } = await orq.gerarProjeto({ objetivo: 'site HTML5 de academia', framework: 'html5' });
        assert('gerarProjeto com RAG semântico continua válido', ok === true);
        assert('consulta vetorial é feita uma vez por projeto', consultas === 1);
        assert('manifesto recebe contexto RAG', router.chamadasArquitetura[0].prompt.includes('Fonte html5-seguranca'));
        assert('arquivos recebem contexto RAG', router.chamadasArquitetura[1].prompt.includes('Fonte html5-seguranca'));
    }

    // M. Erro de embeddings não impede o pipeline Gemini + Workers.
    {
        const oldWarn = console.warn;
        console.warn = () => {};
        try {
            const router = fakeModelRouter({ manifestoTexto: JSON.stringify(MANIFESTO_OK) });
            const orq = criarOrquestrador({
                modelRouter: router,
                buscarConhecimento: async () => { throw new Error('índice indisponível'); },
            });
            const { ok } = await orq.gerarManifesto({ objetivo: 'site HTML5', framework: 'html5' });
            assert('falha no RAG mantém geração', ok === true);
        } finally { console.warn = oldWarn; }
    }

    // N. SDK pode retornar resposta sem texto: mantém diagnóstico, sem conteúdo undefined.
    {
        const orq = criarOrquestrador({ modelRouter: fakeModelRouter() });
        const manifesto = await orq.gerarManifesto({ objetivo: 'x', framework: 'html5' });
        assert('resposta sem texto não vira manifesto válido', manifesto.ok === false);
        const arquivo = await orq.gerarArquivo({ manifesto: MANIFESTO_OK, arquivo: MANIFESTO_OK.arquivos[0] });
        assert('arquivo sem texto é normalizado para string vazia', arquivo.conteudo === '');
        assert('worker rejeita arquivo sem texto', arquivo.ok === false);
    }

}

run().then(() => {
    console.log(`\n${failed === 0 ? '✅' : '❌'} orchestrator: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
});
