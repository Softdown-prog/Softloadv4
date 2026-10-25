# sandbox-efemero

Serviço isolado de contenção pro Solaris Agent. Duas capacidades hoje:

1. **Auditoria de navegador** (Playwright) contra uma URL local:
   screenshot, erros de console, requisições bloqueadas/falhas,
   overflow responsivo e violações de acessibilidade (axe-core).
2. **Extração segura de arquivos** (`archive.extractZip` e
   `archive.extractArchive`) -- ZIP, RAR, 7z e TAR; primeira etapa
   de uma evolução gradual deste serviço rumo a uma camada de
   contenção mais ampla (ver "Extração de arquivos" abaixo e a seção
   "Evolução planejada" no fim deste arquivo).

`sandbox.md`, na raiz desta pasta, é o documento original de intenção
que motivou este serviço -- mantido como registro histórico da ideia.
Este README descreve o que foi **de fato implementado**, depois de uma
revisão que encontrou vários problemas no documento original (ver
seção "O que mudou em relação ao `sandbox.md`" abaixo).

## Por que um serviço/container separado, e não uma capability do `agent/`

Decisão de arquitetura deliberada: este serviço **não** roda no mesmo
container que o Worker Agent (`agent/`). Ele não tem nenhuma
credencial de git, nenhum acesso ao workspace do agent, nenhuma
permissão de GCP além do mínimo necessário para rodar em Cloud Run.

Motivo original (web sandbox): `--no-sandbox` (necessário pro Chromium
rodar em container) desliga a principal barreira de segurança do
próprio navegador contra uma página maliciosa. Se esse processo
rodasse no mesmo container que `shell.execute`/`git.commit`/
`file.write`, um escape do Chromium viraria comprometimento do agent
inteiro. Separando em container + credenciais próprios, o pior caso de
um escape fica contido a um serviço que não tem nada de valioso para
roubar.

Mesmo raciocínio se aplica a processar um `.zip` enviado por um
usuário (entrada não-confiável por definição): mesmo com validação
cuidadosa, o lugar certo pra descomprimir bytes de origem desconhecida
é um container sem credenciais de git/shell/workspace pra perder num
eventual bug de parsing/descompressão -- não o mesmo processo que tem
acesso ao workspace/checkout do agent. Foi cogitado (e descartado) rodar
essa extração dentro de `native/diff_patch_engine.cpp` (o binário C++
já compilado no Dockerfile do `agent/`) -- **descartado porque esse
binário roda como subprocesso DENTRO do mesmo container do Worker
Agent, sem nenhum isolamento próprio**; "C++" não é sinônimo de
"contido" aqui. Ver detalhe na auditoria que motivou esta decisão,
registrada no histórico de commits desta capability.

O `agent/` principal fala com este serviço via HTTP (`POST /run` para
auditoria de navegador, `POST /extract-zip`/`POST /extract-archive` para
extração), não
importa seus módulos diretamente.

## API

```
GET  /health          -> 200 {"status": "ok"}
POST /run              -> 200 com o resultado estruturado (ver runner.js)
  Header: x-sandbox-secret: <SANDBOX_SHARED_SECRET>
  Body: {
    url: string (obrigatório, http/https),
    browser?: "chromium" | "webkit",
    device?: "desktop" | "android-mobile" | "iphone" | "tablet" | "mobile-landscape",
    viewport?: { width: number, height: number },
    screenshot?: boolean,
    screenshotDelivery?: "path" | "inline",  // default: "path" (legado)
    accessibility?: boolean,
    allowedHosts?: string[],   // "host" ou "host:porta"
    timeout?: number           // ms, 1000-120000
  }
```

### Screenshot entre containers (Agent → sandbox)

O sandbox continua aceitando `screenshotDelivery: "path"` (valor padrão)
para clientes legados: retorna `screenshotPath`, apontando a um arquivo
**local do próprio sandbox**. O Agent **não deve usar esse caminho**,
pois roda em outro container.

Para entregar a imagem ao Solaris, a capability TypeScript
`websandbox.run` envia automaticamente `screenshotDelivery: "inline"`
quando `screenshot !== false`. A resposta autenticada contém:

