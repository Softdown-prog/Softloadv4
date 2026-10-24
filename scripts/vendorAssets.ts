/**
 * Copia para public/vendor/ as bibliotecas front-end instaladas pelo npm.
 * Este script e' executado no postinstall e dentro do stage frontend-build
 * do Docker; os artefatos copiados nao sao versionados.
 *
 * Uso: node scripts/vendorAssets.js
 */

interface VendorAsset { readonly src: string; readonly dest: string }
interface VendorBytes extends Uint8Array { equals(other: Uint8Array): boolean }
interface VendorFileSystem {
    existsSync(path: string): boolean;
    mkdirSync(path: string, options: { recursive: true }): unknown;
    copyFileSync(src: string, dest: string): void;
    readFileSync(path: string): VendorBytes;
}
interface VendorPath {
    join(...parts: string[]): string;
    dirname(path: string): string;
}
declare const __dirname: string;
declare const module: unknown;
declare const process: { argv: string[]; exit(code: number): never };
declare const require: ((id: string) => unknown) & { main: unknown };

const fs = require('node:fs') as VendorFileSystem;
const path = require('node:path') as VendorPath;
const ROOT = path.join(__dirname, '..');

export const ASSETS: readonly VendorAsset[] = [
    { src: 'node_modules/bootstrap/dist/css/bootstrap.min.css', dest: 'vendor/bootstrap/css/bootstrap.min.css' },
    { src: 'node_modules/bootstrap/dist/js/bootstrap.bundle.min.js', dest: 'vendor/bootstrap/js/bootstrap.bundle.min.js' },
    { src: 'node_modules/chart.js/dist/chart.umd.min.js', dest: 'vendor/chart.js/chart.umd.min.js' },
];

/**
 * Deterministic copy from the installed package bytes, no CDN/download.
 * Returns false if any source is absent; missing copies never silently pass.
 * Injecting root makes the real copying behavior testable without node_modules.
 */
export function vendorizarAssets(root: string = ROOT): boolean {
    let falhou = false;
    for (const { src, dest } of ASSETS) {
        const srcPath = path.join(root, src);
        const destPath = path.join(root, 'public', dest);
        if (!fs.existsSync(srcPath)) {
            console.error(`❌ [vendorAssets] Fonte ausente: ${src} — dependência não instalada?`);
            falhou = true;
            continue;
        }
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        fs.copyFileSync(srcPath, destPath);
        console.log(`✓ [vendorAssets] ${src} → public/${dest}`);
    }
    return !falhou;
}

/**
 * Gate independente do postinstall: compara os bytes reais que serao
 * servidos ao navegador com as bibliotecas efetivamente instaladas.
 * Nunca altera public/vendor; arquivos ausentes, vazios ou divergentes
 * provocam falha antes da montagem da imagem de producao.
 */
export function verificarAssetsVendorizados(root: string = ROOT): boolean {
    let valido = true;
    for (const { src, dest } of ASSETS) {
        const srcPath = path.join(root, src);
        const destPath = path.join(root, 'public', dest);
        if (!fs.existsSync(srcPath)) {
            console.error(`❌ [vendorAssets] Fonte ausente na verificação: ${src}`);
            valido = false;
            continue;
        }
        if (!fs.existsSync(destPath)) {
            console.error(`❌ [vendorAssets] Arquivo publicado ausente: public/${dest}`);
            valido = false;
            continue;
        }
        try {
            const origem = fs.readFileSync(srcPath);
            const publicado = fs.readFileSync(destPath);
            if (!origem.byteLength || origem.byteLength !== publicado.byteLength || !origem.equals(publicado)) {
                console.error(`❌ [vendorAssets] Arquivo vazio ou divergente da fonte: public/${dest}`);
                valido = false;
                continue;
            }
            console.log(`✓ [vendorAssets] Integridade verificada: public/${dest}`);
        } catch (err) {
            console.error(`❌ [vendorAssets] Falha de leitura em public/${dest}: ${(err as Error).message}`);
            valido = false;
        }
    }
    return valido;
}

// Mantem a entrada de postinstall historica, mas nao executa copia ao importar.
if (require.main === module) {
    const verificar = process.argv.includes('--verify');
    const sucesso = verificar ? verificarAssetsVendorizados() : vendorizarAssets();
    if (!sucesso) {
        console.error('🚨 [vendorAssets] Um ou mais assets não puderam ser vendorizados ou verificados. Ver erros acima.');
        process.exit(1);
    }
}
