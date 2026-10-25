/**
 * Metadados escritos pelo Docker no diretório raiz da imagem.
 * Em ambiente local, arquivos ausentes não causam falhas no servidor.
 */
interface BuildInfoFileSystem {
    readFileSync(file: string, encoding: 'utf-8'): string;
}
interface BuildInfoPath {
    join(...segments: string[]): string;
}
declare const __dirname: string;
declare const require: (id: string) => unknown;

const fs = require('fs') as BuildInfoFileSystem;
const path = require('path') as BuildInfoPath;

function lerArquivo(nome: string): string | null {
    try {
        const conteudo = fs.readFileSync(path.join(__dirname, '../..', nome), 'utf-8').trim();
        return conteudo || null;
    } catch (_) {
        return null;
    }
}

export const gitSha: string = lerArquivo('GIT_SHA') || 'dev-local';
export const gitDate: string | null = lerArquivo('GIT_DATE') || null;
export const buildTime: string | null = lerArquivo('BUILD_TIME') || null;
