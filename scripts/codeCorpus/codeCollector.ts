/**
 * Coleção segura de receitas externas do Solaris Code.
 * Sem executar fontes coletadas e sem gravar por padrão.
 * Os dados retornados pela API GitHub permanecem não confiáveis e passam
 * pelos validadores de licença, integridade, extensão, tamanho e segredos.
 */
export interface CodeSource {
  repo: string;
  prefix: string;
  maxFiles: number;
}
export interface CodeSourceManifest {
  schemaVersion: number;
  repositories: CodeSource[];
  allowLicenses: string[];
}
export interface CodeCollectionRepository {
  repo: string;
  license: string;
  commitSha: string;
  accepted: number;
}
export interface CodeCollectionReport {
  inspected: number;
  collected: number;
  unchanged: number;
  skipped: number;
  repositories: CodeCollectionRepository[];
  errors: string[];
}
export interface CodeFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<any>;
}
export type CodeFetch = (url: string, init: {
  headers: Record<string, string>;
  signal: unknown;
}) => Promise<CodeFetchResponse>;
export interface CodeCollectOptions {
  manifest?: CodeSourceManifest;
  limit?: number;
  apply?: boolean;
  outDir?: string;
  fetchImpl?: CodeFetch;
  token?: string;
}
interface CodeFileSystem {
  readFileSync(file: string, encoding: 'utf8'): string;
  existsSync(file: string): boolean;
  mkdirSync(dir: string, options: { recursive: true }): unknown;
  writeFileSync(file: string, data: string, options: { flag: 'wx'; mode: number }): void;
  renameSync(oldFile: string, newFile: string): void;
}
interface CodePath {
  resolve(...parts: string[]): string;
  join(...parts: string[]): string;
}
interface CodeCrypto {
  createHash(algorithm: 'sha256'): {
    update(text: string): { digest(encoding: 'hex'): string };
  };
}
interface CodeBinary {
  length: number;
  includes(byte: number): boolean;
  toString(encoding: 'utf8'): string;
}
declare const __dirname: string;
declare const process: { env: Record<string, string | undefined>; pid: number };
declare const Buffer: {
  from(source: string, encoding: 'base64'): CodeBinary;
};
declare const AbortSignal: { timeout(ms: number): unknown };
declare function require(name: string): unknown;

// Coleta somente caminhos de repositórios aprovados no manifesto, sem executar
// o código coletado. Somente licenças explicitamente permitidas passam.
const fs = require('node:fs') as CodeFileSystem;
const path = require('node:path') as CodePath;
const crypto = require('node:crypto') as CodeCrypto;
const { languageFor, containsPotentialSecret } = require('./codeChunker') as {
  languageFor(file: string): string | null;
  containsPotentialSecret(code: string): boolean;
};

const MAX_SOURCE_BYTES = 16000;
export const DEFAULT_LIMIT = 40;
const HARD_LIMIT = 1000;
export const OUTPUT_DIR = path.resolve(__dirname, '../../.scratch/solaris-code-corpus');
const SOURCE_MANIFEST = path.join(__dirname, 'sources.json');
const SKIP_PATH = /(?:^|\/)(?:node_modules|vendor|dist|build|coverage|generated|__snapshots__|fixtures|migrations|\.github)(?:\/|$)/i;
const SKIP_FILES = /(?:^|\/)(?:package-lock\.json|yarn\.lock|pnpm-lock\.yaml|\.env[^/]*|.*\.min\.(?:js|css))$/i;

