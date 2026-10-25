/**
 * Interfaces da política de comandos do Worker, sem alterações
 * nas allowlists, prefixos ou padrões que já protegem o runtime.
 */
export interface CommandPolicyOptions {
  allowedCommands?: Iterable<string>;
  allowedPrefixes?: string[] | null;
  blockedPatterns?: RegExp[];
}
export interface CommandValidation {
  allowed: boolean;
  executable: string;
}

import { parseCommand } from "../utils/parse-command.js";

// Lista de padrões (regex) considerados perigosos o suficiente para
// bloquear mesmo que o executável em si esteja na allowlist.
// IMPORTANTE: isto é uma blocklist — cobre casos conhecidos, mas por
// natureza é incompleta (não é possível enumerar toda variação
// perigosa de comando shell). Deve ser tratada como uma camada
// adicional de defesa, não como a proteção principal.
const DEFAULT_BLOCKED_PATTERNS = [
  // Achado real: `\b` logo após `/` ou `*` só cria fronteira de
  // palavra quando o caractere SEGUINTE é de palavra (ex: "/home" —
  // fronteira entre "/" e "h"). No fim da string (ou seguido de
  // espaço) não há transição não-palavra->palavra nenhuma, então
  // "rm -rf /" sozinho — o próprio exemplo citado no comentário
  // original — nunca batia. Troca por lookahead `(?=$|\s|\w)`: cobre
  // fim de string, espaço, OU um caractere de palavra em seguida —
  // mesmos casos que `\b` cobria, mais o de fim de string que faltava.
  /\brm\s+-rf\s+\/(?=$|\s|\w)/i, // rm -rf / (ou /algo)
  /\brm\s+-rf\s+\*(?=$|\s|\w)/i, // rm -rf * (sem barra na frente)
  /\bmkfs\b/i, // formatação de sistema de arquivos
  /\bdd\s+if=/i, // dd pode sobrescrever discos inteiros
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bpoweroff\b/i,
  /\bchmod\s+-R\s+777\s+\/(?=$|\s|\w)/i, // permissões perigosas recursivas na raiz
  /\bchown\s+-R\s+.*\s+\/(?=$|\s|\w)/i, // troca de dono recursiva na raiz
];

// Allowlist padrão dos binários que o agent pode invocar, usada
// quando nenhuma allowlist customizada é passada no construtor.
// Note que "rm", "sudo", "sh", "bash" etc. NÃO estão aqui — então
// mesmo que um BLOCKED_PATTERN falhe em pegar algum caso, esses
// comandos ainda seriam barrados na checagem de `executable` (ver
// validate()), desde que apareçam como o primeiro comando da
// string.
const DEFAULT_ALLOWED_COMMANDS = new Set([
  "node",
  "npm",
  "npx",
  "git",
  "git-lfs",
  "python",
  "python3",
  "php",
  "composer",
  "docker",
  "gcloud",
  "curl",
  "wget",
  "jq",
  "find",
  "grep",
  "cat",
  "ls",
  "pwd",
  "tree",
  "mkdir",
  "cp",
  "mv",
  "unzip",
  "zip",
]);

/**
 * CommandPolicy: valida uma string de comando de shell antes que a
 * ShellCapability a execute, combinando três camadas:
 *
 * 1. Blocklist de padrões perigosos (blockedPatterns), testada
 *    contra a string INTEIRA do comando.
 * 2. Allowlist do executável (primeiro token do comando).
 * 3. (opcional) Allowlist de PREFIXOS EXATOS de comando
 *    (allowedPrefixes) — mais restritiva que só checar o
 *    executável. Ex: liberar apenas "npm test" e "npm run", em vez
 *    de "npm" inteiro (que também permitiria "npm publish",
 *    "npm install <pacote-malicioso>" etc.). Útil para papéis como
 *    o Validador, que só deveria poder RODAR testes, não qualquer
 *    coisa que o binário "npm" for capaz de fazer.
 *
 * Por padrão (sem passar nada no construtor), usa as listas globais
 * originais — mantém compatibilidade com o uso existente. Para
 * políticas por papel/sub-agente, ver role-permissions.js.
 *
 * Nota sobre encadeamento de shell (`&&`, `;`, `|`, `` ` ``, `$()`):
 * apenas o primeiro token é validado contra a allowlist, mas isso é
 * seguro porque a ShellCapability invoca `execa` SEM `shell: true`
 * — ou seja, o comando roda como um único binário com argumentos
 * literais, e esses operadores não são interpretados como parte de
 * uma shell (viram texto comum passado como argumento). Se essa
 * forma de invocação mudar no futuro (passar a usar uma shell),
 * esta validação precisaria ser refeita para cobrir cada comando
 * encadeado individualmente.
 */
