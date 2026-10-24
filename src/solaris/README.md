# Solaris Code — motor de desenvolvimento web (Fase 0 + Fase 1 + Fase 2 + Fase 3 parcial)

**Jogos HTML5 e assets 2D:** o [A7 Forge integrado](../../agent/forge/README.md)
acrescenta receitas procedurais, spritesheets, áudio sintético e módulos Canvas
ao manifesto e ao editor de projetos, sem importar os jogos do A7. Esse guia
documenta os comandos disponíveis, a integração, os limites e a verificação.

Módulo independente da Softload Engine, especializado em Front-end e
Back-end leve — **nunca** usa o Compiler Blogger (`src/core/`). Mesma
filosofia de Workers determinísticos + IA como arquiteto (não como
único responsável) já usada na Blogger Engine, mas com RAG/pipeline/
histórico próprios, sem misturar os dois motores.

## O que existe nesta fase (Fase 0)

- `llm/modelRouter.js` — roteamento entre dois papéis de modelo, mesma
  chave (`GEMINI_API_KEY`) e SDK (`@google/genai`, unificada — não mais
  `@google/generative-ai`, descontinuada e migrada em toda a aplicação,
  ver "Migração pra @google/genai" mais abaixo) já usados por
  `src/services/geminiService.js` (Blogger Engine):
  - `executarTriagem` (Gemini Flash, temperature 0.2) — detecção de
    framework, parse de diagnóstico pra JSON, geração de entrada de
    catálogo RAG (`rag/ragEntryGenerator.js`). Baixa latência,
    determinístico de propósito (consumidores querem JSON confiável,
    não personalidade).
  - `executarTriagemStream` (Gemini Flash, temperature **2.0** — teto
    real da API, diferente de `executarTriagem` de propósito) —
    chat/brainstorm conversacional (`solarisChat.js`, único
    consumidor). 0.2 (copiado de `executarTriagem`) fazia o chat soar
    repetitivo/robótico — achado real, usuário relatou "sempre dá a
    mesma resposta pra tudo" (ver seção "Fluxo de conversa mais
    natural" mais abaixo); depois disso, pedido explícito do dono do
    produto pra deixar o chat o mais livre possível ("temperatura
    7.5" pedida excedia a faixa válida 0.0–2.0 da API — subida pro
    teto real em vez disso).
  - `executarTarefaArquitetura` (Gemini Pro, temperature 0.7,
    `thinkingConfig.thinkingBudget` opcional) — geração do manifesto
    JSON e geração de código por arquivo (function calling).
  - `maxOutputTokens`: 60.000 (`SOLARIS_MAX_OUTPUT_TOKENS`) nos dois
    papéis — cap deliberado abaixo do teto real do Gemini 2.5
    (65.536), calibrado pelo dono do produto. Entrada não tem cap
    configurável — a janela de contexto de 1.048.576 tokens é nativa
    do modelo, sem parâmetro de API pra encolher (um prompt maior que
    isso simplesmente falha na chamada, não é truncado).
- `manifest/manifestSchema.js` — contrato do manifesto (framework,
  páginas, componentes, lista de arquivos a gerar um a um, dependências)
  com schema Gemini (1ª camada) + validador server-side (2ª camada, no
  mesmo padrão de `src/ai/pecaRequestSchema.js`).
- `workers/{html,css,js}Worker.js` — **não duplicam** análise: são
  wrappers finos sobre `src/core/parser/{html,css,js}Parser.js`
  (parsers já determinísticos e testados), normalizando a saída pro
  formato `{ ok, erros, avisos }` que o Orquestrador espera de qualquer
  Worker.
- `pipeline/orchestrator.js` — fluxo granular do roadmap: objetivo →
  manifesto (Pro) → itera arquivos → 1 arquivo por vez (Pro, escopo
  fechado) → Worker do tipo certo → diagnóstico → **persiste em disco**
  (Fase 1) → ZIP final. Nunca gera o projeto inteiro numa chamada só.
- `chat/solarisChat.js` + `prompts/systemPrompt.js` — entrada
  conversacional mínima (pergunta → resposta via `executarTriagem`).
- `tools/fileTools.js` (Fase 1) — `createHtml`/`createCss`/`createJs`/
  `readProject`/`scanProject`/`createZip` do roadmap, determinísticos
  (sem regex/heurística — `fs`/`archiver` puros). Confinados a um
  `baseDir` por projeto, guardados contra path traversal (`caminho` vem
  do manifesto gerado por IA — entrada não-confiável, nunca escreve
  fora do diretório do projeto). `orchestrator.js` chama essas funções
  DIRETO (determinístico decide quando/o quê gerar) — também expostas
  como `FUNCTION_DECLARATIONS` (schema Gemini) pra um futuro modo
  agêntico de chat; o loop de tool-calling em si ainda não é wireado
  (ver "O que NÃO existe ainda" mais abaixo). `gerarProjeto()` só
  empacota o ZIP se TODOS os arquivos
  passaram no Worker — nunca entrega projeto com erro (mesmo critério
  do roadmap, seção Validadores).
- `tools/archiveExtractClient.js` (Fase 2, migrado da extração
  in-process original) — cliente HTTP fino que repassa o ZIP bruto do
  upload pro serviço isolado `sandbox-efemoro/` (`POST /extract-zip`),
  o MESMO endpoint que `agent/src/capabilities/archive.js` já usa —
  mesmas env vars (`SANDBOX_SERVICE_URL`/`SANDBOX_SHARED_SECRET`), uma
  única configuração no Cloud Run serve os dois chamadores. O parsing
  do ZIP não-confiável (zip-slip, zip bomb, symlink, profundidade,
  tamanho/contagem — ver `sandbox-efemoro/src/archive/extractZip.js`)
  roda inteiramente FORA do processo do app principal, no container
  separado; esta função só grava de volta em disco (via `criarArquivo`)
  os arquivos de TEXTO já validados que o serviço devolveu. Substitui a
  antiga `extrairZip()` de `fileTools.js` (removida — parsing de zip
  não-confiável em processo deixou de existir no app principal). Ver
  seção "Upload real" mais abaixo.
- Rota HTTP + view do chat (Fase 2) —
  `src/routes/dashboard_routes/solaris.js` (`GET /dashboard/solaris` +
  `POST /dashboard/solaris/chat/stream`, mesmo protocolo de evento SSE
  usado no resto do projeto) + `views/pages/dashboard/solaris.ejs`,
  card próprio em `/dashboard` e entrada no menu lateral. Histórico
  persistido via `chatStorageService` (`type: 'solaris-chat'`, mesmo
  mecanismo do Especialista Blogger/Workspace) — reaproveita as rotas
  genéricas `/api/chat/sessions*` já existentes, sem endpoint próprio.
  **Streaming real** — `executarTriagemStream`/`perguntarStream` (async
  generators, `model.generateContentStream`, mesmo padrão de
  `src/services/geminiService.js:gerarChatStream`) emitem eventos
  "chunk" de verdade, não só "status"→"done". **Cobrança de créditos**
  — `verificarSaldo` (mesmo middleware/pool "creditos" do Especialista
  Blogger) + `debitarCreditos` pelos tokens reais do `usageMetadata` do
  Gemini (nunca por chamada fixa).
- `rag/ragCatalogLoader.js` (Fase 2) — carrega o catálogo de
  categorias (`agencia`/`blog`/`clinica`/`dashbord`/`documentacao`/
  `ecommerce`/`escola`/`evento`/`landing-page`/`portifolio`/
  `restaurante`/`saas.json`, populado diretamente em `src/solaris/rag/`)
  e casa o objetivo do usuário contra ele — reusa `src/rag/ragMatcher.js`
  (fronteira de palavra + acentos normalizados), sem duplicar a lógica
  de scoring já usada pelo RAG do Blogger Engine. Wireado em DOIS
  lugares: `orchestrator.gerarManifesto()` injeta o resumo da categoria
  no prompt do manifesto; `solarisChat.js` injeta o mesmo resumo no
  prompt conversacional, pra o brainstorm sugerir estrutura concreta
  em vez de perguntas abertas (ver `SOLARIS_SYSTEM_PROMPT`). Decisão de
  QUAL categoria casou é 100% determinística (código, `buscarCategoria`
  roda antes de qualquer chamada ao modelo) — a IA só recebe o contexto
  já resolvido, nunca escolhe a categoria sozinha.
- `prompts/systemPrompt.js` (Fase 2 + Fase 3) — brainstorm guiado:
  pergunta framework cedo (menu curto), usa a categoria reconhecida
  (RAG) como estrutura sugerida concreta em vez de pergunta aberta,
  oferece menu de estilo visual, resume "Projeto detectado" e monta um
  "Manifesto do Projeto" pedindo confirmação explícita. Só depois que o
  usuário confirma, o modelo fecha a resposta com o marcador oculto
  `[[SOLARIS_GERAR:{"objetivo":"...","framework":"..."}]]` — nunca
  antes, nunca por conta própria (regra explícita no prompt).
  `framework` é validado contra `manifestSchema.FRAMEWORKS_VALIDOS`
  (fonte única, importado no prompt em vez de hardcoded).
- `chat/solarisGenerationTrigger.js` (Fase 3) — detecta o marcador
  `[[SOLARIS_GERAR:{...}]]` no texto completo da resposta (mesmo padrão
  do `[[TEMPLATE:{...}]]`/`TEMPLATE_MARKER_RE` do `chatGenerationFlow.js`
  da Blogger Engine) — puro parsing de string, nunca lança (JSON
  inválido/campo ausente vira `erro` no retorno). `removerMarcadorTruncado()`
  cobre o caso do streaming ser interrompido no meio do marcador (usuário
  parou a geração, corte por teto de tokens) — nunca deixa um fragmento
  vazar pro texto exibido/salvo.
