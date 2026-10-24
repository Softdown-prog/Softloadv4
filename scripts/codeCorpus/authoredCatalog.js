"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CATALOG = exports.ROOT = void 0;
exports.loadAuthoredCorpus = loadAuthoredCorpus;
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chunkCode, languageFor, containsPotentialSecret, wordCount } = require('./codeChunker');
const { validateLimit } = require('./codeCollector');
exports.ROOT = path.resolve(__dirname, '../../src/solaris/code-examples');
exports.CATALOG = path.join(exports.ROOT, 'catalog.json');
// Mantém a procedência histórica: troca de URL depende de migração do índice.
const REPO = 'Softdown-prog/softload-engine-v3';
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
function safePath(relative) {
    const legacy = /^src\/solaris\/code-examples\/(javascript|python|typescript)\/[a-z0-9]+(?:-[a-z0-9]+)*\.(js|py|ts)$/.test(relative);
    const modern = /^examples\/solaris-code\/(typescript|react|node)\/[a-z0-9]+(?:-[a-z0-9]+)*\.(js|ts|tsx)$/.test(relative);
    if (typeof relative !== 'string' || (!legacy && !modern)) {
        throw new Error('Caminho de receita não permitido: ' + relative);
    }
    const repoRoot = path.resolve(__dirname, '../..');
    const file = path.resolve(repoRoot, relative);
    if (!file.startsWith(repoRoot + path.sep))
        throw new Error('Caminho fora do corpus original');
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error('Receita deve ser arquivo físico regular');
    return file;
}
function normalizeDescription(value, field) {
    if (typeof value !== 'string' || !value.trim() || value.length > 1000) {
        throw new Error('Metadado da receita inválido: ' + field);
    }
    return value.trim();
}
function loadAuthoredCorpus({ limit = 50, catalogFile = exports.CATALOG } = {}) {
    validateLimit(limit);
    const catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'));
    if (catalog.schemaVersion !== 1 || catalog.source !== 'softload-authored' ||
        !Array.isArray(catalog.entries))
        throw new Error('Catálogo original inválido');
    const seen = new Set();
    const result = [];
    for (const meta of catalog.entries.slice(0, limit)) {
        const rel = normalizeDescription(meta.path, 'path');
        const file = safePath(rel);
        if (seen.has(rel))
            throw new Error('Receita duplicada: ' + rel);
        seen.add(rel);
        const code = fs.readFileSync(file, 'utf8');
        if (code.length < 60 || code.length > 16000 || containsPotentialSecret(code) ||
            languageFor(rel) !== meta.language || !['javascript', 'python', 'typescript'].includes(meta.language)) {
            throw new Error('Conteúdo ou linguagem inválida: ' + rel);
        }
        const title = normalizeDescription(meta.title, 'title');
        const summary = normalizeDescription(meta.summary, 'summary');
        const useWhen = normalizeDescription(meta.useWhen, 'useWhen');
        const limitations = normalizeDescription(meta.limitations, 'limitations');
        const tags = title + '. ' + summary + ' Quando usar: ' + useWhen + ' Limitações: ' + limitations;
        const prefix = 'Título: ' + title + '\nLinguagem: ' + meta.language +
            '\nDescrição: ' + summary + '\nQuando usar: ' + useWhen +
            '\nLimitações: ' + limitations + '\nCódigo:\n';
        const overhead = wordCount(prefix);
        if (overhead >= 110)
            throw new Error('Metadados longos demais: ' + rel);
        const chunks = chunkCode(code, 220 - overhead).map(piece => prefix + piece);
        if (!chunks.length || chunks.some(c => wordCount(c) > 220))
            throw new Error('Chunks inválidos: ' + rel);
        const id = 'code-' + sha256('softload-authored:' + rel).slice(0, 32);
        result.push({
            entry: {
                id, repo: REPO, path: rel, language: meta.language, origin: 'softload-authored',
                title, summary, useWhen, limitations, categoria: meta.category || null,
                sourceUrl: 'https://github.com/' + REPO + '/blob/main/' + rel,
                license: 'PROJECT', commitSha: null, validated: false,
                contentHash: sha256(tags + '\n' + code),
            },
            chunks,
        });
    }
    return result;
}
