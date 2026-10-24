'use strict';
// Indexa o corpus coletado na coleção separada do RAG legado.
// Padrão dry-run; --apply exige credenciais Firestore e embeddings-service.
const fs = require('node:fs');
const path = require('node:path');
const { chunkCode, containsPotentialSecret, languageFor } = require('./codeCorpus/codeChunker');
const { OUTPUT_DIR, validateLimit } = require('./codeCorpus/codeCollector');
const { replaceCodeVectors, COLLECTION } = require('./codeCorpus/codeVectorStore');
const { loadAuthoredCorpus } = require('./codeCorpus/authoredCatalog');
const { execFileSync } = require('node:child_process');

function loadCorpus(directory = OUTPUT_DIR, limit = 50) {
  validateLimit(limit);
  if (!fs.existsSync(directory)) return [];
  const out = [];
  const files = fs.readdirSync(directory).filter(x => /^code-[a-f0-9]{32}\.json$/.test(x)).sort().slice(0, limit);
  for (const file of files) {
    const full = path.join(directory, file);
    if (!fs.lstatSync(full).isFile()) continue; // nunca segue symlinks
    const entry = JSON.parse(fs.readFileSync(full, 'utf8'));
    if (!entry || entry.id + '.json' !== file ||
        typeof entry.code !== 'string' || entry.code.length < 80 ||
        entry.code.length > 16000 || containsPotentialSecret(entry.code) ||
        typeof entry.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.contentHash) ||
        typeof entry.repo !== 'string' || typeof entry.path !== 'string' ||
        languageFor(entry.path) !== entry.language ||
        typeof entry.sourceUrl !== 'string' || !entry.sourceUrl.startsWith('https://github.com/' + entry.repo + '/blob/') ||
        !/^[a-f0-9]{40}$/.test(entry.commitSha) ||
        !['MIT', 'APACHE-2.0', 'BSD-3-CLAUSE'].includes(entry.license)) {
      throw new Error('Fonte inválida: ' + file);
    }
    const { createHash } = require('node:crypto');
    if (createHash('sha256').update(entry.code).digest('hex') !== entry.contentHash) throw new Error('Hash inválido: ' + file);
    out.push({ entry, chunks: chunkCode(entry.code) });
  }
  return out;
}
async function indexCorpus({ entries, db, embedFn, apply = false } = {}) {
  const report = { entries: 0, chunks: 0, indexed: 0, unchanged: 0, errors: [] };
  for (const { entry, chunks } of entries) {
    report.entries++;
    report.chunks += chunks.length;
    if (!apply) continue;
    try {
      const previous = await db.collection(COLLECTION).doc(entry.id + '::chunk0').get();
      if (previous.exists && previous.data().contentHash === entry.contentHash) {
        report.unchanged++;
        continue;
      }
      const vectors = await embedFn({ textos: chunks, taskType: 'RETRIEVAL_DOCUMENT' });
      await replaceCodeVectors({ db, entry, chunks, embeddings: vectors });
      report.indexed++;
    } catch (err) {
      report.errors.push({ id: entry.id, error: err.message });
    }
  }
  return report;
}
function verifyAuthoredExamples() {
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
async function main() {
  require('dotenv').config();
  const args = process.argv.slice(2);
  if (args.some(x => x !== '--apply' && !/^--limit=\d+$/.test(x))) {
    throw new Error('Uso: npm run rag:code-index -- [--limit=50] [--apply]');
  }
  const limitArg = args.find(x => x.startsWith('--limit='));
  const limit = limitArg ? validateLimit(Number(limitArg.slice(8))) : 50;
  const entries = loadAuthoredCorpus({ limit });
  const apply = args.includes('--apply');
  const options = { entries, apply };
  if (apply) {
    verifyAuthoredExamples();
    entries.forEach(item => { item.entry.validated = true; });
    options.db = require('../src/services/firebase').db;
    options.embedFn = require('../src/solaris/rag/ragEmbeddingsClient').gerarEmbeddings;
  }
  const result = await indexCorpus(options);
  console.log(JSON.stringify({ source: 'softload-authored', mode: apply ? 'apply' : 'dry-run', ...result }, null, 2));
  if (result.errors.length) process.exitCode = 1;
}
if (require.main === module) main().catch(err => { console.error(err.message); process.exitCode = 1; });
module.exports = { loadCorpus, loadAuthoredCorpus, indexCorpus, verifyAuthoredExamples };