- **Fase 3 — confirmação do manifesto dispara geração de verdade**
  (`src/routes/dashboard_routes/solaris.js`): ao detectar o marcador
  (sem erro de parse), a rota chama `orchestrator.gerarProjeto({objetivo,
  framework, baseDir})` num diretório temporário (`fs.mkdtempSync` em
  `os.tmpdir()`), envia um evento `status` de progresso enquanto isso
  roda, e — se `gerarProjeto` retornar `ok` com ZIP — devolve o Buffer
  em base64 dentro do próprio evento `done` (`{zip:{base64,nome,
  totalArquivos}}`). O diretório temporário é sempre apagado
  (`fs.rmSync`) antes do evento sair, mesmo em erro — nada do projeto
  fica em disco além da vida do request. Sem rota de download nem
  upload pra GCS: projetos do Solaris são pequenos o bastante pra um
  link `data:application/zip;base64,...` no próprio HTML da bolha
  (`<a download>`), o navegador cuida do resto. O texto salvo no
  histórico de chat é sempre o texto SEM o marcador (`textoVisivel`) —
  o ZIP em si não é persistido, só entregue naquele turno.
  **Cobrança da geração**: `orchestrator.js` ainda não expõe
  `usageMetadata` real por chamada de arquitetura (Pro) pro caller —
  a rota soma uma estimativa pela mesma heurística de caracteres já
  usada como fallback no resto do projeto (`Math.ceil(len/3.5)`), pra
  nunca deixar o custo real de Pro (1 chamada de manifesto + 1 por
  arquivo) sem cobrança nenhuma — documentado explicitamente no código
  como estimativa, não fonte de verdade.
- `workers/ragKebabWorker.js` (Fase 2) — Worker de uso interno (zero
  chamada a IA, zero custo de token — puro `fs`/string) que analisa,
  valida e corrige o nome FÍSICO dos arquivos de `src/solaris/rag/`:
  garante kebab-case (sem acento/maiúscula/espaço) e garante a
  extensão `.json` em arquivo enviado sem extensão. Responsabilidade
  dividida do resto do RAG: `ragCatalogLoader.js` só orquestra (lista
  o diretório, monta o índice buscável) e consome o relatório deste
  Worker pra avisar no console — a análise/correção do nome em si mora
  só aqui, sem duplicar a regra em dois lugares (`ehArquivoDeCatalogo`
  é a fonte única do filtro "isso é um arquivo de catálogo?", usado
  pelos dois módulos). `normalizarDiretorioRag({ aplicar: true })` é a
  função que efetivamente renomeia em disco — usada uma vez pra corrigir
  os 12 arquivos reais do catálogo (todos chegaram com nome em Title
  Case/acentuado e 11 dos 12 sem extensão nenhuma).
- `workers/ragKebabWorker.js` — `auditarCatalogo()` (Fase 2.1, evolução
  pedida em revisão de PR): o Worker deixou de olhar só o nome do
  arquivo e passou a auditar CONTEÚDO — três checagens, sempre em modo
  diagnóstico (nunca corrige nada sozinho, só avisa):
  1. **Coerência nome↔id** — nome-base do arquivo (kebab) deve bater
     com `id` ou `slug` da entrada; se divergir, vira aviso (não erro
     — ex.: `agencia.json` com `"id":"agencia-digital"` é intencional,
     não bug, mas fica registrado pra quem for revisar).
  2. **Campos recomendados** — `id`/`slug`/`categoria`/`descricao`
     (`CAMPOS_RECOMENDADOS`); ausência vira aviso, nunca bloqueia
     carregamento (parte do catálogo real já roda sem `descricao` hoje
     — convergir é objetivo incremental).
  3. **Id duplicado** — dois arquivos com o mesmo `id` internos ficam
     `ok:false` nos dois, com erro explícito citando o(s) outro(s)
     arquivo(s) — evita que o `buscarCategoria` decida entre eles por
     ordem não-determinística de `fs.readdirSync`.
  Arquivo sem `id` é tratado como RASCUNHO (mesmo critério do loader)
  — aviso informativo, não participa da checagem de duplicado.
  `ragCatalogLoader.carregarCatalogo()` chama `auditarCatalogo()` uma
  vez por carga e imprime tudo no console, junto do lint de nome já
  existente.
- `rag/drafts/` (Fase 2.1) — pasta pra entradas de catálogo ainda sem
  `id`/formato divergente (hoje: `flask2.json`/`flask3.json`, chegaram
  em formato de artigo/tutorial, estrutura bem diferente do resto).
  `listarArquivosDeCatalogo()` (fonte única do listar-diretório, usada
  por `normalizarDiretorioRag`/`auditarCatalogo`/`carregarCatalogo`)
  filtra subdiretórios antes de aplicar `ehArquivoDeCatalogo` — o
  loader nunca tenta ler uma pasta como se fosse JSON, sem precisar
  hardcodar o nome "drafts" em lugar nenhum (qualquer subpasta futura
  já seria ignorada do mesmo jeito).

## Organização em pastas — `workers/ragOrganizerWorker.js`

Pedido direto: "cria um worker que organiza os arquivos em pastas
separadas por nicho, você só passa o JSON pro Worker ele faz".
Determinístico, zero IA, zero heurística sobre texto livre — `determinarPasta(entrada)`
decide a pasta só a partir de campos ESTRUTURADOS já existentes,
primeira regra que bater vence:

1. `entrada.pasta` — override explícito.
2. `categoria === 'preset'` → pasta `presets/` (mesmo com id
   `flask-saas-glassmorphism`, fica agrupado com outros presets, não
   espalhado pela pasta de tecnologia).
3. Prefixo `<grupo>-` do id (convenção já usada por
   `ragTopicMatrix.js`) ou id igual a um grupo conhecido → pasta do
   grupo (ex.: `bootstrap5-navbar` e a própria referência `bootstrap5`
   caem juntos em `bootstrap5/`).
4. Sem grupo reconhecido → usa a própria `categoria` como pasta (ex.:
   uma entrada real com `categoria:"banco"` cai automaticamente em
   `banco/`, sem precisar hardcodar esse nome em lugar nenhum).
5. Sem id nem categoria → `outros/` — nunca falha, nunca perde
   arquivo, mas também nunca finge saber classificar algo sem sinal.

`organizarDiretorio({dir, aplicar})` varre só o TOPO do diretório
(nunca mexe em `drafts/` nem em algo já dentro de subpasta), mesmo
padrão de relatório/dry-run/conflito-seguro de `normalizarDiretorioRag`.
Rodado de verdade contra o catálogo real — os 40 arquivos existentes
foram organizados em `bootstrap5/`, `css3/`, `django/`, `flask/`,
`html5/`, `php/`, `template-engine/`, `presets/` (grupos técnicos) e
pastas por categoria de projeto (`empresa/`, `frontend/`, `educacao/`
etc.) pros 12 nichos de negócio já existentes. `scripts/ragGenerate.js`
já grava direto na pasta certa desde essa mudança — não precisa de
passada de organização separada depois de gerar.

**Mudança de infraestrutura que isso exigiu**: `ragKebabWorker.
listarArquivosDeCatalogo()` passou a percorrer 1 nível de subpasta
(qualquer uma, exceto `drafts/`) — sem isso, mover arquivo pra pasta
teria feito o loader simplesmente parar de enxergá-lo. `validarNomeArquivo`/
`separarNomeExtensao` agora preservam o prefixo de pasta ao sugerir
correção de nome, nunca tratam o `/` como parte do nome-base a
kebab-casear.

## Limpeza de conteúdo externo indevido (04/2026) — allowlist em `ehArquivoDeCatalogo`

Pedido direto: "corrige os problemas do rag do Solaris". Achado real:
4 commits `Add files via upload` foram pushados direto em `main`
(fora do fluxo de PR usado no resto do projeto), misturando ~220
arquivos de conteúdo externo (exemplos oficiais do repositório
Bootstrap, uma cópia quase completa de `TheAlgorithms/Python`, e um
projeto PHP de terceiro de propósito não relacionado) dentro de
`src/solaris/rag/` — a pasta que `ragCatalogLoader.carregarCatalogo()`
varre pra montar o catálogo de referência do Solaris.

Causa raiz: `ehArquivoDeCatalogo()` (`workers/ragKebabWorker.js`) era
uma BLOCKLIST (`.js`/`.md`/dotfile fora, qualquer outra extensão
dentro) em vez de ALLOWLIST — todo arquivo `.py`/`.php`/`.txt`/etc.
dumpado virou candidato a entrada de catálogo, e `JSON.parse` falhando
em cada um gerava um `console.warn` — 492 linhas de spam afogando os
~16 avisos legítimos de curadoria a cada chamada de `carregarCatalogo()`.

Correção: `ehArquivoDeCatalogo()` agora só aceita arquivo SEM extensão
(candidato legítimo a virar `.json`, fluxo já coberto por
`validarNomeArquivo`/`normalizarDiretorioRag`) ou já com extensão
`.json` — qualquer outra extensão nunca entra no catálogo nem tenta
`JSON.parse`.

Remoção do conteúdo externo (`git rm`, nunca sobrescrito): pastas
inteiras `bootstrap5/`, `machine_learning/`, `neural_network/`,
`web_programming/`, `linear_programming/`, `file_transfer/`, `scripts/`
(exemplos do repositório Bootstrap e TheAlgorithms/Python, sem nenhuma
referência em código — confirmado via grep), `conf.py` (config Sphinx
órfã na raiz do RAG), e dentro de `php/` os 26 arquivos `.php` soltos
mais a subpasta `php8.4-changes-main/` (projeto de terceiro sem
relação com o catálogo, misturado ao lado do `php.json` legítimo).

