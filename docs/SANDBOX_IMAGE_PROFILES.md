# Perfis de imagem Docker do sandbox Solaris

## Qual problema estamos resolvendo

O Chromium é **instalado durante o `docker build`**, não está versionado no
repositório GitHub. Por isso a soma de arquivos rastreados pelo Git **não mede**
o tamanho do navegador. O serviço `sandbox-efemoro` acumula duas funções:

- `POST /run`: auditorias de navegador com Playwright (capturas de tela,
  console, responsividade, acessibilidade).
- `POST /extract-zip` e `POST /extract-archive`: extração isolada de
  ZIP, RAR, 7z e TAR.

Uma extração de arquivo não necessita iniciar Chromium. O servidor de
navegador atual já é *lazy*: lança browser apenas quando recebe `/run`
e fecha o processo ao concluir. Só desligar a execução ociosa não reduz
o tamanho da imagem em disco.

## Perfis disponíveis

**Padrão — completo (produção atual):**

```bash
docker build -f sandbox-efemoro/Dockerfile -t softload-sandbox:full sandbox-efemoro
```

Mantém `INSTALL_CHROMIUM=1` e todas as funções. O workflow
`.github/workflows/deploy.yml` **permanece neste perfil por padrão**.
A política de isolamento entre Agent e sandbox é preservada.

**Opcional — archive-only (instância dedicada):**

```bash
docker build --build-arg INSTALL_CHROMIUM=0 \
  -f sandbox-efemoro/Dockerfile -t softload-sandbox:archive-only sandbox-efemoro
```

Continua instalando o pacote JS `playwright`, mas **não baixa o binário
Chromium nem suas dependências nativas extras**. Mantém os endpoints de
extração. O endpoint `/run` responde HTTP 503 com
`{"error":"capability_unavailable","capability":"browser"}`,
sem tentar iniciar um navegador. Portanto, **não encaminhe auditorias web
para a imagem archive-only**.

> Não substituir o sandbox de produção pelo archive-only sem separar as
> rotas de auditoria e de extração no Agent e sem validar essas rotas.
> Isso seria perda de funcionalidade, não otimização transparente.

## Onde ver números reais

O workflow `Deploy Softload VPS` agora informa, nos logs e no resumo do
job de cada serviço:

- tamanho local da imagem Docker (`docker image inspect .Size`);
- bytes do arquivo `docker save | gzip -1` enviado à VPS.

Esses números não são a RAM de processos em uso: RAM exige medições de
`docker stats` / `docker inspect` executadas no host e não foi medida
por estas alterações.

O arquivo `.dockerignore` na raiz exclui `public/dist/` do contexto de
build: o estágio `frontend-build` executa `npm run build` e o estágio
final copia o resultado recém-gerado. Isso não apaga nenhum arquivo do
Git, nem deixa de servir o frontend React.

## Alterações deliberadamente adiadas

As imagens do Visitor Forge 2D não foram removidas: `agent/forge/UPSTREAM.json`
e `agent/forge/verify-source.cjs` conferem hashes individuais dos arquivos
upstream, e os renderizadores podem utilizar recursos adicionais. Antes de
criar uma distribuição runtime reduzida, construir uma lista exata de
recursos referenciados, manter o verificador no estágio de build e executar
todos os testes de renderização em ambas as imagens.

Também não foram removidos Python, ffmpeg, php-cli, ferramentas de build
ou outras dependências do Agent: essas operações pertencem às capacidades
efetivamente oferecidas pelo Solaris Code.

## Separação opcional de serviços — Agent e sandbox

O Agent mantém compatibilidade total com a VPS atual:

| Função | URL dedicada opcional | Segredo dedicado opcional |
|---|---|---|
| Auditoria web | `SANDBOX_BROWSER_SERVICE_URL` | `SANDBOX_BROWSER_SHARED_SECRET` |
| Extração ZIP | `SANDBOX_ARCHIVE_SERVICE_URL` | `SANDBOX_ARCHIVE_SHARED_SECRET` |

As capacidades que não têm URL dedicada continuam usando
`SANDBOX_SERVICE_URL`. Sem segredo dedicado, usam
`SANDBOX_SHARED_SECRET`. **Nenhuma nova variável é obrigatória
no deploy atual.**

O servidor de sandbox admite `SANDBOX_MODE=full|browser|archive`.
A imagem com Chromium começa em `full` (todas as rotas);
`browser` restringe ao endpoint de auditoria;
a imagem `INSTALL_CHROMIUM=0` inicia automaticamente em `archive`.
Rotas desabilitadas respondem 503 **após autenticação**.
Uma imagem sem Chromium recusa configuração `browser` ou `full`.

### Como ativar na VPS futuramente

1. Manter o container atual completo, incluindo o navegador.
2. Implantar um **segundo** container isolado com
   `--build-arg INSTALL_CHROMIUM=0` e segredo compartilhado.
   O workflow de deploy existente **não cria este segundo container**.
3. Validar `/health`, `/extract-zip`, `/extract-archive` e que
   `/run` retorna 503 no container leve.
4. Configurar `SANDBOX_ARCHIVE_SERVICE_URL` no Agent para o novo serviço.
   Auditorias continuam apontando para o container completo via fallback.
5. Em caso de problema, remover `SANDBOX_ARCHIVE_SERVICE_URL`:
   extrações retornam automaticamente à instância legada.

O container leve reduz **disco/imagem** em comparação ao completo.
Uma segunda instância rodando simultaneamente pode consumir RAM extra;
não afirmar economia de RAM sem medir `docker stats`.
