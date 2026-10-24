'use strict';

// Fatia por linhas preservando a estrutura e os recuos do código.
// O teto de 220 palavras deixa margem para o limite de 250 do embeddings-service.
const MAX_WORDS = 220;
const MIN_WORDS = 65;
const EXTENSIONS = Object.freeze({
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript', '.py': 'python', '.html': 'html',
  '.css': 'css', '.scss': 'css', '.sql': 'sql', '.php': 'php',
});
const path = require('node:path');

function languageFor(file) {
  return EXTENSIONS[path.posix.extname(file).toLowerCase()] || null;
}
function wordCount(text) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}
function chunkCode(code, maxWords = MAX_WORDS) {
  if (typeof code !== 'string' || !Number.isInteger(maxWords) || maxWords < 10 || maxWords > 250) {
    throw new Error('chunkCode: conteúdo ou limite inválido');
  }
  const lines = code.replace(/\r\n?/g, '\n').split('\n');
  const chunks = [];
  let current = [];
  let count = 0;
  function flush() {
    const text = current.join('\n').replace(/^\n+|\n+$/g, '');
    if (text) chunks.push(text);
    current = [];
    count = 0;
  }
  for (const line of lines) {
    // Linhas gigantes são recusadas: nunca cortar uma instrução no meio.
    const words = wordCount(line);
    if (words > maxWords) throw new Error('Linha de código excede o limite de palavras');
    // Prefere dividir em separadores de blocos, sem desfigurar funções curtas.
    if (!line.trim() && count >= MIN_WORDS) flush();
    if (count + words > maxWords) flush();
    current.push(line);
    count += words;
  }
  flush();
  return chunks;
}
function containsPotentialSecret(text) {
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']{12,}["']/i.test(text);
}
module.exports = { chunkCode, languageFor, containsPotentialSecret, wordCount, MAX_WORDS };