**Cuidado que essa limpeza exigiu**: `bootstrap5/` já existia ANTES do
dump (commit `feat(solaris): Worker que organiza o catálogo RAG em
pastas por grupo/nicho`) com 21 arquivos `.json` legítimos
(`bootstrap5.json` + 20 tópicos gerados, ex.: `bootstrap5-accordion.json`)
— o dump só ACRESCENTOU arquivos de exemplo (`.html`/`.css`/`.js`/`.svg`)
dentro da mesma pasta, não substituiu. `git rm -r bootstrap5/` teria
apagado os 21 arquivos legítimos junto — pego pelo teste existente
(`ragCatalogLoader.test.js` esperava `buscarCategoria('bootstrap5')`
resolver); os 21 `.json` foram restaurados via `git checkout <commit
pré-dump> -- <caminho>` antes do commit final, mantendo só a poda do
conteúdo realmente externo.

5 arquivos de notas de arquitetura (`gemini-sandbox-architecture`,
`workspace-ephemeral-isolation` etc.) encontrados soltos na raiz do RAG
não são conteúdo de terceiro — leem como anotações de design do próprio
projeto sobre sandbox/Workspace, tema desta sessão — foram
RELOCADOS (não apagados) para `docs/arquitetura-referencias/`, fora do
diretório varrido pelo catálogo.

## Triagem de `rag/drafts/` — `workers/ragDraftWorker.js`

Pergunta direta em revisão: "os arquivos de `drafts/` têm erro? por
que não estão nas pastas correspondentes?". Resposta confirmada
arquivo por arquivo (31 `.json` + 1 `.md`, hoje): nenhum tem erro de
JSON — nenhum tem o campo `id`, e o SCHEMA diverge do formato-alvo de
catálogo (`ragEntryGenerator.RAG_ENTRY_RESPONSE_SCHEMA`:
`id`/`slug`/`categoria`/`descricao`/`componentes`/`exemplos`/`keywords`).
Achados reais: `flask2.json` tem chaves tipo `nome-framework`/
`tipo-framework` (formato de artigo/tutorial); `select-users.json`
usa `unit-id`/`code`/`returns`/`rules` (schema de "unidade de código",
nada a ver com catálogo).

Pedido de "arrumar" isso levou a uma escolha explícita de arquitetura:
decidir `categoria`, escrever `descricao` e extrair `keywords` que
representem de verdade um texto livre EXIGE entender o conteúdo — não
é algo que dê pra derivar mecanicamente do nome do arquivo (CLAUDE.md:
"IA só entra onde não há alternativa determinística viável" — aqui não
há). Por isso `ragDraftWorker.js` é só TRIAGEM — puro/determinístico,
nunca escreve em disco, nunca inventa categoria/descricao/keywords,
nunca promove nada pro catálogo sozinho:

- `triarRascunho(nomeArquivo, entrada)` — valida JSON, checa quais dos
  7 campos de catálogo já existem vs faltam (aceita `prompt_keywords`
  como equivalente de `keywords`, mesma convenção do loader), deriva
  um `idCandidato` do nome do arquivo (`ragKebabWorker.paraKebabCase`,
  só conveniência de nomenclatura, nunca usado pra classificar), e só
  sugere `pastaSugerida` (via `ragOrganizerWorker.determinarPasta`)
  quando há sinal estrutural REAL (`id`/`categoria` já presentes na
  entrada — nunca a partir do nome do arquivo).
- `triarDiretorio({ dir })` — varre `rag/drafts/` (ou um dir de teste),
  nunca falha em arquivo `.md`/JSON inválido (entram no relatório como
  fora de escopo / `jsonValido:false`, nunca desaparecem silenciosos).
- `resumirTriagem(relatorio)` — contagens agregadas
  (`prontosPraCatalogo`/`semSinalNenhum`/`sinalParcial`).

Rodado contra os drafts reais hoje: **0 dos 31 está pronto pra
catálogo** — todos caem em "schema totalmente divergente", exatamente
o achado que motivou o Worker. Promover um rascunho de verdade continua
decisão humana, ou usando o rascunho como fonte pra
`scripts/ragGenerate.js` (o pipeline com IA que já existe pra gerar
entrada de catálogo válida, com o Validador determinístico de sempre —
`ragKebabWorker.validarEntradaGerada` — como portão antes de qualquer
coisa entrar no catálogo buscável).

## Mover rascunhos prontos — `npm run rag:organizar`

Pedido direto: um `npm run` que pega os rascunhos de `rag/drafts/` e já
organiza nas pastas certas. `scripts/ragOrganizarRascunhos.js` faz
exatamente isso, mas só pro subconjunto que a triagem acima já marca
como `prontoPraCatalogo:true` — nunca move um rascunho de schema
divergente (a maioria hoje, ver seção anterior: **0 dos 31** reais
qualificam) pra dentro do catálogo buscável. Reorganizar arquivo já é
mecânico; decidir categoria/descricao/keywords de texto livre não é —
mesma linha que já separa este Worker do pipeline de IA.

Antes de mover, roda o MESMO gate de `scripts/ragGenerate.js` (reusado,
não reinventado):

1. `ragKebabWorker.validarEntradaGerada` — kebab-case, `slug===id`,
   campos obrigatórios, id não duplicado contra o catálogo real.
2. `ragDeduplicator.encontrarSimilares` — rascunho parecido demais com
   uma entrada já existente NUNCA move sozinho, fica em `drafts/` pra
   revisão humana (mesmo critério de `ragGenerate.js`: score ≥ 0.6 vira
   pendência, não decisão automática).

Só depois disso grava em `rag/<pastaSugerida>/<id>.json` (mesma
convenção de nomenclatura de `ragGenerate.js` — `pastaSugerida` já vem
calculada da triagem, via `ragOrganizerWorker.determinarPasta`) e apaga
o rascunho original. Três categorias de resultado, nunca um "sucesso ou
falha" binário:

- `movidos` — rascunho pronto, validado, sem similar demais: movido de
  verdade.
- `rejeitados` — rascunho pronto na FORMA, mas reprovado pelo Worker ou
  pelo Deduplicador: fica em `drafts/`, motivo explícito.
- `precisamDeCuradoria` — schema divergente ou parcial (a maioria):
  fica em `drafts/`, mesmo motivo já reportado pela triagem.

Rodado contra os drafts reais hoje: **0 movidos** (esperado — nenhum
está pronto ainda), os 5 arquivos sem extensão do lote Django/flask-jinja2
todos em `precisamDeCuradoria`.

## Curadoria manual dos 33 rascunhos — 32 novas entradas de catálogo

Continuação direta da triagem acima. Pergunta do usuário: "por enquanto
classifica os arquivos do rag você mesmo" — dado que não havia
`GEMINI_API_KEY` disponível pra rodar `scripts/ragGenerate.js` (que só
gera a partir de grupo/tópico conhecidos, nunca de conteúdo já
existente como fonte), a curadoria foi feita diretamente nesta sessão:
os 33 arquivos (31 de `drafts/` + 2 soltos na raiz do RAG,
`nodejs-and-bootstrap-modern-platform-overview` e
`python-flask-php-modern-runtime-overview`, que chegaram via commit
direto em `main` enquanto o trabalho estava em andamento) foram lidos
por completo e reescritos manualmente no formato-alvo de catálogo
(`id`/`slug`/`categoria`/`descricao`/`componentes`/`exemplos`/`keywords`),
extraindo fielmente do conteúdo real — nunca inventando API/config que
não estivesse na fonte.

Resultado: **32 entradas novas**, organizadas em 5 pastas técnicas
novas (`firebase/` — 18 entradas, `python/`, `php/` — 1 nova entrada
somada ao `php.json` já existente, `nodejs/`, `postgresql/` — 2
entradas, `supabase/`) mais 7 entradas somadas a `flask/` (framework já
existente). Alguns arquivos-fonte com conteúdo fino/sobreposto foram
conscientemente CONSOLIDADOS em uma entrada só em vez de virarem 2-3
entradas rasas (ex.: `knowledge-id-postgresql-training.json` +
`treinamento-postgresql.json` → uma única `postgresql-fundamentos-modelagem-e-performance`;
`create-client.json` + `select-users.json` + `supabase-fundamentals.json`
→ `supabase-fundamentos-cliente-consultas`).

Cada entrada passou pelo MESMO portão determinístico que o pipeline de
geração automática usaria — `ragKebabWorker.validarEntradaGerada`
(schema/tamanho mínimo de descrição/substância técnica) +
`ragDeduplicator.encontrarSimilares` (zero colisão contra as 40
entradas pré-existentes do catálogo) — só depois de passar em ambos é
que o arquivo-fonte em `drafts/`/raiz foi removido. Local final de cada
pasta via `ragOrganizerWorker.determinarPasta`, mesma função usada pelo
pipeline automático.

**Achado real durante a verificação** (não coberto pelos validadores
existentes, achado só rodando `buscarCategoria` contra frases de teste):
alguns ids continham a conjunção "e" como segmento isolado (ex.:
`firebase-erros-criticos-e-mitigacoes`) — `_keywordsDerivadas`
(`ragCatalogLoader.js`) derivava "e" como keyword própria de 1
caractere, que casava por acidente contra qualquer mensagem contendo
"e" solto (`buscarCategoria('e agora?')` retornava essa entrada em vez
de `null`). Corrigido na raiz: `_keywordsDerivadas` agora ignora
tokens derivados com menos de 3 caracteres (`TAMANHO_MINIMO_KEYWORD_DERIVADA`)
— também elimina o mesmo risco pra números de versão soltos ("18",
"22", "3" etc.), não só pra esse caso específico. Os 14 ids afetados
foram renomeados pra tirar a conjunção isolada, seguindo a mesma
convenção já usada no resto do catálogo (nenhum id existente usa
conjunção como segmento).

`npm test`: 84/84 arquivos passando. Catálogo real: 40 → 72 entradas.

## Pipeline de geração do catálogo (`npm run rag:generate -- <grupo> [topico]`)

Automatiza a autoria de entradas de catálogo em escala (~100+ tópicos
por grupo: Bootstrap 5, HTML5, CSS3, JavaScript, PHP, Flask, Django) —
mesmo princípio de "IA só entra onde não há alternativa determinística
viável" da Blogger Engine (o AST parser não usa IA; o Solaris não usa
IA pra nome de arquivo). 5 estágios, só 1 com IA:

1. **`rag/ragTopicMatrix.js`** (Coletor + Fragmentador, 100%
   determinístico) — matriz estática de grupo→tópicos, editada à mão,
   zero rede. Decisão de arquitetura: um crawler ao vivo contra sites
   de documentação oficiais foi avaliado e descartado — frágil
   (estrutura de HTML muda, cada site pediria parser próprio) e ainda
   assim provavelmente precisaria de IA no meio pra estruturar o HTML
   raspado (não eliminaria o uso de IA, só adicionaria uma etapa a mais
   que pode quebrar). A matriz de tópicos é a semente real fornecida em
   revisão de roadmap — estender pra mais tópicos é decisão de quem
   cura o catálogo, nunca fabricada sozinha.
2. **`rag/ragEntryGenerator.js`** (único estágio com IA) —
   `gerarEntradaCatalogo({ grupo, topico, modelRouter })` manda UM
   tópico de cada vez pro Gemini (Flash, `executarTriagem` com
   `responseSchema` — JSON mode, mesma 1ª camada de schema restrito de
   `manifestSchema.js`/`pecaRequestSchema.js`), nunca um lote. `id`/
   `slug` são sempre forçados pelo código (`"<grupo>-<topico>"`), nunca
   confiados à resposta do modelo.
3. **`workers/ragKebabWorker.js` → `validarEntradaGerada()`**
   (Validador, determinístico) — 2ª camada: JSON válido, id em
   kebab-case, `slug === id`, campos obrigatórios, `descricao` com
   tamanho mínimo (sintoma de resposta vazia/truncada abaixo disso),
   "componentes" ou "exemplos" com conteúdo real (substância técnica),
   id não colide com o catálogo existente. Barra mais alta que
   `auditarCatalogo` (aquele audita conteúdo já curado à mão; este é o
   portão de entrada de conteúdo novo gerado por IA).
4. **`rag/ragDeduplicator.js`** (Deduplicador, determinístico) —
   similaridade de Jaccard sobre tokens de `componentes`/`keywords`
   (não embeddings — sem custo de API extra, sem chamada de rede;
   `id`/`categoria` deliberadamente fora do cálculo, ver comentário no
   código: ambos gerariam falso positivo sistemático entre tópicos do
   mesmo grupo/mesma categoria "topico"). Nunca decide sozinho — só
   aponta candidato a `revisar`, sem gravar.
5. **`scripts/ragGenerate.js` → `rodarGeracao()`** (Indexador +
   orquestração) — junta os 4 estágios: pula tópico cujo id já existe
   no catálogo, grava em `src/solaris/rag/<grupo>-<topico>.json` (flat,
   mesma pasta de sempre — convenção de nome `<grupo>-<topico>`
   deliberadamente evita precisar de subpasta por grupo nem de o
   `ragCatalogLoader` aprender a percorrer diretório recursivamente,
   menos abstração nova). "Indexar" não precisa de arquivo de índice
   separado — `carregarCatalogo()` já escaneia o diretório a cada
   `forcarRecarga`, o próximo carregamento (próxima requisição do chat)
   já enxerga o arquivo novo sozinho.

Testável ponta a ponta sem gastar créditos reais de API — todo estágio
recebe `modelRouter`/`catalogoExistente` injetáveis (mesmo padrão de
`llm/modelRouter.test.js`); ver `ragTopicMatrix.test.js`,
`ragEntryGenerator.test.js`, `ragDeduplicator.test.js`,
`ragKebabWorker.test.js` (seção `validarEntradaGerada`) e
`scripts/ragGenerate.test.js`. Rodar de verdade contra a API
(`npm run rag:generate -- bootstrap5`) é ação deliberada de quem cura o
catálogo — nunca automática, cada rodada gasta créditos reais e produz
conteúdo que ainda vale revisar antes de confiar 100%.

## Primeira rodada real do pipeline de geração — 20 tópicos de Bootstrap 5

`npm run rag:generate -- bootstrap5` rodou de verdade pela primeira vez
— sem Gemini nem Haiku disponíveis (limite de gastos da conta), o
conteúdo dos 20 tópicos foi autorado diretamente e injetado no lugar
da chamada de IA (`modelRouter.executarTriagem` fake devolvendo o
texto pronto), exercitando o resto do pipeline de verdade — Validador,
Deduplicador e gravação em disco — exatamente como rodaria com uma API
real. `src/solaris/rag/bootstrap5-{navbar,dropdown,offcanvas,accordion,
cards,grid,forms,validation,alerts,toast,carousel,pagination,badge,
modal,tooltip,popover,scrollspy,utilities,icons,dark-mode}.json` — 20
arquivos, todos passaram no Validador na primeira tentativa, nenhum
marcado pra revisão pelo Deduplicador.

**Achado real de escala, corrigido**: rodar com 20 entradas novas do
mesmo grupo expôs um bug de verdade em `buscarCategoria` —
`bootstrap5-navbar.json` deriva a keyword "bootstrap5" do próprio id
(mesma lógica de `_keywordsDerivadas` já documentada), empatando em
score com `bootstrap5.json` (a referência do framework) pra um pedido
genérico ("quero usar bootstrap5 no meu projeto"). O desempate por
ordem de `fs.readdirSync` (fragilidade já documentada como risco
aceito antes de existir catálogo grande o bastante pra disparar de
verdade) escolhia um tópico ao acaso em vez da referência. Corrigido
em `buscarCategoria`: em empate exato de score, referência de
framework/backend/linguagem (`categoria !== 'topico'`) vence entrada
de tópico — um tópico só deveria ganhar quando o pedido cita algo
específico dele, e nesse caso o score já seria estritamente maior, não
empatado. Teste de regressão dedicado em `ragCatalogLoader.test.js`
(seção N) cobre os dois lados: pedido genérico acha a referência,
pedido específico acha o tópico certo.

## Workers de PHP/EJS/JSON/Python — verificação mecânica real

Fechando parte do gap documentado como "não existe ainda" nas fases
anteriores: `workers/phpWorker.js`, `workers/ejsWorker.js`,
`workers/jsonWorker.js` e `workers/pythonWorker.js`, wireados em
`WORKER_POR_TIPO` do `pipeline/orchestrator.js` — arquivo
`.php`/`.ejs`/`.json`/`.py` gerado pelo Solaris agora passa por
verificação mecânica de sintaxe antes de entrar no ZIP final, mesmo
critério de "nunca entrega sem validação" que HTML/CSS/JS já tinham.

- `core/parser/phpParser.js` — usa `php-parser` (glayzzle), parser PHP
  real em puro JS, **zero binding nativo, zero dependência de
  sistema**. Decisão verificada ANTES de escolher a dependência: o
  `Dockerfile` de produção é `node:18-slim`, sem runtime PHP instalado
  — shell-out pra `php -l` funcionaria só por acidente no ambiente de
  desenvolvimento (que tem PHP) e falharia silenciosamente (ou com
  "comando não encontrado") em produção. `php-parser` evita esse risco
  completamente, mesmo padrão zero-binding-nativo já documentado no
  Dockerfile pros pacotes npm do projeto.
- `core/parser/ejsParser.js` — usa o pacote `ejs` que o projeto já tem
  instalado (view engine do Express) — `ejs.compile()` já É o parser
  real, zero dependência nova. Também sinaliza (aviso, não erro) quando
  o EJS gerado chama `include(...)`: o pipeline gera um arquivo por vez
  com escopo fechado (ver `orchestrator.js`), então não há garantia de
  que o parcial referenciado exista no projeto final.
- `workers/jsonWorker.js` — `JSON.parse` nativo já é o parser
  determinístico de verdade pra JSON, sem precisar de biblioteca.
- Escopo desta fase é validade de SINTAXE — análise semântica mais
  profunda (função PHP indefinida entre arquivos, variável EJS não
  declarada) fica de fora: o pipeline gera um arquivo isolado por vez,
  sem contexto dos outros arquivos do mesmo projeto pra cruzar essa
  informação ainda.
- Flask/Django (tipo `py`) — `workers/pythonWorker.js` — é a ÚNICA
  exceção ao "zero shell-out" desta lista, decisão consciente e não
  silenciosa: nenhum parser Python puro-JS maduro o bastante pra
  sintaxe Python 3 moderna foi encontrado (avaliados: `filbert`,
  `python-ast`), então sem alternativa determinística puro-JS viável,
  entra `python3-minimal` na imagem de produção (ver Dockerfile) só
  pra isso. O shell-out é estritamente `python3 -c "ast.parse(...)"` —
  NUNCA `exec()`/`eval()`/`py_compile` — `ast.parse` só constrói a
  árvore sintática, nenhuma linha do código do usuário roda, nenhum
  import é resolvido, mesma garantia de segurança que os parsers
  puro-JS dos outros Workers. Entrada só via stdin (nunca grava o
  código num `.py` real em disco), timeout de 5s como defesa em
  profundidade, sem rede. Se `python3` não estiver disponível no
  ambiente (ex.: dev sem Docker), degrada pra `ok:true` com aviso
  explícito em vez de fingir que validou — mesmo padrão de "sem Worker
  pro tipo ainda" usado pra tipos sem Worker nenhum.

## Detector de framework por upload — `tools/frameworkDetector.js`

Peça determinística que faltava pro botão de anexo do chat sair de
"só UI" — `detectarFramework(arquivos)` recebe uma lista já extraída
de `{caminho, conteudo}` (decoupled de propósito da mecânica de zip/
upload em si — nunca lê disco, nunca lida com multipart) e decide o
framework mais provável (`FRAMEWORKS_VALIDOS` de `manifestSchema.js`)
só por sinal estruturado: nome de arquivo característico (`manage.py`
→ Django), dependência declarada (`package.json` com `"express"`) ou
trecho de código inequívoco (`from flask import`). Cada framework tem
regras com peso próprio — sinal mais forte (import explícito) pesa
mais que sinal fraco (só ter um `.html` qualquer, usado como fallback
pro html5 puro). Nunca força um palpite sem evidência: score zerado ou
empate exato no topo devolve `melhorPalpite: null`, sempre junto da
lista de candidatos com as evidências que embasaram cada score — o
pipeline nunca aceita a detecção sem poder mostrar por que decidiu
aquilo.

