// Protege a identidade do Softload nas fontes renderizadas e no bundle
// enviado ao navegador. Não altera nomes de modelos nem a API backend.
interface BrandingDirent {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
}
interface BrandingFS {
    existsSync(filename: string): boolean;
    statSync(filename: string): { isFile(): boolean };
    readdirSync(dirname: string, options: { withFileTypes: true }): BrandingDirent[];
    readFileSync(filename: string, encoding: 'utf8'): string;
}
interface BrandingPath {
    resolve(...parts: string[]): string;
    join(...parts: string[]): string;
    relative(from: string, to: string): string;
    extname(filename: string): string;
    sep: string;
}
declare const __dirname: string;
declare const module: unknown;
declare const process: { exitCode?: number };
declare const require: ((name: string) => unknown) & { main: unknown };

const fs = require('node:fs') as BrandingFS;
const path = require('node:path') as BrandingPath;
const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['frontend', 'views', 'public/css', 'public/js', 'public/dist/assets', 'src/routes/adminRoutes.js', 'src/solaris/rag'];
const SCAN_EXTS = new Set(['.jsx', '.tsx', '.js', '.mjs', '.ts', '.ejs', '.html', '.css', '.svg', '.json']);
const BRAND = /chat[\s_-]*gpt/gi;
// Também rejeita a antiga sigla GPT como rótulo visível nas telas,
// mas preserva identificadores internos da API (gpt-5.4, creditosGpt etc.).
const VISIBLE_GPT = /\bGPT\b/g;
// Não permitir nomes fictícios para o provedor sem saldo: só Gemini é
// oferecido na UI. O id interno da API pode permanecer no backend.
const DISABLED_PROVIDER = /IA\s+Avan[cç]ada|gpt-5\.4/gi;

export interface BrandingReport {
    readonly scanned: number;
    readonly violations: readonly string[];
}

/** Varredura deterministica e sem efeitos colaterais; root injetavel para testes. */
export function auditarBranding(root: string = ROOT): BrandingReport {
    const violations: string[] = [];
    let scanned = 0;

    function scanFile(file: string): void {
        if (!SCAN_EXTS.has(path.extname(file))) return;
        // No RAG só os JSONs de conteúdo são exibidos/recuperados para o usuário.
        // Identificadores legados em testes e no código interno não são rótulos de UI.
        if (file.startsWith(path.join(root, 'src/solaris/rag') + path.sep) && path.extname(file) !== '.json') return;
        scanned++;
        const content = fs.readFileSync(file, 'utf8');
        const rel = path.relative(root, file).replaceAll(path.sep, '/');
        BRAND.lastIndex = 0;
        for (const match of content.matchAll(BRAND)) {
            const line = content.slice(0, match.index).split('\n').length;
            violations.push(rel + ':' + line + ': ' + match[0]);
        }
        if (rel.startsWith('frontend/') || rel.startsWith('views/') || rel === 'public/dist/assets/main.js') {
            for (const match of content.matchAll(VISIBLE_GPT)) {
                const line = content.slice(0, match.index).split('\n').length;
                violations.push(rel + ':' + line + ': rótulo antigo ' + match[0]);
            }
            for (const match of content.matchAll(DISABLED_PROVIDER)) {
                const line = content.slice(0, match.index).split('\n').length;
                violations.push(rel + ':' + line + ': modelo indisponível exposto ' + match[0]);
            }
        }
    }

    function walk(dir: string): void {
        if (!fs.existsSync(dir)) return;
        if (fs.statSync(dir).isFile()) return scanFile(dir);
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const current = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(current);
            else if (entry.isFile()) scanFile(current);
        }
    }

    for (const dir of SCAN_DIRS) walk(path.join(root, dir));
    return { scanned, violations };
}

// Mantem a verificacao do workflow de deploy, sem executar quando importado.
if (require.main === module) {
    const { scanned, violations } = auditarBranding();
    if (violations.length) {
        console.error('[BRANDING] Referências ao ChatGPT no frontend:');
        for (const violation of violations) console.error('  ' + violation);
        process.exitCode = 1;
    } else {
        console.log('[BRANDING] OK — ' + scanned + ' arquivos de frontend/HTML/CSS/bundle, nenhuma referência ao ChatGPT.');
    }
}
