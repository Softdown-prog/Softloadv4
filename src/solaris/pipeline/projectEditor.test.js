'use strict';

/**
 * Testes de projectEditor.js — sem bater na API real do Gemini: injeta
 * um `modelRouter` fake com executarTarefaComFerramentas() controlado,
 * chamando o `executorFerramenta` real recebido de opts pra exercitar o
 * loop de propor/aplicar/cancelar mudança contra um baseDir real (temp
 * dir) e um `aplicarMudancasReal` fake que só grava numa lista em vez de
 * tocar GCS.
 *
 * Execute: node src/solaris/pipeline/projectEditor.test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { criarArquivo, lerArquivo } = require('../tools/fileTools');
const { responderOuEditarProjeto, EDICAO_TOOLS, _tipoPorCaminho } = require('./projectEditor');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// fakeModelRouter roda uma sequência de "turnos do modelo" pré-programada
// — cada item é uma lista de function calls a fazer (ou null pra devolver
// texto final direto). Chama o executorFerramenta REAL passado em opts,
// então o comportamento de proporMudancaArquivo/aplicarMudancasPendentes/
// etc. é exercitado de verdade, só a "decisão de qual ferramenta chamar"
// é fixa (roteiro do teste), não vem de uma IA de verdade.
function fakeModelRouter(roteiro, textoFinal = 'ok') {
    const chamadas = [];
    return {
        chamadas,
        async executarTarefaComFerramentas(opts) {
            chamadas.push(opts);
            const respostasFerramenta = [];
            for (const passo of roteiro) {
                const resultado = await opts.executorFerramenta(passo.nome, passo.args || {});
                respostasFerramenta.push({ nome: passo.nome, resultado });
            }
            return { texto: textoFinal, iteracoes: roteiro.length + 1, tokens: { total: 10, input: 5, output: 5 }, _respostasFerramenta: respostasFerramenta };
        },
    };
}

async function run() {
    // A. _tipoPorCaminho — mapeia extensão pro tipo do WORKER_POR_TIPO.
    {
        assert('.py -> py',   _tipoPorCaminho('app.py') === 'py');
        assert('.css -> css', _tipoPorCaminho('static/style.css') === 'css');
        assert('.PY (maiúsculo) -> py (case-insensitive)', _tipoPorCaminho('APP.PY') === 'py');
        assert('extensão desconhecida -> null', _tipoPorCaminho('dados.csv') === null);
    }

    // B. EDICAO_TOOLS inclui as 3 ferramentas de leitura + as 4 de escrita.
    {
        const nomes = EDICAO_TOOLS[0].functionDeclarations.map((f) => f.name);
        const esperados = ['readFile', 'listFiles', 'searchInProject', 'proporMudancaArquivo', 'verPropostasPendentes', 'aplicarMudancasPendentes', 'cancelarMudancasPendentes'];
        assert('todas as 7 ferramentas declaradas', esperados.every((n) => nomes.includes(n)), JSON.stringify(nomes));
    }

    // C. proporMudancaArquivo (criar) — conteúdo válido vira proposta
    // pendente; NÃO grava nada no baseDir (só decisão do modelRouter).
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-projecteditor-test-'));
        const aplicadas = [];
        const modelRouter = fakeModelRouter([
            { nome: 'proporMudancaArquivo', args: { caminho: 'static/novo.css', operacao: 'criar', conteudo: 'body{color:red}', resumo: 'adiciona estilo básico' } },
        ]);
        const r = await responderOuEditarProjeto({
            baseDir: dir, framework: 'flask', arquivos: [], mensagem: 'cria um css básico',
            historico: [], propostasPendentes: [], modelRouter,
            aplicarMudancasReal: async (m) => aplicadas.push(...m),
        });
        assert('ok:true', r.ok === true, JSON.stringify(r));
        assert('propostasFinais tem 1 item pendente', r.propostasFinais.length === 1 && r.propostasFinais[0].caminho === 'static/novo.css');
        assert('nada foi aplicado ainda', aplicadas.length === 0 && r.mudancasAplicadas.length === 0);
        assert('nada foi gravado no baseDir', !fs.existsSync(path.join(dir, 'static/novo.css')));
        fs.rmSync(dir, { recursive: true, force: true });
    }

    // D. proporMudancaArquivo (criar) — CSS com sintaxe inválida é
    // rejeitado pelo Worker determinístico, nunca vira proposta.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-projecteditor-test-'));
        const modelRouter = fakeModelRouter([
            { nome: 'proporMudancaArquivo', args: { caminho: 'quebrado.css', operacao: 'criar', conteudo: 'body{color:', resumo: 'css quebrado' } },
        ]);
        const r = await responderOuEditarProjeto({
            baseDir: dir, framework: null, arquivos: [], mensagem: 'testa',
            historico: [], propostasPendentes: [], modelRouter,
            aplicarMudancasReal: async () => {},
        });
        assert('ok:true (o loop continua, só a proposta específica é rejeitada)', r.ok === true);
        assert('CSS inválido nunca virou proposta pendente', r.propostasFinais.length === 0, JSON.stringify(r.propostasFinais));
        const resultadoDaChamada = modelRouter.chamadas[0]; // não usado diretamente, só documenta o fluxo
        assert('modelRouter foi de fato chamado', !!resultadoDaChamada);
        fs.rmSync(dir, { recursive: true, force: true });
    }

    // E. proporMudancaArquivo (editar) — operacao inconsistente com
    // existência do arquivo é recusada (editar/deletar exigem que exista,
    // criar exige que NÃO exista).
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-projecteditor-test-'));
        criarArquivo(dir, 'app.py', 'x = 1\n');

        const modelRouterEditarInexistente = fakeModelRouter([
            { nome: 'proporMudancaArquivo', args: { caminho: 'nao-existe.py', operacao: 'editar', conteudo: 'y = 2\n', resumo: 'edita' } },
        ]);
        const r1 = await responderOuEditarProjeto({
            baseDir: dir, framework: 'flask', arquivos: ['app.py'], mensagem: 'edita nao-existe.py',
            historico: [], propostasPendentes: [], modelRouter: modelRouterEditarInexistente,
            aplicarMudancasReal: async () => {},
        });
        assert('editar arquivo inexistente não vira proposta', r1.propostasFinais.length === 0);

        const modelRouterCriarExistente = fakeModelRouter([
            { nome: 'proporMudancaArquivo', args: { caminho: 'app.py', operacao: 'criar', conteudo: 'y = 2\n', resumo: 'cria' } },
        ]);
        const r2 = await responderOuEditarProjeto({
            baseDir: dir, framework: 'flask', arquivos: ['app.py'], mensagem: 'cria app.py de novo',
            historico: [], propostasPendentes: [], modelRouter: modelRouterCriarExistente,
            aplicarMudancasReal: async () => {},
        });
        assert('criar arquivo já existente não vira proposta', r2.propostasFinais.length === 0);

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // F. Guard central: proposta criada NESTE turno não pode ser aplicada
    // no mesmo turno, mesmo que o modelo tente (roteiro chama as duas
    // ferramentas em sequência, simulando o modelo "trapaceando").
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-projecteditor-test-'));
        const aplicadas = [];
        const modelRouter = fakeModelRouter([
            { nome: 'proporMudancaArquivo', args: { caminho: 'novo.json', operacao: 'criar', conteudo: '{"a":1}', resumo: 'cria json' } },
            { nome: 'aplicarMudancasPendentes', args: {} },
        ]);
        const r = await responderOuEditarProjeto({
            baseDir: dir, framework: null, arquivos: [], mensagem: 'cria e já aplica',
            historico: [], propostasPendentes: [], modelRouter,
            aplicarMudancasReal: async (m) => aplicadas.push(...m),
        });
        assert('nada foi aplicado de verdade', aplicadas.length === 0);
        assert('proposta continua pendente (não foi consumida pela tentativa de aplicar)', r.propostasFinais.length === 1);
        fs.rmSync(dir, { recursive: true, force: true });
    }

    // G. Proposta de um turno ANTERIOR (propostasPendentes) pode ser
    // aplicada neste turno — grava de verdade via aplicarMudancasReal.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-projecteditor-test-'));
        const aplicadas = [];
        const propostaAnterior = [{ caminho: 'config.json', operacao: 'criar', conteudoNovo: '{"debug":false}', resumo: 'cria config' }];
        const modelRouter = fakeModelRouter([
            { nome: 'aplicarMudancasPendentes', args: {} },
        ]);
        const r = await responderOuEditarProjeto({
            baseDir: dir, framework: null, arquivos: [], mensagem: 'sim, pode aplicar',
            historico: [{ autor: 'usuario', texto: 'cria um config.json' }, { autor: 'solaris', texto: 'proposto, confirma?' }],
            propostasPendentes: propostaAnterior, modelRouter,
            aplicarMudancasReal: async (m) => aplicadas.push(...m),
        });
        assert('ok:true', r.ok === true);
        assert('mudança foi de fato aplicada (callback chamado)', aplicadas.length === 1 && aplicadas[0].caminho === 'config.json');
        assert('proposta some da lista de pendentes depois de aplicada', r.propostasFinais.length === 0);
        assert('mudancasAplicadas reflete o que foi aplicado', r.mudancasAplicadas.length === 1 && r.mudancasAplicadas[0].caminho === 'config.json');

        // solaris.md ganha uma entrada de changelog (coerência do projeto,
        // ver pipeline/projectMemory.js) — escrito no baseDir ANTES de
        // aplicarMudancasReal, então já reflete a mudança confirmada.
        const solarisMd = lerArquivo(dir, 'solaris.md');
        assert('solaris.md foi criado no baseDir', solarisMd.ok);
        assert('solaris.md documenta a mudança aplicada (caminho + resumo)', solarisMd.ok && solarisMd.conteudo.includes('config.json') && solarisMd.conteudo.includes('cria config'));

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // H. cancelarMudancasPendentes — remove a proposta sem aplicar.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-projecteditor-test-'));
        const aplicadas = [];
        const propostaAnterior = [{ caminho: 'lixo.txt', operacao: 'criar', conteudoNovo: 'x', resumo: 'proposta indesejada' }];
        const modelRouter = fakeModelRouter([
            { nome: 'cancelarMudancasPendentes', args: {} },
        ]);
        const r = await responderOuEditarProjeto({
            baseDir: dir, framework: null, arquivos: [], mensagem: 'não, esquece isso',
            historico: [], propostasPendentes: propostaAnterior, modelRouter,
            aplicarMudancasReal: async (m) => aplicadas.push(...m),
        });
        assert('nada foi aplicado', aplicadas.length === 0);
        assert('proposta foi removida', r.propostasFinais.length === 0);
        fs.rmSync(dir, { recursive: true, force: true });
    }

    // I. aplicarMudancasReal lançando erro vira resultado de ferramenta
    // com erro — não derruba o turno inteiro nem perde a proposta.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-projecteditor-test-'));
        const propostaAnterior = [{ caminho: 'quota-estourada.txt', operacao: 'criar', conteudoNovo: 'x', resumo: 'proposta' }];
        const modelRouter = fakeModelRouter([
            { nome: 'aplicarMudancasPendentes', args: {} },
        ]);
        const r = await responderOuEditarProjeto({
            baseDir: dir, framework: null, arquivos: [], mensagem: 'aplica',
            historico: [], propostasPendentes: propostaAnterior, modelRouter,
            aplicarMudancasReal: async () => { throw new Error('cota de armazenamento estourada'); },
        });
        assert('ok:true (turno não quebra, o modelo recebe o erro pra explicar ao usuário)', r.ok === true);
        assert('proposta continua pendente (falhou aplicar, nada foi consumido)', r.propostasFinais.length === 1);
        fs.rmSync(dir, { recursive: true, force: true });
    }

    // J. responderOuEditarProjeto — modelRouter lança (cota/chave/timeout) → degrada, não propaga.
    {
        const modelRouter = { async executarTarefaComFerramentas() { throw new Error('RESOURCE_EXHAUSTED'); } };
        const r = await responderOuEditarProjeto({
            baseDir: '/tmp/x', framework: null, arquivos: [], mensagem: 'oi',
            historico: [], propostasPendentes: [], modelRouter, aplicarMudancasReal: async () => {},
        });
        assert('falha de IA vira ok:false, nunca lança', r.ok === false && /RESOURCE_EXHAUSTED/.test(r.motivo));
    }

    // K. parâmetros obrigatórios ausentes lançam (mensagem, aplicarMudancasReal).
    {
        let erro = null;
        try {
            await responderOuEditarProjeto({ baseDir: '/tmp/x', arquivos: [], modelRouter: { executarTarefaComFerramentas: async () => ({}) } });
        } catch (e) { erro = e; }
        assert('sem mensagem/aplicarMudancasReal lança', erro && /obrigatórios/.test(erro.message));
    }

    // L. readFile/listFiles/searchInProject continuam funcionando (delegados
    // pro mesmo _executorFerramenta de projectInspector.js) dentro do editor.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-projecteditor-test-'));
        criarArquivo(dir, 'app.py', 'from flask import Flask');
        const modelRouter = fakeModelRouter([
            { nome: 'readFile', args: { caminho: 'app.py' } },
            { nome: 'listFiles', args: {} },
            { nome: 'searchInProject', args: { termo: 'flask' } },
        ]);
        const r = await responderOuEditarProjeto({
            baseDir: dir, framework: 'flask', arquivos: ['app.py'], mensagem: 'o que tem no projeto?',
            historico: [], propostasPendentes: [], modelRouter,
            aplicarMudancasReal: async () => {},
        });
        assert('ok:true', r.ok === true);
        assert('leitura continua sem propor nada', r.propostasFinais.length === 0);
        fs.rmSync(dir, { recursive: true, force: true });
    }

    // M. verPropostasPendentes — confere via prompt (aviso de pendência) que
    // o turno sabe que há proposta prévia, sem precisar de tool call extra.
    {
        const propostaAnterior = [{ caminho: 'a.css', operacao: 'criar', conteudoNovo: 'a{color:red}', resumo: 'x' }];
        const modelRouter = fakeModelRouter([]);
        await responderOuEditarProjeto({
            baseDir: '/tmp/x', framework: null, arquivos: [], mensagem: 'oi',
            historico: [], propostasPendentes: propostaAnterior, modelRouter,
            aplicarMudancasReal: async () => {},
        });
        assert('prompt avisa sobre proposta pendente', /proposta\(s\) de mudança de arquivo pendente/.test(modelRouter.chamadas[0].prompt));
    }

    // N. solaris.md é protegido — o modelo nunca pode propor criar/editar/
    // deletar esse arquivo diretamente (é mantido só pelo sistema).
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-projecteditor-test-'));
        const modelRouter = fakeModelRouter([
            { nome: 'proporMudancaArquivo', args: { caminho: 'solaris.md', operacao: 'editar', conteudo: '# hackeado', resumo: 'tenta editar' } },
        ]);
        const r = await responderOuEditarProjeto({
            baseDir: dir, framework: null, arquivos: [], mensagem: 'edita o solaris.md',
            historico: [], propostasPendentes: [], modelRouter,
            aplicarMudancasReal: async () => {},
        });
        assert('proposta de editar solaris.md é recusada', r.propostasFinais.length === 0);
        fs.rmSync(dir, { recursive: true, force: true });
    }

    // Um único diretório residual pode ficar do teste L/etc se algo falhar
    // antes do rmSync — não afeta o resultado, é só scratch de teste.
}

run().then(() => {
    console.log(`\n${failed === 0 ? '✅' : '❌'} projectEditor: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
});