export class CommandPolicy {
  declare allowedCommands: Set<string>;
  declare allowedPrefixes: string[] | null;
  declare blockedPatterns: RegExp[];

  constructor({
    allowedCommands,
    allowedPrefixes,
    blockedPatterns,
  }: CommandPolicyOptions = {}) {
    this.allowedCommands = allowedCommands
      ? new Set(allowedCommands)
      : DEFAULT_ALLOWED_COMMANDS;

    // Se informado, TODO comando precisa começar exatamente com um
    // destes prefixos (ver checagem em validate()). Se omitido
    // (undefined/null), essa camada extra não é aplicada — mantém o
    // comportamento padrão de só checar o executável.
    this.allowedPrefixes = allowedPrefixes || null;

    this.blockedPatterns =
      blockedPatterns || DEFAULT_BLOCKED_PATTERNS;
  }

  validate(command: string): CommandValidation {
    // Rejeita comando vazio, só espaços, ou de tipo diferente de
    // string (ex: undefined, null, número).
    if (
      typeof command !== "string" ||
      !command.trim()
    ) {
      throw new Error(
        "Comando vazio ou inválido",
      );
    }

    // Testa a string completa (não só o primeiro comando) contra
    // cada padrão perigoso conhecido.
    for (const pattern of this.blockedPatterns) {
      if (pattern.test(command)) {
        const error: Error & { code?: string } = new Error(
          "Comando bloqueado pela política de segurança",
        );

        error.code = "COMMAND_BLOCKED";

        throw error;
      }
    }

    // Extrai o nome do executável usando o mesmo parser (com
    // suporte a aspas) que a ShellCapability usa para montar os
    // argumentos reais — assim o executável validado aqui é
    // garantidamente o mesmo que será de fato invocado.
    // 1. divide o comando em tokens respeitando aspas
    // 2. pega o primeiro token
    // 3. remove qualquer caminho de diretório, mantendo só o nome
    //    do binário (ex: "/usr/bin/node" -> "node")
    const tokens = parseCommand(command.trim());

    if (tokens.length === 0) {
      throw new Error("Comando vazio ou inválido");
    }

    const executable = tokens[0]
      .split("/")
      .pop()!;

    // Bloqueia qualquer executável fora da allowlist.
    if (!this.allowedCommands.has(executable)) {
      const error: Error & { code?: string } = new Error(
        `Executável não permitido: ${executable}`,
      );

      error.code = "EXECUTABLE_NOT_ALLOWED";

      throw error;
    }

    // Camada extra (opcional): exige que o comando bata EXATAMENTE
    // com um dos prefixos configurados, ou seja seguido por um
    // espaço logo após o prefixo (evita que "npm test" libere
    // também "npm testxyz", por exemplo — o `.startsWith(prefix)`
    // sozinho teria esse problema).
    if (this.allowedPrefixes) {
      const trimmed = command.trim();

      const matchesPrefix = this.allowedPrefixes.some(
        (prefix) =>
          trimmed === prefix ||
          trimmed.startsWith(`${prefix} `),
      );

      if (!matchesPrefix) {
        const error: Error & { code?: string } = new Error(
          `Comando fora da allowlist de prefixos permitidos: ${command}`,
        );

        error.code = "COMMAND_PREFIX_NOT_ALLOWED";

        throw error;
      }
    }

    return {
      allowed: true,
      executable,
    };
  }
}
