interface VendorDirent {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
}
interface VendorFileSystem {
    existsSync(filename: string): boolean;
    readdirSync(directory: string, options: { withFileTypes: true }): VendorDirent[];
    readFileSync(filename: string, encoding: 'utf8'): string;
    statSync(filename: string): { isFile(): boolean; size: number };
}
interface VendorPath {
    join(...segments: string[]): string;
    relative(base: string, filename: string): string;
}
declare const __dirname: string;
declare const module: unknown;
declare const require: ((id: string) => unknown) & { main: unknown };
declare const process: { exit(code: number): never };

const fs = require('node:fs') as VendorFileSystem;
const path = require('node:path') as VendorPath;
const { ASSETS } = require('./vendorAssets') as {
    ASSETS: readonly { readonly dest: string }[];
};

/**
 * Verifica os href/src /vendor/ literais em views/**.ejs contra o manifesto
 * de copia e os arquivos publicados. Nao executa EJS nem muda arquivos.
 * Aceita ?v=<%= gitSha %>, mas recusa nomes dinamicos de assets.
 */
export function verificarReferenciasVendor(root: string = path.join(__dirname, '..')): boolean {
    const views = path.join(root, 'views');
    const allowed = new Set(ASSETS.map(asset => '/' + asset.dest));
    const errors: string[] = [];
    let templates = 0;
    let references = 0;

    if (!fs.existsSync(views)) {
        console.error('[vendorTemplateRefs] Pasta views/ ausente.');
        return false;
    }

    function visit(directory: string): void {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const filename = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                visit(filename);
                continue;
            }
            if (!entry.isFile() || !entry.name.endsWith('.ejs')) continue;
            templates++;
            const relative = path.relative(root, filename).replace(/\\/g, '/');
            // Comentarios HTML e EJS nao criam recursos no navegador.
            const source = fs.readFileSync(filename, 'utf8')
                .replace(/<%#[\s\S]*?%>/g, '')
                .replace(/<!--[\s\S]*?-->/g, '');
            const attributes = /\b(?:href|src)\s*=\s*(["'])([\s\S]*?)\1/gi;
            let matched: RegExpExecArray | null;
            while ((matched = attributes.exec(source)) !== null) {
                const raw = matched[2].trim();
                if (!raw.startsWith('/vendor/')) continue;
                references++;
                const url = raw.split(/[?#]/, 1)[0];
                if (!allowed.has(url)) {
                    errors.push(`${relative}: referencia nao prevista no manifesto: ${url}`);
                    continue;
                }
                const output = path.join(root, 'public', url.slice(1));
                try {
                    const file = fs.statSync(output);
                    if (!file.isFile() || file.size === 0) {
                        errors.push(`${relative}: arquivo vendor vazio ou invalido: ${url}`);
                    }
                } catch (_err) {
                    errors.push(`${relative}: arquivo vendor nao encontrado: ${url}`);
                }
            }
        }
    }

    try {
        visit(views);
    } catch (err) {
        errors.push(`Falha ao inspecionar views/: ${(err as Error).message}`);
    }
    if (templates === 0) errors.push('Nenhum template EJS encontrado em views/.');
    if (references === 0) errors.push('Nenhuma referencia /vendor/ encontrada nos templates EJS.');
    for (const error of errors) console.error('[vendorTemplateRefs] ' + error);
    if (errors.length) return false;
    console.log(`✓ [vendorTemplateRefs] ${references} referencias conferidas em ${templates} templates EJS.`);
    return true;
}

if (require.main === module && !verificarReferenciasVendor()) process.exit(1);
