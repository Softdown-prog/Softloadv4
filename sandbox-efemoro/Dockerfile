FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
# Instala os browsers do Playwright dentro de node_modules/ em vez do
# cache padrão em $HOME -- evita problema de permissão quando o
# processo roda como usuário não-root (ver USER sandbox abaixo).
ENV PLAYWRIGHT_BROWSERS_PATH=0
# `npm ci` não deve tentar baixar os browsers via postinstall -- o
# download explícito (com --with-deps, que também instala bibliotecas
# de sistema) acontece no passo dedicado abaixo, uma única vez.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

# Motor maduro para RAR, 7z e TAR. A integração em JS lê cada entrada
# limitada no stdout e nunca materializa o conteúdo extraído em disco.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libarchive-tools \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# O Solaris usa o navegador SOMENTE para automação (prints, testes,
# acessibilidade). Instala apenas chromium-headless-shell e dependências:
# evita carregar também o Chromium com interface gráfica.
# Playwright 1.55 inclui dois binários; --only-shell baixa apenas um deles.
# Como browser.js preserva o wrapper de RLIMIT_CPU via executablePath,
# gravamos o caminho REAL do headless shell num manifesto interno.
# Sem isso, chromium.executablePath() apontaria ao Chromium completo
# que não está instalado nesta imagem.
ARG INSTALL_CHROMIUM=1
ENV SANDBOX_CHROMIUM_INSTALLED=${INSTALL_CHROMIUM}
RUN set -eu; \
    case "$INSTALL_CHROMIUM" in \
      1) \
        npx playwright install --with-deps --only-shell chromium; \
        shell_bin="$(find /app/node_modules/playwright-core/.local-browsers \
          -type f \( -name chrome-headless-shell -o -name headless_shell \) -print -quit)"; \
        test -n "$shell_bin" && test -x "$shell_bin"; \
        printf '%s\n' "$shell_bin" > /app/.chromium-headless-shell-path; \
        echo "[SANDBOX] Chromium Headless Shell instalado em $shell_bin" \
        ;; \
      0) echo "[SANDBOX] Perfil archive-only: Chromium não será instalado" ;; \
      *) echo "INSTALL_CHROMIUM deve ser 0 ou 1" >&2; exit 1 ;; \
    esac

COPY src ./src

# Usuário não-root: este container renderiza conteúdo NÃO confiável
# (a app sob teste) dentro de um navegador -- não há motivo para isso
# rodar como root, e reduz o dano de um eventual escape do Chromium.
RUN chmod 0755 /app/src/webSandbox/browserUlimitWrapper.sh \
    && groupadd -r sandbox \
    && useradd -r -g sandbox -m sandbox \
    && chown -R sandbox:sandbox /app
USER sandbox

# Smoke de verdade durante o build (já como usuário sandbox):
# valida lançamento, DOM e screenshot, sem tocar na VPS de produção.
# Qualquer incompatibilidade com o shell ou o wrapper falha o build.
RUN if [ "$SANDBOX_CHROMIUM_INSTALLED" = "1" ]; then \
      node --input-type=module -e 'import { launchBrowser, resolveRealExecutablePath } from "./src/webSandbox/browser.js"; import { accessSync, constants } from "node:fs"; accessSync(resolveRealExecutablePath("chromium"), constants.X_OK); const browser = await launchBrowser("chromium", { timeout: 30000 }); try { const page = await browser.newPage(); await page.setContent("<title>Softload headless smoke</title>"); if (await page.title() !== "Softload headless smoke") throw new Error("DOM smoke failed"); const png = await page.screenshot(); if (png.length < 100) throw new Error("Screenshot smoke failed"); } finally { await browser.close(); }'; \
    fi


# Cloud Run injeta a variável PORT em runtime; server.js já usa
# process.env.PORT com fallback para 8080.
EXPOSE 8080

ENTRYPOINT ["node", "/app/src/server.js"]
