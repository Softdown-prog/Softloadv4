#!/usr/bin/env node
/**
 * Adiciona variantes CSS e Hero para temas Blogger.
 * Execução é dry-run por padrão; --apply ativa chamadas pagas ao Gemini.
 */
export interface NichoMeta { descricao?: string; nicho?: string }
export interface ExistingBundle { card_css: string[]; hero_html: string[] }
export interface AppendVariants { card_css?: unknown; hero_html?: unknown }
export interface ThemeBlockBundle extends ExistingBundle {
  nicho: string; gerado_em: string; total_css: number; total_hero: number;
}
interface FileOps {
  readFileSync(file: string, encoding: 'utf-8'): string;
  writeFileSync(file: string, value: string, encoding: 'utf-8'): void;
}
interface PathOps { join(...parts: string[]): string }
declare const __dirname: string;
declare const module: unknown;
declare const require: ((id: string) => unknown) & { main: unknown };
declare const process: { argv: string[]; exit(code: number): never };
declare const console: { log(...x: unknown[]): void; warn(...x: unknown[]): void; error(...x: unknown[]): void };
declare function setTimeout(callback: () => void, delay: number): unknown;


// ============================================================
// BLOCK APPENDER — Gera variantes ADICIONAIS de CSS e Hero
// para cada nicho, garantindo que sejam DISTINTAS das existentes.
//
// Lê os blocks.json atuais, extrai os nomes dos estilos já gerados
// e passa para o Gemini como restrição: "NÃO repita esses estilos".
//
// Resultado: total_css vai de 5 → 10, total_hero de 3 → 5.
//
// Uso:
//   node scripts/appendBlocks.js              # todos os 14 nichos
//   node scripts/appendBlocks.js gamer-playerone
// ============================================================

(require('dotenv') as { config(): void }).config();

const fs = require('fs') as FileOps;
const path = require('path') as PathOps;
const { gerarTexto } = require('../src/services/geminiService') as { gerarTexto(prompt: string): Promise<string> };

// ──────────────────────────────────────────────────────────────
// Rate-limit wrapper — reintenta em 429/quota com backoff
// ──────────────────────────────────────────────────────────────
export async function gerarTextoComRetry(prompt: string, maxRetries = 3): Promise<string> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await gerarTexto(prompt);
        } catch (err) {
            const msg = ((err as Error).message || '').toLowerCase();
            const is429 = msg.includes('429') || msg.includes('quota') || msg.includes('rate limit');
            if (is429 && attempt < maxRetries) {
                const waitMs = Math.pow(2, attempt + 1) * 10_000; // 20s, 40s, 80s
                console.warn(`  ⚠️  429/quota — aguardando ${waitMs / 1000}s (tentativa ${attempt + 1}/${maxRetries})...`);
                await new Promise<void>(r => setTimeout(r, waitMs));
            } else {
                throw err;
            }
        }
    }
    throw new Error('Tentativas Gemini esgotadas');
}

const TEMAS_DIR = path.join(__dirname, '../src/rag/rag-ia-compiler/pipeline/temas');

