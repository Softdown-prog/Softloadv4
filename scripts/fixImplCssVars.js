#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NICHOS_COM_CSS = void 0;
exports.gerarTextoComRetry = gerarTextoComRetry;
exports.extrairJSON = extrairJSON;
exports.coletarCssStrings = coletarCssStrings;
exports.setByPath = setByPath;
exports.buildPrompt = buildPrompt;
exports.processarNicho = processarNicho;
exports.main = main;

// ============================================================
// CSS Var Fixer — Substitui cores hardcoded por var(--sl-*)
// nos impl.json que têm CSS. Usa Gemini para inferir o mapeamento
// semântico correto por nicho.
//
// Variáveis alvo (definidas pelo colorPreset do compilador):
//   --sl-primary    → cor de destaque principal
//   --sl-bg-body    → fundo da página
//   --sl-card-bg    → fundo de cards
//   --sl-text-main  → texto principal
//   --sl-footer-bg  → fundo do rodapé
//
// Uso:
//   node scripts/fixImplCssVars.js
//   node scripts/fixImplCssVars.js gamer-playerone
// ============================================================

require('dotenv').config();

const fs   = require('fs');
const path = require('path');
const { gerarTexto } = require('../src/services/geminiService');

// ──────────────────────────────────────────────────────────────
// Rate-limit wrapper — reintenta em 429/quota com backoff
// ──────────────────────────────────────────────────────────────
async function gerarTextoComRetry(prompt, maxRetries = 3) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await gerarTexto(prompt);
        } catch (err) {
            const msg = (err.message || '').toLowerCase();
            const is429 = msg.includes('429') || msg.includes('quota') || msg.includes('rate limit');
            if (is429 && attempt < maxRetries) {
                const waitMs = Math.pow(2, attempt + 1) * 10_000; // 20s, 40s, 80s
                console.warn(`  ⚠️  429/quota — aguardando ${waitMs / 1000}s (tentativa ${attempt + 1}/${maxRetries})...`);
                await new Promise(r => setTimeout(r, waitMs));
            } else {
                throw err;
            }
        }
    }
    throw new Error('Falha inesperada no limite de tentativas');
}

const TEMAS_DIR = path.join(__dirname, '../src/rag/rag-ia-compiler/pipeline/temas');

// Apenas os nichos que têm CSS significativo
exports.NICHOS_COM_CSS = [
    'gamer-playerone',
    'appstore-bulma-mobile',
    'natureza-bulma-vegan',
    'noticias-mag-news',
];

function extrairJSON(texto) {
    let limpo = texto.trim();
    limpo = limpo.replace(/^```json\s*/i, '').replace(/\s*```\s*$/i, '');
    limpo = limpo.replace(/^```\s*/i, '').replace(/\s*```\s*$/i, '');
    try { return JSON.parse(limpo); } catch (_) {}
    const match = limpo.match(/\{[\s\S]*\}/);
    if (match) { try { return JSON.parse(match[0]); } catch (_) {} }
    return null;
}

// ──────────────────────────────────────────────────────────────
// Percorre o objeto e retorna todas as strings CSS com seus caminhos
// ──────────────────────────────────────────────────────────────
function coletarCssStrings(obj, caminho = '') {
    const resultado = [];
    if (typeof obj === 'string' && obj.includes('{')) {
        resultado.push({ caminho, valor: obj });
    } else if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        for (const [k, v] of Object.entries(obj)) {
            resultado.push(...coletarCssStrings(v, caminho ? `${caminho}.${k}` : k));
        }
    } else if (Array.isArray(obj)) {
        obj.forEach((v, i) => resultado.push(...coletarCssStrings(v, `${caminho}[${i}]`)));
    }
    return resultado;
}

// ──────────────────────────────────────────────────────────────
// Define valor em objeto por caminho (ex: "css_componentes.top_bar")
// ──────────────────────────────────────────────────────────────
function setByPath(obj, caminho, valor) {
    const partes = caminho.replace(/\[(\d+)\]/g, '.$1').split('.');
    let cur = obj;
    for (let i = 0; i < partes.length - 1; i++) {
        cur = cur[partes[i]];
    }
    cur[partes[partes.length - 1]] = valor;
}

