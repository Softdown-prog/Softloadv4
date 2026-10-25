#!/usr/bin/env node
/**
 * Geração offline de variantes visuais para os temas Blogger.
 * Importação não faz requisição Gemini nem escreve no catálogo;
 * somente a execução explícita do CLI efetua a geração.
 */
export interface NichoMeta { descricao?: string; nicho?: string }
export interface GeneratedVariants { card_css?: unknown; hero_html?: unknown }
export interface ThemeBlockBundle {
    nicho: string;
    gerado_em: string;
    total_css: number;
    total_hero: number;
    card_css: string[];
    hero_html: string[];
}
interface FileOps {
    readFileSync(path: string, encoding: 'utf-8'): string;
    writeFileSync(path: string, content: string, encoding: 'utf-8'): void;
}
interface PathOps {
    join(...parts: string[]): string;
    relative(base: string, target: string): string;
}
declare const __dirname: string;
declare const module: unknown;
declare const require: ((id: string) => unknown) & { main: unknown };
declare const process: { argv: string[]; cwd(): string; exit(code: number): never };
declare function setTimeout(cb: () => void, milliseconds: number): unknown;


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

(require('dotenv') as { config(): void }).config();

const fs = require('fs') as FileOps;
const path = require('path') as PathOps;

// Importa gerarTexto após o dotenv carregar a key
const { gerarTexto } = require('../src/services/geminiService') as { gerarTexto(prompt: string): Promise<string> };

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

// Quantas variantes gerar por slot
export const CSS_VARIANTS = 5;
export const HERO_VARIANTS = 3;

// ──────────────────────────────────────────────────────────────
// buildPrompt — monta o prompt Gemini para um nicho específico
// ──────────────────────────────────────────────────────────────
export function buildPrompt(nicho: string, meta: NichoMeta): string {
    const descricao = (meta.descricao || nicho).substring(0, 200);
    const nichoLabel = meta.nicho || nicho;

    return `Você é um especialista em CSS e Bootstrap 5 para blogs. Gere variantes visuais para um blog do nicho: "${nichoLabel}".

CONTEXTO DO NICHO:
${descricao}

TAREFA:
Gere exatamente ${CSS_VARIANTS} variantes de CSS e ${HERO_VARIANTS} variantes de hero HTML para este nicho.

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

IMPORTANTE: card_css deve ter EXATAMENTE ${CSS_VARIANTS} strings. hero_html deve ter EXATAMENTE ${HERO_VARIANTS} strings.`;
}

// ──────────────────────────────────────────────────────────────
// extrairJSON — extrai JSON da resposta (Gemini às vezes retorna
// com ```json ... ``` ou com texto antes/depois)
// ──────────────────────────────────────────────────────────────
export function extrairJSON(texto: string): GeneratedVariants | null {
    // Remove markdown code fences
    let limpo = texto.trim();
    limpo = limpo.replace(/^```json\s*/i, '').replace(/\s*```\s*$/i, '');
    limpo = limpo.replace(/^```\s*/i, '').replace(/\s*```\s*$/i, '');

    // Tenta parsear direto
    try {
        return JSON.parse(limpo);
    } catch (_) {}

    // Tenta extrair o primeiro {...} do texto
    const match = limpo.match(/\{[\s\S]*\}/);
    if (match) {
        try {
            return JSON.parse(match[0]);
        } catch (_) {}
    }

    return null;
}

// ──────────────────────────────────────────────────────────────
// Validadores — mesmos critérios do carregarNichoImpl()
// ──────────────────────────────────────────────────────────────
export function validarCSS(str: unknown): str is string {
    if (typeof str !== 'string' || str.trim().length < 20) return false;
    // Sem sintaxe Blogger
    if (/\bdata:|b:|expr:/.test(str)) return false;
    // Sem placeholders mock
    if (/\[[A-Za-z][A-Za-z0-9_ :.-]*\]/.test(str)) return false;
    // Deve ter pelo menos uma regra CSS (chave abre)
    return str.includes('{') && str.includes('}');
}