## Upload real de projeto — `POST /dashboard/solaris/upload`

Fecha o fio que faltava: botão de anexo (`solaris.ejs`) → rota →
extração segura → detector → resposta. Princípio de segurança que
governa todo o desenho: **todo arquivo enviado pelo usuário é tratado
como malicioso até prova em contrário**. O conteúdo extraído nunca é
executado, nunca passa por `eval`/`require`/`child_process` — só vira
texto puro lido como string, exatamente como um humano leria código
colado num chat.

- `multer` (`memoryStorage`) faz o parse do multipart — o upload bruto
  nunca toca disco no app principal; o Buffer inteiro é repassado pro
  serviço isolado `sandbox-efemoro/` via `tools/archiveExtractClient.js`
  (`extrairZipViaSandbox`), que é quem de fato valida/extrai o zip —
  parsing de conteúdo não-confiável nunca roda dentro do processo do
  app principal (mesma camada de contenção que `agent/` já usa pra essa
  operação, ver `sandbox-efemoro/README.md`).
- Rate limit dedicado (`express-rate-limit`, 5 uploads / 10min por
  sessão) — superfície de ataque nova (parsing de zip de terceiro)
  ganha limite próprio, não reusa o rate limit do chat.
- `fileFilter` do multer (extensão `.zip`) é só gate de UX — nome/
  mimetype vêm do cliente, trivialmente falsificável. A validação de
  verdade é o serviço `sandbox-efemoro/` tentando abrir o buffer como
  zip real.
- Diretório temporário (`fs.mkdtempSync` em `os.tmpdir()`) — sempre
  apagado no `finally`, nunca sobrevive além da vida do request (mesmo
  padrão já usado pro ZIP de geração da Fase 3). Só recebe os arquivos
  de TEXTO já extraídos e validados pelo serviço isolado (gravados via
  `criarArquivo`) — binários voltam listados mas nunca são gravados
  (mesmo escopo — projeto de texto — já documentado em
  `agent/src/capabilities/archive.js`).
- Erros de `extrairZipViaSandbox` (zip inválido, zip-slip, acima dos
  limites, OU o serviço `sandbox-efemoro/` estar indisponível/mal
  configurado) voltam pro cliente como `400` com mensagem genérica — o
  motivo real só é logado no servidor (`console.warn`), nunca vaza
  detalhe de path/infra interno.
- Resposta de sucesso: `{ok, framework, candidatos, totalArquivos,
  arquivos, analiseIA, sessionId, temProjeto}` — `arquivos` é só a
  lista de até 50 nomes (nunca o conteúdo), `analiseIA` é o resumo
  gerado pela inspeção abaixo (ou `null` se a IA falhou), `sessionId` é
  a sessão de chat à qual o projeto fica anexado (recebida do cliente
  se já existir, gerada nova senão) e `temProjeto` indica se a
  persistência no GCS (Fase 2c, ver abaixo) deu certo.
  `views/pages/dashboard/solaris.ejs` chama essa rota via
  `fetch`/`FormData` no `change` do input de arquivo (mandando o
  `sessionId` atual, se já existir), atualiza `currentSessionId` com o
  que a resposta devolve, e mostra o resultado como uma mensagem do
  assistente no próprio chat.

## Inspeção de projeto por IA (Fase 2b) — `pipeline/projectInspector.js`

Fecha o gap que a detecção de framework sozinha deixava: `frameworkDetector.js`
só olha PADRÃO de nome/dependência/import, nunca leu o código de
verdade. Depois da detecção determinística, a rota de upload roda um
**loop de tool-calling de uma única requisição** (Gemini Pro,
`modelRouter.executarTarefaComFerramentas` — mecanismo genérico e
reutilizável, mesmo formato do loop já usado em `src/ai/solAgent.js`)
que deixa o modelo **ler de verdade** o projeto recém-extraído antes de
descrevê-lo, em vez de só ver a lista de nomes de arquivo.

- Três ferramentas SOMENTE LEITURA (`readFile`/`listFiles`/
  `searchInProject`), wrappers finos sobre `tools/fileTools.js`
  (`lerArquivo`/`listarProjeto`/`buscarNoProjeto`) — confinadas ao
  MESMO `baseDir` onde os arquivos extraídos via `sandbox-efemoro/`
  foram materializados, nenhuma escrita, nenhuma execução.
  `searchInProject` é grep case-insensitive escopado
  ao projeto (mesmo padrão de `buscar_no_codigo` do Sol, mas sobre
  código de terceiro em vez do código-fonte da Softload).
- System prompt instrui o modelo a nunca reproduzir segredo/credencial
  que encontrar (só mencionar que existe e recomendar remoção) e a
  nunca afirmar ter executado/instalado/modificado nada — é
  estritamente consultivo, mesma postura do Sol.
- **Nunca lança por contrato** (`inspecionarProjeto` sempre devolve
  `{ok, ...}`, mesmo se o Gemini falhar por cota/chave/timeout, ou se o
  limite de chamadas de ferramenta esgotar sem resposta final) — a
  detecção determinística de framework NUNCA depende da IA responder
  pra a rota devolver sucesso.
- Cobra crédito real (`verificarSaldo` no middleware da rota,
  `debitarCreditos` pelos tokens reais do `usageMetadata`, mesmo pool
  "creditos" do resto do Solaris) — só debita quando a inspeção de fato
  roda e retorna tokens.

## Persistência real de projeto (Fase 2c) — `tools/projectStorage.js`

