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

**Padrão — auditoria web completa usando Chromium Headless Shell (candidato):**

```bash
docker build -f sandbox-efemoro/Dockerfile -t softload-sandbox:full sandbox-efemoro
```

Mantém `INSTALL_CHROMIUM=1` e todas as funções, mas a imagem em teste
instala somente `chromium-headless-shell` via `playwright install --with-deps
--only-shell chromium`. A instalação reduzida é adequada porque o Agent usa
somente renderização headless, screenshots e testes, não janelas gráficas.
O wrapper existente de RLIMIT_CPU permanece ativo. O Dockerfile descobre o
binário do shell instalado e grava um manifesto interno para evitar que
`chromium.executablePath()` aponte ao Chromium completo que não foi baixado.

O build executa um smoke real como usuário `sandbox` (launch, DOM e screenshot)
e falha se o navegador reduzido não funcionar. A redução efetiva de tamanho
ainda **precisa ser medida** no job de validação de PR antes de ativar a
mudança em produção.

O workflow `.github/workflows/deploy.yml` continua usando esse perfil com
auditoria web quando a mudança for integrada à `main`.
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

## Validação do Chromium Headless Shell

O job `browser-headless-shell` de
`.github/workflows/sandbox-boundary.yml` constrói a imagem completa
na verificação de pull requests, testa lançamento/DOM/screenshot
durante o próprio build e registra o tamanho de imagem
`docker image inspect .Size`. Não instala navegador na VPS e não
ativa containers de produção. Quando integrada à `main`, o deploy
existente compila a imagem da mesma forma e só substitui o serviço se
a cadeia de verificações e transferência passar.

O Shell Headless não é idêntico ao Chromium com GUI em modo headless
moderno: páginas que dependem de recursos específicos podem se comportar
de modo diferente. O smoke cobre o caso mínimo, mas auditorias reais
do Solaris devem ser verificadas antes da troca definitiva.

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

## Etapa 2: imagem archive-slim independente

O arquivo `sandbox-efemoro/Dockerfile.archive` cria um perfil separado com
`node:22-bookworm-slim`, `libarchive-tools` e o código existente de extração.
O arquivo `Dockerfile` (com Chromium) **não foi alterado**. Os dois mantêm o
mesmo `package-lock.json`; o perfil leve não instala browsers no build.

```bash
docker build -t softload-sandbox:archive-slim \
  -f sandbox-efemoro/Dockerfile.archive sandbox-efemoro
```

O CI `Solaris Sandbox - fronteiras e perfil leve` compila esta imagem,
executa um container com rede externa desabilitada para verificar
`/health`, autenticação por segredo, rejeição de auditoria de navegador
(HTTP 503) e a resposta da extração ZIP, valida o Compose e registra
o tamanho real da imagem. Os números da versão slim devem ser retirados
dos logs de Actions; nunca assumir tamanho ou economia antes desse build.

### Compose opcional para VPS (não ativado automaticamente)

O arquivo `sandbox-efemoro/compose.archive.yml` cria um serviço separado
no mesmo Docker network do Agent, sem publicar porta no host, sem
privilégios adicionais e com filesystem raiz somente leitura. Exige
que a rede Docker já exista.

Na VPS, com acesso administrativo legítimo e o repositório já disponível:

```bash
# Exemplo: use o nome da rede Docker onde o Worker Agent esta conectado.
export SOFTLOAD_DOCKER_NETWORK='NOME_REAL_DA_REDE_DO_AGENT'
export SANDBOX_ARCHIVE_SHARED_SECRET='SEGREDO_GERADO_COM_SEGURANCA'

# O mesmo nome/tag precisa existir no daemon Docker da VPS.
docker build -t softload-sandbox:archive-slim \
  -f sandbox-efemoro/Dockerfile.archive sandbox-efemoro
docker compose -f sandbox-efemoro/compose.archive.yml up -d
docker compose -f sandbox-efemoro/compose.archive.yml ps
```

A URL no Agent depois de validar conectividade na rede do Docker é,
tipicamente, `http://archive:8080` **apenas se o nome da rede/serviço
resolver assim naquele ambiente**; confirme na rede real antes de
configurar `SANDBOX_ARCHIVE_SERVICE_URL`. Configure o segredo
`SANDBOX_ARCHIVE_SHARED_SECRET` do Agent igual ao do novo container.
Sem essa variável de URL, o Agent continua usando o sandbox antigo.

Para rollback, desfaça apenas a variável `SANDBOX_ARCHIVE_SERVICE_URL`
do Agent e reinicie o Agent conforme seu procedimento normal; depois
remova a instância archive-slim se desejar.

O protocolo SSH de deploy da VPS atualmente suporta apenas os quatro
serviços originais, e o novo Compose **não pode ser ativado por esse
workflow existente**. Não dar a entender que um commit no GitHub já
provisionou a instância archive-slim na VPS.

### Por que o deploy completo não deve baixar Chromium toda vez

O planejamento em `deploy.yml` agora considera como entradas da
imagem **completa** somente `Dockerfile`, `.dockerignore`,
`package.json`, `package-lock.json` e `src/` do sandbox.
Mudanças em `Dockerfile.archive`, `compose.archive.yml` e scripts
exclusivos da imagem slim não provocam desnecessariamente um rebuild
e a transferência da imagem completa do Chromium.
