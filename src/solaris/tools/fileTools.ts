/** All relative paths are checked against the project root. */
export interface FileWriteResult { ok: true; caminhoAbsoluto: string }
export type FileDeleteResult = { ok: true } | { ok: false; erro: string };
export type FileReadResult = { ok: true; conteudo: string } | { ok: false; erro: string; binario?: boolean; tamanhoBytes?: number };
export interface PersistableFile { caminho: string; conteudo: Buffer }
export interface FileSearchMatch { caminho: string; linha: number; trecho: string }
export type FileSearchResult = { erro: string } | { termo: string; totalEncontrado: number; truncado: boolean; ocorrencias: FileSearchMatch[] };
export interface GeminiFileToolDeclaration {
    name: string; description: string;
    parameters: { type: string; required?: string[]; properties: Record<string, unknown> };
}
interface ArchiveWriter {
    on(event: 'data', callback: (chunk: Buffer) => void): ArchiveWriter;
    on(event: 'error', callback: (error: Error) => void): ArchiveWriter;
    on(event: 'end', callback: () => void): ArchiveWriter;
    append(stream: import('node:fs').ReadStream, opts: { name: string }): unknown;
    finalize(): unknown;
}
declare function require(id: string): unknown;
// ============================================================
// SOLARIS FILE TOOLS (Fase 1)
// ============================================================
// Ferramentas determinísticas de arquivo — createHtml/createCss/createJs/
// createZip/readProject/scanProject do roadmap. Usadas HOJE de duas
// formas:
//   1. Chamadas DIRETO pelo Orquestrador (pipeline/orchestrator.js) — o
//      manifesto já decide determinísticamente qual arquivo gerar e
//      quando, então não precisa do modelo "decidir" invocar a
//      ferramenta (mesmo princípio #5 do CLAUDE.md: IA só entra onde
//      não há alternativa determinística viável).
//   2. Usadas como implementação (não como schema) pelos loops de
//      tool-calling reais: pipeline/projectInspector.js (SOMENTE
//      LEITURA — lerArquivo/listarProjeto/buscarNoProjeto) e
//      pipeline/projectEditor.js (LEITURA + ESCRITA — os mesmos três
//      mais criarArquivo/deletarArquivo). Ambos declaram seu próprio
//      schema de ferramenta no formato plain-object que
//      modelRouter.executarTarefaComFerramentas espera — o
//      FUNCTION_DECLARATIONS abaixo (formato Type do SDK) é
//      anterior a essa wiring real e ficou órfão; mantido só porque
//      fileTools.test.js ainda o exercita, não fingir que é o schema
//      em uso.
//
// Toda escrita/leitura é confinada a um baseDir (guardado contra path
// traversal — "../" ou caminho absoluto nunca escapa do projeto) —
// entrada de caminho pode vir de um manifesto gerado por IA, tratada
// como não-confiável.
// ============================================================

const fs = require('fs') as typeof import('node:fs');
const path = require('path') as typeof import('node:path');
const archiver = require('archiver') as (format: 'zip', opts: { zlib: { level: number } }) => ArchiveWriter;
const { Type } = require('@google/genai') as { Type: Record<string, string> };

/** Resolve `caminhoRelativo` dentro de `baseDir`, garantindo que o
 *  resultado não escapa do baseDir (path traversal). Lança se escapar —
 *  achado real de segurança: caminho vem de manifesto gerado por IA,
 *  entrada não-confiável, nunca deve tocar filesystem fora do projeto. */
export function _resolverSeguro(baseDir: string, caminhoRelativo: unknown): string {
    if (typeof caminhoRelativo !== 'string' || !caminhoRelativo.trim()) {
        throw new Error('[SOLARIS-FILETOOLS] caminho vazio ou inválido.');
    }
    const baseAbs = path.resolve(baseDir);
    const alvoAbs = path.resolve(baseAbs, caminhoRelativo);
    if (alvoAbs !== baseAbs && !alvoAbs.startsWith(baseAbs + path.sep)) {
        throw new Error(`[SOLARIS-FILETOOLS] caminho "${caminhoRelativo}" escapa do diretório do projeto — recusado.`);
    }
    return alvoAbs;
}

/** Cria/sobrescreve um arquivo dentro do projeto, criando diretórios
 *  intermediários conforme necessário. Retorna { ok, caminhoAbsoluto }. */
