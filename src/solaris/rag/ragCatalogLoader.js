"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.carregarCatalogo = carregarCatalogo;
exports.buscarCategoria = buscarCategoria;
exports.resumirParaPrompt = resumirParaPrompt;
// ============================================================
// SOLARIS RAG CATALOG LOADER (Fase 2)
// ============================================================
// Base de conhecimento de categorias de projeto (Blog, SaaS, Landing
// Page, Dashboard, E-commerce, Restaurante, etc.) — cada arquivo em
// src/solaris/rag/ é um JSON descrevendo componentes/SEO/frameworks/
// boas práticas esperados daquela categoria. Populado diretamente no
// repositório (não gerado por código) — este módulo só carrega e
// casa contra o pedido do usuário, determinístico, sem IA.
//
// Reusa o mesmo matcher com fronteira de palavra + acentos normalizados
// já usado pelo RAG do Blogger Engine (src/rag/ragMatcher.js) — evita
// duplicar a lógica de scoring (princípio #4 do CLAUDE.md).
// ============================================================
const fs = require('fs');
const path = require('path');
const { criarMatcher, pontuarKeywords } = require('../../rag/ragMatcher');
const { listarArquivosDeCatalogo, validarNomeArquivo, auditarCatalogo } = require('../workers/ragKebabWorker');
const RAG_DIR = __dirname;
// Tamanho mínimo de um token derivado pra virar keyword — abaixo disso é
// quase sempre stopword (conjunção "e", artigo, número solto) que casa
// por acidente contra qualquer mensagem de usuário que contenha aquele
// caractere isolado (achado real: id "firebase-erros-criticos-e-mitigacoes"
// derivava a keyword "e", que casava a mensagem genérica "e agora?").
// Números de versão soltos (ex.: "18", "22", "3") têm o mesmo risco —
// aparecem sozinhos em frases comuns do usuário sem relação com o tópico.
const TAMANHO_MINIMO_KEYWORD_DERIVADA = 3;
// Termos estruturais genéricos que aparecem em ids/categorias de entradas
// amplas (ex.: "django-frontend-backend-cloud-architecture") e não
// devem vencer tecnologias explícitas em prompts curtos como "backend em
// flask" ou "backend em php". Mantém o match focado no assunto real da
// entrada, não em palavras de arquitetura comuns a qualquer stack.
const KEYWORDS_DERIVADAS_IGNORADAS = new Set([
    'frontend', 'backend', 'full', 'stack', 'web', 'cloud', 'architecture',
    'framework', 'frameworks', 'pattern', 'patterns', 'category', 'topic',
    'description', 'design', 'recommended', 'and',
]);
// Deriva keywords extras a partir de id/slug/titulo/categoria — nem todo
// arquivo de catálogo tem prompt_keywords/keywords (achado real: só
// Landing-page e Portifólio têm; os outros 9 não) — sem isso, a maioria
// das categorias nunca seria encontrada por match de prompt.
function _keywordsDerivadas(entrada) {
    const campos = [entrada.id, entrada.slug, entrada.titulo, entrada.categoria];
    const tokens = new Set();
    for (const campo of campos) {
        if (typeof campo !== 'string')
            continue;
        for (const parte of campo.split(/[-_\s]+/)) {
            const token = parte.trim();
            if (token.length >= TAMANHO_MINIMO_KEYWORD_DERIVADA && !KEYWORDS_DERIVADAS_IGNORADAS.has(token.toLowerCase()))
                tokens.add(token);
        }
    }
    return Array.from(tokens);
}
let _cache = null;
/**
 * Carrega e faz parse de todo arquivo de catálogo em src/solaris/rag/.
 * Arquivo que falha o parse é ignorado com aviso no console (nunca
 * derruba o carregamento dos demais) — mesma postura de degradação
 * parcial do ragLoader.js do Blogger Engine.
 */
