#!/bin/sh
# Wrapper de contenção do processo do navegador (Chromium/WebKit) --
# ver "Isolamento de memória/CPU por requisição" em README.md e o
# comentário em browser.js (launchBrowser).
#
# `browser.js` sempre lança o navegador através DESTE script como
# `executablePath` (nunca o binário real diretamente), passando o
# caminho real do binário e o teto de CPU via VARIÁVEL DE AMBIENTE
# (launchOptions.env) -- não dá pra usar argv extra como em
# extractArchive.js/runBsdTar(), porque o Playwright monta ele mesmo
# o array de argumentos do navegador logo depois de `executablePath`,
# sem espaço pra argumentos posicionais nossos antes.
#
# Só RLIMIT_CPU (`ulimit -t`, segundos de CPU REALMENTE consumidos,
# não wall-clock) é aplicado aqui -- RLIMIT_AS (memória virtual, usado
# pro bsdtar) foi testado contra um Chromium real e descartado: só o
# processo renderer reserva ~1.4TB de ESPAÇO DE ENDEREÇAMENTO VIRTUAL
# de saída (ASLR/pointer compression/guard pages -- não é memória
# física de verdade), então qualquer RLIMIT_AS baixo o bastante pra
# ser útil impede até o navegador de terminar de subir. Mesma
# observação documentada no README.
#
# Mesma regra de ouro já aplicada em extractArchive.js: se o `ulimit`
# falhar por QUALQUER motivo, ABORTA (nunca deixa o navegador rodar
# sem o teto aplicado, silenciosamente) -- exit code reservado (99),
# nunca confundido com um código de saída real do navegador.
if [ -z "$SANDBOX_BROWSER_REAL_EXECUTABLE" ]; then
  echo "sandbox-efemero: SANDBOX_BROWSER_REAL_EXECUTABLE não definida -- recusando lançar sem saber qual binário rodar" >&2
  exit 99
fi

if [ -z "$SANDBOX_BROWSER_CPU_LIMIT_SECONDS" ]; then
  echo "sandbox-efemero: SANDBOX_BROWSER_CPU_LIMIT_SECONDS não definida -- recusando lançar sem teto de CPU" >&2
  exit 99
fi

ulimit -t "$SANDBOX_BROWSER_CPU_LIMIT_SECONDS" || {
  echo "sandbox-efemero: falha ao aplicar ulimit -t $SANDBOX_BROWSER_CPU_LIMIT_SECONDS -- recusando lançar sem o teto de CPU" >&2
  exit 99
}

exec "$SANDBOX_BROWSER_REAL_EXECUTABLE" "$@"
