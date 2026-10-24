"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORKER_POR_TIPO = void 0;
exports.criarOrquestrador = criarOrquestrador;
// ============================================================
// SOLARIS ORCHESTRATOR (Fase 0 + Fase 1)
// ============================================================
// Implementa o fluxo granular do roadmap:
//   objetivo → manifesto JSON (Pro) → itera arquivos → 1 arquivo por vez
//   (Pro, escopo limitado à descrição daquele arquivo) → Worker
//   determinístico do tipo certo → diagnóstico → persiste em disco
//   (Fase 1, tools/fileTools.js) → ZIP final.
//
// Fase 0 cobre HTML/CSS/JS puro (workers/htmlWorker.js, cssWorker.js,
// jsWorker.js). PHP/EJS/JSON ganharam Worker próprio depois (phpWorker.js
// via php-parser, ejsWorker.js via ejs.compile, jsonWorker.js via
// JSON.parse — todos puro JS, zero binding nativo/dependência de sistema,
// checado contra o Dockerfile de produção ANTES de escolher a dependência:
// node:18-slim não tinha runtime PHP/Python, então shell-out pra `php -l`
// funcionaria só por acidente neste sandbox e falharia silenciosamente em
// produção — inaceitável, ver comentário de phpParser.js). Flask/Django
// (tipo "py") ganhou Worker próprio depois de nenhum parser Python
// puro-JS maduro o bastante ser encontrado (avaliados: filbert/python-ast,
// nenhum confiável pra sintaxe Python 3 moderna) — decisão consciente de
// exceção (mesma lógica do princípio #5 do CLAUDE.md, generalizada: "IA/
// shell-out só entra onde não há alternativa determinística puro-JS
// viável"): workers/pythonWorker.js faz shell-out pra `python3 -c
// "ast.parse(...)"` (nunca exec/eval — só constrói a árvore sintática,
// nenhuma linha do código do usuário roda), com `python3-minimal`
// adicionado à imagem de produção (ver Dockerfile) especificamente pra
// isso. Arquivo de tipo sem Worker correspondente passa sem diagnóstico
// automático (documentado, não fingido).
//
// Nunca gera todos os arquivos numa chamada só — item 4.2 do roadmap:
// cada arquivo é uma chamada isolada ao Pro, escopo fechado ao que
// aquele arquivo precisa, validado antes do próximo entrar na fila.
//
// `baseDir` é opcional em gerarArquivo/gerarProjeto — sem ele, o
// conteúdo só existe em memória (retrocompatível com a Fase 0, testes
// existentes não tocam disco). Com ele, cada arquivo é persistido de
// verdade via tools/fileTools.js (createHtml/createCss/createJs) e
// gerarProjeto fecha com um ZIP (createZip) — só empacota se TODOS os
// arquivos passaram no Worker, mesmo critério de "nunca entrega sem
// validação" do roadmap (seção Validadores).
// ============================================================
const { validarManifesto, GEMINI_MANIFEST_RESPONSE_SCHEMA } = require('../manifest/manifestSchema');
const { validarHtml } = require('../workers/htmlWorker');
const { validarCss } = require('../workers/cssWorker');
const { validarJs } = require('../workers/jsWorker');
const { validarPhp } = require('../workers/phpWorker');
const { validarEjs } = require('../workers/ejsWorker');
const { validarJson } = require('../workers/jsonWorker');
const { validarPy } = require('../workers/pythonWorker');
const { criarArquivo, criarZip } = require('../tools/fileTools');
const { buscarCategoria, resumirParaPrompt } = require('../rag/ragCatalogLoader');
const { recuperarContextoRag } = require('../rag/ragPromptContext');
const { inicializarSolarisMd } = require('./projectMemory');
const { render: renderAsset, contextoForge, pedidoForge } = require('../tools/assetForge');
const path = require('node:path');
exports.WORKER_POR_TIPO = {
    html: validarHtml,
    css: validarCss,
    js: validarJs,
    php: validarPhp,
    ejs: validarEjs,
    json: validarJson,
    py: validarPy,
};
// Casa o objetivo contra o catálogo de categorias (Blog/SaaS/Landing
// Page/Dashboard/etc, ver src/solaris/rag/) ANTES de chamar o modelo —
// decisão determinística (código), não a IA quem escolhe a categoria.
// Sem match, o manifesto é gerado sem contexto extra (comportamento da
// Fase 0/1, preservado).
function _promptManifesto(objetivo, framework, contextoSemantico = '') {
    const categoria = buscarCategoria(objetivo);
    const contexto = categoria
        ? `\n\nContexto de referência (categoria "${categoria.titulo || categoria.id}" reconhecida no pedido — componentes, SEO e boas práticas típicas dessa categoria; use como orientação, não como obrigação rígida):\n${JSON.stringify(resumirParaPrompt(categoria))}`
        : '';
    return `Projeto: ${objetivo}\nFramework: ${framework}\n\nMonte o manifesto JSON deste projeto: lista de páginas, componentes, dependências e a lista de arquivos a gerar (cada um com caminho/tipo/descrição do que precisa conter).${contexto}${pedidoForge(objetivo) ? contextoForge() : ''}${contextoSemantico}`;
}
function _promptArquivoBase(manifesto, arquivo) {
    return `Projeto: ${manifesto.objetivo}\nFramework: ${manifesto.framework}\n\nGere APENAS o conteúdo do arquivo "${arquivo.caminho}" (tipo ${arquivo.tipo}). Escopo deste arquivo: ${arquivo.descricao}\n\nDeixe comentários no código explicando decisões não óbvias (por que, não o que — nomes já dizem o que o código faz) — quem herdar este projeto depois precisa entender o raciocínio, não só ler sintaxe.\n\nRetorne só o conteúdo do arquivo, sem explicação, sem markdown fence.`;
}
function _promptArquivo(manifesto, arquivo, assets = [], contextoSemantico = '') {
    const contexto = assets.length ? `\n\nAssets Forge já gerados e validados tecnicamente (use EXATAMENTE estes caminhos relativos ao projeto, nunca invente nomes de PNG/spritesheet):\n${JSON.stringify(assets)}\nAo importar módulos html5-runtime, use os .mjs exportados. Leia os manifests JSON de animação para rect/anchor/durationMs; não suponha grid nem tamanho de célula. Use URLs relativas ao arquivo HTML/módulo correto.` : '';
    return _promptArquivoBase(manifesto, arquivo) + contexto + contextoSemantico;
}
function criarOrquestrador({ modelRouter, buscarConhecimento = null }) {
    if (!modelRouter)
        throw new Error('[SOLARIS-ORCHESTRATOR] modelRouter é obrigatório.');
    return {
        // Etapa 1: Brainstorm → Manifesto JSON. Modelo Pro (item 2 do
        // roadmap: "Geração do Manifesto JSON" é responsabilidade do
        // arquiteto, não da triagem) — precisa entender o pedido completo
        // do usuário pra montar arquitetura/páginas/componentes coerentes,
        // não é uma tarefa de baixa latência.
        async gerarManifesto({ objetivo, framework, contextoSemantico = null }) {
            const referencias = contextoSemantico ?? await recuperarContextoRag({ query: `${objetivo} Framework: ${framework}`, buscarConhecimento });
            const resposta = await modelRouter.executarTarefaArquitetura({
                prompt: _promptManifesto(objetivo, framework, referencias),
                responseSchema: GEMINI_MANIFEST_RESPONSE_SCHEMA,
            });
            const textoJson = resposta.text;
            let bruto;
            try {
                bruto = JSON.parse(textoJson);
            }
            catch (_) {
                return { ok: false, erros: ['resposta do modelo não é JSON válido.'], avisos: [], manifesto: null };
            }
            return validarManifesto(bruto);
        },
        // Etapa 2: 1 arquivo por vez (Pro, escopo fechado) → Worker do tipo
        // → persiste em disco (se baseDir informado).
        async gerarArquivo({ manifesto, arquivo, baseDir = null, assets = [], contextoSemantico = '' }) {
            const worker = exports.WORKER_POR_TIPO[arquivo.tipo];
            const resposta = await modelRouter.executarTarefaArquitetura({
                prompt: _promptArquivo(manifesto, arquivo, assets, contextoSemantico),
            });
            const conteudo = resposta.text;
            let resultado;
            if (!worker) {
                resultado = { ok: true, caminho: arquivo.caminho, conteudo, diagnostico: null, avisoSemWorker: `sem Worker de validação pro tipo "${arquivo.tipo}" ainda (Fase 0 só cobre html/css/js).` };
            }
            else {
                const diagnostico = worker(conteudo);
                resultado = { ok: diagnostico.ok, caminho: arquivo.caminho, conteudo, diagnostico };
            }
            // Persiste mesmo quando o Worker reporta erro — o dono do
            // projeto vê o arquivo problemático em disco pra corrigir,
            // em vez de só um diagnóstico solto sem o conteúdo real; só
            // gerarProjeto() decide se o ZIP final inclui um projeto com
            // erro (não inclui, ver abaixo).
            if (baseDir) {
                criarArquivo(baseDir, arquivo.caminho, conteudo);
            }
            return resultado;
        },
        // Etapa completa: objetivo → manifesto → todos os arquivos, um a
        // um → ZIP final (se baseDir informado e nenhum arquivo falhou).
        async gerarProjeto({ objetivo, framework, baseDir = null }) {
            // Uma consulta semântica por projeto, reaproveitada na geração de arquivos.
            const contextoSemantico = await recuperarContextoRag({ query: `${objetivo} Framework: ${framework}`, buscarConhecimento });
            const { ok, erros, manifesto } = await this.gerarManifesto({ objetivo, framework, contextoSemantico });
            if (!ok)
                return { ok: false, erros, arquivos: [], zipBuffer: null };
            const assets = [];
            if (manifesto.assets?.length && !baseDir)
                return { ok: false, erros: ['Assets Forge exigem baseDir para gerar arquivos reais.'], manifesto, arquivos: [], assets, zipBuffer: null };
            try {
                let assetBytes = 0;
                for (const asset of manifesto.assets || []) {
                    const result = await renderAsset(asset, { baseDir });
                    assetBytes += result.files.reduce((sum, f) => sum + (f.tamanhoBytes || 0), 0);
                    if (assetBytes > 64 * 1024 * 1024)
                        throw new Error('Projeto excede 64 MiB de assets Forge.');
                    assets.push(result);
                }
            }
            catch (e) {
                return { ok: false, erros: [e.message], manifesto, arquivos: [], assets, zipBuffer: null };
            }
            const arquivos = [];
            for (const arquivo of manifesto.arquivos) {
                const normalized = path.posix.normalize(arquivo.caminho.replaceAll('\\', '/'));
                if (assets.some(a => normalized === `assets/${a.id}` || normalized.startsWith(`assets/${a.id}/`))) {
                    return { ok: false, erros: ['Arquivo gerado tenta substituir um bundle Forge.'], manifesto, arquivos, assets, zipBuffer: null };
                }
                arquivos.push(await this.gerarArquivo({ manifesto, arquivo, baseDir, assets, contextoSemantico }));
            }
            const algumFalhou = arquivos.some((a) => a.ok === false);
            let zipBuffer = null;
            if (baseDir && !algumFalhou) {
                // solaris.md ANTES do zip — pra sair incluso no download e o
                // usuário/o próprio Solaris (numa edição futura) já achar o
                // arquivo lá (ver pipeline/projectMemory.js).
                inicializarSolarisMd(baseDir, { objetivo: manifesto.objetivo, framework: manifesto.framework, arquivos: [...manifesto.arquivos, ...assets.flatMap(a => a.files.map(f => ({ caminho: f.caminho, tipo: 'asset', descricao: `Forge ${a.command}; revisão visual necessária` })))] });
                zipBuffer = await criarZip(baseDir);
            }
            return { ok: !algumFalhou, erros: [], manifesto, arquivos, assets, zipBuffer };
        },
    };
}
