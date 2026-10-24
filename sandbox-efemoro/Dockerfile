FROM node:22-bookworm

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

# Instala o Chromium + dependências de sistema (libnss3, libatk, etc.
# via --with-deps). ATENÇÃO: precisa de acesso de rede ao CDN do
# Playwright durante o build -- se o ambiente de build tiver política
# de rede restritiva, este passo falha (mesmo tipo de restrição já
# visto bloquear docker.io durante o desenvolvimento deste serviço,
# ver PR #670). Só Chromium por padrão; WebKit também é suportado
# pelo código (browser.js), mas dobra tempo/tamanho de build -- só
# instale se for realmente necessário testar em WebKit:
# RUN npx playwright install --with-deps webkit
# Perfil completo permanece o padrão para NÃO perder auditorias web em produção.
# 0 = imagem menor para serviço dedicado somente à extração de arquivos.
# A imagem archive-only NÃO deve substituir a instância de auditoria web.
ARG INSTALL_CHROMIUM=1
ENV SANDBOX_CHROMIUM_INSTALLED=${INSTALL_CHROMIUM}
RUN set -eu; \
    case "$INSTALL_CHROMIUM" in \
      1) npx playwright install --with-deps chromium ;; \
      0) echo "[SANDBOX] Perfil archive-only: Chromium não será instalado" ;; \
      *) echo "INSTALL_CHROMIUM deve ser 0 ou 1" >&2; exit 1 ;; \
    esac

COPY src ./src

# Usuário não-root: este container renderiza conteúdo NÃO confiável
# (a app sob teste) dentro de um navegador -- não há motivo para isso
# rodar como root, e reduz o dano de um eventual escape do Chromium.
RUN groupadd -r sandbox \
    && useradd -r -g sandbox -m sandbox \
    && chown -R sandbox:sandbox /app
USER sandbox

# Cloud Run injeta a variável PORT em runtime; server.js já usa
# process.env.PORT com fallback para 8080.
EXPOSE 8080

ENTRYPOINT ["node", "/app/src/server.js"]