function carregarCatalogo({ forcarRecarga = false } = {}) {
    if (_cache && !forcarRecarga)
        return _cache;
    // Auditoria de consistência (nome↔id, campos recomendados, id
    // duplicado) — puro diagnóstico, nunca impede o carregamento; só
    // avisa no console pra quem populou o catálogo corrigir na fonte.
    const { arquivos: auditoria, duplicados } = auditarCatalogo({ dir: RAG_DIR });
    for (const item of auditoria) {
        for (const aviso of item.avisos)
            console.warn(`[SOLARIS-RAG] ${item.arquivo}: ${aviso}`);
        for (const erro of item.erros)
            console.warn(`[SOLARIS-RAG] ${item.arquivo}: ${erro}`);
    }
    for (const dup of duplicados) {
        console.warn(`[SOLARIS-RAG] id "${dup.id}" duplicado em: ${dup.arquivos.join(', ')}.`);
    }
    const arquivos = listarArquivosDeCatalogo(RAG_DIR);
    const catalogo = [];
    for (const nomeArquivo of arquivos) {
        // Lint do nome físico do arquivo (kebab-case + extensão .json) —
        // análise/correção mecânica é responsabilidade do ragKebabWorker,
        // este loader só consome o resultado e avisa; nunca corrige em
        // disco sozinho (ver normalizarDiretorioRag no Worker pra isso).
        const { avisos: avisosDeNome } = validarNomeArquivo(nomeArquivo);
        for (const aviso of avisosDeNome) {
            console.warn(`[SOLARIS-RAG] ${aviso}`);
        }
        const caminho = path.join(RAG_DIR, nomeArquivo);
        try {
            const bruto = fs.readFileSync(caminho, 'utf8');
            const entrada = JSON.parse(bruto);
            if (!entrada || typeof entrada !== 'object' || !entrada.id) {
                console.warn(`[SOLARIS-RAG] ${nomeArquivo}: ignorado (sem campo "id").`);
                continue;
            }
            entrada._arquivo = nomeArquivo;
            entrada._keywords = [
                ...(entrada.prompt_keywords || []),
                ...(entrada.keywords || []),
                ..._keywordsDerivadas(entrada),
            ];
            catalogo.push(entrada);
        }
        catch (err) {
            console.warn(`[SOLARIS-RAG] ${nomeArquivo}: ignorado (JSON inválido) — ${err.message}`);
        }
    }
    _cache = catalogo;
    return catalogo;
}
/**
 * Casa o texto do objetivo do usuário (brainstorm/prompt) contra o
 * catálogo — mesmo scoring do RAG do Blogger Engine (soma do
 * comprimento das keywords que casaram, com fronteira de palavra).
 * Retorna a entrada de maior score, ou null se nada casou.
 */
function buscarCategoria(textoObjetivo) {
    if (!textoObjetivo || typeof textoObjetivo !== 'string')
        return null;
    const catalogo = carregarCatalogo();
    const matcher = criarMatcher(textoObjetivo);
    let melhor = null;
    let melhorScore = 0;
    for (const entrada of catalogo) {
        const { hits, score } = pontuarKeywords(matcher, entrada._keywords);
        if (hits === 0)
            continue;
        // Empate exato de score: prioriza referência de framework/backend/
        // linguagem sobre entrada de tópico específico (categoria "topico",
        // ver ragEntryGenerator.js/ragTopicMatrix.js) — achado real ao
        // escalar o catálogo com tópicos gerados (ex.: "bootstrap5-navbar"
        // deriva a keyword "bootstrap5" do próprio id, empatando com
        // bootstrap5.json pra um pedido genérico que só cita o framework).
        // Um tópico só deveria vencer quando o pedido também cita algo
        // específico dele — nesse caso o score já seria estritamente
        // maior (mais keywords casadas), não empatado.
        const ehMelhorPorScore = score > melhorScore;
        const ehDesempatePorGeneralidade = score === melhorScore && melhor && melhor.categoria === 'topico' && entrada.categoria !== 'topico';
        // Empate de score em pedido genérico de tecnologia (ex.: só "flask"):
        // prioriza a referência mais curta/geral (flask.json) sobre um tópico
        // especializado que também contém a mesma keyword (flask-jinja2-...).
        const ehDesempatePorReferenciaCurta = score === melhorScore && melhor && entrada.id.length < melhor.id.length;
        if (ehMelhorPorScore || ehDesempatePorGeneralidade || ehDesempatePorReferenciaCurta) {
            melhor = entrada;
            melhorScore = score;
        }
    }
    return melhor;
}
// Resumo compacto pra injetar no prompt do manifesto — só os campos que
// orientam arquitetura (componentes/seo/frameworks/boas práticas), sem
// os campos internos do loader (_arquivo/_keywords) nem prompt_keywords/
// keywords crus (já cumpriram o papel deles no match).
function resumirParaPrompt(entrada) {
    if (!entrada)
        return null;
    const { _arquivo, _keywords, prompt_keywords, keywords, ...resto } = entrada;
    return resto;
}