```json
{
  "success": true,
  "screenshotPath": null,
  "screenshot": {
    "mimeType": "image/png",
    "dataBase64": "iVBORw0KGgo...",
    "bytes": 12345,
    "fullPage": true
  }
}
```

Esse PNG é transportado pelo HTTPS interno da implantação (ou HTTP na
rede isolada Docker, conforme configuração). `dataBase64` é **conteúdo
binário codificado**, não uma URL pública. Quem consome a capability
pode decodificar e encaminhar os pixels a um componente de imagem ou
persisti-los num armazenamento autorizado; não deve incluir o base64
nos logs, prompts textuais ou respostas exibidas ao usuário.

O modo inline não grava PNG em `/tmp`, limita o buffer a 4 MiB e
limita a superfície renderizada a 16 milhões de pixels e 8192 pixels
de altura. Se uma página exceder esse tamanho, recua para screenshot
do viewport (campo `fullPage: false`); se ainda exceder 4 MiB,
retorna `success:false` com mensagem de erro. O modo legado
continua inalterado.

O agente valida tipo PNG, prefixo, bytes e comprimento antes de
repassar o resultado. Isto **não** é uma rota de armazenamento nem
torna imagens automaticamente visíveis ao modelo multimodal: o
consumidor final deve integrar os bytes ao fluxo de imagens. Não se
adicionou endpoint de arquivo nem acesso do sandbox ao workspace.

`POST /run` praticamente nunca responde com erro HTTP pela falha da
auditoria em si (ex: página não carregou) -- isso vira
`{"success": false, "errors": [...]}` no corpo, com HTTP 200. Só
falhas de infraestrutura (corpo malformado, request não autenticado,
erro interno inesperado) usam status de erro (400/401/500).

```
POST /extract-zip     -> 200 com o resultado estruturado (ver src/archive/extractZip.js)
  Header: x-sandbox-secret: <SANDBOX_SHARED_SECRET>
  Query string (todos opcionais, cada um tem default + teto -- ver security.js):
    maxFiles, maxFileBytes, maxTotalBytes, maxCompressedBytes, maxDepth, timeoutMs
  Body: bytes CRUS do .zip (não JSON -- um zip de poucos MB em base64
        dentro de JSON infla ~33% à toa)

  Resposta: {
    success: boolean,
    arquivos: [{ caminho, conteudo, binario }],  // conteudo:null quando binario:true
    totalArquivos: number,
    duration: number,
    errors: [{ message }]
  }
```

```
POST /extract-archive -> 200 com o mesmo resultado estruturado
  Header: x-sandbox-secret: <SANDBOX_SHARED_SECRET>
  Query: format?=auto|zip|rar|7z|tar, maxFiles, maxFileBytes,
         maxTotalBytes, maxCompressedBytes, maxDepth, timeoutMs
  Body: bytes CRUS do arquivo compactado
```

`/extract-archive` é a rota para RAR, 7z e TAR. Em `format=auto`
(padrão), ZIP/RAR/7z e TAR com cabeçalho `ustar` são identificados pelo
conteúdo, nunca pelo nome do upload. Para TAR V7 e TAR comprimido
(`.tar.gz`, `.tar.xz` etc.), informe `format=tar`, pois o body HTTP não
tem nome de arquivo e esses formatos não possuem assinatura TAR inequívoca.
`/extract-zip` continua compatível e usa somente o parser dedicado de ZIP.

Mesmo critério de `/run`: `success:false` (zip malicioso, corrompido,
acima de algum limite) volta com HTTP 200 -- só falha de
infraestrutura (não autenticado, corpo maior que o teto) usa status de
erro.

## Extração de arquivos (`archive.extractZip` e `archive.extractArchive`)

Lógica em `src/archive/extractZip.js`, **portada** (não reescrita) do
algoritmo de duas fases já maduro e testado em produção em
`src/solaris/tools/fileTools.js` (app principal) -- mesma validação
completa via central-directory ANTES de escrever qualquer byte em
disco, mesma checagem de byte-count real durante a descompressão
(defesa contra cabeçalho mentiroso). RAR/7z/TAR são processados pela
biblioteca madura **libarchive**, via `bsdtar` do pacote Debian
`libarchive-tools`; ela reconhece RAR (incluindo RAR5), 7-Zip e TAR com
filtros como gzip/xz. Não há parser próprio desses formatos.

