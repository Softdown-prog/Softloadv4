#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gerarTextoComRetry = gerarTextoComRetry;
exports.extrairJSON = extrairJSON;
exports.gerarEsalvar = gerarEsalvar;
exports.main = main;
// ============================================================
// RAG Balcão Generator — Gera os dois arquivos de conhecimento
// técnico ia-balcao-* via Gemini e salva em ia-de-balcao/.
//
// Uso:
//   node scripts/generateRagBalcao.js
// ============================================================
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { gerarTexto } = require('../src/services/geminiService');
// ──────────────────────────────────────────────────────────────
// Rate-limit wrapper — reintenta em 429/quota com backoff
// ──────────────────────────────────────────────────────────────
async function gerarTextoComRetry(prompt, maxRetries = 3) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await gerarTexto(prompt);
        }
        catch (err) {
            const msg = (err.message || '').toLowerCase();
            const is429 = msg.includes('429') || msg.includes('quota') || msg.includes('rate limit');
            if (is429 && attempt < maxRetries) {
                const waitMs = Math.pow(2, attempt + 1) * 10_000; // 20s, 40s, 80s
                console.warn(`  ⚠️  429/quota — aguardando ${waitMs / 1000}s (tentativa ${attempt + 1}/${maxRetries})...`);
                await new Promise(r => setTimeout(r, waitMs));
            }
            else {
                throw err;
            }
        }
    }
    throw new Error('Falha inesperada no limite de tentativas');
}
const OUT_DIR = path.join(__dirname, '../src/rag/ia-de-balcao');
// ──────────────────────────────────────────────────────────────
// extrairJSON — idêntico ao de generateBlocks.js
// ──────────────────────────────────────────────────────────────
function extrairJSON(texto) {
    let limpo = texto.trim();
    limpo = limpo.replace(/^```json\s*/i, '').replace(/\s*```\s*$/i, '');
    limpo = limpo.replace(/^```\s*/i, '').replace(/\s*```\s*$/i, '');
    try {
        return JSON.parse(limpo);
    }
    catch (_) { }
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
// PROMPT 1 — Grid col-lg-8 + col-lg-4 com sidebar condicional
// ──────────────────────────────────────────────────────────────
const PROMPT_GRID_SIDEBAR = `Você é um especialista em templates Blogger com Bootstrap 5. Gere um arquivo de conhecimento técnico JSON para um sistema RAG.

O arquivo deve documentar o padrão arquitetural de grid Bootstrap col-lg-8 + col-lg-4 com sidebar condicional usada em templates Blogger.

CONTEXTO TÉCNICO:
- Layout principal: <div class="row g-4"><div class="col-lg-8">...main...</div><div class="col-lg-4">...aside...</div></div>
- A sidebar tem dois estados: quando isMultipleItems (lista de posts) mostra "Sobre o Portal"; quando isPost (post único) mostra "Artigos Relacionados" com id='related-posts-container' para injeção via JSON Feed
- O estado condicional é controlado por b:if cond='data:view.isMultipleItems' no template Blogger
- Cards na lista: row g-4 > col-md-6 > card h-100 > badge + h3 + snippet + btn-outline rounded-pill
- Post único: article.post-content.bg-white.p-4.rounded-3.shadow-sm > h1.display-5 + meta + entry-content

Retorne SOMENTE JSON válido com esta estrutura exata:
{
  "id": "ia-balcao-grid-sidebar-condicional",
  "categoria": "padrao-estrutural",
  "pattern_central": "descrição do padrão em 1-2 frases",
  "main_condicional": {
    "lista_html": "HTML Bootstrap 5 do bloco main quando isMultipleItems (2 cards mock de post, com classe .sl-card, badge categoria, h3 título, p snippet, a btn-outline rounded-pill)",
    "single_html": "HTML Bootstrap 5 do bloco main quando isPost (article com h1, meta data/autor, p conteúdo de exemplo)"
  },
  "aside_condicional": {
    "lista_html": "HTML do sidebar 'Sobre o Portal' (heading h5, p descrição, badges de categorias mock)",
    "single_html": "HTML do sidebar 'Artigos Relacionados' com div id='related-posts-container' vazio e script de injeção comentado"
  },
  "html_simulado_lista": "HTML completo da saída com isMultipleItems=true: row g-4 com col-lg-8 (2 cards) + col-lg-4 (sidebar Sobre o Portal)",
  "html_simulado_single": "HTML completo da saída com isPost=true: row g-4 com col-lg-8 (article) + col-lg-4 (sidebar Artigos Relacionados)",
  "notas_tecnicas": [
    "por que sidebar precisa de dois estados (evitar sidebar poluída no post)",
    "padrão id='related-posts-container' para injeção dinâmica via JSON Feed",
    "col-lg-8 + col-lg-4 = 12 colunas Bootstrap, empilha em mobile",
    "ZERO tags b:, data:, expr: nos exemplos de HTML — são outputs finais, não templates"
  ]
}

REGRAS:
- Todo HTML deve ser Bootstrap 5 válido, sem tags Blogger (b:, data:, expr:)
- Use classes sl-card para cards, sl-hero para heroes
- Os html_simulado_* devem ser HTML renderizável completo (não templates)
- Texto em português brasileiro
- ZERO markdown fora do JSON`;
// ──────────────────────────────────────────────────────────────
// PROMPT 2 — Imagens responsivas com resizeImage() e JS interceptor
// ──────────────────────────────────────────────────────────────
const PROMPT_IMAGENS = `Você é um especialista em otimização de imagens para Blogger. Gere um arquivo de conhecimento técnico JSON para um sistema RAG.

O arquivo deve documentar a técnica de lazy loading e resize dinâmico de imagens do Blogger via JavaScript interceptor (IIFE).

CONTEXTO TÉCNICO:
- O servidor de imagens do Google (lh3.googleusercontent.com) aceita parâmetros via URL: /s1600/ ou =w1200-h675-c
- resizeImage() nativo do Blogger é estático; para responsividade real precisa de JS que detecta window.innerWidth
- Breakpoints: mobile (<576px) → w480-h360-c (4:3), tablet (<992px) → w800-h450-c (16:9), desktop → w1200-h675-c (16:9)
- SVG placeholder como src evita layout shift (LCP)
- A IIFE deve: 1) selecionar todos img[data-src], 2) calcular dimensão baseada em window.innerWidth, 3) reescrever URL (detectando formato /s1600/ vs =s0), 4) setar src e adicionar classe img-loaded
- Dois formatos de URL Blogger: "https://lh3.googleusercontent.com/.../s1600/foto.jpg" e "https://blogger.googleusercontent.com/.../s0/foto.jpg"

Retorne SOMENTE JSON válido com esta estrutura exata:
{
  "id": "ia-balcao-imagens-responsivas-blogger",
  "categoria": "otimizacao-imagens",
  "conceito": "descrição em 1-2 frases do por que precisa de JS interceptor",
  "placeholder_xml": "atributo data-src com data:post.featuredImage e src com SVG 16:9 base64 cinza como placeholder",
  "javascript_iife": "IIFE JavaScript completa (auto-executada) com os 3 breakpoints, detecção dos 2 formatos de URL do Google, seleção de img[data-src], reescrita de URL e adição de classe img-loaded. Usar document.readyState para execução imediata ou DOMContentLoaded",
  "breakpoints": {
    "mobile": {"condicao": "window.innerWidth < 576", "params": "w480-h360-c", "ratio": "4:3"},
    "tablet": {"condicao": "window.innerWidth < 992", "params": "w800-h450-c", "ratio": "16:9"},
    "desktop": {"condicao": "default", "params": "w1200-h675-c", "ratio": "16:9"}
  },
  "formatos_url_blogger": {
    "formato_s1600": "exemplo de URL formato /s1600/ e como reescrever com regex",
    "formato_s0": "exemplo de URL formato =s0 e como reescrever com replace"
  },
  "html_saida_simulado": "HTML de exemplo com img tendo data-src='https://lh3.googleusercontent.com/abc/s1600/foto.jpg' e src SVG placeholder, depois do JS rodar o src vira https://lh3.googleusercontent.com/abc/w425-h319-c/foto.jpg com classe img-loaded",
  "notas_tecnicas": [
    "LCP impact: imagens lazy sem resize correto carregam 3x o tamanho necessário",
    "SVG placeholder evita layout shift — dimensionar com aspect-ratio no CSS",
    "classe img-loaded como state marker para CSS transitions de fade-in",
    "document.readyState check: se 'loading' aguarda DOMContentLoaded, senão executa imediatamente"
  ]
}

REGRAS:
- O javascript_iife deve ser código JavaScript real e funcional
- O placeholder_xml deve usar a sintaxe correta do Blogger (data: e expr:)
- Texto descritivo em português brasileiro
- ZERO markdown fora do JSON`;
// ──────────────────────────────────────────────────────────────
// main
// ──────────────────────────────────────────────────────────────
async function gerarEsalvar(nome, prompt) {
    console.log(`\n[1/2] Gerando ${nome}...`);
    let resposta;
    try {
        resposta = await gerarTextoComRetry(prompt);
    }
    catch (err) {
        console.error(`  [erro] Gemini falhou: ${err.message}`);
        return false;
    }
    const json = extrairJSON(resposta);
    if (!json) {
        console.error(`  [erro] JSON inválido. Resposta:\n${resposta.substring(0, 300)}`);
        return false;
    }
    // Validação mínima
    if (!json.id || !json.categoria) {
        console.error(`  [erro] JSON sem id/categoria. Chaves: ${Object.keys(json).join(', ')}`);
        return false;
    }
    const outPath = path.join(OUT_DIR, `${nome}.json`);
    fs.writeFileSync(outPath, JSON.stringify(json, null, 2), 'utf-8');
    console.log(`  → salvo: ${path.relative(process.cwd(), outPath)}`);
    return true;
}
async function main() {
    const flags = process.argv.slice(2).filter(a => a.startsWith('--'));
    const dryRun = flags.includes('--dry-run');
    const delayFlag = flags.find(f => f.startsWith('--delay='));
    const pauseMs = delayFlag ? parseInt(delayFlag.split('=')[1], 10) * 1000 : 10_000;
    console.log('\n🔧 RAG Balcão Generator — 2 arquivos');
    console.log(`   Chamadas Gemini estimadas : 2`);
    console.log(`   Delay entre chamadas      : ${pauseMs / 1000}s`);
    if (dryRun)
        console.log(`   [DRY-RUN] Nenhuma chamada real será feita.\n`);
    else
        console.log('');
    let r1, r2;
    if (dryRun) {
        console.log('[1/2] [dry-run] ia-balcao-grid-sidebar-condicional ignorado');
        console.log('[2/2] [dry-run] ia-balcao-imagens-responsivas-blogger ignorado');
        r1 = r2 = true;
    }
    else {
        r1 = await gerarEsalvar('ia-balcao-grid-sidebar-condicional', PROMPT_GRID_SIDEBAR);
        console.log(`  ⏳ Aguardando ${pauseMs / 1000}s antes da próxima chamada...`);
        await new Promise(r => setTimeout(r, pauseMs));
        r2 = await gerarEsalvar('ia-balcao-imagens-responsivas-blogger', PROMPT_IMAGENS);
    }
    console.log(`\n✅ Concluído: ${[r1, r2].filter(Boolean).length}/2 ok`);
    if (r1 && r2) {
        console.log('\n   Próximo passo:');
        console.log('   git add src/rag/ia-de-balcao/ia-balcao-*.json');
        console.log('   git commit -m "feat: add ia-balcao RAG files for grid+sidebar and responsive images"');
    }
}
if (require.main === module)
    main().catch((err) => {
        console.error('Erro fatal:', err);
        process.exit(1);
    });
