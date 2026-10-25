#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HERO_VARIANTS = exports.CSS_VARIANTS = exports.TODOS_OS_NICHOS = void 0;
exports.buildPrompt = buildPrompt;
exports.extrairJSON = extrairJSON;
exports.validarCSS = validarCSS;
exports.validarHero = validarHero;
exports.gerarBlocosParaNicho = gerarBlocosParaNicho;
exports.salvarBlocos = salvarBlocos;
exports.main = main;
// ============================================================
// BLOCK WORKER — Gera variantes CSS e Hero HTML para cada nicho
// via Gemini e salva em tema-{nicho}-blocks.json no diretório
// de temas. Execute uma vez; commite o output.
//
// Uso:
//   node scripts/generateBlocks.js              # todos os 14 nichos
//   node scripts/generateBlocks.js gamer-playerone viral-magazine
//
// Output por nicho:
//   src/rag/rag-ia-compiler/pipeline/temas/tema-{nicho}-blocks.json
// ============================================================
require('dotenv').config();
const fs = require('fs');
const path = require('path');
// Importa gerarTexto após o dotenv carregar a key
const { gerarTexto } = require('../src/services/geminiService');
const TEMAS_DIR = path.join(__dirname, '../src/rag/rag-ia-compiler/pipeline/temas');
exports.TODOS_OS_NICHOS = [
    'gamer-playerone',
    'pop-retro-pixel',
    'natureza-bulma-vegan',
    'elearning-academy',
    'biolink-social',
    'appstore-bulma-mobile',
    'brutalista-appcraft',
    'culinaria-boutique-gourmet',
    'noticias-mag-news',
    'viral-magazine',
    'saas-nexus',
    'portfolio-minimalista',
    'tecnologia-mag-tech',
    'tecnologia-techwind',
];
// Quantas variantes gerar por slot
exports.CSS_VARIANTS = 5;
exports.HERO_VARIANTS = 3;
// ──────────────────────────────────────────────────────────────
// buildPrompt — monta o prompt Gemini para um nicho específico
// ──────────────────────────────────────────────────────────────
function buildPrompt(nicho, meta) {
    const descricao = (meta.descricao || nicho).substring(0, 200);
    const nichoLabel = meta.nicho || nicho;
    return `Você é um especialista em CSS e Bootstrap 5 para blogs. Gere variantes visuais para um blog do nicho: "${nichoLabel}".

CONTEXTO DO NICHO:
${descricao}

TAREFA:
Gere exatamente ${exports.CSS_VARIANTS} variantes de CSS e ${exports.HERO_VARIANTS} variantes de hero HTML para este nicho.

REGRAS OBRIGATÓRIAS:
1. Use APENAS var(--sl-primary) para cor de destaque principal
2. Use var(--sl-bg-body) para fundo de página
3. Use var(--sl-card-bg) para fundo de cards
4. Use var(--sl-text-main) para texto principal
5. Use var(--sl-footer-bg) para rodapé
6. Bootstrap 5 — use classes nativas (card, btn, badge, row, col-*)
7. ZERO sintaxe Blogger (sem b:, data:, expr:)
8. Cada variante de CSS deve ter estilo VISUAL DISTINTO (ex: flat vs glassmorphism vs neon vs minimalista vs editorial)
9. Hero HTML: HTML estático completo (sem placeholders como [TITULO] ou [URL])
10. Hero HTML deve começar com <section ou <div

Retorne SOMENTE JSON válido, sem markdown, sem comentários fora do JSON:
{
  "card_css": [
    "/* Variante 1: [nome do estilo] */\\n.sl-card { ... }\\n.sl-card:hover { ... }",
    "/* Variante 2: [nome do estilo] */\\n.sl-card { ... }",
    "/* Variante 3: [nome do estilo] */\\n.sl-card { ... }",
    "/* Variante 4: [nome do estilo] */\\n.sl-card { ... }",
    "/* Variante 5: [nome do estilo] */\\n.sl-card { ... }"
  ],
  "hero_html": [
    "<section class='sl-hero ...'> ... </section>",
    "<section class='sl-hero ...'> ... </section>",
    "<div class='sl-hero ...'> ... </div>"
  ]
}

IMPORTANTE: card_css deve ter EXATAMENTE ${exports.CSS_VARIANTS} strings. hero_html deve ter EXATAMENTE ${exports.HERO_VARIANTS} strings.`;
}
// ──────────────────────────────────────────────────────────────
// extrairJSON — extrai JSON da resposta (Gemini às vezes retorna
// com ```json ... ``` ou com texto antes/depois)
// ──────────────────────────────────────────────────────────────
function extrairJSON(texto) {
    // Remove markdown code fences
    let limpo = texto.trim();
    limpo = limpo.replace(/^```json\s*/i, '').replace(/\s*```\s*$/i, '');
    limpo = limpo.replace(/^```\s*/i, '').replace(/\s*```\s*$/i, '');
    // Tenta parsear direto
    try {
        return JSON.parse(limpo);
    }
    catch (_) { }
    // Tenta extrair o primeiro {...} do texto
    const match = limpo.match(/\{[\s\S]*\}/);
    if (match) {
        try {
            return JSON.parse(match[0]);
        }
        catch (_) { }
    }
    return null;
}
// ──────────────────────────────────────────────────────────────
// Validadores — mesmos critérios do carregarNichoImpl()
// ──────────────────────────────────────────────────────────────
function validarCSS(str) {
    if (typeof str !== 'string' || str.trim().length < 20)
        return false;
    // Sem sintaxe Blogger
    if (/\bdata:|b:|expr:/.test(str))
        return false;
    // Sem placeholders mock
    if (/\[[A-Za-z][A-Za-z0-9_ :.-]*\]/.test(str))
        return false;
    // Deve ter pelo menos uma regra CSS (chave abre)
    return str.includes('{') && str.includes('}');
}
function validarHero(str) {
    if (typeof str !== 'string' || str.trim().length < 30)
        return false;
    // Deve começar com tag HTML
    if (!/^[\s\n]*<[a-z]/i.test(str))
        return false;
    // Sem sintaxe Blogger
    if (/\bdata:|b:|expr:/.test(str))
        return false;
    // Sem placeholders mock
    if (/\[[A-Za-z][A-Za-z0-9_ :.-]*\]/.test(str))
        return false;
    return true;
}
// ──────────────────────────────────────────────────────────────
// gerarBlocosParaNicho — gera e valida variantes para 1 nicho
// ──────────────────────────────────────────────────────────────
async function gerarBlocosParaNicho(nicho) {
    const metaPath = path.join(TEMAS_DIR, `tema-${nicho}-meta.json`);
    let meta = {};
    try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    }
    catch (_) {
        console.warn(`  [aviso] meta.json não encontrado para ${nicho} — usando defaults`);
    }
    const prompt = buildPrompt(nicho, meta);
    let resposta;
    try {
        resposta = await gerarTexto(prompt);
    }
    catch (err) {
        console.error(`  [erro] Gemini falhou para ${nicho}: ${err.message}`);
        return null;
    }
    const json = extrairJSON(resposta);
    if (!json) {
        console.error(`  [erro] JSON inválido para ${nicho}. Resposta:\n${resposta.substring(0, 200)}`);
        return null;
    }
    const cssValidos = (Array.isArray(json.card_css) ? json.card_css : []).filter(validarCSS);
    const heroValidos = (Array.isArray(json.hero_html) ? json.hero_html : []).filter(validarHero);
    console.log(`  css: ${cssValidos.length}/${exports.CSS_VARIANTS} válidas | hero: ${heroValidos.length}/${exports.HERO_VARIANTS} válidas`);
    if (cssValidos.length === 0 && heroValidos.length === 0) {
        console.error(`  [erro] Nenhum bloco válido gerado para ${nicho}`);
        return null;
    }
    return {
        nicho,
        gerado_em: new Date().toISOString(),
        total_css: cssValidos.length,
        total_hero: heroValidos.length,
        card_css: cssValidos,
        hero_html: heroValidos,
    };
}
// ──────────────────────────────────────────────────────────────
// salvarBlocos — escreve o arquivo de blocos no disco
// ──────────────────────────────────────────────────────────────
function salvarBlocos(nicho, blocos) {
    const outPath = path.join(TEMAS_DIR, `tema-${nicho}-blocks.json`);
    fs.writeFileSync(outPath, JSON.stringify(blocos, null, 2), 'utf-8');
    console.log(`  → salvo: ${path.relative(process.cwd(), outPath)}`);
}
// ──────────────────────────────────────────────────────────────
// main
// ──────────────────────────────────────────────────────────────
async function main() {
    const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
    const nichos = args.length > 0 ? args : exports.TODOS_OS_NICHOS;
    const pauseMs = 2000; // pausa entre chamadas para evitar rate limit
    console.log(`\n🔧 Block Worker — ${nichos.length} nicho(s) × ${exports.CSS_VARIANTS} css + ${exports.HERO_VARIANTS} hero\n`);
    const resultados = { ok: [], erro: [] };
    for (let i = 0; i < nichos.length; i++) {
        const nicho = nichos[i];
        console.log(`[${i + 1}/${nichos.length}] ${nicho}`);
        const blocos = await gerarBlocosParaNicho(nicho);
        if (blocos) {
            salvarBlocos(nicho, blocos);
            resultados.ok.push(nicho);
        }
        else {
            resultados.erro.push(nicho);
        }
        // Pausa entre nichos para não estourar rate limit
        if (i < nichos.length - 1) {
            await new Promise(r => setTimeout(r, pauseMs));
        }
    }
    console.log(`\n✅ Concluído: ${resultados.ok.length} ok | ${resultados.erro.length} com erro`);
    if (resultados.erro.length > 0) {
        console.log(`   Erros: ${resultados.erro.join(', ')}`);
    }
    if (resultados.ok.length > 0) {
        console.log(`\n   Próximo passo:\n   git add src/rag/rag-ia-compiler/pipeline/temas/*-blocks.json`);
        console.log(`   git commit -m "feat: generated block library"`);
    }
}
if (require.main === module)
    main().catch((err) => {
        console.error('Erro fatal:', err);
        process.exit(1);
    });