Para RAR/7z/TAR, o wrapper chama `bsdtar` apenas neste container e nunca
o deixa extrair para uma pasta. Primeiro lista o arquivo; para cada entrada
regular validada, lê o conteúdo limitado pelo stdout. Links simbólicos ou
duros, devices, FIFOs e outros tipos não-regulares são recusados. Cada
subprocesso recebe o tempo restante da requisição e é encerrado se exceder
seu limite.

Limites de segurança (todos com default + teto, `src/archive/security.js`):

| Defesa | Como |
|---|---|
| Tamanho compactado | checado antes de sequer abrir o buffer como zip |
| Tamanho total descomprimido | soma declarada nos metadados (fase 1) -- proteção contra zip bomb |
| Tamanho por arquivo | declarado (fase 1) **e** byte count real durante a descompressão (fase 2) -- cabeçalho pode mentir |
| Quantidade de arquivos | contagem na fase 1 |
| Profundidade de caminho | segmentos de diretório por entrada |
| Path traversal (zip-slip) | `yauzl.validateFileName` + resolução segura contra o diretório de destino, em duas camadas |
| Symlink | rejeitado explicitamente (Unix mode em `externalFileAttributes`) -- mesmo sem isso, a extração nunca cria um symlink real (grava bytes crus), mas agora é uma decisão explícita, não efeito colateral |
| Extensão perigosa | denylist fixa (`security.js`, `hasDangerousExtension`) -- executáveis/scripts do Windows (`.exe`/`.bat`/`.cmd`/`.pif`/`.scr`/`.lnk`/`.vbs`/`.wsf`/`.hta`), Office com macro (`.docm`/`.xlsm`) e arquivo `.env` exato (não `.env.example`/`.env.local`, convenção comum de template sem segredo real) -- qualquer entrada assim rejeita o pacote INTEIRO, mesmo padrão de symlink/zip-slip; case-insensitive, aplicado nos dois formatos (ZIP e RAR/7z/TAR) |
| Tempo/CPU | timeout de wall-clock pra extração inteira; RAR/7z/TAR também tem RLIMIT_CPU (`ulimit -t`) no processo bsdtar |
| Espaço em disco | checado via `fs.statfs` antes da fase de escrita real |
| Limpeza em falha | diretório temporário é criado E destruído inteiramente dentro da própria função -- nunca depende de quem chamou lembrar de limpar |
| RAR/7z/TAR | libarchive só em listagem/stdout; links, devices e caminhos ambíguos são recusados antes de devolver conteúdo |
| Memória/isolamento a nível de container | ZIP roda numa worker_thread dedicada por requisição; RAR/7z/TAR roda com RLIMIT_AS (`ulimit -v`) no processo bsdtar -- ver seção abaixo |

### Isolamento de memória/CPU por requisição (archive.extractZip/extractArchive + websandbox.run)

Até esta revisão, a extração de ZIP rodava no mesmo processo/thread do
servidor Express -- um bug (no `yauzl`, no zlib nativo, ou aqui mesmo)
podia derrubar o container inteiro, levando junto qualquer requisição
concorrente na mesma instância (ex: uma auditoria de navegador rodando
ao mesmo tempo). Cada formato ganhou o mecanismo de contenção que
FUNCIONA DE VERDADE pra sua natureza -- validado experimentalmente, não
só assumido:

- **RAR/7z/TAR** (`extractArchive.js`): cada processo `bsdtar` roda
  dentro de um `/bin/sh -c 'ulimit -v ...; ulimit -t ...; exec bsdtar
  ...'` -- RLIMIT_AS (memória virtual) e RLIMIT_CPU (segundos de CPU
  consumidos), aplicados pelo próprio processo a si mesmo via `ulimit`
  (builtin POSIX de shell), sem precisar de privilégios especiais
  (diferente de cgroups, que normalmente exigem `CAP_SYS_ADMIN`,
  indisponível no Cloud Run). Um limite baixo demais faz até o
  carregador dinâmico falhar de forma limpa -- nunca um crash do
  processo pai.
