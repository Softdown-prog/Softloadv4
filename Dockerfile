# syntax=docker/dockerfile:1
# IMAGEM DO APP DE PRODUÇÃO: Blogger em Node + EJS, sem React/Forge.
# O Agent continua separado; receptor v2 app+agent e rollback preservados.

# Vendorização somente de Bootstrap e Chart.js. Instala dependências de
# desenvolvimento no BUILD, sem executar Vite/React nem copiar o bundle.
FROM node:20-slim AS vendor
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
COPY scripts/vendorAssets.js ./scripts/vendorAssets.js
RUN npm ci --legacy-peer-deps --ignore-scripts \
    && node scripts/vendorAssets.js \
    && node scripts/vendorAssets.js --verify

# App Node + EJS exclusivamente Blogger; sem toolchains Python/FFmpeg.
FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /usr/src/app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --legacy-peer-deps \
    && npm cache clean --force

# COPY seletivo: sem frontend/, sem agent/, sem documentos,
# sem código-fonte da interface antiga na raiz do contêiner.
# public/dist/ também é excluído do contexto via Dockerfile.lite.dockerignore.
COPY server.js ./
COPY src ./src
COPY views ./views
COPY public ./public
COPY scripts ./scripts
COPY manifests ./manifests
COPY --from=vendor /usr/src/app/public/vendor ./public/vendor

# Testes não destrutivos, em build. Manter o mesmo grafo de require de
# produção; nenhum endpoint externo ou job do Agent é executado.
RUN test ! -d /usr/src/app/frontend \
    && test ! -d /usr/src/app/agent \
    && test ! -e /usr/src/app/public/dist/assets/main.js \
    && test ! -e /usr/src/app/views/pages/forge-2d.ejs \
    && test ! -e /usr/src/app/src/routes/dashboard_routes/forgeStandalone.cjs
RUN node scripts/vendorTemplateRefs.js \
    && node src/core/vendorStaticPolicy.test.js
RUN node -e "require('./src/services/envBoot');require('./src/services/firebase');require('./src/middlewares/security');require('./src/routes/authRoutes');require('./src/routes/dashboardRoutes');require('./src/routes/contatoRoutes');require('./src/routes/apiRoutes');require('./src/routes/adminRoutes');require('./src/routes/workersRoutes');require('./src/services/sentinelWorker');require('./src/services/errorLogWorker');require('./src/services/buildInfo');console.log('[LITE] Grafo de boot carregado em ' + process.version)"

ARG GIT_SHA=dev-local
ARG GIT_DATE=unknown
RUN printf '%s\n' "$GIT_SHA"  > /usr/src/app/GIT_SHA \
    && printf '%s\n' "$GIT_DATE"  > /usr/src/app/GIT_DATE \
    && date -u +"%Y-%m-%dT%H:%M:%SZ" > /usr/src/app/BUILD_TIME
EXPOSE 8080
CMD ["node", "server.js"]