// ──────────────────────────────────────────────────────────────
// buildPrompt — pede ao Gemini para substituir cores hardcoded
// ──────────────────────────────────────────────────────────────
function buildPrompt(nicho, cssStrings) {
    const cssBloco = cssStrings.map((c, i) => `// [${i}] caminho: ${c.caminho}\n${c.valor}`).join('\n\n---\n\n');

    return `Você é um especialista em CSS e sistemas de design para blogs. Analise o CSS abaixo do nicho "${nicho}" e substitua cores hardcoded pelas variáveis CSS do sistema Softload onde fizer sentido semanticamente.

VARIÁVEIS DISPONÍVEIS DO SISTEMA (definidas pelo colorPreset):
- var(--sl-primary)   → cor de destaque principal do blog (links, botões, badges, bordas ativas)
- var(--sl-bg-body)   → cor de fundo da página/body
- var(--sl-card-bg)   → cor de fundo de cards e painéis
- var(--sl-text-main) → cor do texto principal
- var(--sl-footer-bg) → cor de fundo do rodapé

REGRAS OBRIGATÓRIAS:
1. Substitua cores hardcoded APENAS onde forem semanticamente equivalentes a uma das variáveis acima
2. NÃO substitua cores que são específicas do design do nicho (ex: vermelho de perigo, verde de sucesso, cores de gradiente decorativas)
3. NÃO substitua cores dentro de rgba() a menos que seja claramente a cor primária/bg
4. MANTENHA variáveis nicho-específicas existentes (var(--gamer-*), var(--nat-*), etc.)
5. Se uma cor já usa var(--sl-*) ou var(--nicho-*), deixe como está
6. O CSS final deve ser funcionalmente idêntico mas mais flexível com colorPresets

CSS DO NICHO "${nicho}" (${cssStrings.length} blocos):

${cssBloco}

Retorne SOMENTE JSON válido com esta estrutura (os arrays devem ter EXATAMENTE ${cssStrings.length} elementos, na mesma ordem):
{
  "nicho": "${nicho}",
  "css_corrigido": [
    "...CSS do bloco [0] com vars substituídas...",
    "...CSS do bloco [1]...",
    ...
  ],
  "substituicoes": [
    {"bloco": 0, "de": "#cor-original", "para": "var(--sl-*)"},
    ...
  ]
}

IMPORTANTE: css_corrigido deve ter EXATAMENTE ${cssStrings.length} strings, uma para cada bloco CSS acima, na mesma ordem.`;
}