export function criarArquivo(baseDir: string, caminhoRelativo: string, conteudo: string | Buffer | null | undefined): FileWriteResult {
    const alvoAbs = _resolverSeguro(baseDir, caminhoRelativo);
    fs.mkdirSync(path.dirname(alvoAbs), { recursive: true });
    fs.writeFileSync(alvoAbs, conteudo ?? '', 'utf-8');
    return { ok: true, caminhoAbsoluto: alvoAbs };
}

export const criarHtml = (baseDir: string, caminho: string, conteudo: string) => criarArquivo(baseDir, caminho, conteudo);
export const criarCss  = (baseDir: string, caminho: string, conteudo: string) => criarArquivo(baseDir, caminho, conteudo);
export const criarJs   = (baseDir: string, caminho: string, conteudo: string) => criarArquivo(baseDir, caminho, conteudo);

/** Apaga um arquivo do projeto. Nunca lança — path traversal ou arquivo
 *  ausente viram { ok:false, erro } (mesmo contrato de lerArquivo/
 *  criarArquivo — entrada de caminho vem de manifesto/proposta gerada
 *  por IA, tratada como não-confiável). */
export function deletarArquivo(baseDir: string, caminhoRelativo: string): FileDeleteResult {
    let alvoAbs;
    try {
        alvoAbs = _resolverSeguro(baseDir, caminhoRelativo);
    } catch (e) {
        return { ok: false, erro: (e as Error).message };
    }
    if (!fs.existsSync(alvoAbs) || !fs.statSync(alvoAbs).isFile()) {
        return { ok: false, erro: `arquivo "${caminhoRelativo}" não existe no projeto.` };
    }
    fs.unlinkSync(alvoAbs);
    return { ok: true };
}

/** Lê um arquivo do projeto. Nunca lança por arquivo ausente — retorna
 *  { ok:false, erro } (entrada externa, resultado esperado a reportar). */
export function lerArquivo(baseDir: string, caminhoRelativo: string): FileReadResult {
    let alvoAbs;
    try {
        alvoAbs = _resolverSeguro(baseDir, caminhoRelativo);
    } catch (e) {
        return { ok: false, erro: (e as Error).message };
    }
    if (!fs.existsSync(alvoAbs) || !fs.statSync(alvoAbs).isFile()) {
        return { ok: false, erro: `arquivo "${caminhoRelativo}" não existe no projeto.` };
    }
    const bytes = fs.readFileSync(alvoAbs);
    if (!(require('node:buffer') as typeof import('node:buffer')).isUtf8(bytes) || bytes.includes(0) || /\.(png|gif|jpe?g|webp|ogg|wav|mp3|zip|woff2?)$/i.test(caminhoRelativo)) {
        return { ok: false, binario: true, tamanhoBytes: bytes.length, erro: 'Arquivo binário: use o caminho no projeto, não leitura como texto.' };
    }
    return { ok: true, conteudo: bytes.toString('utf8') };
}

/** Preserve all bytes for storage; text inspection deliberately skips binaries. */
export function lerProjetoParaPersistir(baseDir: string): PersistableFile[] {
    return listarProjeto(baseDir).map(caminho => ({ caminho, conteudo: fs.readFileSync(_resolverSeguro(baseDir, caminho)) }));
}

/** Lista todo arquivo do projeto (recursivo), caminhos relativos ao
 *  baseDir — scanProject do roadmap. Projeto inexistente retorna []. */
export function listarProjeto(baseDir: string): string[] {
    const baseAbs = path.resolve(baseDir);
    if (!fs.existsSync(baseAbs)) return [];
    const arquivos: string[] = [];
    (function andar(dirAbs: string): void {
        for (const nome of fs.readdirSync(dirAbs)) {
            const abs = path.join(dirAbs, nome);
            if (fs.statSync(abs).isDirectory()) andar(abs);
            else arquivos.push(path.relative(baseAbs, abs).split(path.sep).join('/'));
        }
    })(baseAbs);
    return arquivos.sort();
}

/** Empacota o projeto inteiro (ou só os caminhos passados) num Buffer
 *  ZIP — mesmo padrão já usado em src/services/storageService.js
 *  (archiver, zlib nível 6). Resolve com o Buffer completo (projeto de
 *  Solaris é pequeno — poucos arquivos de texto — bufferizar é seguro,
 *  diferente do streaming direto pro GCS do storageService). */
