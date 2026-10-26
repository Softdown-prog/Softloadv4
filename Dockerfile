# ── Stage: build-info ─────────────────────────────────────────────────────
# Pass immutable source metadata from the GitHub Actions checkout. We no longer
# need to install git or send the entire .git history into the Docker context.
# For manual/local builds, unknown is explicit rather than a misleading SHA.
FROM node:20-slim AS build-info
ARG SOURCE_GIT_SHA=unknown
ARG SOURCE_GIT_DATE=unknown
RUN printf '%s\n' "$SOURCE_GIT_SHA" > /GIT_SHA \
    && printf '%s\n' "$SOURCE_GIT_DATE" > /GIT_DATE

# ── Stage: frontend-build ─────────────────────────────────────────────────
# Achado real: a imagem final sempre instalou só `--only=production`
# (nunca tem `vite`/`@vitejs/plugin-react`, que são devDependencies) e
# nunca rodava `npm run build` — a imagem só copiava o que já estivesse
# commitado em public/dist/. Isso tornava o build do React um passo 100%
# manual e sem rede de segurança: editar frontend/*.jsx e esquecer de
# rodar `npm run build` antes de commitar deixava a produção servindo um
# bundle desatualizado, silenciosamente (confirmado na prática: um
# `vite build` local contra o código-fonte já em main produzia um bundle
# diferente do que estava commitado). Stage isolado, com devDependencies
# completas só aqui — nunca entra na imagem final além do public/dist/
# gerado, via COPY --from mais abaixo.
FROM node:20-slim AS frontend-build
WORKDIR /usr/src/app
COPY package*.json vite.config.js ./
# scripts/vendorAssets.js copiado antes do `npm ci` de propósito: ele roda
# via postinstall (ver package.json) — sem isso, o postinstall falha com
# "Cannot find module '/usr/src/app/scripts/vendorAssets.js'" porque nada
# além de package*.json existe no container ainda neste ponto (achado real,
# quebrou o deploy da PR #662: build passava local, porque `npm install` ali
# roda com o repo inteiro já no disco — só falha neste COPY em 2 passos).
COPY scripts/vendorAssets.js ./scripts/vendorAssets.js
RUN npm ci --legacy-peer-deps
# Comprova que os assets publicados sao identicos aos pacotes npm instalados.
RUN npm run verify:vendor
COPY frontend ./frontend
RUN npm run build

# ── Stage final ────────────────────────────────────────────────────────────
# node:18-slim — nenhuma dependência do projeto compila addon nativo (checado:
# zero binding.gyp na árvore de node_modules); a única vez que isso deixou de
# ser verdade (sharp, puxado transitivamente por @xenova/transformers) o
# pacote já foi removido do projeto. Volta pra slim reduz imagem/superfície
# sem perder nada hoje — se uma dependência futura precisar compilar algo
# nativo, isso aparece como falha clara no `npm install` abaixo, não como
# silêncio.
FROM node:20-slim
WORKDIR /usr/src/app
# python3-minimal — único uso: src/solaris/workers/pythonWorker.js faz
# shell-out pra `python3 -c "ast.parse(...)"` (Worker de validação
# Flask/Django, tipo "py"). NUNCA exec()/eval() — ast.parse só constrói a
# árvore sintática do código do usuário, nenhuma linha roda de verdade,
# nenhum import é resolvido. Decisão consciente de exceção ao "zero
# dependência de sistema" do resto da imagem (ver comentário abaixo):
# não existe parser Python puro-JS maduro o bastante pra sintaxe Python 3
# moderna (avaliados: filbert/python-ast) — sem alternativa determinística
# puro-JS viável, entra o runtime mínimo só pra validar sintaxe (ver
# src/solaris/workers/pythonWorker.js e src/solaris/pipeline/orchestrator.js
# pro racional completo).
RUN apt-get update && apt-get install -y --no-install-recommends python3-minimal python3-venv ffmpeg fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
COPY agent/forge/requirements.txt /tmp/forge-requirements.txt
RUN python3 -m venv /opt/solaris-forge && /opt/solaris-forge/bin/pip install --no-cache-dir -r /tmp/forge-requirements.txt
ENV SOLARIS_FORGE_PYTHON=/opt/solaris-forge/bin/python
COPY package*.json ./
# Mesmo motivo do stage frontend-build acima: o postinstall (vendorAssets.js)
# precisa existir no disco no momento do `npm install`, antes do `COPY . .`.
COPY scripts/vendorAssets.js ./scripts/vendorAssets.js
RUN npm ci --omit=dev --ignore-scripts --legacy-peer-deps
COPY . .
# A7 tools are available in the actual production image, with binary resources.
RUN node agent/forge/verify-source.cjs && node agent/forge/smoke.cjs
# Sobrescreve o public/dist/ copiado do repo (que pode estar desatualizado
# — é só uma conveniência pra rodar `node server.js` localmente sem buildar
# antes) pelo bundle fresco do stage frontend-build acima. A imagem de
# produção NUNCA depende do que estiver commitado em public/dist/.
COPY --from=frontend-build /usr/src/app/public/dist ./public/dist
# O postinstall roda apenas no estágio frontend (que tem Bootstrap e Chart.js)
# e gera estes arquivos locais. A imagem do servidor recebe o resultado, sem
# carregar as dependências de frontend em node_modules.
COPY --from=frontend-build /usr/src/app/public/vendor ./public/vendor
# Verifica links /vendor/ declarados nos templates EJS contra os arquivos da imagem.
RUN node scripts/vendorTemplateRefs.js
# Smoke HTTP sob Node da imagem: Bootstrap/Chart, MIME, Cache-Control, ETag e 404.
RUN node src/core/vendorStaticPolicy.test.js
COPY --from=build-info /GIT_SHA /usr/src/app/GIT_SHA
COPY --from=build-info /GIT_DATE /usr/src/app/GIT_DATE
RUN date -u +"%Y-%m-%dT%H:%M:%SZ" > /usr/src/app/BUILD_TIME
# Smoke test determinístico: carrega, sob o Node exato desta imagem, toda a
# árvore de require() que server.js carrega ANTES de app.listen(). Existe
# porque um require() de pacote ESM-only (parse5@8, "ERR_REQUIRE_ESM") ou um
# SyntaxError num template literal (crase não escapada em chat.js, incidente
# anterior) só quebram nessa versão exata do Node — o dev local roda Node
# mais novo (com require(esm) e sem o bug), então nenhum teste local pega
# isso. Falha AQUI, no build, sem `|| true` — é o mesmo princípio de
# verificação mecânica pós-compilação já usado no resto do compilador
# (dossieIntegrityChecker etc.): nunca confiar que "rodou aqui" significa
# "roda em produção".
RUN node -e "require('./src/services/envBoot');require('./src/services/firebase');require('./src/middlewares/security');require('./src/routes/authRoutes');require('./src/routes/dashboardRoutes');require('./src/routes/contatoRoutes');require('./src/routes/apiRoutes');require('./src/routes/adminRoutes');require('./src/routes/workersRoutes');require('./src/services/sentinelWorker');require('./src/services/errorLogWorker');require('./src/services/buildInfo');console.log('[BUILD] Grafo de módulos de server.js carrega sem erro sob Node ' + process.version);"
EXPOSE 8080
CMD ["node", "server.js"]