// ──────────────────────────────────────────────────────────────
// processarNicho — lê impl.json, envia para Gemini, aplica fixes
// ──────────────────────────────────────────────────────────────
async function processarNicho(nicho) {
    const implPath = path.join(TEMAS_DIR, `tema-${nicho}-impl.json`);
    let impl;
    try {
        impl = JSON.parse(fs.readFileSync(implPath, 'utf-8'));
    } catch (err) {
        console.error(`  [erro] Não conseguiu ler ${implPath}: ${err.message}`);
        return false;
    }

    const cssStrings = coletarCssStrings(impl.css_componentes || {});
    if (cssStrings.length === 0) {
        console.log(`  [skip] Nenhuma string CSS encontrada`);
        return true;
    }

    console.log(`  ${cssStrings.length} blocos CSS encontrados`);

    const prompt = buildPrompt(nicho, cssStrings);
    let resposta;
    try {
        resposta = await gerarTextoComRetry(prompt);
    } catch (err) {
        console.error(`  [erro] Gemini falhou: ${err.message}`);
        return false;
    }

    const json = extrairJSON(resposta);
    if (!json || !Array.isArray(json.css_corrigido)) {
        console.error(`  [erro] JSON inválido ou sem css_corrigido. Resposta:\n${(resposta||'').substring(0, 300)}`);
        return false;
    }

    if (json.css_corrigido.length !== cssStrings.length) {
        console.error(`  [erro] Esperado ${cssStrings.length} blocos, recebido ${json.css_corrigido.length}`);
        return false;
    }

    // Aplicar substituições no objeto original
    for (let i = 0; i < cssStrings.length; i++) {
        const original = cssStrings[i];
        const corrigido = json.css_corrigido[i];
        if (typeof corrigido === 'string' && corrigido.length > 10) {
            setByPath(impl, `css_componentes.${original.caminho}`, corrigido);
        }
    }

    // Log das substituições
    if (Array.isArray(json.substituicoes) && json.substituicoes.length > 0) {
        console.log(`  ${json.substituicoes.length} substituições:`);
        json.substituicoes.slice(0, 5).forEach(s => {
            console.log(`    bloco[${s.bloco}]: ${s.de} → ${s.para}`);
        });
        if (json.substituicoes.length > 5) console.log(`    ... +${json.substituicoes.length - 5} mais`);
    } else {
        console.log(`  Nenhuma substituição necessária (CSS já usa variáveis)`);
    }

    fs.writeFileSync(implPath, JSON.stringify(impl, null, 2), 'utf-8');
    console.log(`  → salvo: ${path.relative(process.cwd(), implPath)}`);
    return true;
}

// ──────────────────────────────────────────────────────────────
// main
// ──────────────────────────────────────────────────────────────
async function main() {
    const rawArgs = process.argv.slice(2);
    const flags   = rawArgs.filter(a => a.startsWith('--'));
    const args    = rawArgs.filter(a => !a.startsWith('--'));

    const dryRun    = !flags.includes('--apply') || flags.includes('--dry-run');
    const delayFlag = flags.find(f => f.startsWith('--delay='));
    const pauseMs   = delayFlag ? parseInt(delayFlag.split('=')[1], 10) * 1000 : 10_000;

    const nichos = args.length > 0 ? args : exports.NICHOS_COM_CSS;
    const tempoEstimadoMin = ((nichos.length * pauseMs) / 60_000).toFixed(1);

    console.log(`\n🎨 CSS Var Fixer — ${nichos.length} nicho(s)`);
    console.log(`   Chamadas Gemini estimadas : ${nichos.length}`);
    console.log(`   Delay entre chamadas      : ${pauseMs / 1000}s`);
    console.log(`   Tempo total estimado      : ~${tempoEstimadoMin} min`);
    if (dryRun) console.log(`   [DRY-RUN] Nenhuma chamada real será feita.\n`);
    else console.log('');

    const resultados = { ok: [], erro: [] };

    for (let i = 0; i < nichos.length; i++) {
        const nicho = nichos[i];
        console.log(`[${i + 1}/${nichos.length}] ${nicho}`);

        if (dryRun) {
            console.log(`  [dry-run] Chamada Gemini ignorada`);
            resultados.ok.push(nicho);
        } else {
            const ok = await processarNicho(nicho);
            (ok ? resultados.ok : resultados.erro).push(nicho);
        }

        if (!dryRun && i < nichos.length - 1) {
            console.log(`  ⏳ Aguardando ${pauseMs / 1000}s antes da próxima chamada...`);
            await new Promise(r => setTimeout(r, pauseMs));
        }
    }

    console.log(`\n✅ Concluído: ${resultados.ok.length} ok | ${resultados.erro.length} com erro`);
    if (resultados.erro.length > 0) {
        console.log(`   Erros: ${resultados.erro.join(', ')}`);
    }
    if (resultados.ok.length > 0) {
        console.log('\n   Próximo passo:');
        console.log('   git add src/rag/rag-ia-compiler/pipeline/temas/tema-*-impl.json');
        console.log('   git commit -m "fix: replace hardcoded colors with --sl-* CSS vars in impl.json"');
    }
}

if (require.main === module) main().catch(err => {
    console.error('Erro fatal:', err);
    process.exit(1);
});