export function criarZip(baseDir: string, caminhos: string[] | null = null): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
        const alvos = caminhos && caminhos.length ? caminhos : listarProjeto(baseDir);
        if (alvos.length === 0) {
            reject(new Error('[SOLARIS-FILETOOLS] criarZip: projeto sem arquivo nenhum pra empacotar.'));
            return;
        }
        const archive = archiver('zip', { zlib: { level: 6 } });
        const chunks: Buffer[] = [];
        archive.on('data', (chunk) => chunks.push(chunk));
        archive.on('error', reject);
        archive.on('end', () => resolve(Buffer.concat(chunks)));
        for (const caminhoRelativo of alvos) {
            const abs = _resolverSeguro(baseDir, caminhoRelativo);
            if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
                archive.append(fs.createReadStream(abs), { name: caminhoRelativo });
            }
        }
        archive.finalize();
    });
}

// Busca um termo literal (case-insensitive) em todo arquivo de texto do
// projeto — mesmo padrão de src/ai/solAgent.js:_buscarNoCodigo, mas
// escopado a um baseDir de projeto (upload do usuário) em vez do
// código-fonte da Softload. Usada pelo loop de tool-calling de inspeção
// de projeto (ver pipeline/projectInspector.js) — nunca lê fora do
// baseDir (reusa listarProjeto/lerArquivo, já confinados).
const BUSCA_MAX_RESULTADOS = 30;
export function buscarNoProjeto(baseDir: string, termo: unknown): FileSearchResult {
    if (!termo || typeof termo !== 'string' || !termo.trim()) {
        return { erro: 'Termo de busca vazio.' };
    }
    const alvo = termo.trim().toLowerCase();
    const ocorrencias: FileSearchMatch[] = [];

    for (const caminho of listarProjeto(baseDir)) {
        if (ocorrencias.length >= BUSCA_MAX_RESULTADOS) break;
        const r = lerArquivo(baseDir, caminho);
        if (!r.ok) continue; // arquivo binário/ilegível como texto — pula, não é erro
        const linhas = r.conteudo.split('\n');
        for (let i = 0; i < linhas.length; i++) {
            if (linhas[i].toLowerCase().includes(alvo)) {
                ocorrencias.push({ caminho, linha: i + 1, trecho: linhas[i].trim().slice(0, 200) });
                if (ocorrencias.length >= BUSCA_MAX_RESULTADOS) break;
            }
        }
    }

    return {
        termo,
        totalEncontrado: ocorrencias.length,
        truncado: ocorrencias.length >= BUSCA_MAX_RESULTADOS,
        ocorrencias,
    };
}

// ──────────────────────────────────────────────────────────────────────────
// Declarações Gemini (function calling) — uso futuro em modo agêntico.
// ──────────────────────────────────────────────────────────────────────────
export const FUNCTION_DECLARATIONS: GeminiFileToolDeclaration[] = [
    {
        name: 'createHtml',
        description: 'Cria ou sobrescreve um arquivo HTML no projeto atual.',
        parameters: {
            type: Type.OBJECT,
            required: ['caminho', 'conteudo'],
            properties: {
                caminho: { type: Type.STRING, description: 'Caminho relativo do arquivo dentro do projeto (ex: "index.html").' },
                conteudo: { type: Type.STRING, description: 'Conteúdo HTML completo do arquivo.' },
            },
        },
    },
    {
        name: 'createCss',
        description: 'Cria ou sobrescreve um arquivo CSS no projeto atual.',
        parameters: {
            type: Type.OBJECT,
            required: ['caminho', 'conteudo'],
            properties: {
                caminho: { type: Type.STRING, description: 'Caminho relativo do arquivo dentro do projeto (ex: "css/style.css").' },
                conteudo: { type: Type.STRING, description: 'Conteúdo CSS completo do arquivo.' },
            },
        },
    },
    {
        name: 'createJs',
        description: 'Cria ou sobrescreve um arquivo JavaScript no projeto atual.',
        parameters: {
            type: Type.OBJECT,
            required: ['caminho', 'conteudo'],
            properties: {
                caminho: { type: Type.STRING, description: 'Caminho relativo do arquivo dentro do projeto (ex: "js/script.js").' },
                conteudo: { type: Type.STRING, description: 'Conteúdo JavaScript completo do arquivo.' },
            },
        },
    },
    {
        name: 'readProject',
        description: 'Lê o conteúdo de um arquivo já existente no projeto atual.',
        parameters: {
            type: Type.OBJECT,
            required: ['caminho'],
            properties: {
                caminho: { type: Type.STRING, description: 'Caminho relativo do arquivo dentro do projeto.' },
            },
        },
    },
    {
        name: 'scanProject',
        description: 'Lista todos os arquivos já existentes no projeto atual (caminhos relativos).',
        parameters: { type: Type.OBJECT, properties: {} },
    },
];


