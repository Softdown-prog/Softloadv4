/**
 * parseCommand: divide uma string de comando em tokens (argv),
 * respeitando aspas simples e duplas — diferente de um simples
 * `split(/\s+/)`, que quebra incorretamente argumentos com espaço
 * dentro de aspas.
 *
 * Exemplos:
 *   parseCommand('git commit -m "fix bug in login"')
 *   -> ['git', 'commit', '-m', 'fix bug in login']
 *
 *   parseCommand("echo 'hello world' foo")
 *   -> ['echo', 'hello world', 'foo']
 *
 * Suporta escape de aspas duplas dentro de aspas duplas usando
 * barra invertida, ex: "say \"hi\"" -> say "hi".
 * Aspas simples são tratadas literalmente (sem suporte a escape
 * dentro delas), seguindo o comportamento mais comum em shells.
 *
 * Lança erro se houver aspas não fechadas, evitando que um comando
 * malformado seja silenciosamente truncado/mal interpretado.
 */
export function parseCommand(command) {
  const args = [];
  let current = "";
  let quote = null;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (quote) {
      // Dentro de uma aspa aberta (' ou ").
      if (char === quote) {
        // Fecha a aspa atual.
        quote = null;
      } else if (
        quote === '"' &&
        char === "\\" &&
        (command[i + 1] === '"' || command[i + 1] === "\\")
      ) {
        // Escape de " ou \ dentro de aspas duplas.
        current += command[++i];
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      // Abre uma nova aspa (não inclui o caractere de aspa em si
      // no token final).
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      // Espaço fora de aspas: finaliza o token atual, se houver.
      if (current.length > 0) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new Error(
      "Comando inválido: aspas não fechadas",
    );
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}