export function validarHero(str: unknown): str is string {
    if (typeof str !== 'string' || str.trim().length < 30) return false;
    // Deve começar com tag HTML
    if (!/^[\s\n]*<[a-z]/i.test(str)) return false;
    // Sem sintaxe Blogger
    if (/\bdata:|b:|expr:/.test(str)) return false;
    // Sem placeholders mock
    if (/\[[A-Za-z][A-Za-z0-9_ :.-]*\]/.test(str)) return false;
    return true;
}

// ──────────────────────────────────────────────────────────────
// gerarBlocosParaNicho — gera e valida variantes para 1 nicho
// ──────────────────────────────────────────────────────────────
export async function gerarBlocosParaNicho(nicho: string): Promise<ThemeBlockBundle | null> {
    const metaPath = path.join(TEMAS_DIR, `tema-${nicho}-meta.json`);
    let meta: NichoMeta = {};
    try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as NichoMeta;
    } catch (_) {
        console.warn(`  [aviso] meta.json não encontrado para ${nicho} — usando defaults`);
    }

    const prompt = buildPrompt(nicho, meta);

    let resposta;
    try {
        resposta = await gerarTexto(prompt);
    } catch (err) {
        console.error(`  [erro] Gemini falhou para ${nicho}: ${(err as Error).message}`);
        return null;
    }

    const json = extrairJSON(resposta);
    if (!json) {
        console.error(`  [erro] JSON inválido para ${nicho}. Resposta:\n${resposta.substring(0, 200)}`);
        return null;
    }

    const cssValidos  = (Array.isArray(json.card_css)  ? json.card_css  : []).filter(validarCSS);
    const heroValidos = (Array.isArray(json.hero_html) ? json.hero_html : []).filter(validarHero);

    console.log(`  css: ${cssValidos.length}/${CSS_VARIANTS} válidas | hero: ${heroValidos.length}/${HERO_VARIANTS} válidas`);

    if (cssValidos.length === 0 && heroValidos.length === 0) {
        console.error(`  [erro] Nenhum bloco válido gerado para ${nicho}`);
        return null;
    }

    return {
        nicho,
        gerado_em:  new Date().toISOString(),
        total_css:  cssValidos.length,
        total_hero: heroValidos.length,
        card_css:   cssValidos,
        hero_html:  heroValidos,
    };
}

// ──────────────────────────────────────────────────────────────
// salvarBlocos — escreve o arquivo de blocos no disco
// ──────────────────────────────────────────────────────────────
export function salvarBlocos(nicho: string, blocos: ThemeBlockBundle): void {
    const outPath = path.join(TEMAS_DIR, `tema-${nicho}-blocks.json`);
    fs.writeFileSync(outPath, JSON.stringify(blocos, null, 2), 'utf-8');
    console.log(`  → salvo: ${path.relative(process.cwd(), outPath)}`);
}

// ──────────────────────────────────────────────────────────────
// main
// ──────────────────────────────────────────────────────────────
export async function main(): Promise<void> {
    const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
    const nichos = args.length > 0 ? args : TODOS_OS_NICHOS;
    const pauseMs = 2000; // pausa entre chamadas para evitar rate limit

    console.log(`\n🔧 Block Worker — ${nichos.length} nicho(s) × ${CSS_VARIANTS} css + ${HERO_VARIANTS} hero\n`);

    const resultados: { ok: string[]; erro: string[] } = { ok: [], erro: [] };

    for (let i = 0; i < nichos.length; i++) {
        const nicho = nichos[i];
        console.log(`[${i + 1}/${nichos.length}] ${nicho}`);

        const blocos = await gerarBlocosParaNicho(nicho);
        if (blocos) {
            salvarBlocos(nicho, blocos);
            resultados.ok.push(nicho);
        } else {
            resultados.erro.push(nicho);
        }

        // Pausa entre nichos para não estourar rate limit
        if (i < nichos.length - 1) {
            await new Promise<void>(r => setTimeout(r, pauseMs));
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

if (require.main === module) main().catch((err: Error) => {
    console.error('Erro fatal:', err);
    process.exit(1);
});
