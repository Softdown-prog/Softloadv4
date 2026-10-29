# Piloto da imagem Docker Lite — somente GitHub Actions

Esta variante é uma preparação **reversível** para a Softload Blogger + A7 Forge 2D, não uma atualização da VPS.

## O que muda no piloto
- `Dockerfile.lite` usa um estágio temporário para copiar somente os arquivos Bootstrap/Chart.js usados nos EJS. **Não executa Vite nem compila React.**
- A imagem final copia `server.js`, `src/`, `views/`, `public/` (sem `public/dist/`), `scripts/`, `manifests/` e `agent/forge/` (somente a ferramenta 2D).
- `agent/src/`, `frontend/`, `docs/`, exemplos e mídias antigas desnecessárias ficam fora da imagem final.
- Mantém Node, Firestore/Firebase Auth, Mercado Pago, NodeMail, libs atuais, Python/Pillow, FFmpeg e fontes necessários para preservar a compatibilidade nesta etapa. Não reduz ainda o `package-lock.json`.
- Os testes de smoke dentro da imagem conferem a geração A7, as bibliotecas EJS e a inicialização de módulos HTTP. A imagem é medida em bytes no CI, **não transferida**.

## Como testar sem afetar clientes

A workflow `.github/workflows/lite-image-ci.yml` executa em PRs que mudam o Dockerfile.lite ou seu próprio CI; também pode ser disparada manualmente.

```bash
node --test scripts/liteImage.contract.test.cjs
docker build --progress plain -f Dockerfile.lite --build-arg GIT_SHA=dev-pilot -t softload-lite-ci:local .
docker image inspect softload-lite-ci:local --format '{{.Size}} bytes'
```

Não usar `docker system prune`, `docker compose down -v`, nem substituir serviços durante esse teste.

## O que esta entrega NÃO faz

- Não modifica `.github/workflows/deploy.yml`, `Dockerfile`, `agent/Dockerfile`, ou o receptor instalado na VPS.
- Não para nem remove o contêiner `agent`.
- Não exclui volumes, arquivos GCS, dados do Firestore ou pagamentos.
- Não ativa a nova área de arquivos, ainda controlada por `SOFTLOAD_LITE_FILES_ENABLED`.
- Não promete reduzir o uso do SSD: o CI mostra apenas o tamanho da **imagem experimental isolada**. A economia real depende de ativação e remoção de imagens sem uso, após backup e rollback.

## Antes do deploy App-only

1. Validar integralmente o resultado de `lite-image-ci`, incluindo boot, login Firebase, Blogger XML, Forge 2D, webhook Mercado Pago, histórico e downloads, de preferência com ambiente de homologação.
2. Identificar e neutralizar consumidores de `agent` no `compose.vps.yaml` existente na VPS. Não presumir que somente editar o repositório altera o Compose do host.
3. Criar/revisar um **novo contrato negociado** do receptor SSH e do workflow para aceitar App-only, com rollback funcional para a versão App+Agent anterior. A troca deve ser atômica e compatível com o receptor instalado.
4. Medir tamanho real das imagens antigas e novas, preservar a revisão anterior e confirmar health externo.
5. Somente depois, limpar **imagens não referenciadas** e auditar volumes separadamente. Os volumes de clientes ficam intocados.

## Reversão
Ao encontrar regressão, continuar com `Dockerfile` e o workflow de deploy originais. Enquanto o piloto não for ativado, nenhuma reversão na VPS é necessária.