- **ZIP** (`extractZip.js`): roda numa `worker_thread` dedicada por
  requisição (`zipExtractWorker.js`, criada e terminada dentro de uma
  única chamada), com `resourceLimits.maxOldGenerationSizeMb`.
  `ulimit -v` não é viável aqui -- um processo Node completo precisa
  de centenas de MB de espaço de endereçamento só pra inicializar o
  V8, então qualquer teto baixo o bastante pra ser útil impediria o
  próprio Node de subir (confirmado tentando). **Achado real ao testar
  isto de verdade**: `maxOldGenerationSizeMb` só conta o heap
  GERENCIADO do V8 (arrays/strings/objetos JS) -- `Buffer`/
  `ArrayBuffer` (o `zipBuffer` em si, e o conteúdo dos arquivos
  conforme streamam) são alocados FORA do heap do V8 e não contam pra
  esse teto. A garantia incondicional que a worker_thread realmente dá
  é **isolamento de falha**: qualquer crash (estouro de heap JS,
  exceção, bug de terceiros) mata só aquela worker, nunca o processo
  Express compartilhado. Quem efetivamente limita o tamanho de
  conteúdo/Buffer continua sendo a contagem de bytes em tempo real já
  existente (`maxFileBytes`/`maxTotalBytes`, tabela acima) -- inalterada
  por esta mudança; `maxOldGenerationSizeMb` é defesa em profundidade
  específica contra crescimento descontrolado do lado JS, não um
  substituto para essa contagem.
- Timeout de wall-clock também ficou mais forte pro ZIP: antes,
  estourar o prazo só fazia o código PARAR DE ESPERAR a extração
  (`Promise.race`) -- o trabalho em andamento continuava rodando
  "zumbi" em segundo plano até terminar sozinho. Agora,
  `worker.terminate()` cancela de verdade.

Variáveis de ambiente pra ajustar os tetos por ambiente sem rebuild
(ambas opcionais, com default seguro): `SANDBOX_BSDTAR_MEMORY_LIMIT_KB`
(default 512MB) e `SANDBOX_ZIP_WORKER_MEMORY_LIMIT_MB` (default
512MB) -- ver tabela de variáveis de ambiente abaixo.

**`websandbox.run` (Playwright/Chromium) também ganhou contenção,
numa rodada separada** -- mecanismo diferente dos dois acima, porque
o Playwright monta ELE MESMO o array de argumentos do navegador logo
depois de `executablePath` (sem espaço pra argumentos posicionais
nossos antes, ao contrário do `runBsdTar` acima, onde o processo
inteiro é controlado por este código). `browser.js` sempre lança o
navegador através de `browserUlimitWrapper.sh` (nunca o binário real
diretamente), passando o caminho real do binário e o teto de CPU via
`launchOptions.env` (variável de ambiente, não argv):

- **RLIMIT_AS foi tentado e descartado**, com números reais: um
  processo `renderer` do Chromium sozinho reserva **~1,4TB de espaço
  de endereçamento virtual** de saída (ASLR/pointer compression/guard
  pages -- não é memória física, mas RLIMIT_AS conta espaço de
  endereçamento) -- qualquer teto baixo o bastante pra ser útil contra
  memória de verdade impede até o navegador de terminar de subir
  (confirmado: 4GB de RLIMIT_AS já mata o lançamento).
- **RLIMIT_CPU** (`ulimit -t`, segundos de CPU realmente consumidos,
  não wall-clock) funciona bem aqui -- herdado por TODOS os processos
  que o navegador lança (zygote/gpu/utility/renderer, herança padrão
  de rlimit via fork/exec), cada um com seu próprio teto
  independente. Provado matando de propósito uma página com loop
  infinito: Playwright rejeita com "Page crashed", limpo, em segundos
  -- nunca trava nem derruba o processo do sandbox-efemoro (que já
  roda o navegador como processo do SO separado -- isolamento de
  falha inerente à arquitetura, não uma garantia nova).
- **`--js-flags=--max-old-space-size=N`** -- teto de heap do V8
  especificamente pro JAVASCRIPT DA PÁGINA sendo testada (não pro
  Chromium como um todo). Mesma classe de defesa que
  `maxOldGenerationSizeMb` deu pra worker do ZIP: não cobre memória
  nativa do navegador, mas cobre o vetor mais óbvio de abuso (uma
  página maliciosa alocando memória sem limite via JS). Provado: um
  script que aloca memória sem parar sob um teto de 32MB falha com
  "Target crashed", limpo.

