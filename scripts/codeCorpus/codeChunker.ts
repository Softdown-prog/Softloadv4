/**
 * Segmentação de receitas de código preservando linhas e indentação.
 * O limite padrão deixa margem para o serviço de embeddings (250 palavras).
 */
export const MAX_WORDS = 220;
const MIN_WORDS = 65;
const EXTENSIONS: Readonly<Record<string, string>> = Object.freeze({
  '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript',
  '.ts': 'typescript', '.tsx': 'typescript', '.py': 'python', '.html': 'html',
  '.css': 'css', '.scss': 'css', '.sql': 'sql', '.php': 'php',
});
declare function require(name: string): unknown;
const path = require('node:path') as { posix: { extname(file: string): string } };

export function languageFor(file: string): string | null {
  return EXTENSIONS[path.posix.extname(file).toLowerCase()] || null;
}
export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}
export function chunkCode(code: string, maxWords: number = MAX_WORDS): string[] {
  if (typeof code !== 'string' || !Number.isInteger(maxWords) || maxWords < 10 || maxWords > 250) {
    throw new Error('chunkCode: conteúdo ou limite inválido');
  }
  const lines = code.replace(/\r\n?/g, '\n').split('\n');
  const chunks: string[] = [];
  let current: string[] = [];
  let count = 0;
  function flush(): void {
    const text = current.join('\n').replace(/^\n+|\n+$/g, '');
    if (text) chunks.push(text);
    current = [];
    count = 0;
  }
  for (const line of lines) {
    const words = wordCount(line);
    if (words > maxWords) throw new Error('Linha de código excede o limite de palavras');
    if (!line.trim() && count >= MIN_WORDS) flush();
    if (count + words > maxWords) flush();
    current.push(line);
    count += words;
  }
  flush();
  return chunks;
}
export function containsPotentialSecret(text: string): boolean {
  return /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|(?:api[_-]?key|secret|password|token)\s*[:=]\s*["'][^"']{12,}["']/i.test(text);
}
