# Estágio 1: compila o diff_patch_engine (Power-up/diff_patch_engine.cpp,
# vendorizado para native/ via `npm run vendor:power-up` -- ver
# scripts/vendorPowerUp.js). Isolado num estágio próprio para que o
# toolchain de compilação (g++) e o código-fonte C++ nunca entrem na
# imagem final: só o binário já compilado atravessa para o próximo
# estágio via COPY --from.
FROM debian:bookworm-slim AS cpp-builder

RUN apt-get update && apt-get install -y --no-install-recommends g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build

# Se este COPY falhar com "not found", rode `npm run vendor:power-up`
# (na pasta agent/) antes de `docker build` -- native/ é gerado
# localmente a partir de Power-up/diff_patch_engine.cpp e nunca é
# commitado (ver .gitignore).
COPY native/diff_patch_engine.cpp ./diff_patch_engine.cpp

RUN g++ -std=c++17 -O2 -o diff_patch_engine diff_patch_engine.cpp

# Estágio 2: imagem final do Worker Agent (Node.js) -- igual à anterior,
# com a adição do binário compilado no estágio acima.
FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production

# Ferramentas necessárias para o Worker Agent
RUN apt-get update && apt-get install -y \
    git \
    git-lfs \
    curl \
    wget \
    unzip \
    zip \
    tar \
    gzip \
    bzip2 \
    xz-utils \
    ca-certificates \
    openssh-client \
    jq \
    tree \
    nano \
    vim \
    build-essential \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    fonts-dejavu-core \
    python-is-python3 \
    php-cli \
    php-curl \
    php-mbstring \
    php-xml \
    php-zip \
    php-intl \
    php-gd \
    composer \
    && rm -rf /var/lib/apt/lists/*

# Configura o Git para aceitar qualquer diretório no workspace sem erro de permissão
RUN git config --system --add safe.directory '*'

COPY forge/requirements.txt /tmp/forge-requirements.txt
RUN python3 -m venv /opt/solaris-forge && /opt/solaris-forge/bin/pip install --no-cache-dir -r /tmp/forge-requirements.txt
ENV SOLARIS_FORGE_PYTHON=/opt/solaris-forge/bin/python

# Prepara a estrutura da aplicação e do workspace com as permissões corretas
WORKDIR /app
RUN mkdir -p /workspace && chown -R node:node /app /workspace

# Copia arquivos do pacote ajustando o dono para o usuário não-root
COPY --chown=node:node package*.json ./

# Alterna para o usuário não-root para instalar dependências e rodar a aplicação
USER node

RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=node:node src ./src
COPY --chown=node:node forge ./forge
RUN node forge/verify-source.cjs && node forge/smoke.cjs

# Binário do diff_patch_engine, compilado no estágio cpp-builder acima.
# Fica em /app/bin (junto com o resto do código do agent) para as
# capabilities do agent invocá-lo via subprocesso, do mesmo jeito que já
# fazem com git/npm/etc (ver execa em src/utils/run-command.js).
COPY --from=cpp-builder --chown=node:node /build/diff_patch_engine /app/bin/diff_patch_engine
RUN chmod +x /app/bin/diff_patch_engine
ENV PATH="/app/bin:${PATH}"

# Define o diretório de trabalho onde o agente vai operar
WORKDIR /workspace

EXPOSE 8080

ENTRYPOINT ["node", "/app/src/index.js"]

