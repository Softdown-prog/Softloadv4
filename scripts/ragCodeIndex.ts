/**
 * Indexação da biblioteca de receitas autorais do Solaris Code.
 * Dry-run é o padrão: Firestore só é acessado mediante --apply.
 * Não usa nem escreve a coleção técnica ou os arquivos do Blogger.
 */
import type { CodeFirestore, CodeVectorEntry } from './codeCorpus/codeVectorStore';

export interface CorpusEntry extends CodeVectorEntry { code?: string }
export interface CorpusItem { entry: CorpusEntry; chunks: string[] }
export interface CodeIndexReport {
  entries: number;
  chunks: number;
  indexed: number;
  unchanged: number;
  errors: { id: string; error: string }[];
}
interface Snapshot { exists: boolean; data(): { contentHash: string } }
interface CodeIndexDb extends CodeFirestore {
  collection(name: string): ReturnType<CodeFirestore['collection']> & {
    doc(id: string): { get(): Promise<Snapshot> };
  };
}
export type EmbedFn = (input: {
  textos: string[];
  taskType: 'RETRIEVAL_DOCUMENT';
}) => Promise<number[][]>;
export interface CodeIndexOptions {
  entries?: CorpusItem[];
  db?: CodeIndexDb;
  embedFn?: EmbedFn;
  apply?: boolean;
}
interface FSFileStat { isFile(): boolean }
interface FSReader {
  existsSync(file: string): boolean;
  readdirSync(file: string): string[];
  lstatSync(file: string): FSFileStat;
  readFileSync(file: string, encoding: 'utf8'): string;
}
interface Paths { resolve(...paths: string[]): string; join(...paths: string[]): string }
interface CodeChunkApi {
  chunkCode(code: string): string[];
  containsPotentialSecret(code: string): boolean;
  languageFor(file: string): string | null;
}
interface ChildProcessAPI {
  execFileSync(cmd: string, args: string[], options: { cwd: string; stdio: 'inherit' }): unknown;
}
declare function require(path: string): unknown;
declare namespace require { const main: unknown }
declare const module: unknown;
declare const __dirname: string;
declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  execPath: string;
  exitCode: number;
};
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const fs = require('node:fs') as FSReader;
const path = require('node:path') as Paths;
const { chunkCode, containsPotentialSecret, languageFor } = require('./codeCorpus/codeChunker') as CodeChunkApi;
const { OUTPUT_DIR, validateLimit } = require('./codeCorpus/codeCollector') as {
  OUTPUT_DIR: string;
  validateLimit(limit: number): number;
};
const { replaceCodeVectors, COLLECTION } = require('./codeCorpus/codeVectorStore') as {
  COLLECTION: string;
  replaceCodeVectors(input: { db: CodeFirestore; entry: CorpusEntry; chunks: string[]; embeddings: number[][] }): Promise<unknown>;
};
const { loadAuthoredCorpus } = require('./codeCorpus/authoredCatalog') as {
  loadAuthoredCorpus(options: { limit: number }): CorpusItem[];
};
const { execFileSync } = require('node:child_process') as ChildProcessAPI;

export function loadCorpus(directory: string = OUTPUT_DIR, limit: number = 50): CorpusItem[] {
  validateLimit(limit);
  if (!fs.existsSync(directory)) return [];
  const out: CorpusItem[] = [];
  const files = fs.readdirSync(directory).filter(x => /^code-[a-f0-9]{32}\.json$/.test(x)).sort().slice(0, limit);
  for (const file of files) {
    const full = path.join(directory, file);
    if (!fs.lstatSync(full).isFile()) continue;
    const entry = JSON.parse(fs.readFileSync(full, 'utf8')) as CorpusEntry;
    if (!entry || entry.id + '.json' !== file ||
        typeof entry.code !== 'string' || entry.code.length < 80 ||
        entry.code.length > 16000 || containsPotentialSecret(entry.code) ||
        typeof entry.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.contentHash) ||
        typeof entry.repo !== 'string' || typeof entry.path !== 'string' ||
        languageFor(entry.path) !== entry.language ||
        typeof entry.sourceUrl !== 'string' || !entry.sourceUrl.startsWith('https://github.com/' + entry.repo + '/blob/') ||
        !/^[a-f0-9]{40}$/.test(entry.commitSha as string) ||
        !['MIT', 'APACHE-2.0', 'BSD-3-CLAUSE'].includes(entry.license)) {
      throw new Error('Fonte inválida: ' + file);
    }
    const { createHash } = require('node:crypto') as { createHash(algorithm: string): { update(s: string): { digest(encoding: string): string } } };
    if (createHash('sha256').update(entry.code).digest('hex') !== entry.contentHash) throw new Error('Hash inválido: ' + file);
    out.push({ entry, chunks: chunkCode(entry.code) });
  }
  return out;
}

