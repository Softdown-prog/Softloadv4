import { execa } from "execa";

/**
 * runCommand: wrapper fino sobre `execa`, no mesmo padrão de
 * segurança já usado em shell.js/git.js — SEM `shell: true` (binário
 * chamado diretamente com um array de argumentos, sem interpretação
 * de `&&`/`;`/`|`/backticks) e com `reject: false` (exit code != 0
 * não vira exceção; quem chama decide o que fazer com
 * `exitCode`/`stderr`, igual ao restante do código).
 *
 * Usado pelas capabilities que rodam um comando pontual e esperam o
 * resultado completo de uma vez (build.js, test.js, package.js,
 * code-search.js) — diferente de process.js, que roda comandos em
 * background via `execa` diretamente (não usa este helper).
 *
 * @param {string} executable
 * @param {string[]} args
 * @param {{ cwd: string, timeoutMs?: number, stripFinalNewline?: boolean }} options
 *   `stripFinalNewline` não tem default aqui de propósito — omitido,
 *   deixa o próprio default do execa valer (`true`, remove um "\n"
 *   final do stdout/stderr capturado), que é o comportamento que
 *   TODO chamador existente (build.js/test.js/package.js/
 *   code-search.js) já espera pra LOG de comando. Só passe `false`
 *   quando o stdout capturado precisa ser reconstruído byte a byte
 *   (ex: diff-patch-engine.js, onde stdout é o CONTEÚDO de um
 *   arquivo, não um log — perder o "\n" final corromperia qualquer
 *   arquivo que termine com uma quebra de linha, o caso comum).
 * @returns {Promise<{ exitCode: number|null, stdout: string, stderr: string, failed: boolean, timedOut: boolean }>}
 *   Não inclui `command` no retorno de propósito — os chamadores
 *   fazem `{ command, ...result }` com o `command` original (a
 *   string completa, antes de virar executable+args), e um `command`
 *   vindo daqui sobrescreveria esse valor por vir depois no spread.
 */
export async function runCommand(executable, args = [], options = {}) {
  const { cwd, timeoutMs, stripFinalNewline } = options;

  const result = await execa(executable, args, {
    cwd,
    timeout: timeoutMs,
    reject: false,
    ...(stripFinalNewline === undefined ? {} : { stripFinalNewline }),
  });

  return {
    exitCode: result.exitCode,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    failed: result.failed ?? false,
    timedOut: result.timedOut ?? false,
  };
}

/**
 * truncateOutput: limita `text` a `maxChars`, mantendo o FIM da
 * string (a saída mais recente é geralmente a mais relevante — é
 * onde erros de build/teste costumam aparecer) e prefixando um
 * marcador quando corta algo, para deixar claro que a saída não está
 * completa.
 *
 * Usado por process.js a cada chunk de stdout/stderr recebido de um
 * processo em background, para nunca deixar `record.stdout`/`stderr`
 * crescer sem limite em processos de longa duração.
 *
 * @param {string} text
 * @param {number} maxChars
 * @returns {string}
 */
export function truncateOutput(text, maxChars) {
  if (typeof text !== "string" || text.length <= maxChars) {
    return text;
  }

  const marker = "...[saída truncada]\n";

  // Reserva espaço para o marcador dentro do limite total, em vez de
  // ultrapassar `maxChars` ao concatená-lo.
  const keep = Math.max(0, maxChars - marker.length);

  return marker + text.slice(text.length - keep);
}