export const TODOS_OS_NICHOS: string[] = [
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

// Quantas variantes NOVAS gerar por slot
export const CSS_NOVAS = 5;
export const HERO_NOVAS = 2;

export function extrairJSON(texto: string): AppendVariants | null {
    let limpo = texto.trim();
    limpo = limpo.replace(/^```json\s*/i, '').replace(/\s*```\s*$/i, '');
    limpo = limpo.replace(/^```\s*/i, '').replace(/\s*```\s*$/i, '');
    try { return JSON.parse(limpo) as AppendVariants; } catch (_) {}
    const match = limpo.match(/\{[\s\S]*\}/);
    if (match) { try { return JSON.parse(match[0]) as AppendVariants; } catch (_) {} }
    return null;
}

export function validarCSS(str: unknown): str is string {
    if (typeof str !== 'string' || str.trim().length < 20) return false;
    if (/\bdata:|b:|expr:/.test(str)) return false;
    if (/\[[A-Za-z][A-Za-z0-9_ :.-]*\]/.test(str)) return false;
    return str.includes('{') && str.includes('}');
}

export function validarHero(str: unknown): str is string {
    if (typeof str !== 'string' || str.trim().length < 30) return false;
    if (!/^[\s\n]*<[a-z]/i.test(str)) return false;
    if (/\bdata:|b:|expr:/.test(str)) return false;
    if (/\[[A-Za-z][A-Za-z0-9_ :.-]*\]/.test(str)) return false;
    return true;
}

// Extrai o nome do estilo do comentário inicial: "/* Variante 1: Neon Glow */" → "Neon Glow"
export function extrairNomeEstilo(css: string): string | null {
    const m = css.match(/\/\*[^*]*Variante\s*\d+\s*:\s*([^*]+)\*\//i);
    return m ? m[1].trim() : null;
}

// ──────────────────────────────────────────────────────────────
// buildPromptAppend — prompt que pede variantes DISTINTAS
// ──────────────────────────────────────────────────────────────
export function buildPromptAppend(nicho: string, meta: NichoMeta, estilosExistentes: string[]): string {
    const descricao = (meta.descricao || nicho).substring(0, 200);
    const nichoLabel = meta.nicho || nicho;
    const estilosStr = estilosExistentes.length > 0
        ? estilosExistentes.map((e, i) => `  ${i + 1}. ${e}`).join('\n')
        : '  (nenhum)';

    return `Você é um especialista em CSS e Bootstrap 5 para blogs. Gere variantes visuais NOVAS e DISTINTAS para um blog do nicho: "${nichoLabel}".

CONTEXTO DO NICHO:
${descricao}

ESTILOS JÁ EXISTENTES (NÃO REPITA ESTES):
${estilosStr}

TAREFA:
Gere exatamente ${CSS_NOVAS} variantes de CSS e ${HERO_NOVAS} variantes de hero HTML que sejam COMPLETAMENTE DIFERENTES dos estilos listados acima.

EXEMPLOS DE ESTILOS AINDA NÃO USADOS (use como inspiração):
- Neumorphism (sombras suaves internas/externas sem borda)
- Material Design (elevação com box-shadow, ripple, cores vibrantes)
- Skeuomorphic (texturas realistas, gradientes profundos)
- Editorial Magazine (tipografia grande, sem imagem, texto como elemento visual)
- Swiss/International (grid rígido, sans-serif bold, sem ornamentos)
- Art Deco (linhas geométricas, dourado, simétrico)
- Vapor Wave (gradiente rosa-roxo, fontes estilizadas, anos 80)
- Organic/Blob (bordas irregulares, formas fluidas, cores terrosas)
- Dark Editorial (fundo quase-preto, tipografia serifada, cores âmbar)
- Brutalist Minimal (sem border-radius, fontes mono, apenas preto/branco)
- Newspaper Column (colunas serifadas, drop cap, linha divisória horizontal)
- Frosted Terminal (fundo escuro, texto verde/âmbar, fonte mono, scan lines)

REGRAS OBRIGATÓRIAS:
1. Use APENAS var(--sl-primary) para cor de destaque principal
2. Use var(--sl-bg-body) para fundo de página
3. Use var(--sl-card-bg) para fundo de cards
4. Use var(--sl-text-main) para texto principal
5. Use var(--sl-footer-bg) para rodapé
6. Bootstrap 5 — use classes nativas (card, btn, badge, row, col-*)
7. ZERO sintaxe Blogger (sem b:, data:, expr:)
8. Cada variante deve ter estilo VISUAL GENUINAMENTE DISTINTO dos existentes E entre si
9. Hero HTML: HTML estático completo (sem placeholders como [TITULO])
10. Hero HTML deve começar com <section ou <div

Retorne SOMENTE JSON válido, sem markdown:
{
  "card_css": [
    "/* Variante Nova 1: [nome do estilo diferente] */\\n.sl-card { ... }\\n.sl-card:hover { ... }",
    "/* Variante Nova 2: [nome do estilo diferente] */\\n.sl-card { ... }",
    "/* Variante Nova 3: [nome do estilo diferente] */\\n.sl-card { ... }",
    "/* Variante Nova 4: [nome do estilo diferente] */\\n.sl-card { ... }",
    "/* Variante Nova 5: [nome do estilo diferente] */\\n.sl-card { ... }"
  ],
  "hero_html": [
    "<section class='sl-hero ...'> ... </section>",
    "<div class='sl-hero ...'> ... </div>"
  ]
}

IMPORTANTE: card_css deve ter EXATAMENTE ${CSS_NOVAS} strings. hero_html deve ter EXATAMENTE ${HERO_NOVAS} strings.`;
}

// ──────────────────────────────────────────────────────────────
// appendBlocosParaNicho
// ──────────────────────────────────────────────────────────────
export async function appendBlocosParaNicho(nicho: string): Promise<boolean> {
    const blocksPath = path.join(TEMAS_DIR, `tema-${nicho}-blocks.json`);
    let existente: ExistingBundle;
    try {
        existente = JSON.parse(fs.readFileSync(blocksPath, 'utf-8')) as ExistingBundle;
    } catch (_) {
        console.warn(`  [aviso] blocks.json não encontrado — criando do zero`);
        existente = { card_css: [], hero_html: [] };
    }

    const metaPath = path.join(TEMAS_DIR, `tema-${nicho}-meta.json`);
    let meta: NichoMeta = {};
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as NichoMeta; } catch (_) {}

    // Extrai nomes dos estilos existentes para passar ao Gemini
    const estilosExistentes = (existente.card_css || [])
        .map(extrairNomeEstilo)
        .filter((name): name is string => Boolean(name));

    console.log(`  existente: ${(existente.card_css||[]).length} css | ${(existente.hero_html||[]).length} hero`);
    console.log(`  estilos existentes: ${estilosExistentes.slice(0,3).join(', ')}${estilosExistentes.length>3?'...':''}`);

    const prompt = buildPromptAppend(nicho, meta, estilosExistentes);

    let resposta: string;
    try {
        resposta = await gerarTextoComRetry(prompt);
    } catch (err) {
        console.error(`  [erro] Gemini falhou: ${(err as Error).message}`);
        return false;
    }

    const json = extrairJSON(resposta);
    if (!json) {
        console.error(`  [erro] JSON inválido. Resposta:\n${(resposta||'').substring(0, 200)}`);
        return false;
    }

    const cssNovos  = (Array.isArray(json.card_css)  ? json.card_css  : []).filter(validarCSS);
    const heroNovos = (Array.isArray(json.hero_html) ? json.hero_html : []).filter(validarHero);

    console.log(`  novos válidos: ${cssNovos.length}/${CSS_NOVAS} css | ${heroNovos.length}/${HERO_NOVAS} hero`);

    if (cssNovos.length === 0 && heroNovos.length === 0) {
        console.error(`  [erro] Nenhum bloco novo válido`);
        return false;
    }

    // Mescla com existentes
    const cssTotal  = [...(existente.card_css  || []), ...cssNovos];
    const heroTotal = [...(existente.hero_html || []), ...heroNovos];

    const blocos: ThemeBlockBundle = {
        nicho,
        gerado_em:   new Date().toISOString(),
        total_css:   cssTotal.length,
        total_hero:  heroTotal.length,
        card_css:    cssTotal,
        hero_html:   heroTotal,
    };

    fs.writeFileSync(blocksPath, JSON.stringify(blocos, null, 2), 'utf-8');
    console.log(`  → salvo: ${cssTotal.length} css total | ${heroTotal.length} hero total`);
    return true;
}

// ──────────────────────────────────────────────────────────────
// main
// ──────────────────────────────────────────────────────────────
export async function main(): Promise<void> {
    const rawArgs = process.argv.slice(2);
    const flags   = rawArgs.filter(a => a.startsWith('--'));
    const args    = rawArgs.filter(a => !a.startsWith('--'));

    const dryRun = !flags.includes('--apply') || flags.includes('--dry-run');
    const delayFlag = flags.find(f => f.startsWith('--delay='));
    const pauseMs   = delayFlag ? parseInt(delayFlag.split('=')[1], 10) * 1000 : 10_000;

    const nichos = args.length > 0 ? args : TODOS_OS_NICHOS;
    const totalChamadas = nichos.length; // 1 chamada Gemini por nicho
    const tempoEstimadoMin = ((totalChamadas * pauseMs) / 60_000).toFixed(1);

    console.log(`\n🎨 Block Appender — ${nichos.length} nicho(s) × +${CSS_NOVAS} css +${HERO_NOVAS} hero`);
    console.log(`   Chamadas Gemini estimadas : ${totalChamadas}`);
    console.log(`   Delay entre chamadas      : ${pauseMs / 1000}s`);
    console.log(`   Tempo total estimado      : ~${tempoEstimadoMin} min`);
    if (dryRun) console.log(`   [DRY-RUN] Nenhuma chamada real será feita.\n`);
    else console.log('');

    const resultados: { ok: string[]; erro: string[] } = { ok: [], erro: [] };

    for (let i = 0; i < nichos.length; i++) {
        const nicho = nichos[i];
        console.log(`[${i + 1}/${nichos.length}] ${nicho}`);

        if (dryRun) {
            console.log(`  [dry-run] Chamada Gemini ignorada`);
            resultados.ok.push(nicho);
        } else {
            const ok = await appendBlocosParaNicho(nicho);
            (ok ? resultados.ok : resultados.erro).push(nicho);
        }

        if (!dryRun && i < nichos.length - 1) {
            console.log(`  ⏳ Aguardando ${pauseMs / 1000}s antes da próxima chamada...`);
            await new Promise<void>(r => setTimeout(r, pauseMs));
        }
    }

    console.log(`\n✅ Concluído: ${resultados.ok.length} ok | ${resultados.erro.length} com erro`);
    if (resultados.erro.length > 0) console.log(`   Erros: ${resultados.erro.join(', ')}`);
    if (resultados.ok.length > 0) {
        console.log(`\n   Próximo passo:`);
        console.log(`   git add src/rag/rag-ia-compiler/pipeline/temas/*-blocks.json`);
        console.log(`   git commit -m "feat: append block variants — 10 css + 5 hero per nicho"`);
    }
}

if (require.main === module) main().catch(err => { console.error('Erro fatal:', err); process.exit(1); });