export async function indexCorpus({ entries, db, embedFn, apply = false }: CodeIndexOptions = {}): Promise<CodeIndexReport> {
  const report: CodeIndexReport = { entries: 0, chunks: 0, indexed: 0, unchanged: 0, errors: [] };
  for (const { entry, chunks } of entries as CorpusItem[]) {
    report.entries++;
    report.chunks += chunks.length;
    if (!apply) continue;
    try {
      const ref = (db as CodeIndexDb).collection(COLLECTION).doc(entry.id + '::chunk0');
      const previous = await (ref as { get(): Promise<Snapshot> }).get();
      if (previous.exists && previous.data().contentHash === entry.contentHash) {
        report.unchanged++;
        continue;
      }
      const vectors = await (embedFn as EmbedFn)({ textos: chunks, taskType: 'RETRIEVAL_DOCUMENT' });
      await replaceCodeVectors({ db: db as CodeIndexDb, entry, chunks, embeddings: vectors });
      report.indexed++;
    } catch (err) {
      report.errors.push({ id: entry.id, error: (err as Error).message });
    }
  }
  return report;
}

export function verifyAuthoredExamples(): void {
  const cwd = path.resolve(__dirname, '..');
  execFileSync(process.execPath, ['--test',
    'src/solaris/code-examples/javascript/examples.test.js',
    'src/solaris/rag/authoredCatalog.test.js'], { cwd, stdio: 'inherit' });
  execFileSync(process.execPath, ['--test', 'examples/solaris-code/examples.test.js'], { cwd, stdio: 'inherit' });
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc',
    '--project', 'examples/solaris-code/tsconfig.json', '--noEmit'], { cwd, stdio: 'inherit' });
  execFileSync(process.env.PYTHON || 'python3',
    ['-B', '-m', 'unittest', 'discover', '-s',
      'src/solaris/code-examples/python', '-p', 'test_examples.py', '-v'], { cwd, stdio: 'inherit' });
}

async function main(): Promise<void> {
  (require('dotenv') as { config(): void }).config();
  const args = process.argv.slice(2);
  if (args.some(x => x !== '--apply' && !/^--limit=\d+$/.test(x))) {
    throw new Error('Uso: npm run rag:code-index -- [--limit=50] [--apply]');
  }
  const limitArg = args.find(x => x.startsWith('--limit='));
  const limit = limitArg ? validateLimit(Number(limitArg.slice(8))) : 50;
  const entries = loadAuthoredCorpus({ limit });
  const apply = args.includes('--apply');
  const options: CodeIndexOptions = { entries, apply };
  if (apply) {
    verifyAuthoredExamples();
    entries.forEach(item => { item.entry.validated = true; });
    options.db = (require('../src/services/firebase') as { db: CodeIndexDb }).db;
    options.embedFn = (require('../src/solaris/rag/ragEmbeddingsClient') as { gerarEmbeddings: EmbedFn }).gerarEmbeddings;
  }
  const result = await indexCorpus(options);
  console.log(JSON.stringify({ source: 'softload-authored', mode: apply ? 'apply' : 'dry-run', ...result }, null, 2));
  if (result.errors.length) process.exitCode = 1;
}
if (require.main === module) main().catch((err: Error) => { console.error(err.message); process.exitCode = 1; });
