/**
 * npm run extract -- <arquivo.xml>
 * npm run extract:all -- [diretorio]
 *
 * CLI sobre extrairTemplate existente: leitura isolada de XML por arquivo,
 * resultado completo no modo unitario e somente _meta no modo --all.
 */
interface ExtractFileSystem {
    readFileSync(filename: string, encoding: 'utf8'): string;
    existsSync(filename: string): boolean;
    statSync(filename: string): { isDirectory(): boolean };
    readdirSync(directory: string): string[];
}
interface ExtractPath {
    join(...parts: string[]): string;
    resolve(...parts: string[]): string;
}
export interface ExtractedTemplate {
    readonly _meta: unknown;
    readonly [key: string]: unknown;
}
export interface ExtractedFile { readonly nome: string; readonly meta: unknown }
export interface ExtractError { readonly nome: string; readonly erro: string }
export interface ExtractDirectoryResult {
    readonly extraidos: ExtractedFile[];
    readonly erros: ExtractError[];
}
declare const module: unknown;
declare const require: ((name: string) => unknown) & { main: unknown };
declare const process: { argv: string[]; exit(status: number): never };
const fs = require('fs') as ExtractFileSystem;
const path = require('path') as ExtractPath;
const { extrairTemplate } = require('../src/core/templateExtractor') as {
    extrairTemplate(xml: string): ExtractedTemplate;
};

export function extrairArquivo(caminho: string): ExtractedTemplate {
    const xml = fs.readFileSync(caminho, 'utf8');
    return extrairTemplate(xml);
}

export function extrairDiretorio(dir: string): ExtractDirectoryResult {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        throw new Error(`Diretório não encontrado: ${dir}`);
    }

    const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith('.xml'));
    const extraidos: ExtractedFile[] = [];
    const erros: ExtractError[] = [];

    for (const nome of arquivos) {
        const caminho = path.join(dir, nome);
        try {
            extraidos.push({ nome, meta: extrairArquivo(caminho)._meta });
        } catch (err) {
            erros.push({ nome, erro: (err as Error).message });
        }
    }

    return { extraidos, erros };
}

function main(): void {
    const args = process.argv.slice(2);
    const modoTodos = args.includes('--all');
    const posicional = args.find((a) => !a.startsWith('--'));

    if (modoTodos) {
        const dir = path.resolve(posicional || '.');
        const { extraidos, erros } = extrairDiretorio(dir);

        if (extraidos.length === 0 && erros.length === 0) {
            console.log(`Nenhum .xml encontrado em ${dir}`);
            process.exit(0);
        }

        for (const { nome, meta } of extraidos) {
            console.log(`\n=== ${nome} ===`);
            console.log(JSON.stringify(meta, null, 2));
        }

        if (erros.length) {
            console.log(`\n❌ falhas (${erros.length}):`);
            for (const { nome, erro } of erros) console.log(`   - ${nome}: ${erro}`);
        }

        process.exit(erros.length > 0 ? 1 : 0);
        return;
    }

    if (!posicional) {
        console.error('Uso: npm run extract -- <arquivo.xml>\n   ou: npm run extract:all -- [diretorio]');
        process.exit(1);
    }

    const caminho = path.resolve(posicional);
    if (!fs.existsSync(caminho)) {
        console.error(`Arquivo não encontrado: ${caminho}`);
        process.exit(1);
    }

    try {
        console.log(JSON.stringify(extrairArquivo(caminho), null, 2));
    } catch (err) {
        console.error(`Falha ao extrair ${caminho}: ${(err as Error).message}`);
        process.exit(1);
    }
}

if (require.main === module) main();