Variáveis de ambiente novas (todas opcionais, com default seguro):
`SANDBOX_BROWSER_CPU_LIMIT_GRACE_SECONDS` (margem somada ao `timeout`
da requisição pra formar o teto de CPU -- RLIMIT_CPU cobre a vida
inteira do processo, não só o lançamento/navegação; default 60s),
`SANDBOX_BROWSER_CPU_LIMIT_SECONDS_OVERRIDE` (teto absoluto,
ignorando o cálculo acima -- defesa em profundidade extra), e
`SANDBOX_PAGE_JS_HEAP_LIMIT_MB` (default 512MB) -- ver tabela de
variáveis de ambiente abaixo.

Diferente de `fileTools.js` (que devolve só a lista de caminhos, pra
depois serem lidos separadamente), esta extração já devolve o
CONTEÚDO de cada arquivo de texto na resposta (é stateless -- este
serviço não guarda nada em disco além da duração da própria
requisição, então não há um "depois" pra reler). Arquivo binário
(heurística: presença de byte nulo) vem marcado sem conteúdo embutido,
fora de escopo desta primeira etapa (projetos de texto).

### Isolamento de filesystem (read-only root)

Diferente de memória/CPU (RLIMIT_AS/RLIMIT_CPU) e rede (iptables/nft),
que exigem privilégio DENTRO do container (`CAP_SYS_ADMIN`/`NET_ADMIN`)
indisponível no Cloud Run/gVisor (ver seção acima e "Evolução
planejada"), restringir o filesystem raiz a **read-only** é um
mecanismo diferente: é aplicado pelo **orquestrador** (Cloud Run
`securityContext.readOnlyRootFilesystem: true`, ou `docker run
--read-only`), não pelo processo dentro do container. Não precisa de
nenhum privilégio especial da aplicação -- só precisa que a aplicação
não tente escrever fora de um caminho montado como volume writable.

Auditoria de todo write deste serviço (não confiada de memória --
verificada lendo cada módulo que chama `fs.write*`/`fs.mkdir*`):

| Módulo | O que escreve | Onde |
|---|---|---|
| `src/archive/extractZip.js` | conteúdo ZIP extraído (temporário) | `os.tmpdir()` |
| `src/archive/extractArchive.js` | conteúdo RAR/7z/TAR extraído (temporário) | `os.tmpdir()` |
| `src/webSandbox/screenshots.js` | screenshot da página auditada | `os.tmpdir()` (default corrigido nesta revisão -- ver abaixo) |

`screenshots.js` era, até esta revisão, o **único** write do serviço
fora de `os.tmpdir()`: o default de `SANDBOX_ARTIFACTS_DIR` apontava
pra uma pasta relativa ao próprio módulo (dentro de `/app`, a imagem
da aplicação), não um diretório temporário. Sob `readOnlyRootFilesystem`,
`/app` fica somente leitura -- esse default quebraria com `EROFS` na
primeira captura de screenshot. Corrigido pra usar `os.tmpdir()` como
todo o resto do serviço, o que significa que **um único volume
writable montado em `/tmp`** (`emptyDir` no Cloud Run) já é suficiente
pra rodar o container inteiro com `readOnlyRootFilesystem: true` --
não dois caminhos separados.

Isso NÃO é, por si só, uma garantia de que um bug de escrita
arbitrária (path traversal fora do escopo já coberto pelas defesas de
`archive.extractZip`/`archive.extractArchive`) seja impossível -- é uma
camada de defesa em profundidade que faz o SO recusar a escrita mesmo
que a validação da aplicação falhe, sem custo de manutenção adicional
(a aplicação já só escreve em `os.tmpdir()`).

## Variáveis de ambiente

- `PORT` -- porta do servidor HTTP (Cloud Run injeta automaticamente).
- `SANDBOX_SHARED_SECRET` -- segredo exigido no header
  `x-sandbox-secret`. Sem isso configurado, o serviço sobe com um
  aviso e aceita qualquer chamador -- defesa em profundidade mínima,
  não a única camada (o ideal em produção é também restringir por
  IAM/rede do Cloud Run).
- `SANDBOX_CHROMIUM_EXECUTABLE_PATH` / `SANDBOX_WEBKIT_EXECUTABLE_PATH`
  -- override do binário do navegador. **Só lido de variável de
  ambiente, nunca do corpo da requisição** (ver nota de segurança em
  `src/webSandbox/browser.js`). Uso legítimo: reaproveitar um binário
  já instalado na imagem/ambiente sem duplicar o download.
- `SANDBOX_ARTIFACTS_DIR` -- diretório onde screenshots são salvos.
  Default: `<os.tmpdir()>/sandbox-efemero-screenshots` -- ver seção
  "Isolamento de filesystem (read-only root)" abaixo pra entender por
  que esse default vive dentro de `os.tmpdir()` e não relativo à pasta
  do serviço.
- `SANDBOX_BSDTAR_PATH` -- override do caminho do binário `bsdtar`
  (default `/usr/bin/bsdtar`). `SANDBOX_SHELL_PATH` -- override do
  shell usado pra aplicar `ulimit` antes de rodar o `bsdtar` (default
  `/bin/sh`).
- `SANDBOX_BSDTAR_MEMORY_LIMIT_KB` -- teto de memória virtual
  (RLIMIT_AS, em KB) por processo `bsdtar`. Default: 524288 KB
  (512MB).
- `SANDBOX_ZIP_WORKER_MEMORY_LIMIT_MB` -- teto de heap do V8
  (`resourceLimits.maxOldGenerationSizeMb`) por worker_thread de
  extração de ZIP. Default: 512MB. Ver ressalva importante na seção
  "Isolamento de memória/CPU por requisição" acima -- não cobre
  Buffer/ArrayBuffer.
- `SANDBOX_BROWSER_CPU_LIMIT_GRACE_SECONDS` -- margem (segundos)
  somada ao `timeout` da requisição pra formar o teto de RLIMIT_CPU
  do processo do navegador (`timeout` também cobre `page.goto()`, mas
  as etapas seguintes -- screenshot, auditoria de acessibilidade --
  não têm prazo próprio hoje). Default: 60.
- `SANDBOX_BROWSER_CPU_LIMIT_SECONDS_OVERRIDE` -- teto ABSOLUTO de
  CPU pro processo do navegador, ignorando o cálculo baseado em
  `timeout` acima. Sem default (ausente = usa o cálculo normal).
- `SANDBOX_PAGE_JS_HEAP_LIMIT_MB` -- teto de heap do V8 (via
  `--js-flags=--max-old-space-size`) especificamente pro JavaScript
  da PÁGINA sendo testada, não pro processo do Chromium como um todo.
  Default: 512MB.

## Rodando localmente

```bash
npm install
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 SANDBOX_CHROMIUM_EXECUTABLE_PATH=/caminho/pro/chromium npm start
# ou, com acesso normal ao CDN do Playwright:
npx playwright install chromium
npm start
```

## Testes

```bash
npm test
# ou, reaproveitando um Chromium já instalado (sem baixar):
SANDBOX_CHROMIUM_EXECUTABLE_PATH=/caminho/pro/chromium npm test
```

A suíte inclui testes unitários (validação de entrada, allowlist de
rede) e testes ponta a ponta reais: sobem um servidor HTTP local
servindo uma página propositalmente quebrada (`test/fixtures/broken-page.html`)
e rodam `runWebSandbox` de verdade contra ela, com um Chromium real --
confirmam captura de console, detecção de overflow/viewport, violação
de acessibilidade real via axe-core, bloqueio real de requisição fora
da allowlist, e o screenshot gravado em disco.

`test/browserContainment.e2e.test.js` prova os dois mecanismos de
contenção de `websandbox.run` (ver seção "Isolamento de memória/CPU
por requisição" acima) contra um Chromium real, sem nenhum mock:
`test/fixtures/cpu-bomb-page.html` (loop infinito síncrono) e
`test/fixtures/heap-bomb-page.html` (alocação de memória sem limite)
-- confirma que RLIMIT_CPU/`--js-flags` derrubam a página de forma
limpa (`{success:false}`, nunca um travamento), usando
`SANDBOX_BROWSER_CPU_LIMIT_SECONDS_OVERRIDE` pra isolar a causa da
falha do timeout normal de navegação (por construção, o cálculo
padrão de RLIMIT_CPU nunca fica menor que o `timeout` da requisição,
então só o override consegue provar que é o teto de CPU -- não o
timeout -- quem derruba o processo). `src/webSandbox/browser.test.js`
cobre `browserUlimitWrapper.sh` isolado via `spawnSync` (sem precisar
de nenhum navegador instalado): aborta de forma limpa (exit 99) se as
variáveis de ambiente esperadas estiverem ausentes ou inválidas,
nunca roda o binário sem os limites aplicados.

`src/archive/extractZip.test.js` testa `runArchiveExtract` de ponta a
ponta sem nenhum mock: zips reais construídos com `archiver` (incluindo
um com `archive.symlink(...)` de verdade, pra provar que a rejeição de
symlink funciona contra um zip que o formato realmente permite gerar),
extração real em disco, e confirmação de que nenhum diretório
temporário sobrevive tanto a uma extração aceita quanto a uma
rejeitada (limpeza garantida).

`src/archive/extractArchive.test.js` cobre a identificação por assinatura,
o requisito explícito para TAR sem assinatura e a normalização de caminhos
que protege consumidores Linux e Windows, além de extração real via `bsdtar`
de verdade (TAR construído com o `tar` do sistema, extraído pelo wrapper de
`ulimit` completo -- incluindo a prova de que o teto de memória rejeita de
forma limpa, sem derrubar o processo). A imagem Docker instala
`libarchive-tools`, pré-requisito pra esses testes e pro pipeline de
imagem/deploy.

## O que mudou em relação ao `sandbox.md`

A revisão do documento original encontrou (lista completa discutida
antes da implementação):

**Críticos:**
- Código em CommonJS (`require`/`module.exports`) -- quebraria
  imediatamente num projeto `"type": "module"`. Tudo aqui é ESM.
- Chromium/WebKit e as capabilities de execução (`shell`, `git`,
  filesystem) no mesmo container -- resolvido com este serviço
  separado, sem essas credenciais.
- `context.route()` do Playwright não intercepta WebSocket -- **essa
  limitação continua existindo** (é do próprio Playwright, não dá pra
  contornar nesta camada) e está documentada aqui e em `network.js`.
- Nenhuma integração com a arquitetura de capabilities do `agent/`
  (TaskRouter/Permissions/protocol.js) -- resolvido pela própria
  decisão de separar em serviço: o `agent/` fala com isto via HTTP, e
  quem expõe isso como `task.type` pro resto do sistema é uma
  capability leve do lado do `agent/` (fora do escopo desta pasta).

**Moderados, corrigidos:**
- Falha de rede contada em dobro (`context.on` + `page.on` duplicados)
  -- `network.js` agora só registra uma vez.
- Allowlist de rede só por hostname, sem porta -- `network.js` agora
  escopa `localhost`/`127.0.0.1` à porta da própria URL sob teste, não
  "qualquer porta".
- Sem proteção contra DNS rebinding -- mitigação best-effort
  implementada (resolve e confirma loopback de verdade), documentada
  como incompleta (proteção total exige política de rede no container).
- Screenshots gravados via `process.cwd()` -- agora caminho fixo
  relativo ao módulo, configurável via `SANDBOX_ARTIFACTS_DIR`.
- `browser.js` duplicado/não usado -- consolidado numa única
  implementação.
- Sem limite de tamanho de viewport -- `devices.js` agora valida e
  limita (200-3840px).
- Sem timeout dedicado pra auditoria de acessibilidade -- agora tem
  timeout próprio (`accessibility.js`, 15s), separado do timeout de
  navegação.

**Menores, corrigidos:**
- `page.waitForTimeout(2000)` fixo -- trocado por espera de rede
  ociosa com teto curto (`waitForLoadState('networkidle', {timeout})`).
- Tratamento de erro inconsistente entre módulos -- falha de
  screenshot agora aparece em `result.errors`, como as outras.
- `options.viewport` sem validação de tipo/shape -- agora validado.
- Nome de screenshot só com `Date.now()` -- agora inclui
  `process.hrtime.bigint()`, sem risco de colisão em execuções
  paralelas.
- `--single-process` (flag desaconselhada pelo Chromium em produção)
  -- removida.

**Achado adicional, encontrado durante a implementação (não estava na
lista original):** a primeira versão desta própria reescrita tinha um
override `browserExecutablePath` aceito via `options` -- ou seja,
vindo do corpo de uma requisição HTTP. Isso seria execução de código
arbitrário no container (qualquer chamador da API poderia mandar
`{"browserExecutablePath": "/bin/sh"}`). Corrigido antes de qualquer
deploy: o override só é lido de variável de ambiente
(`SANDBOX_CHROMIUM_EXECUTABLE_PATH`), nunca de `options` -- com teste
de regressão dedicado em `test/runWebSandbox.e2e.test.js`.

**Gap de escopo, ainda em aberto:** quem sobe um servidor local
servindo o template Blogger compilado antes de chamar este serviço --
isso é responsabilidade do pipeline de compilação, não deste serviço
(que só recebe uma URL já ativa, por design).

## Evolução planejada

Este serviço está evoluindo gradualmente de "sandbox de navegador" pra
uma camada de contenção mais ampla -- `archive.extractZip` é a
primeira capacidade nova além do web sandbox original. Preparado, mas
**deliberadamente não implementado ainda** (escopo desta etapa era só
extração de ZIP):

- ~~limites de CPU/memória a nível de container~~ **implementado** --
  RLIMIT_AS/RLIMIT_CPU (`ulimit`) por processo `bsdtar` (RAR/7z/TAR) e
  `resourceLimits.maxOldGenerationSizeMb` por worker_thread (ZIP), com
  isolamento de falha garantido nos dois casos -- ver seção
  "Isolamento de memória/CPU por requisição" acima pra detalhes e uma
  ressalva importante (Buffer/ArrayBuffer não conta pro teto de heap
  do ZIP; quem cobre isso continua sendo a contagem de bytes já
  existente). **Limite de disco a nível de container continua em
  aberto** -- hoje só existe a checagem de espaço livre via
  `fs.statfs` antes de escrever (tabela de defesas acima) e a
  contagem de bytes total já existente; nenhuma quota de disco real
  (ex: partição/tmpfs dedicada por requisição) foi adicionada, e não
  é viável sem privilégios de montagem indisponíveis no Cloud Run;
- controle de processos mais amplo (RAR/7z/TAR já rodam com timeout,
  kill e agora RLIMIT_AS/RLIMIT_CPU por requisição -- ainda não há
  cgroup nem supervisor global cobrindo o container como um todo);
- ~~isolamento de filesystem mais forte que "diretório temporário
  próprio por requisição" (ex: filesystem read-only fora do
  tmpdir)~~ **parcialmente implementado** -- todo write da aplicação
  foi consolidado em `os.tmpdir()` (`screenshots.js` era a última
  exceção, corrigida nesta revisão), o que torna o container compatível
  com `securityContext.readOnlyRootFilesystem` (Cloud Run) montando
  **um único** volume writable em `/tmp` -- ver seção "Isolamento de
  filesystem (read-only root)" acima. Fica "parcial" porque habilitar
  `readOnlyRootFilesystem: true` de fato é uma configuração de
  **deploy** (fora deste repositório de código) que ainda precisa ser
  aplicada no manifesto do Cloud Run -- este código só remove o
  obstáculo que impedia isso;
- controle de rede genérico (hoje só existe pra `websandbox.run`, via
  `network.js` -- não se aplica a `archive.extractZip`, que não faz
  nenhuma chamada de rede saindo do processo);
- ~~teto de memória/CPU equivalente pra `websandbox.run`~~
  **implementado** -- RLIMIT_CPU (via `browserUlimitWrapper.sh`) +
  `--js-flags=--max-old-space-size` (heap JS da página sob teste). O
  Playwright monta ele mesmo o array de argumentos do navegador, então
  o mecanismo usa `launchOptions.env` em vez de argv (diferente do
  `bsdtar`) -- ver seção "Isolamento de memória/CPU por requisição"
  acima pra detalhes, incluindo por que RLIMIT_AS foi tentado e
  descartado com números reais (o renderer sozinho reserva ~1,4TB de
  espaço de endereçamento virtual);
- inspeção/scanning de arquivo (deliberadamente FORA de escopo --
  SAST/scanner de dependência/pentest continuam sendo responsabilidade
  de workers/serviços externos que o Solaris pode chamar depois, não
  deste sandbox de contenção);