function digest(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}
export function entryId(repo: string, file: string): string {
  return 'code-' + digest(repo + ':' + file).slice(0, 32);
}
function validateRepoSource(source: CodeSource): void {
  if (!source || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source.repo) ||
      typeof source.prefix !== 'string' || !/^[A-Za-z0-9_.\/-]+\/$/.test(source.prefix) ||
      source.prefix.startsWith('/') || source.prefix.includes('..') ||
      !Number.isInteger(source.maxFiles) || source.maxFiles < 1 || source.maxFiles > HARD_LIMIT) {
    throw new Error('Fonte do manifesto inválida');
  }
}
export function validateLimit(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > HARD_LIMIT) {
    throw new Error('Limite deve ser inteiro entre 1 e ' + HARD_LIMIT);
  }
  return value;
}
export function parseManifest(file: string = SOURCE_MANIFEST): CodeSourceManifest {
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as CodeSourceManifest;
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.repositories) ||
      !Array.isArray(manifest.allowLicenses) || manifest.allowLicenses.length === 0) {
    throw new Error('Manifesto de fontes inválido');
  }
  manifest.repositories.forEach(validateRepoSource);
  return manifest;
}
export async function collectCode({
  manifest = parseManifest(), limit = DEFAULT_LIMIT, apply = false,
  outDir = OUTPUT_DIR, fetchImpl = (globalThis as unknown as { fetch: CodeFetch }).fetch, token = process.env.GITHUB_TOKEN,
}: CodeCollectOptions = {}): Promise<CodeCollectionReport> {
  validateLimit(limit);
  const allowed = new Set(manifest.allowLicenses.map(x => String(x).toUpperCase()));
  const results: CodeCollectionReport = { inspected: 0, collected: 0, unchanged: 0, skipped: 0, repositories: [], errors: [] };
  const seenHashes = new Set<string>();
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'Softload-Solaris-CodeCorpus/1.0',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = 'Bearer ' + token;
  // Untrusted HTTP JSON: GitHub fields are validated before use.
  async function jsonGet(repo: string, tail: string): Promise<any> {
    const resp = await fetchImpl('https://api.github.com/repos/' + repo + '/' + tail, {
      headers, signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error('GitHub HTTP ' + resp.status + ' para ' + repo + '/' + tail.split('?')[0]);
    return resp.json();
  }
  for (const source of manifest.repositories) {
    if (results.collected + results.unchanged >= limit) break;
    validateRepoSource(source);
    try {
      const meta = await jsonGet(source.repo, '');
      if (meta.private || meta.archived) throw new Error('Repositório privado/arquivado não é fonte pública');
      const licenseId = String(meta.license && meta.license.spdx_id || '').toUpperCase();
      if (!allowed.has(licenseId)) throw new Error('Licença não autorizada: ' + licenseId);
      const commit = await jsonGet(source.repo, 'commits/' + encodeURIComponent(meta.default_branch));
      const sha = commit.sha;
      if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error('Commit SHA inválido');
      // Navega até o subdiretório autorizado ANTES da consulta recursiva.
      // Repositórios grandes (ex.: Next.js) truncam a árvore recursiva na raiz.
      let subtreeSha = commit.commit && commit.commit.tree && commit.commit.tree.sha;
      if (!/^[a-f0-9]{40}$/i.test(subtreeSha || '')) throw new Error('Tree SHA inválido');
      let missing = false;
      for (const component of source.prefix.split('/').filter(Boolean)) {
        const level = await jsonGet(source.repo, 'git/trees/' + subtreeSha);
        const dir = (level.tree || []).find((item: any) => item.type === 'tree' && item.path === component);
        if (!dir) { missing = true; break; }
        subtreeSha = dir.sha;
      }
      if (missing) throw new Error('Diretório da fonte não existe: ' + source.prefix);
      const listing = await jsonGet(source.repo, 'git/trees/' + subtreeSha + '?recursive=1');
      if (listing.truncated || !Array.isArray(listing.tree)) throw new Error('Árvore incompleta: não indexar parcialmente');
      const paths = listing.tree.map((item: any) => ({ ...item, path: source.prefix + item.path })).filter((item: any) =>
        item.type === 'blob' &&
        languageFor(item.path) && item.size >= 80 && item.size <= MAX_SOURCE_BYTES &&
        !SKIP_PATH.test(item.path) && !SKIP_FILES.test(item.path) &&
        /^[a-f0-9]{40}$/i.test(item.sha)
      ).sort((a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path)).slice(0, source.maxFiles);
      let accepted = 0;
      for (const item of paths) {
        if (results.collected + results.unchanged >= limit) break;
        results.inspected++;
        try {
          const blob = await jsonGet(source.repo, 'git/blobs/' + item.sha);
          if (blob.encoding !== 'base64' || typeof blob.content !== 'string') throw new Error('Blob não é base64');
          const binary = Buffer.from(blob.content.replace(/\s/g, ''), 'base64');
          if (binary.length > MAX_SOURCE_BYTES || binary.includes(0)) { results.skipped++; continue; }
          const code = binary.toString('utf8');
          if (code.includes('\uFFFD') || containsPotentialSecret(code) || code.trim().length < 80) {
            results.skipped++; continue;
          }
          const hash = digest(code);
          if (seenHashes.has(hash)) { results.skipped++; continue; }
          seenHashes.add(hash);
          const id = entryId(source.repo, item.path);
          const entry = {
            id, language: languageFor(item.path), repo: source.repo, path: item.path,
            sourceUrl: 'https://github.com/' + source.repo + '/blob/' + sha + '/' + item.path.split('/').map(encodeURIComponent).join('/'),
            commitSha: sha, license: licenseId, contentHash: hash,
            collectedAt: new Date().toISOString(), validated: false, code,
          };
          const target = path.join(outDir, id + '.json');
          if (fs.existsSync(target)) {
            const prev = JSON.parse(fs.readFileSync(target, 'utf8')) as { contentHash?: string };
            if (prev.contentHash === hash) {
              results.unchanged++; accepted++; continue;
            }
          }
          if (apply) {
            fs.mkdirSync(outDir, { recursive: true });
            const tmp = target + '.' + process.pid + '.tmp';
            fs.writeFileSync(tmp, JSON.stringify(entry, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
            fs.renameSync(tmp, target);
          }
          results.collected++;
          accepted++;
        } catch (error) {
          results.errors.push(source.repo + '/' + item.path + ': ' + (error as Error).message);
        }
      }
      results.repositories.push({ repo: source.repo, license: licenseId, commitSha: sha, accepted });
    } catch (error) {
      results.errors.push(source.repo + ': ' + (error as Error).message);
    }
  }
  return results;
}