Fecha o gap que a Fase 2b deixava: até aqui, o `baseDir` de um upload
só existia dentro da MESMA requisição — nenhum turno de chat seguinte
conseguia perguntar sobre um arquivo específico ("me mostra o app.py
de novo"). Motivo do gap original: o servidor roda em Cloud Run,
múltiplas instâncias sem estado compartilhado por padrão (mesma
investigação de deploy inconsistente já feita nesta base de código) —
um `baseDir` em disco só existiria na instância que atendeu aquela
requisição específica, e guardá-lo "pra próxima pergunta" quebraria de
forma silenciosa assim que o tráfego caísse numa instância diferente.

`tools/projectStorage.js` resolve isso com GCS (durável, compartilhado
entre instâncias) — `salvarProjeto`/`carregarProjeto`/`apagarProjeto`,
usando o **`sessionId` do chat como chave** (`users/{uid}/solaris-projects/{sessionId}/...`,
manifesto + um arquivo por caminho) — nunca um segundo identificador
inventado. Cada sessão tem no máximo um projeto anexado por vez: um
novo upload na mesma sessão sempre chama `apagarProjeto` antes de
`salvarProjeto`, nunca acumula.

- **Upload** (`POST /dashboard/solaris/upload`) — depois da inspeção
  (Fase 2b), persiste o projeto no GCS sob o `sessionId` (recebido do
  cliente via `FormData`, ou gerado novo). Cobra da MESMA cota de
  armazenamento por plano que compilações e sessões de chat já usam
  (`storageService.reservarCota()` — mesmo pool `storage_usado_mb`,
  regra geral do projeto: nunca um contador paralelo por feature).
  Nunca bloqueia a resposta de upload — se a cota estourar ou o GCS
  falhar, o usuário ainda recebe a detecção de framework e a análise
  normalmente, só sem o anexo persistido (`temProjeto:false` na
  resposta).
- **Chat** (`POST /dashboard/solaris/chat/stream`) — em TODO turno,
  tenta `carregarProjeto(uid, sessionId, baseDirTemp)` antes do fluxo
  normal (não depende do cliente avisar "tenho um projeto anexado" —
  elimina uma classe inteira de bug de flag esquecida; custo é só um
  GET no GCS, rápido mesmo quando não há projeto). Se um projeto
  carrega, usa `projectEditor.responderOuEditarProjeto()` (leitura +
  proposta/aplicação de mudança de arquivo, ver "Ferramenta de escrita
  no projeto anexado" mais abaixo — Gemini Pro, tool-calling) em vez do
  `solarisChat.perguntarStream()` normal (Flash, streaming) — **sem
  streaming token-a-token nesse caminho** (`executarTarefaComFerramentas`
  não é streaming), a resposta inteira vai num único evento `chunk`,
  mesmo protocolo SSE, só sem o efeito de digitação. `baseDirTemp` é
  sempre local e temporário, apagado no `finally` — o que persiste é só
  o GCS, nunca disco local entre requisições.
- **`projectInspector.js`**: o loop de tool-calling só cobre mais
  `inspecionarProjeto()` (resumo de UMA vez, logo após o upload, Fase
  2b) — o Q&A/edição de turno seguinte (Fase 2c/2d) migrou inteiro pra
  `projectEditor.js`, que reusa o mesmo `_executorFerramenta` de leitura
  em vez de duplicá-lo.
- **Retenção — TTL fechado (era gap real)**: todo `salvarProjeto()`
  grava um doc de rastreamento em Firestore
  (`solaris_projetos_persistidos/{uid}_{sessionId}` — `criadoEm`,
  `tamanhoBytes`, `email`), enumerado por `apagarProjetosExpirados()`
  em vez de listar o bucket inteiro (mais barato, indexável por data,
  não depende de escanear objetos não relacionados a projetos Solaris
  que também vivem sob `users/{uid}/`). Padrão de retenção: **30 dias**
  (`DIAS_RETENCAO_PADRAO`), configurável por chamada. `apagarProjeto()`
  agora sempre libera a cota do dono via `storageService.liberarCota()`
  (decremento simétrico ao `confirmarUso()` de `reservarCota()`) —
  fecha também um vazamento que já existia mesmo fora do TTL: toda
  SUBSTITUIÇÃO de projeto (novo upload na mesma sessão) apagava o
  anterior sem nunca devolver a cota, mesmo antes desta feature.
  - **Dois gatilhos de limpeza**: (1) TTL — `POST
    /internal/solaris/limpar-projetos-expirados` (`src/routes/apiRoutes.js`,
    autenticado por secret compartilhado `SOLARIS_CLEANUP_SECRET` no
    header `x-solaris-cleanup-secret`, fail-closed em produção sem o
    secret — mesma postura do webhook do Mercado Pago), pensado pra
    Cloud Scheduler bater periodicamente; ou `npm run
    solaris:limpar-projetos-expirados [-- <dias>]` manual. (2) Exclusão
    explícita — `DELETE /api/chat/sessions/:sessionId?type=solaris-chat`
    (`dashboard_routes/chat.js`, botão real já existente em
    `solaris.ejs`) agora também chama `apagarProjeto()` quando a sessão
    apagada é do tipo Solaris, fechando o outro sub-gap documentado
    aqui antes (`chatStorageService.deleteSession` continua agnóstico
    de `solaris-projects` de propósito — a ponte fica na rota, não no
    serviço genérico de sessões).
  - **O que eu NÃO consegui fazer daqui**: provisionar o Cloud
    Scheduler de verdade (precisa de acesso ao console/`gcloud` do
    projeto GCP, que este ambiente não tem). O código está pronto e
    testado (`node src/solaris/tools/projectStorage.test.js`), mas
    quem configura o job (`gcloud scheduler jobs create http ... --uri
    https://.../internal/solaris/limpar-projetos-expirados -H
    "x-solaris-cleanup-secret: <secret>"`, mais o secret em ambas as
    pontas) é o dono do projeto. Até lá, rodar `npm run
    solaris:limpar-projetos-expirados` manualmente continua limpando
    de verdade — não é um placeholder, só não está automatizado
    sozinho.

## Voz para texto no chat — removido

O ditado por voz via Web Speech API (`webkitSpeechRecognition`) que
existiu no chat do Solaris (`views/pages/dashboard/solaris.ejs`) foi
**removido por decisão explícita do produto**: a API nativa do
navegador se mostrou não confiável o suficiente (4 rodadas de bugs
reais de duplicação de texto, cada uma com causa raiz distinta,
corrigidas ao longo de várias sessões) e não compensava manter
tentando contornar as inconsistências entre navegadores. Não existe
mais botão de microfone, nem `SpeechRecognition`/`webkitSpeechRecognition`
referenciado em nenhum lugar do código. Uma integração com uma API paga
de speech-to-text está planejada para uma fase futura, ainda sem
escopo definido.

## Ferramenta de escrita no projeto anexado (Fase 2d) — `pipeline/projectEditor.js`

Fecha o gap documentado nesta seção por um bom tempo: o Solaris só
conseguia LER um projeto anexado (`pipeline/projectInspector.js`,
`readFile`/`listFiles`/`searchInProject`). `responderOuEditarProjeto()`
assume o turno inteiro quando há projeto anexado — mesmas 3 ferramentas
de leitura (reusadas, não duplicadas) mais a capacidade de propor criar,
editar ou deletar um arquivo. `responderComProjeto()` (a versão só
leitura do turno) foi removida de `projectInspector.js` — dois agentes
de turno concorrendo pelo mesmo `baseDir` seria uma duplicação de
responsabilidade, não uma separação real; `inspecionarProjeto()`
(resumo de UMA vez, logo após o upload) continua lá, papel diferente.

Duas decisões de escopo fechadas explicitamente antes de implementar
(perguntadas ao dono do produto, não assumidas):

- **Confirmação por arquivo, nunca aplicação direta**: `proporMudancaArquivo`
  só monta uma proposta PENDENTE em memória — nada é gravado. Só
  `aplicarMudancasPendentes`, chamada numa mensagem SEGUINTE à proposta,
  grava de verdade. Reforçado em CÓDIGO, não só no prompt: uma proposta
  criada na MESMA resposta em que o modelo tenta aplicá-la é recusada
  (`estado.criadasNesteTurno`) — mesmo guard que `templateEditAgent.js`
  usa pra edição de template, generalizado pra granularidade por
  arquivo (cada caminho tem sua própria proposta pendente; aplicar ou
  cancelar pode mirar um caminho específico ou todos de uma vez).
- **Escopo: criar, editar e deletar** (não só criar/editar) —
  `deletarArquivo` novo em `tools/fileTools.js`, mesmo contrato de
  `lerArquivo`/`criarArquivo` (nunca lança, confinado por
  `_resolverSeguro`).

Validação determinística ANTES de aceitar qualquer proposta de
criar/editar (princípio #5 do CLAUDE.md — nunca aceitar output de IA
sem passar pelos mesmos verificadores que peça autoral passaria): o
conteúdo roda pelo Worker do tipo certo, resolvido pela extensão do
caminho contra o MESMO `WORKER_POR_TIPO` que `pipeline/orchestrator.js`
já usa pra gerar projeto do zero (nenhum registro paralelo) —
`quebrado.css`/`app.py` com erro de sintaxe nunca vira proposta
pendente, o modelo recebe o diagnóstico e tenta de novo.

Persistência de verdade (baseDir local temporário + GCS) é
responsabilidade do CALLER, injetada como `aplicarMudancasReal` — o
módulo não conhece GCS/Firestore, só orquestra o loop e o estado de
propostas em memória do turno (mesmo desenho de `aplicarEdicaoReal` em
`src/ai/templateEditAgent.js`). A rota (`routes/dashboard_routes/solaris.js`)
implementa isso reusando `apagarProjeto`+`salvarProjeto` de
`tools/projectStorage.js` — mesmo padrão de substituição que a rota de
upload já usa, sem inventar escrita cirúrgica por arquivo no GCS
(projeto Solaris é pequeno, poucas dezenas de arquivo de texto).

Propostas pendentes SOBREVIVEM entre turnos de chat — persistidas em
`meta.edicaoProjetoPendente` da sessão (`chatStorageService`, mesmo
mecanismo que já guarda `messages`/`tokens`), carregadas de volta no
turno seguinte antes de decidir se aplica ou cancela. Cada gravação de
sessão já é cobrada da cota do usuário (`saveSession(..., cota)`), então
o conteúdo pendente nunca fica fora da cota mesmo antes de ser aplicado.

**Download do projeto editado** — achado real testando a feature depois
de mergeada: `mudancasAplicadas` era calculado por `projectEditor.js`
mas nunca chegava ao usuário, mesma classe de bug já corrigida no chat
de edição do Workspace ("só promete e diz que mudou"). Corrigido
reusando o MESMO mecanismo que "projeto gerado" (Fase 3) já usa — quando
`aplicarMudancasPendentes` roda de verdade nesse turno, a rota monta um
ZIP do `baseDirProjeto` (já atualizado, mutado por `aplicarMudancasReal`
antes de persistir no GCS) e manda no evento `done` (`event.zip`), zero
mudança de frontend: o link de download que `solaris.ejs` já renderia
pra um projeto recém-gerado aparece igual pra um projeto recém-editado.

## Fluxo de conversa mais natural — `prompts/systemPrompt.js` + `llm/modelRouter.js`

Reportado pelo usuário: "torne o fluxo de conversa com o Solaris mais
natural, ele sempre dá a mesma resposta pra tudo". Investigação achou
duas causas reais, corrigidas as duas:

1. **Prompt sem distinção de intenção**: `SOLARIS_SYSTEM_PROMPT`
   instruía o roteiro de escopo ("pergunte o framework logo cedo" etc.)
   como se TODA mensagem fosse início de um projeto novo — sem
   distinguir saudação/bate-papo/pergunta geral de um pedido de projeto
   de verdade, e sem instrução explícita pra nunca repetir uma pergunta
   já respondida no histórico. O histórico já chegava formatado no
   prompt (`solarisChat._montarPrompt`) — o problema nunca foi falta de
   contexto, era a instrução não usar esse contexto pra decidir COMO
   responder. Nova seção "Antes de seguir o roteiro de escopo", logo no
   topo do prompt: saudação/bate-papo/pergunta geral vira resposta
   natural direta; pergunta técnica específica (mesmo em meio ao
   escopo) vira resposta de verdade com profundidade; informação já
   dada no histórico NUNCA é perguntada de novo; pedido de mudar algo
   já decidido ajusta sem reiniciar o roteiro do zero.
2. **Temperature de tarefa determinística aplicada ao chat**: o chat
   conversacional (`solarisChat.js`) usa `executarTriagemStream`, que
   até aqui copiava a mesma `temperature: 0.2` de `executarTriagem` —
   valor calibrado pra tarefa DETERMINÍSTICA (parse de JSON, detecção
   de framework), não pra conversa. Subido pra **0.5** só em
   `executarTriagemStream` (o único consumidor é o chat) —
   `executarTriagem` continua em 0.2 porque também serve
   `rag/ragEntryGenerator.js` (quer JSON confiável, não personalidade).

**Esclarecimento sobre Flash vs. Pro** (dúvida real levantada nesta
mesma investigação, confirmada pelo dono do produto): o split já é
correto por desenho, não um gap — Flash é só pro chat conversacional/
escopo (`solarisChat.js`, ida-e-volta de mensagem, precisa ser rápido e
barato). O Pro só entra DEPOIS que o usuário confirma o manifesto no
chat, via o marcador `[[SOLARIS_GERAR:{...}]]` — `orchestrator.js`
(`gerarManifesto`/`gerarArquivo`, ambos via `executarTarefaArquitetura`)
gera o manifesto de verdade e o código de cada arquivo. Tarefa de
código complexa, cara, mas de baixo volume (1x por projeto confirmado,
não por mensagem de chat) — o custo/latência maior do Pro cabe
exatamente aí, não no chat inteiro. Comentário de topo de
`llm/modelRouter.js` reescrito pra deixar essa separação explícita
(a palavra "brainstorm" sozinha, sem qualificar, dava a entender que a
conversa inteira deveria rodar no Pro — nunca foi essa a intenção).

### Rodada 2 — "por qualquer pergunta ele sempre fala dos frameworks e das paletas de cores"

A rodada 1 acima não foi suficiente: o usuário reportou que o chat
continuava puxando pra pergunta de framework/identidade visual mesmo em
mensagens que não tinham nada a ver com isso. Duas causas reais, as duas
corrigidas:

1. **`_contextoDeCategoria` (`chat/solarisChat.js`) competia com a
   instrução de responder à pergunta real e vencia.** O match de
   categoria do catálogo RAG é só léxico — uma pergunta comparativa tipo
   "qual a diferença entre Flask e Django?" casa a keyword "flask" e
   injeta o contexto da categoria Flask no prompt dizendo "use como base
   concreta pra sugerir estrutura, não pergunte em aberto". Esse texto
   competia diretamente com a seção "Antes de seguir o roteiro de
   escopo" do system prompt (rodada 1) e, na prática, vencia — o modelo
   trocava a resposta técnica pontual pela sugestão de estrutura.
   Corrigido injetando a ressalva no próprio ponto de injeção, não só no
   topo do prompt: o contexto agora deixa explícito que só deve ser
   usado se o usuário estiver de fato pedindo pra escopar aquele tipo de
   projeto agora, e que bate-papo/pergunta técnica pontual/pedido não
   relacionado devem ignorar esse contexto.
2. **A seção "Como conduzir o brainstorm" do system prompt não reforçava
   a condição no próprio ponto onde framework/categoria/paleta de cores
   são instruídos** — a condição só existia na seção anterior do prompt,
   distante das instruções concretas ("pergunte o framework logo cedo",
   "pergunte identidade visual"). Adicionada frase explícita logo na
   abertura da seção, citando a queixa relatada, deixando claro que
   framework/paleta só entram em jogo depois que já foi decidido que a
   mensagem é sobre escopar projeto — nunca como resposta padrão.
3. **Temperature elevada ao teto real da API** (2.0 — não existe valor
   maior aceito pelo Gemini; o pedido original era "temperatura 7.5",
   fora da faixa válida 0.0–2.0 documentada pela API) só em
   `executarTriagemStream`, pedido explícito do dono do produto pra
   deixar o chat o mais livre possível na resposta.

## Migração pra `@google/genai` — quebra total das chamadas Gemini

Achado real ao sincronizar com uma mudança externa na `main` (migração
do dashboard pra React): `package.json` trocou o SDK do Gemini de
`@google/generative-ai` pra `@google/genai` (unificada), mas nenhum
ponto de chamada real à API — em `llm/modelRouter.js` e nos outros 4
consumidores de Gemini da aplicação inteira (`src/services/geminiService.js`,
`src/ai/solAgent.js`, `src/ai/templateEditAgent.js`, `src/rag/ragAgent.js`)
— tinha sido atualizado. Todos ainda chamavam `.getGenerativeModel(...)`,
método que não existe na SDK nova (confirmado em runtime, não só por
leitura do `.d.ts`: `typeof ai.getGenerativeModel === 'undefined'`).
Isso quebrava TODA chamada real ao Gemini, Solaris incluído — nenhum
teste pegou porque `modelRouter.test.js` sempre injetou um
`clientFactory` fake, nunca bateu no SDK real.

`modelRouter.js` migrado pro shape real da SDK unificada:
- `ai.getGenerativeModel({...}).generateContent(prompt)` virou
  `ai.models.generateContent({model,contents,config})` — resposta
  direta, sem wrapper `.response`; `.text` é propriedade (getter), não
  mais função `.text()` (`orchestrator.js` também simplificado: o
  fallback frágil `typeof resposta.text === 'function' ? resposta.text() : String(resposta)`
  virou `resposta.text` direto).
- `.generateContentStream(prompt)` virou
  `ai.models.generateContentStream({model,contents,config})` — resolve
  pro async generator direto (sem `.stream`); não existe mais uma
  Promise de "response" agregada à parte — `usageMetadata` só vem
  completo no(s) último(s) chunk(s) do próprio stream.
- `model.startChat({history}).sendMessage(msg)` virou
  `ai.chats.create({model,config,history}).sendMessage({message:msg})`.
- `generationConfig` some como objeto aninhado — `temperature`,
  `maxOutputTokens`, `responseMimeType`, `responseSchema`,
  `thinkingConfig`, `safetySettings`, `systemInstruction` e `tools`
  viram campos diretos de `config`.
- **Achado extra no loop de tool-calling**: a SDK nova recusa um array
  cru de parts `functionResponse` — lança
  `"To specify functionCall or functionResponse parts, please wrap them in a Content object, specifying the role for them"`
  (confirmado lendo o código-fonte da SDK). A antiga aceitava
  implicitamente sob `role: 'user'`; agora precisa ser explícito:
  `{message: [{role:'user', parts: functionResponseParts}]}`.

`modelRouter.test.js`/`orchestrator.test.js` reescritos pra mockar o
shape real da SDK nova (fakes de `models.generateContent`/
`chats.create().sendMessage()`, não mais `getGenerativeModel`).

`agent/src/capabilities/web-search.js` tem o mesmo padrão quebrado,
mas é um serviço separado (Dockerfile próprio, `@google/genai` nem
instalado no `agent/package.json`, não referenciado pelos scripts do
`package.json` raiz) — deixado de fora dessa correção pra não expandir
escopo; sinalizar se for deployado algum dia.

## Coerência do projeto — `solaris.md` (Fase 2e)

Pedido direto: manter a coerência do projeto ao longo de várias
gerações/edições, escrevendo um `solaris.md` dentro do próprio
projeto — objetivo, framework, lista de arquivos e um changelog de
toda mudança aplicada de verdade (nunca proposta cancelada/pendente,
só o que foi de fato confirmado e persistido). `pipeline/projectMemory.js`
é o módulo novo — 100% determinístico (código, nunca uma chamada extra
ao modelo só pra formatar markdown, princípio #5 do CLAUDE.md): os
dados que entram nele (objetivo/framework do manifesto, resumo de cada
proposta aplicada) já existem prontos no fluxo normal de
`orchestrator.js`/`projectEditor.js`.

- `inicializarSolarisMd(baseDir, {...})` — chamado logo depois que
  `orchestrator.gerarProjeto()` termina com sucesso, ANTES de
  empacotar o ZIP (pra sair incluso no download). Nunca sobrescreve um
  `solaris.md` já existente.
- `registrarMudancasNoSolarisMd(baseDir, mudancas)` — chamado dentro de
  `projectEditor._executarAplicarPendentes`, ANTES da persistência
  real (o `baseDir` já reflete a entrada quando `aplicarMudancasReal`
  relista os arquivos pra persistir — mesmo mecanismo que o ZIP de
  download pós-edição já reusa, zero round-trip extra). Só acrescenta
  ao final, nunca reescreve do zero. Projeto sem `solaris.md` prévio
  (upload de projeto externo, nunca gerado pelo Solaris) ganha um
  mínimo na primeira edição aplicada — não trava por falta dele.
- **Guard determinístico** (mesmo princípio do `criadasNesteTurno` já
  usado neste arquivo — nunca confiar só no prompt pra uma garantia
  estrutural): `_executarProporMudanca` recusa de cara qualquer
  proposta de criar/editar/deletar o próprio `solaris.md` — ele é
  mantido só pelo sistema.
- `SYSTEM_INSTRUCTION_EDICAO` instrui o modelo a ler `solaris.md`
  (via `readFile`) no início da conversa quando ele existir, pra não
  contradizer uma decisão já registrada (framework, convenção,
  estrutura) sem o usuário pedir explicitamente.
- **Comentários no código gerado/editado**: pedido direto, junto com o
  `solaris.md`. `_promptArquivo` (orchestrator.js) e
  `SYSTEM_INSTRUCTION_EDICAO` (projectEditor.js) instruem o modelo a
  deixar comentários explicando decisões NÃO óbvias (por que, não o
  que — nomes já dizem o que o código faz). Geração de conteúdo é
  inerentemente não-determinística — não há alternativa de código pra
  isso, então a IA entra aqui por necessidade real (princípio #5 do
  CLAUDE.md), mas o QUE escrever (nunca o SE deve escrever) é decisão
  do modelo.

## O que NÃO existe ainda (fases seguintes, não fingido)

- Validação de REFERÊNCIAS dentro do catálogo (ex.: uma entrada citando
  `"components": ["hero-bootstrap", "pricing-bootstrap"]` e o Worker
  conferindo se cada snippet citado existe de verdade) — sugerido na
  mesma revisão que motivou `auditarCatalogo()`, mas deliberadamente
  NÃO implementado ainda: esse campo de referência a snippets não
  existe em nenhuma entrada real do catálogo hoje, então validar contra
  ele seria checagem especulativa, sem alvo real pra rodar contra (viola
  o princípio de não desenhar pra requisito hipotético). Entra quando o
  catálogo de fato ganhar esse tipo de entrada.
- Diff visual (antes/depois) das propostas de mudança de arquivo — hoje
  a confirmação é 100% conversacional (o modelo descreve o que muda em
  texto, mesmo padrão já usado na edição de template do Workspace, que
  também não tem diff visual). `conteudoNovo` da proposta existe e
  poderia alimentar uma UI de diff no futuro, mas nenhuma tela foi
  desenhada pra isso ainda.
- Abstração tipo "Workspace API" (`read_file`/`write_file`/`list_files`/
  `search`/`rag_query`/`compile`/`validate`/`preview`/`snapshot`) como
  camada única entre o modelo e qualquer ferramenta, com execução
  isolada em Worker sandboxado separado do processo principal — visão
  de arquitetura de longo prazo, ainda por desenhar. O que existe hoje
  (`projectInspector.js` + `projectEditor.js`) é um primeiro passo real
  e testado nessa direção (ferramentas confinadas ao `baseDir`, nunca
  execução), não a abstração completa.
- Context Caching (`cached_content` do roadmap) — cada chamada ao
  modelo hoje é isolada, sem cache de contexto entre chamadas de um
  mesmo projeto.

## Por que reusar os parsers de `src/core/parser/`

`src/core/parser/{html,css,js}Parser.js` já existem (Item 6 do RAG do
Sol, usados também via ferramenta no chat `/eu/sol`) e já são
determinísticos, testados e cobrem exatamente o que Fase 0 precisa
(sintaxe real via AST/PostCSS, não regex). Duplicar essa análise dentro
de `src/solaris/` violaria o princípio #4 do `CLAUDE.md`
("componentes especializados e reutilizáveis") sem ganho nenhum.

## Pipeline de embeddings vetoriais — `rag/ragChunker.js` + `rag/ragEntryText.js` + `rag/ragEmbeddingsClient.js` + `rag/ragVectorStore.js`

Pedido direto: automatizar a geração de embeddings do catálogo RAG
(hoje buscado só por palavra-chave, ver `ragCatalogLoader.buscarCategoria`)
e persistir os vetores no Firestore, como base pro **futuro** Solaris
agent (Gemini 2.5) fazer busca semântica real em vez de match de
palavra-chave. Decisão explícita de escopo: esta rodada entrega o
PIPELINE DE INDEXAÇÃO (catálogo → vetor → Firestore), não a busca
semântica ligada ao chat/agent em si — isso é gap em aberto, ver final
desta seção.

Cinco componentes, cada um com uma responsabilidade só (mesmo princípio
de especialização já usado no resto do RAG do Solaris):

1. **`rag/ragEntryText.js`** (puro, determinístico) —
   `montarTextoEmbedavel(entrada)` monta o texto a ser vetorizado a
   partir dos campos já existentes do catálogo (`descricao`/
   `componentes`/`exemplos`/`boas_praticas`/`keywords`, mesmo schema de
   `ragEntryGenerator.RAG_ENTRY_RESPONSE_SCHEMA`) — a MESMA entrada
   sempre produz o MESMO texto, propriedade que o passo 4 depende para
   ser idempotente.
2. **`rag/ragChunker.js`** (puro, determinístico) —
   `chunkarTexto(texto, {maxPalavras:250})` fatia em pedaços de até 250
   palavras, sempre em fronteira de palavra, nunca produz chunk vazio.
   250 palavras é o mesmo teto validado do lado do servidor de
   embeddings (defesa em profundidade — ver item 3).
3. **`Embedings-python/server.py`** (Python, serviço Cloud Run
   isolado) — único estágio que gera o vetor (`POST /embed`). Não
   conhece Firestore, não conhece "chunk"/RAG, não guarda estado —
   mesmo princípio de isolamento já usado em `sandbox-efemoro/`.
   Migrado da API Gemini para um modelo LOCAL (`paraphrase-multilingual-
   mpnet-base-v2` via `fastembed`, ONNX Runtime) depois de perder a
   conexão com a API Gemini — pesos baixados e cacheados na imagem
   Docker no build, nenhuma credencial de API externa (nem
   `GEMINI_API_KEY`, nem qualquer outra). Ver `Embedings-python/README.md`
   pra API completa, variáveis de ambiente e o motivo de ser um serviço
   separado em vez de uma capability do `agent/` ou do app principal.
4. **`rag/ragEmbeddingsClient.js`** (Node) — cliente HTTP fino do
   serviço acima (`gerarEmbeddings({textos, taskType})`), com
   retry/backoff exponencial só para falhas transitórias (5xx/rede,
   nunca 4xx — erro de validação não se resolve tentando de novo) e
   batching de até 20 textos por requisição (mesmo teto do serviço).
5. **`rag/ragVectorStore.js`** (Node) — escreve/lê a coleção
   `solaris_rag_vectors` no Firestore usando o índice vetorial NATIVO
   (`FieldValue.vector()` + `collection.findNearest()`, KNN real no
   servidor — não similaridade calculada em memória, decisão
   deliberada para escalar além de alguns milhares de chunks). Índice
   declarado em `firestore.indexes.json` (`fieldOverrides` →
   `solaris_rag_vectors.embedding` → `vectorConfig`, dimensão 768,
   precisa bater com `EMBEDDING_DIMENSION` do serviço Python).
   `substituirVetoresDaEntrada(entrada, chunks, embeddings)` faz
   REPLACE COMPLETO por entrada (apaga tudo que já existia daquela
   entrada antes de escrever de novo) em vez de append — decisão que
   evita por construção o bug de duplicação em reindexação identificado
   na revisão do protótipo original (`Embedings-python/Observações.md`,
   item 2.2: rodar duas vezes sobre a mesma pasta duplicava vetores
   indefinidamente). `buscarSimilares(queryEmbedding, topK)` agora tem
   um consumidor real (ver item 6 abaixo) — deixa de ser só código
   pronto-mas-não-chamado.
6. **`rag/ragSearchService.js`** (Node) — camada fina que orquestra os
   itens 4+5 pra uma QUERY de busca (não indexação): embeda a query
   com `taskType:'RETRIEVAL_QUERY'` (diferente de `RETRIEVAL_DOCUMENT`
   usado na indexação — otimiza a precisão da recuperação vetorial, ver
   `Embedings-python/Observações.md`) e chama `buscarSimilares()`.
   Exposta via `POST /internal/solaris/rag/buscar`
   (`src/routes/apiRoutes.js`) — endpoint interno autenticado por
   segredo compartilhado (`SOLARIS_RAG_SEARCH_SECRET`, header
   `x-solaris-rag-search-secret`), MESMO padrão fail-closed já usado em
   `/internal/solaris/limpar-projetos-expirados` (`crypto.timingSafeEqual`,
   recusa em produção sem secret configurado — nada novo inventado, só
   replicado). Consumida pela capability `knowledge.search` do Worker
   Agent (`agent/src/capabilities/knowledge-search.js`) — o agent/
   continua sem NENHUMA credencial de Firestore/Gemini pra isso, quem
   tem a credencial é este app principal (mesmo princípio de isolamento
   de `sandbox-efemoro/`). Ver `agent/README.md`, seção
   `knowledge.search`, pro lado do Worker.

**Orquestração — `npm run rag:embed-index [-- id1,id2,...]`**
(`scripts/ragEmbedIndex.js`, `rodarIndexacao()` testável com
catálogo/db/`gerarEmbeddingsFn` injetáveis, mesmo padrão de
`scripts/ragGenerate.js`): varre o catálogo real (ou só os ids
passados como filtro, pra reindexar incrementalmente sem reprocessar
tudo) e roda os 4 estágios acima por entrada. Uma entrada sem nenhum
campo preenchido (texto embedável vazio) é pulada sem chamar a API;
falha numa entrada (rede, validação) nunca impede as demais — relatório
final sempre com três categorias (`indexados`/`pulados`/`erros`),
nunca um sucesso-ou-falha binário pro lote inteiro.

**Segurança — segredo nunca em texto**: `EMBEDDINGS_SHARED_SECRET`
(segredo compartilhado no header `x-embeddings-secret`, mesmo padrão de
`SANDBOX_SHARED_SECRET` do `sandbox-efemoro/`) vem de variável de
ambiente/Secret Manager em produção — nunca hardcoded, nunca colado em
chat/log/commit. O serviço Python não tem mais nenhuma credencial de
API externa pra proteger (migrado da API Gemini pra um modelo local,
ver `Embedings-python/README.md`).

**O que eu NÃO consegui fazer daqui (gaps reais, não escondidos)**:

- **Deploy do serviço Python no Cloud Run** — precisa de acesso ao
  console/`gcloud` do projeto GCP, que este ambiente não tem (mesmo gap
  já documentado pro Cloud Scheduler em "Retenção — TTL fechado" mais
  acima). `Embedings-python/Dockerfile` está pronto (já baixa e cacheia
  o modelo local no próprio build); falta o dono do projeto rodar o
  build+deploy e configurar `EMBEDDINGS_SHARED_SECRET` (não depende
  mais de Secret Manager pra chave de API nenhuma — não existe mais
  `GEMINI_API_KEY` neste serviço).
- **Publicar o índice vetorial** — `firestore.indexes.json` já declara
  o `fieldOverride` de `solaris_rag_vectors.embedding`, mas precisa de
  `firebase deploy --only firestore:indexes` rodando contra o projeto
  real pra existir de verdade — até lá, `findNearest()` falha (índice
  inexistente).
- **`EMBEDDINGS_SERVICE_URL`** — o pipeline Node lê essa variável pra
  saber onde está o serviço Cloud Run; só existe depois do deploy
  acima. Sem ela configurada, `ragEmbeddingsClient.gerarEmbeddings`
  lança erro explícito (nunca falha silenciosa).
- **Busca semântica ligada ao Worker Agent (`agent/`)** — feito
  (`ragSearchService.js` + `POST /internal/solaris/rag/buscar` +
  `agent/src/capabilities/knowledge-search.js`, ver item 6 acima).
  Continua bloqueado só pelos dois gaps de deploy já listados
  (serviço Python + índice vetorial) — a cadeia inteira foi validada
  de ponta a ponta neste ambiente e falha exatamente (e só) nesse
  ponto.
- **Busca semântica ligada ao CHAT do Solaris (Gemini 2.5,
  `solarisChat.js`/`ragCatalogLoader.buscarCategoria`)** — ainda em
  aberto, e é um gap DIFERENTE do item acima (consumidor diferente:
  ali é o Worker Agent autônomo, aqui é o brainstorm conversacional).
  Decisão de produto pendente: substituir `buscarCategoria` (match por
  palavra-chave) por busca vetorial, ou usar os dois em conjunto —
  fora do escopo técnico, fica pra quando essa decisão for tomada.

