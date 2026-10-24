# softload-worker-agent

## Estrutura do projeto

```
agent/
├── package.json
├── Dockerfile
├── scripts/
│   └── vendorPowerUp.js         # copia ../Power-up/diff_patch_engine.cpp -> native/ (ver seção de build)
├── native/                      # gerado por vendorPowerUp.js, nunca commitado (.gitignore)
│   └── diff_patch_engine.cpp    # fonte do diff/patch engine em C++, compilado no Dockerfile
└── src/
    ├── index.js                     # entrypoint (node src/index.js) — sobe o Agent + o servidor HTTP
    ├── server.js                    # createApp(agent): POST /run, GET /health, GET /capabilities
    ├── agent.js                     # classe Agent: monta workspace, permissions, capabilities
    ├── agent-dispatch-capability.js # capability usada pelo Orquestrador para delegar a sub-agentes (um por vez)
    │
    ├── core/
    │   ├── task-router.js           # resolve task.type -> capability (TASK_MAP)
    │   ├── task-runner.js           # executa a task já roteada, padroniza resultado
    │   └── workspace.js             # diretório de trabalho isolado (protegido contra path traversal)
    │
    ├── capabilities/
    │   ├── filesystem.js            # file.read/write/edit/delete/list/search
    │   ├── shell.js                 # shell.execute (via execa, sem shell:true)
    │   ├── git.js                   # git.status/diff/log/branch/commit
    │   ├── github.js                # github.issue_*/pull_request_*/repository_get (via @octokit/rest, GITHUB_TOKEN)
    │   ├── storage.js               # stub — storage.read/write/delete/list
    │   ├── artifacts.js             # stub — artifact.build/push/list
    │   ├── build.js                 # build.detect/run (detecta e roda build via runCommand)
    │   ├── test.js                  # test.detect/run (idem, para suíte de testes)
    │   ├── package.js               # package.install/add (npm/composer/pip)
    │   ├── process.js               # process.start/status/output/kill (background + webhook opcional de "terminou")
    │   ├── code-analysis.js         # code.analyze — estatísticas estáticas, só leitura
    │   ├── code-search.js           # code.search — busca via ripgrep (fallback JS puro)
    │   ├── project-inspector.js     # project.inspect — detecta linguagem/framework/scripts
    │   ├── web-search.js            # web.search — Gemini + Google Search Grounding
    │   ├── web-fetch.js             # web.fetch — busca uma URL específica diretamente (proteção contra SSRF embutida)
    │   ├── web-sandbox.js           # websandbox.run — chama o serviço isolado sandbox-efemoro/ via HTTP
    │   ├── archive.js               # archive.extract_zip — extração segura de ZIP, também via sandbox-efemoro/
    │   ├── knowledge-search.js      # knowledge.search — busca semântica (embeddings) via endpoint interno do app principal
    │   ├── mcp-client.js            # mcp.list_servers/list_tools/call_tool — cliente genérico de servidores MCP externos
    │   ├── agent-parallel-dispatch.js # agent.dispatch_parallel — fan-out de agent.dispatch, isolado por git worktree
    │   ├── plan-tracker.js          # plan.* — registro EM MEMÓRIA de progresso, só do Orquestrador
    │   ├── escalation.js            # escalation.* — canal de escalonamento pra humano (webhook + POST /escalations/:id/respond)
    │   └── __testUtils__/
    │       └── mcpEchoServer.js     # servidor MCP real, só para teste (mcp-client.e2e.test.js) — nunca implantado
    │
    ├── config/
    │   └── mcpServers.js            # parse/validação de MCP_SERVERS_JSON (servidores MCP configurados)
    │
    ├── security/
    │   ├── permissions.js           # allowlist/denylist por task.type, com mode "restricted"/"full"
    │   ├── command-policy.js        # allowlist de executáveis + prefixos exatos para shell.execute
    │   ├── role-permissions.js      # presets prontos por papel de sub-agente (ver abaixo)
    │   └── ssrf-guard.js            # proteção contra SSRF compartilhada (web-fetch.js + webhook-delivery.js)
    │
    ├── notifications/
    │   └── webhook-delivery.js      # deliverWebhook/verifyWebhookSignature — webhook de saída assinado (HMAC)
    │
    ├── orchestration/
    │   ├── coder-validator-loop.js  # loop Programador<->Validador com limite de tentativas
    │   ├── orchestrator-example.js  # wiring completo: Orquestrador + todos os sub-agentes
    │   ├── example-usage.js         # exemplo isolado do loop Programador/Validador
    │   └── git-worktree-pool.js     # createWorktree/removeWorktree — usado por agent-parallel-dispatch.js
    │
    ├── protocol/
    │   ├── protocol.js              # validação (Zod) do payload de entrada da API do Worker
    │   └── protocol-adapter.js      # traduz {capability, operation} -> task.type interno
    │
    └── utils/
        ├── logger.js                # logger JSON estruturado (campo "severity", compatível com Cloud Logging)
        ├── errors.js                # AgentError
        ├── parse-command.js         # parser de comando shell com suporte a aspas
        └── run-command.js           # runCommand/truncateOutput — wrapper de execa usado por build/test/package/process/code-search
```

## Build da imagem Docker

O `Dockerfile` tem dois estágios:

1. `cpp-builder` (`debian:bookworm-slim` + g++): compila
   `native/diff_patch_engine.cpp` (o motor de diff/patch estrutural da
   pasta `Power-up/` na raiz do monorepo, ver `Power-up/Observações.md`)
   num binário standalone.
2. Estágio final (`node:22-bookworm`, igual a antes): copia só o
   **binário já compilado** do estágio 1 para `/app/bin/diff_patch_engine`
   (no `PATH` da imagem) -- o toolchain C++ e o código-fonte nunca entram
   na imagem final.

O build da imagem usa **contexto = pasta `agent/`**, não a raiz do repo.
Como `Power-up/` é uma pasta irmã de `agent/`, o Docker não a enxerga
diretamente -- por isso o passo 1 acima compila `native/diff_patch_engine.cpp`,
e não `../Power-up/diff_patch_engine.cpp` diretamente. `native/` é gerado
localmente por `npm run vendor:power-up` (copia o `.cpp` de `Power-up/`),
nunca é commitado, e precisa ser rodado **antes** de `docker build`:

```bash
cd agent
npm run vendor:power-up   # gera native/diff_patch_engine.cpp a partir de ../Power-up/
docker build -t <imagem> .
```

Se `native/diff_patch_engine.cpp` não existir, o build falha no estágio
`cpp-builder` com um erro claro de `COPY` (o comentário no `Dockerfile`
lembra do `npm run vendor:power-up`).

## API HTTP (`server.js`)

```
GET  /health          -> 200 {"status": "ok"}
GET  /capabilities     -> 200 {"filesystem": ["read","write",...], ...} (getSupportedOperations())
POST /run               -> 200 com o resultado de cada action
  Header: x-worker-secret: <WORKER_SHARED_SECRET>
  Body: {
    request_id: string,
    task: "execute",
    actions: [
      { id: string, capability: string, operation: string, input: {...} },
      ...   // até 50 por request
    ]
  }
  Resposta: { requestId, results: [{ actionId, ok, taskType, capability, durationMs, result|error }, ...] }

POST /escalations/:escalationId/respond -> status HTTP convencional (200/400/404/409/403/500)
  Header: x-worker-secret: <WORKER_SHARED_SECRET> (mesmo segredo de /run)
  Body: { decision: string, note?: string }
  Resposta 200: o escalonamento completo, já resolvido (ver escalation.get)
```

`POST /run` roda as `actions` **sequencialmente** (não em paralelo) — actions do mesmo request
podem depender de ordem (ex: `filesystem.write` seguido de `filesystem.read` do mesmo arquivo).
Uma action com erro de execução ou de roteamento (capability/operação desconhecida) nunca aborta
as demais do mesmo lote — sempre aparece no array `results` com `ok:false`, formato idêntico ao
das falhas normais de `TaskRunner`.

`POST /escalations/:escalationId/respond` é a ÚNICA rota deste servidor fora do protocolo genérico
de `/run` — devolve status HTTP convencional por erro (`400` validação, `404` não encontrado, `409`
já respondido, `403` permissão negada), diferente de `/run` (sempre `200` com `{ok:false}` por
action), porque é uma rota de propósito único: mais natural pra quem a consome de fora checar
`resp.ok`/status direto, sem precisar parsear um envelope de batch. Ver seção "Escalonamento
humano" mais abaixo pro fluxo completo.

Variáveis de ambiente:

- `PORT` — porta do servidor HTTP (Cloud Run injeta automaticamente; default `8080`).
- `WORKER_SHARED_SECRET` — segredo exigido no header `x-worker-secret`. Sem isso configurado, o
  serviço sobe com aviso e aceita qualquer chamador — mesma defesa em profundidade mínima já usada
  em `sandbox-efemoro/` (`SANDBOX_SHARED_SECRET`) e nos endpoints internos do app principal
  (`SOLARIS_RAG_SEARCH_SECRET` etc.); o ideal em produção é também restringir por IAM/rede do
  Cloud Run.

## Capabilities e task.type suportados

| Capability (protocolo)  | Chave em `Agent.capabilities` | task.type                                              |
|--------------------------|-------------------------------|----------------------------------------------------------|
| `filesystem`              | `filesystem`                  | `file.read/write/edit/diff/patch/delete/list/search`                  |
| `shell`                   | `shell`                       | `shell.execute`                                            |
| `git`                     | `git`                         | `git.status/diff/log/branch/commit`                        |
| `github`                  | `github`                      | `github.issue_*/pull_request_*/repository_get` (requer `GITHUB_TOKEN`, ver abaixo) |
| `storage`                 | `storage`                     | `storage.read/write/delete/list` (stub)                    |
| `artifacts`               | `artifacts`                   | `artifact.build/push/list` (stub)                           |
| `build`                   | `build`                       | `build.detect/run`                                          |
| `test`                    | `test`                        | `test.detect/run`                                            |
| `package`                 | `package`                     | `package.install/add`                                        |
| `process`                 | `process`                     | `process.start/status/output/kill` (`start` aceita `callback_url`/`callback_secret` opcionais, ver abaixo) |
| `code-analysis`           | `codeAnalysis`                 | `code.analyze`                                                 |
| `code-search`             | `codeSearch`                   | `code.search`                                                    |
| `project-inspector`       | `projectInspector`             | `project.inspect`                                                 |
| `web-search`              | `webSearch`                    | `web.search` (requer `GEMINI_API_KEY`)                             |
| `web-fetch`                | `webFetch`                     | `web.fetch` (busca URL específica, proteção contra SSRF embutida)   |
| `escalation`                | `escalation`                   | `escalation.request/respond/get/list` (canal de escalonamento pra humano, ver abaixo) |
| `web-sandbox`              | `webSandbox`                   | `websandbox.run` (requer `SANDBOX_SERVICE_URL`, ver abaixo)          |
| `archive`                  | `archive`                      | `archive.extract_zip` (extração segura de ZIP via `sandbox-efemoro/`, ver abaixo) |
| `knowledge-search`         | `knowledgeSearch`              | `knowledge.search` (requer `SOLARIS_RAG_SEARCH_URL`, ver abaixo)      |
| `mcp`                      | `mcp`                          | `mcp.list_servers/list_tools/call_tool` (servidor genérico ou presets GitHub/Supabase, ver abaixo) |
| —                         | `dispatch`                     | `agent.dispatch` (só via `extraCapabilities`, não faz parte do protocolo externo) |
| —                         | `dispatchParallel`             | `agent.dispatch_parallel` (fan-out isolado por git worktree, só via `extraCapabilities`) |
| —                         | `planTracker`                  | `plan.create/add_item/update_item/list/get` (registro em memória, só via `extraCapabilities`) |

### `file.read` — paginado por linha, sempre

Sem `offset`/`limit`, `file.read` continua devolvendo `content` como
sempre devolveu — a diferença só aparece em arquivo GRANDE: no máximo
2000 linhas por chamada (`DEFAULT_READ_LIMIT_LINES`, mesmo teto default
do Read tool deste próprio Claude Code), com `truncated: true` no
resultado avisando que sobrou conteúdo. `offset` é 1-indexado (linha 1
é a primeira) — pagina o resto com `offset: totalLines_ja_lidas + 1`.
Retorno sempre inclui `totalLines`/`offset`/`truncated`, além de
`content`.

### `file.edit` — edição por substituição de string, não sobrescrita

`file.write` sempre grava o arquivo inteiro (o chamador precisa montar
o conteúdo completo). `file.edit` faz uma troca `oldString` ->
`newString` cirúrgica, sem tocar no resto do arquivo — mesmo contrato
do Edit tool deste próprio Claude Code:

- `oldString` precisa aparecer no arquivo; se não aparecer, erro.
- Por padrão precisa aparecer **exatamente uma vez** — mais de uma
  ocorrência é rejeitado como ambíguo (erro claro, nunca adivinha qual
  trocar). Passe `replaceAll: true` pra trocar todas de propósito.
- `oldString` e `newString` não podem ser iguais.

Protocolo externo (`filesystem.edit`): `{ path, old_string, new_string,
replace_all? }` — ver `protocol/protocol.js` (schema) e
`protocol/protocol-adapter.js` (rename pra `oldString`/`newString`/
`replaceAll` internamente).

### `file.diff` / `file.patch` — motor de diff/patch estrutural (`Power-up/diff_patch_engine.cpp`)

Terceira opção de escrita, ao lado de `file.write` (sobrescreve tudo) e
`file.edit` (troca uma string exata): calcula e aplica uma
transformação de arquivo em duas etapas separadas, delegando o cálculo
pro motor C++ determinístico já compilado na imagem (ver "Build da
imagem Docker" acima) — nunca em JS. Mesmo princípio de "IA decide O
QUE mudar, código determinístico decide COMO" documentado em
`Power-up/Observações.md`.

- **`file.diff`** (`{ path, new_content }` → `filesystemInput.new_content`
  no protocolo, `newContent` internamente): lê o conteúdo ATUAL de
  `path`, calcula o patch estrutural (algoritmo de Myers, token a
  token — não linha a linha, mais preciso quando o arquivo foi
  reformatado ou teve poucas linhas deslocadas) que o transformaria em
  `new_content`, e devolve `{ path, patch, summary }` **sem escrever
  nada**. `patch` é o objeto pronto pra mandar de volta em `file.patch`
  (formato `structural-token-diff-v2`: `{ format, sourceHash, ops }`,
  onde `sourceHash` é o SHA-256 do arquivo no momento do cálculo);
  `summary` (`{ insertedChars, deletedChars }`) dá uma medida rápida do
  tamanho da mudança sem precisar inspecionar `ops` inteiro. Existe
  como etapa separada de propósito: permite pré-visualizar/revisar uma
  mudança (ex: via `escalation.request`, ou só logar antes de aplicar)
  antes de decidir aplicá-la.
- **`file.patch`** (`{ path, patch }`): aplica um `patch` (tipicamente
  o que `file.diff` devolveu) contra o conteúdo ATUAL de `path` e grava
  o resultado **atomicamente** (`Workspace.writeAtomic()` — arquivo
  temporário no mesmo diretório + `fs.rename`, nunca uma escrita
  parcial visível). Rejeita, sem escrever nada, se `path` mudou desde
  que o patch foi calculado — o binário confere `sourceHash` ANTES de
  tentar aplicar qualquer operação, então uma edição concorrente (ex:
  dois agentes, ou o usuário editando por fora) nunca é sobrescrita
  silenciosamente.

Erros de `diff_patch_engine` (ver `utils/diff-patch-engine.js`, que
mapeia os exit codes documentados em `Power-up/Observações.md` item 16)
propagam com mensagem clara: arquivo não encontrado, patch malformado,
**hash de origem não confere** (o caso de edição concorrente acima), ou
patch que não corresponde ao conteúdo atual.

Permissão: `file.diff` acompanha o mesmo critério de `file.read`
(cálculo é leitura); `file.patch` acompanha `file.write`/`file.edit`
(escreve) — ver `security/role-permissions.js`.

Validado de ponta a ponta com o binário REAL, compilado via `g++` na
própria suíte de teste (não mockado) — ver
`utils/diff-patch-engine.e2e.test.js` (cliente subprocess isolado,
inclui os vetores de teste oficiais do SHA-256) e
`capabilities/filesystem-patch.e2e.test.js` (capability completa +
protocolo HTTP `POST /run` com campos snake_case reais).

### `websandbox.run` — auditoria de navegador via sandbox-efemoro/

Chama `POST /run` do serviço isolado em `sandbox-efemoro/` (Playwright
rodando em container/credenciais próprios — ver o README de lá) e
repassa o resultado estruturado (screenshot, console, rede,
responsividade, acessibilidade) como está. Esta capability nunca abre
um navegador no processo do agent.

Variáveis de ambiente:

- `SANDBOX_SERVICE_URL` — URL do serviço Cloud Run do
  `sandbox-efemoro/`. Sem isso, `websandbox.run` lança erro explícito
  (nunca falha silenciosa).
- `SANDBOX_SHARED_SECRET` — mesmo segredo compartilhado configurado no
  `sandbox-efemoro/` (header `x-sandbox-secret`). Opcional (mesma
  defesa em profundidade mínima documentada lá — sem isso, o serviço
  aceita qualquer chamador).

Só o preset do Validador (`createValidatorPermissions`) libera
`websandbox.run` por padrão — mesmo raciocínio de `build.run`/
`test.run`: é o papel cujo trabalho é auditar o resultado, aqui via
navegador real em vez de linha de comando.

### `archive.extract_zip` — extração segura de ZIP, também via sandbox-efemoro/

`zipPath`/`destPath` são caminhos RELATIVOS AO WORKSPACE deste agent —
o `.zip` nunca viaja pelo corpo de `POST /run` (limite de 1MB de JSON,
ver abaixo; um zip de poucos MB já estouraria isso). Precisa já estar
no workspace (ex: escrito via `file.write`) antes de chamar
`archive.extract_zip`. Ver seção dedicada mais abaixo neste README
para a auditoria completa que motivou a escolha de arquitetura.

Mesmas variáveis de ambiente de `websandbox.run` (`SANDBOX_SERVICE_URL`/
`SANDBOX_SHARED_SECRET`) — mesmo serviço isolado, endpoint diferente
(`POST /extract-zip`).

Negado no preset default e liberado somente no preset do Programador
(`createCoderPermissions`). A capability lê o ZIP e grava os arquivos
extraídos no workspace, portanto cabe no papel que já possui
`file.read`/`file.write`. Investigador e Validador continuam somente
leitura; os demais papéis precisam de `permissions.grant()` pontual.

### `knowledge.search` — busca SEMÂNTICA (embeddings) no catálogo RAG do Solaris

Diferente de `code.search` (grep local) e `web.search` (conteúdo
externo via Gemini), `knowledge.search` busca por SIGNIFICADO (não
palavra-chave) dentro do catálogo RAG do Solaris (`src/solaris/rag/`
no repositório Node principal) — a mesma base de conhecimento técnico
que já existe, agora buscável por proximidade semântica em vez de só
match de palavra.

Chama `POST /internal/solaris/rag/buscar` no app principal, que já
tem a credencial de Firestore — o agent/ continua sem NENHUMA
credencial de Firestore ou Gemini pra isso, mesmo princípio de
isolamento de `web-sandbox.js`. A rota, por sua vez, usa o pipeline de
embeddings já existente (`ragEmbeddingsClient.gerarEmbeddings` +
`ragVectorStore.buscarSimilares`, ver `src/solaris/README.md`, seção
"Pipeline de embeddings vetoriais").

Variáveis de ambiente:

- `SOLARIS_RAG_SEARCH_URL` — URL base do app principal. Sem isso,
  `knowledge.search` lança erro explícito.
- `SOLARIS_RAG_SEARCH_SECRET` — segredo compartilhado (header
  `x-solaris-rag-search-secret`), dedicado a este endpoint (não
  reaproveita `SOLARIS_CLEANUP_SECRET` — cada endpoint interno com seu
  próprio segredo).

Igual a `web.search`: **nenhum papel libera por padrão** — é útil de
forma transversal a vários papéis (Investigador pesquisando,
Programador buscando referência), não o motivo de existir de um papel
específico só. Conceda via `permissions.grant("knowledge.search")` em
tempo de execução quando um fluxo específico precisar.

### `github.*` — issues, pull requests e dados de repositório (via `@octokit/rest`)

`github.js` deixou de ser stub — `@octokit/rest` já era dependência
declarada no `package.json` desde o início, mas nunca tinha sido
importada em lugar nenhum até agora.

- `github.issue_create` — exige `owner`/`repository`/`title` (`body`
  opcional).
- `github.issue_get` — exige `owner`/`repository`/`issueNumber`.
- `github.pull_request_create` — exige `owner`/`repository`/`title`/
  `head`/`base` (`body` opcional).
- `github.pull_request_get` — exige `owner`/`repository`/`pullNumber`.
- `github.repository_get` — exige só `owner`/`repository`.

Cada operação devolve um formato reduzido (nunca o objeto bruto do
Octokit, que carrega dezenas de campos internos pouco úteis pra quem
consome o resultado da task).

Variável de ambiente: `GITHUB_TOKEN` — sem isso, `github.*` lança erro
explícito na primeira chamada (nunca falha silenciosa; a checagem só
acontece na hora de usar, não na hora de instanciar a capability, pra
não impedir o `Agent` de subir só porque essa credencial específica
ainda não foi configurada).

Permissões (já vinham pré-configuradas em `role-permissions.js` desde
antes deste stub virar implementação real, então nenhuma role precisou
mudar): só o Investigador tem as 3 operações de LEITURA liberadas
(`issue_get`/`pull_request_get`/`repository_get`) — as de ESCRITA
(`issue_create`/`pull_request_create`) ficam negadas em todo papel por
padrão, mesmo critério de `git.commit`.

## Sub-agentes (ver `security/role-permissions.js`)

| Papel         | Preset                         | Pode                                             |
|---------------|---------------------------------|---------------------------------------------------|
| Investigador  | `createExplorerPermissions`     | ler/listar/buscar arquivos, git read-only, detectar/analisar/inspecionar código (só leitura) |
| Arquiteto     | `createArchitectPermissions`    | nada (puramente chamada de LLM, sem capabilities)  |
| Programador   | `createCoderPermissions`        | ler/escrever/**editar**/deletar arquivos, git read-only, detectar/analisar/inspecionar código |
| Validador     | `createValidatorPermissions`    | shell restrito a comandos de teste/lint/build, **mais `build.run`/`test.run`/`websandbox.run` liberados** |
| Empacotador   | `createPackagerPermissions`     | shell restrito a git add/commit/push, zip, tar      |
| Orquestrador  | `createOrchestratorPermissions` | `agent.dispatch` (um por vez), `agent.dispatch_parallel` (fan-out isolado por worktree) e `plan.*` (progresso em memória) — delega e acompanha os outros papéis |

Nenhum papel libera `package.install/add`, `process.*` (start/kill) ou `web.search` por padrão —
são ações com custo/efeito real (instalar dependência nova, iniciar processo, chamar API paga)
fora do escopo de qualquer papel definido até agora. Conceda via `permissions.grant("...")` em
tempo de execução se um fluxo específico precisar.

## Bugs corrigidos (auditoria + correção real, não só leitura)

Histórico: este código foi originalmente só "organizado" (arquivos renomeados/movidos) sem nunca
ter sido de fato instalado/executado. Uma auditoria seguida de correção real (`npm install` +
`new Agent()` + execução de tasks reais, incluindo comandos de shell/git/build/test genuínos)
encontrou e corrigiu:

- `core/task-router.js` era uma cópia acidental de `security/permissions.js` — não existia
  nenhuma implementação real de `TaskRouter`, e o processo falhava ao iniciar. Reescrito com o
  `TASK_MAP` real.
- `utils/run-command.js` não existia — 6 capabilities importavam dele. Criado.
- `package-lock.json` nunca existiu, e o `Dockerfile` roda `npm ci` (que exige lockfile). Gerado e commitado.
- `security/command-policy.js`: blocklist de `rm -rf /` (e variantes) tinha um bug de `\b` que
  deixava passar exatamente o caso mais perigoso citado no próprio comentário do código.
- `security/permissions.js`: faltavam `file.list`/`file.search` no mapa padrão.
- `capabilities/web-search.js`: misturava a API do SDK antigo (`@google/generative-ai`,
  `getGenerativeModel()`) com o import do SDK atual (`@google/genai`) — corrigido para
  `genAI.models.generateContent()`, mesmo padrão já usado em `src/services/geminiService.js` do
  app principal. Também tinha um bug real de `maxResults is not defined` (nunca passado para
  `extractSearchResults`) e um `filteredCount` calculado mas nunca devolvido ao chamador —
  ambos só encontrados rodando os testes de verdade, não por leitura estática.
- `capabilities/web-search.test.js`: usava globals do Jest num projeto que roda `node --test`.
  Reescrito com `node:test` + mock real de `@google/genai` via `mock.module()` (requer
  `--experimental-test-module-mocks`, já no script `test` do `package.json`).
- Dois timers (`setTimeout`) em `web-search.js` sem `.unref()` — seguravam o processo vivo por
  até 60s/30s desnecessariamente após a task terminar.
- As 8 capabilities acima (build/test/package/process/code-analysis/code-search/
  project-inspector/web-search) existiam prontas mas nunca tinham sido ligadas em `agent.js`,
  `core/task-router.js`, `security/permissions.js`, `security/role-permissions.js`,
  `protocol/protocol.js` nem `protocol/protocol-adapter.js` — nenhuma delas era alcançável nem
  pelo `Agent` interno nem pela API HTTP do Worker. Ligadas em todos os pontos.

## Validado de verdade (não só `node --check`)

- `npm install` real (dependências instaladas, incluindo `@google/genai`, que faltava no
  `package.json`).
- `new Agent()` + `agent.start()` — todas as 14 capabilities instanciam sem erro.
- Execução real de `file.write/read`, `git.status` (binário `git` de verdade),
  `project.inspect`/`code.analyze`/`code.search` (via `rg`), `build.detect`/`build.run` e
  `test.run` (via `npm run build`/`npm test` reais, com `createValidatorPermissions()`).
- Permissões negando corretamente por padrão (`shell.execute`, `build.run`, `web.search`) e
  liberando corretamente com o preset certo (Validador).
- Pipeline HTTP completo: `parseTaskRequest()` (Zod) → `requestToTasks()` (rename
  snake_case→camelCase) → `Agent.execute()`, ponta a ponta, para as 14 capabilities.
- `npm test` — suíte de `web-search.test.js` (7 casos) passando de verdade.

## `file.edit` e `websandbox.run` (2 gaps fechados de uma auditoria comparando com o Claude Code)

Pedido direto, depois de uma auditoria comparando as capabilities daqui contra o ambiente de
execução deste próprio Claude Code: os dois gaps de maior alavancagem identificados foram
`file.write` só sobrescrever o arquivo inteiro (sem edição cirúrgica) e `sandbox-efemoro/` já
existir pronto/testado sem nenhuma capability em `agent/` saber chamá-lo.

- **`file.edit`** (`filesystem.js`): substituição `oldString` -> `newString` exata — precisa
  aparecer no arquivo, precisa ser única (a menos que `replaceAll:true`), `oldString !==
  newString`. Mesmo contrato do Edit tool do Claude Code, escolhido de propósito por ser
  previsível: nunca adivinha qual ocorrência trocar quando é ambíguo. Ligado nos mesmos 5 lugares
  documentados na seção anterior (`task-router.js`, `permissions.js`, `role-permissions.js`,
  `protocol.js`, `protocol-adapter.js`) — permissão default `true`, liberado só pro Programador
  entre os papéis (mesmo nível de `file.write`).
- **`websandbox.run`** (`web-sandbox.js`, novo): cliente HTTP fino do serviço isolado
  `sandbox-efemoro/` (`POST /run`) — `fetchImpl` injetável para teste, `SANDBOX_SERVICE_URL`/
  `SANDBOX_SHARED_SECRET` via ambiente (nunca hardcoded). Uma resposta HTTP não-ok é erro de
  infraestrutura (lança exceção); `{success:false, errors:[...]}` dentro de um 200 normal é
  devolvido como está — é a falha da AUDITORIA em si, não desta capability. Permissão default
  `false` (custo real de compute/rede, mesma categoria de `web.search`), liberada só pro
  Validador — mesmo raciocínio de `build.run`/`test.run`: é o papel cujo trabalho é auditar o
  resultado, aqui via navegador real em vez de linha de comando.

**Validado de ponta a ponta com os serviços reais**, não só teste unitário: subiu o
`sandbox-efemoro/src/server.js` de verdade localmente (Chromium pré-instalado deste ambiente,
via `SANDBOX_CHROMIUM_EXECUTABLE_PATH`) e chamou via `new Agent({role:"validator", ...}).execute({
type:"websandbox.run", ... })` — contra `https://example.com` (falhou por `ERR_TUNNEL_CONNECTION_FAILED`,
a mesma política de rede deste ambiente que já bloqueou `docker.io`/CDN do Playwright antes — não
um bug da capability) e contra uma página local de verdade (sucesso real: `success:true`,
screenshot gravado em disco, 0 violações de acessibilidade). `file.edit` também testado via
`Agent.execute()` real (não só a capability isolada), com o preset `createCoderPermissions()`.

15 testes novos (`filesystem.test.js` + `web-sandbox.test.js`) — `npm test` do `agent/`: 28/28
passando.

Ainda não corrigido (fora do escopo desta rodada, documentado): as 8 capabilities recém-ligadas
não têm testes automatizados próprios (só web-search.js tem); `capabilities/test.js` colide com o
padrão de descoberta de arquivo de teste do `node --test` (aparece como um "teste" vazio na saída
de `npm test` — inofensivo, mas confuso).

## `file.read` paginado e `knowledge.search` (itens #2 e #1 da mesma auditoria)

Continuação direta da rodada anterior (`file.edit`/`websandbox.run`) — pedido explícito:
"implanta 1 e 2" da lista de gaps restantes.

- **`file.read` com `offset`/`limit`** (`filesystem.js`): sem parâmetros, agora aplica um teto
  default de 2000 linhas (`DEFAULT_READ_LIMIT_LINES`, mesmo valor do Read tool deste próprio
  Claude Code) e sinaliza `truncated`/`totalLines`/`offset` no retorno — arquivo GRANDE não estoura
  mais o contexto de quem consome o resultado. Nenhum caller interno do agent/ dependia de
  `file.read` sempre devolver o arquivo inteiro (confirmado via grep antes de mudar o
  comportamento default), então isso não é uma mudança que quebra nada existente — só passa a
  aplicar a mesma paginação segura por padrão.
- **`knowledge.search`** (`capabilities/knowledge-search.js`, novo): busca SEMÂNTICA (não
  palavra-chave) no catálogo RAG do Solaris. Mesmo padrão de isolamento de `web-sandbox.js` — o
  agent/ fala HTTP com um endpoint NOVO no app principal (`POST /internal/solaris/rag/buscar`,
  `src/routes/apiRoutes.js`), que reusa o pipeline de embeddings já existente
  (`ragEmbeddingsClient` + `ragVectorStore`, ver `src/solaris/README.md`). O agent/ continua sem
  nenhuma credencial de Firestore/Gemini — quem tem a credencial de Firestore é o app principal,
  que já tinha. A rota nova segue EXATAMENTE o mesmo padrão fail-closed já usado em
  `/internal/solaris/limpar-projetos-expirados` (`crypto.timingSafeEqual`, secret dedicado,
  recusa em produção sem secret configurado) — nada inventado, só replicado. Igual a `web.search`,
  nenhum papel libera por padrão (é transversal a vários papéis, não o motivo de existir de um só)
  — disponível via `permissions.grant("knowledge.search")`.

**Validado de ponta a ponta com os serviços reais outra vez**: subiu o app principal de verdade
localmente (`express()` + `apiRoutes` real, com Firestore de verdade conectado neste ambiente) e
confirmou a rota nova rejeitando sem secret/com secret errado (403), rejeitando sem `query` (400),
e passando pela autenticação até `buscarNoCatalogo` (que falha limpo por
`EMBEDDINGS_SERVICE_URL` não configurada — mesmo gap já documentado em `src/solaris/README.md`,
não um bug novo). Depois, chamou a cadeia completa a partir do lado do agent/ —
`new Agent(...).execute({type:"knowledge.search",...})` contra esse mesmo app principal rodando —
confirmando que o erro de infraestrutura se propaga corretamente até o formato padrão
`{ok:false, error:{...}}` do `TaskRunner`. `file.read` paginado também confirmado via
`Agent.execute()` real, paginando um arquivo de 10 linhas em duas chamadas de 4 linhas cada.

13 testes novos (`ragSearchService.test.js` no app principal +
`knowledge-search.test.js`/paginação em `filesystem.test.js` no agent/) — `npm test`: 92/92
arquivos no app principal, 41/41 testes no `agent/`.

## `github.js` deixa de ser stub (item #1 da reflexão sobre o que eu mais uso)

Pedido direto depois de eu refletir sobre quais ferramentas eu mais uso no meu próprio ambiente
que ainda não existiam aqui — integração real com GitHub foi a resposta mais óbvia (usada
extensivamente ao longo de toda esta sessão pra criar/acompanhar PRs e CI). `@octokit/rest` já
era dependência declarada desde o início do `agent/`, nunca importada em lugar nenhum — a
implementação real (`issue_create/get`, `pull_request_create/get`, `repository_get`) troca o
`throw new Error(...)` único que existia antes por chamadas reais à API, com Octokit injetável
no construtor (mesmo padrão de `fetchImpl` em `web-sandbox.js`/`knowledge-search.js`) pra nunca
precisar de `GITHUB_TOKEN` real nos testes.

Achado ao implementar: as permissões por papel em `role-permissions.js` já vinham
pré-configuradas corretamente desde quando `github.js` ainda era stub (só o Investigador com
leitura liberada, escrita negada em todo papel) — zero mudança necessária em
`task-router.js`/`permissions.js`/`role-permissions.js`, só a capability em si e o schema do
protocolo (`protocol.js` ganhou `pull_number`/`head`/`base`; `protocol-adapter.js` ganhou o rename
`issue_number`/`pull_number` → `issueNumber`/`pullNumber`).

Validado via `Agent.execute()` real (não só a capability isolada) com `createExplorerPermissions()`
e um Octokit fake injetado via `extraCapabilities`: `github.repository_get` funciona ponta a ponta,
e `github.issue_create` é corretamente negado pra esse papel (`PERMISSION_DENIED`) mesmo com a
capability real por trás. Não testado contra a API do GitHub de verdade neste ambiente (não há
`GITHUB_TOKEN` de agent disponível aqui) — mesmo critério já usado em `web-search.js`
(testes 100% com mock, nunca gastam quota/custo real).

12 testes novos (`github.test.js`) — `npm test` do `agent/`: 53/53 passando.

## Servidor HTTP real (`server.js`) — o Worker não tinha NENHUM jeito de receber task de fora

Pedido direto: implementar "monitoramento assíncrono/agendado" (equivalente ao `ScheduleWakeup`
deste próprio Claude Code). Investigando ONDE esse monitoramento se encaixaria, achado bem mais
sério do que o pedido original: **`index.js` nunca subia servidor HTTP nenhum**. `main()`
instanciava o `Agent`, chamava `agent.start()`, e ficava só em `agent.wait()` — um polling de
`this.running` a cada 1s, sem NENHUM jeito de uma task chegar de fora até `agent.execute()`.
Confirmado via grep por `app.listen()`/`express()`/`createServer()` em todo `agent/src/` antes
desta mudança: zero ocorrências. `protocol.js`/`protocol-adapter.js` já existiam, prontos e
testados (README já documentava "Pipeline HTTP completo" como validado) — mas nada no processo
real os chamava. O Worker subia, logava "pronto", e nunca processava uma task sequer em produção.

Isso é pré-requisito de qualquer monitoramento assíncrono: não dá pra "avisar quando terminar"
uma task que não existe nenhum jeito de sequer começar. Por isso esta rodada implementou o
servidor primeiro (opção escolhida explicitamente quando perguntado) — agendamento/notificação de
verdade fica pra uma próxima rodada, agora que existe uma base real pra construir em cima.

- **`server.js`** (novo) — `createApp(agent)` monta o Express: `GET /health`, `GET /capabilities`
  (introspecção via `getSupportedOperations()`, já existia em `protocol.js` sem nenhum consumidor),
  `POST /run` ligando `parseTaskRequest()` → `requestToTasks()` → `agent.execute()` por action,
  sequencial, com isolamento de falha por action (ver "API HTTP" acima). Não chama `listen()` —
  só monta o app, pra ser testável numa porta efêmera (mesmo padrão de
  `sandbox-efemoro/src/server.js`, que já tinha exatamente essa estrutura pronta pra copiar).
- **`index.js`** (reescrito) — troca o polling de `agent.wait()` por `app.listen()` de verdade, e
  ganha o shutdown gracioso em `SIGTERM`/`SIGINT` que o próprio arquivo já documentava como gap
  conhecido ("Observação... não é um bug, apenas sugestão") — sem isso, uma requisição `/run` em
  andamento (pode levar segundos, ex: `shell.execute` rodando testes) seria derrubada abruptamente
  quando o Cloud Run reciclar a instância.
- **Achado 2, durante a implementação**: `protocol.js` exigia `path` pra TODAS as operações de
  filesystem, mas `file.list`/`file.search` já tratam `path` ausente como `"."` na própria
  capability (`filesystem.js`) — bloqueando as duas operações sem motivo técnico. Só apareceu
  rodando o servidor de ponta a ponta contra `filesystem.list` de verdade; nenhum teste anterior
  exercitava essas duas operações através da camada de protocolo. Corrigido: `path` agora opcional
  no schema (mesmo critério de schema-por-capability-não-por-operação já documentado ali para
  `old_string`/`new_string`), a exigência de fato continua dentro de cada método da capability.
- **`express` adicionado como dependência real** — `agent/package.json` nunca tinha `express`
  (nem no lockfile); instalado agora (`^4.22.1`, mesma versão já usada no app principal e em
  `sandbox-efemoro/`).

**Validado com o processo real, não só a função exportada nos testes**: rodou
`node src/index.js` de verdade (`PORT`/`WORKER_SHARED_SECRET`/`WORKSPACE_ROOT` via env) e bateu
com `curl` de verdade -- `/health` e `/capabilities` respondendo, `/run` sem secret recusando com
401, e um `POST /run` real com duas actions (`filesystem.write` + `filesystem.read`) escrevendo o
arquivo em disco de verdade e devolvendo o conteúdo lido de volta -- primeira vez que este Worker
processa uma task de ponta a ponta desde que existe.

19 testes novos (`server.test.js`) -- `npm test` do `agent/`: 63/63 passando.

## Cliente MCP genérico (`mcp.*`) — o adaptador do item #9 da mesma auditoria

Pedido direto: "desenvolver aquele protocolo padronizado que você recomendou, o MCP". Contexto da
recomendação original (auditoria comparando `agent/` com o ambiente deste próprio Claude Code):
`github`/`storage`/`artifacts` são stubs porque cada integração externa nova exige código em
5 arquivos (`agent.js`, `task-router.js`, `permissions.js`, `role-permissions.js`,
`protocol.js`/`protocol-adapter.js`) — um protocolo genérico (tipo MCP, o Model Context Protocol da
própria Anthropic) resolveria isso de raiz: em vez de escrever uma capability nova por integração,
o agent/ vira **cliente** de servidores MCP já prontos, e ganha as ferramentas deles automaticamente.

Escopo desta rodada, definido explicitamente antes de implementar (arquitetura nova, decisão cara de
reverter — não chutada):

- **Só cliente MCP** (não servidor) — é isso que resolve o gap real identificado; o inverso (agent/
  expor suas 15 capabilities via MCP para Claude Desktop/Claude Code chamarem) é um problema
  diferente, não pedido.
- **Transport Streamable HTTP contra servidores remotos, nunca stdio/processo local** — consistente
  com o resto do agent/, que nunca guarda credenciais diretamente nem spawna processo de terceiro,
  só fala HTTP com serviços já rodando em outro lugar (mesmo padrão de `sandbox-efemoro`,
  `Embedings-python`, `knowledge-search.js`).
- **Infra genérica, com presets opt-in para GitHub e Supabase** — ambos usam os endpoints remotos
  oficiais e PATs guardados apenas no ambiente. Continua validada de ponta a ponta contra um servidor
  MCP de referência real (ver abaixo), sem exigir credenciais de produção na suíte.

### `config/mcpServers.js` — servidor genérico, GitHub e Supabase

Único ponto de configuração — é isso que permite plugar um servidor MCP novo **sem mudar nenhum
código**, só editando a env var:

```json
{
  "docs": {
    "url": "https://meu-servidor-mcp.exemplo.com/mcp",
    "headers": { "Authorization": "Bearer xyz" }
  }
}
```

Mesmo formato usado por `claude_desktop_config.json` do Claude Desktop, de propósito — reduz a
distância entre configurar um servidor MCP aqui e em qualquer outro cliente MCP. Validado com Zod
(`.strict()`, URL obrigatória, `headers` e `allowedTools` opcionais); JSON malformado ou schema
inválido lança erro claro na inicialização, não falha silenciosa. `allowedTools`, se informado,
é uma allowlist de nomes exatos: a ferramenta não aparece em `mcp.list_tools` nem pode ser chamada
fora da lista.

Para o worker headless, configure os dois provedores reais com PATs no gerenciador de segredos do
ambiente — **nunca** no JSON versionado e nunca em `GITHUB_TOKEN` (esse token continua reservado à
capability REST já existente):

```bash
# GitHub MCP remoto oficial. Crie um fine-grained PAT só com os repositórios e
# permissões necessários; a allowlist é opcional, mas recomendada.
GITHUB_MCP_TOKEN=...
GITHUB_MCP_ALLOWED_TOOLS=get_issue,get_pull_request,search_repositories

# Supabase MCP remoto oficial. O project_ref é obrigatório para não expor a
# conta toda; leitura é o padrão e os grupos expostos começam em database,docs.
SUPABASE_MCP_ACCESS_TOKEN=...
SUPABASE_MCP_PROJECT_REF=abc123
SUPABASE_MCP_READ_ONLY=true
SUPABASE_MCP_FEATURES=database,docs
SUPABASE_MCP_ALLOWED_TOOLS=list_tables,execute_sql
```

Com essas variáveis, os servidores aparecem como `github` e `supabase` em
`mcp.list_servers`. Os endpoints padrão são `https://api.githubcopilot.com/mcp/`
e `https://mcp.supabase.com/mcp`; `GITHUB_MCP_URL` e `SUPABASE_MCP_URL` só
aceitam overrides HTTPS. Não combine um preset com um servidor do mesmo nome
em `MCP_SERVERS_JSON`: a inicialização falha para evitar que uma credencial
seja enviada ao destino errado.

O cliente não inicia OAuth em navegador. Para ambientes interativos, siga o
OAuth do provedor; para este processo sem UI, PAT com menor privilégio é o
modo suportado. O MCP hospedado do Supabase é indicado para desenvolvimento e
testes; não conecte dados de produção sem uma revisão explícita de escopo,
RLS e permissões.

### `capabilities/mcp-client.js` — `McpClientCapability`

- **`mcp.list_servers`** — lista nome+URL dos servidores configurados. NUNCA inclui `headers` (pode
  carregar segredo de autenticação) e não faz nenhuma chamada de rede (só lê configuração local).
- **`mcp.list_tools`** (`server`) — conecta no servidor nomeado, lista as ferramentas que ele expõe
  (nome, descrição, `inputSchema`), filtradas por `allowedTools` quando configurada.
- **`mcp.call_tool`** (`server`, `tool`, `arguments?`) — chama a ferramenta e devolve o resultado
  (`content`, `isError`, `structuredContent`) sem reinterpretar — `isError:true` é um resultado
  normal de protocolo MCP (ex: ferramenta não existe, argumento de tipo errado — o próprio servidor
  MCP validou e devolveu um erro estruturado), não uma exceção.

Uma conexão nova é aberta e fechada a cada chamada (`_withClient`) — sem pool de sessão persistente
entre chamadas. Simplicidade deliberada: o volume esperado de chamadas MCP por task não justifica a
complexidade extra de gerenciar sessões vivas, e cada request de Cloud Run já é, por natureza, de
vida curta. `ClientClass`/`TransportClass` (do `@modelcontextprotocol/sdk`, SDK oficial da
Anthropic) são injetáveis no construtor — mesmo padrão de `octokit` em `github.js` — para que os
testes de unidade nunca precisem de rede real.

### Permissão: negada em TODO papel por padrão (mesmo critério de `knowledge.search`)

A ferramenta exposta por um servidor MCP de terceiro pode fazer literalmente qualquer coisa —
superfície de risco desconhecida por natureza, diferente de `websandbox.run`/`knowledge.search`
(que falam com um serviço isolado da própria Softload, com contrato conhecido). `mcp.list_servers`/
`mcp.list_tools`/`mcp.call_tool` seguem exatamente o mesmo tratamento de `knowledge.search`:
transversal, deliberadamente **não** liberado em nenhum preset de `role-permissions.js`, disponível
só via `permissions.grant("mcp.call_tool")` pontual quando um fluxo específico precisar.

### Validado de ponta a ponta com um servidor MCP REAL, não mockado

`ClientClass`/`TransportClass` injetados cobrem só o roteamento interno (`mcp-client.test.js`, 15
testes com fakes) — isso sozinho não prova que a capability realmente fala o protocolo. Para provar
isso de verdade, `capabilities/__testUtils__/mcpEchoServer.js` sobe um servidor MCP real (SDK
oficial do lado do servidor: `McpServer` + `StreamableHTTPServerTransport`, modo stateless — mesmo
padrão do exemplo oficial `simpleStatelessStreamableHttp.js` do próprio SDK), com duas ferramentas
triviais (`echo`, `add`), usado **somente** em teste — nunca implantado.

`mcp-client.e2e.test.js` (7 testes) constrói `McpClientCapability` com os valores **padrão** (nenhum
fake) e conversa via HTTP de verdade com esse servidor:

- `list_servers`/`list_tools` reais devolvem as ferramentas de verdade (nome, descrição, schema).
- `call_tool("echo", ...)` e `call_tool("add", ...)` rodam via JSON-RPC/HTTP real e devolvem o
  resultado real.
- **Achado real, só descoberto rodando contra o servidor de verdade** (não seria óbvio por leitura
  do SDK): chamar uma ferramenta com argumento de tipo errado, ou uma ferramenta inexistente, não
  faz o SDK client REJEITAR a promise — o SDK resolve normalmente com `isError:true` e uma mensagem
  de erro JSON-RPC dentro de `content` (é um erro de nível de PROTOCOLO MCP, não de infraestrutura
  de transporte). A asserção inicial do teste (`assert.rejects`) estava errada; corrigida depois de
  observar o comportamento real.
- Duas chamadas concorrentes contra o mesmo servidor não interferem entre si — prova que
  conexão-nova-por-chamada realmente isola cada uma.

35 testes MCP (11 `mcpServers.test.js` + 16 `mcp-client.test.js` + 7 `mcp-client.e2e.test.js`,
mais 1 `server.test.js` provando a fiação HTTP completa) cobrem configuração, autorização e
transporte sem depender de token real.

Os testes dos presets reais são determinísticos e não usam tokens: verificam a montagem da URL,
o header que segue apenas em memória, o `project_ref` obrigatório no Supabase e a recusa de nomes
duplicados. A autenticação e a chamada ao GitHub/Supabase reais acontecem somente depois de o operador
fornecer os segredos acima.

## `web.fetch` — ler uma URL específica diretamente (item da mesma auditoria)

Sequência combinada com o usuário: implementar os 5 itens restantes da comparação com o ambiente
deste Claude Code **um de cada vez** (mesma cadência de sempre — PR pequena, testada de ponta a
ponta, revisada e implantada antes da próxima), começando pelo de menor risco. `web.fetch` foi
escolhido primeiro justamente por não ter nenhuma decisão de arquitetura pendente — os outros 4
(fan-out paralelo + isolamento de git worktree, rastreamento de plano/progresso, execução em
background com notificação, canal de escalonamento humano) têm decisões reais pela frente e ficam
pra rodadas seguintes.

`web.search` (já existente) nunca acessa uma URL arbitrária — só consulta a Gemini API com Google
Search Grounding, e filtra resultados pela allowlist de domínios do Solaris. `web.fetch` é
literalmente diferente: busca (`GET`) a URL que o chamador passar, ponto — "lê essa URL específica e
me diz o que tem", mesmo papel do `WebFetch` deste próprio Claude Code.

### Proteção contra SSRF, em 3 camadas (`capabilities/web-fetch.js`)

Buscar uma URL arbitrária a partir de um worker server-side é a definição livresca de risco de SSRF
(Server-Side Request Forgery) — sem proteção, seria possível usar este agent/ pra sondar a rede
interna do Cloud Run ou alcançar o endpoint de metadata de nuvem (`169.254.169.254`, que expõe
credenciais da própria instância). Três camadas, todas aplicadas **a cada redirecionamento seguido**
(não só na URL original):

1. Só protocolo `http`/`https`.
2. Lista fixa de hosts sempre bloqueados (endpoints de metadata GCE/AWS/Azure/Alibaba) — mesma lista
   de `sandbox-efemoro/src/webSandbox/security.js`, deliberadamente **duplicada** (não importada:
   são dois serviços deployáveis separados, com `Dockerfile`/`package.json` próprios — um pacote
   publicado só pra compartilhar 4 strings não valeria a complexidade).
3. Resolução DNS do host, com o(s) endereço(s) resultante(s) verificados contra faixas
   privadas/reservadas (RFC 1918, loopback, link-local, CGNAT, multicast — IPv4 e IPv6).

O ponto 3 é aplicado a **cada hop de redirecionamento seguido manualmente** (`redirect: "manual"`,
nunca o `redirect: "follow"` nativo do fetch) — um servidor malicioso poderia devolver `302` de uma
URL pública válida pra um endereço interno, e só revalidar a URL original não pegaria isso. Provado
com teste real (`web.fetch: redirecionamento pra host que resolve pra IP privado é bloqueado (SSRF
via redirect)`), não só documentado.

Limitação conhecida, documentada (mesma já registrada em `sandbox-efemoro/src/webSandbox/network.js`
para o problema análogo): isso é proteção *best-effort*, não elimina TOCTOU entre a checagem de DNS e
a conexão real do `fetch` — proteção completa exigiria política de rede em nível de container, fora
do escopo desta capability.

Outros limites de segurança/recurso: corpo lido via streaming manual (não `response.text()`, que
carregaria tudo na memória ANTES de qualquer chance de cortar) com teto de 1MB por padrão (5MB
máximo, `maxBytes`); no máximo 5 redirecionamentos; timeout de 15s por padrão (60s máximo,
`timeoutMs`); só conteúdo textual aceito (`text/*`, `application/json`, `application/xml` e
variantes) — binário (imagem, vídeo, etc.) é rejeitado com erro claro, já que não há "o que ler".

### HTML vira texto legível de verdade, não regex

`text/html` é convertido via `html-to-text` (nova dependência — `htmlparser2` por baixo, o mesmo
parser real usado pelo `cheerio`, não um "strip de tag" por regex, que quebra em casos comuns:
comentários, CDATA, tags aninhadas, entidades). `<script>`/`<style>`/`<head>` já são removidos por
padrão pela própria biblioteca — confirmado rodando de verdade antes de escrever qualquer código
contra ela, não assumido pela documentação.

### Permissão: negada em todo papel por padrão (mesmo critério de `web.search`)

Mesmo com as 3 camadas de proteção contra SSRF, `web.fetch` continua sendo a única capability deste
agent/ que aceita qualquer URL `http(s)` publicamente alcançável vinda do chamador — custo real de
rede e superfície de risco maior que `web.search` (que nunca toca uma URL arbitrária). Negada em todo
preset de `role-permissions.js`, disponível só via `permissions.grant("web.fetch")` pontual.

### Validado de ponta a ponta com um servidor HTTP real, não mockado

`web-fetch.e2e.test.js` usa o `fetch` GLOBAL de verdade (nenhum `fetchImpl` injetado, diferente de
`web-fetch.test.js`, que fabrica respostas) contra um `http.createServer()` real rodando localmente:
busca uma página HTML real (confirma que `<script>`/`<style>` somem do resultado de verdade), segue
um `302` real até o destino, trunca um corpo de 50KB de verdade no `maxBytes` configurado, devolve um
`404` real sem lançar exceção, e rejeita conteúdo binário real. Um teste final prova que, SEM nenhum
`resolveHostname` injetado (comportamento idêntico ao de produção, DNS real via `dns.lookup`), o
próprio servidor de teste (`127.0.0.1`) é bloqueado pela proteção contra SSRF — evidência de que o
`resolveHostname` fabricado usado nos outros testes desta suíte não desliga a proteção real, só
contorna o bloqueio de loopback especificamente para viabilizar testar contra um servidor de
verdade.

31 testes novos (25 `web-fetch.test.js` com `fetchImpl`/`resolveHostname` injetados + 6
`web-fetch.e2e.test.js` com `fetch` real) — `npm test` do `agent/`: todos passando.

## `agent.dispatch_parallel` — fan-out isolado por git worktree

Segundo dos 5 itens restantes da mesma auditoria (depois de `web.fetch`, escolhido primeiro por não
ter decisão de arquitetura pendente). Este item TINHA decisões reais pela frente, confirmadas com o
usuário antes de codar:

1. **Cliente ou servidor MCP, transport, servidor piloto** (rodada anterior) — resolvido lá.
2. **Direção deste item**: escolhido entre "fan-out + worktree" e "rastreamento de plano/progresso"
   como o próximo a implementar (o par background+notificação/escalonamento humano continua por
   último, por serem os mais complexos e relacionados entre si).

### O problema

`AgentDispatchCapability` (`agent.dispatch`) despacha **um** sub-agente por vez — sequencial, sem
fan-out. Se dois sub-agentes rodassem "ao mesmo tempo" hoje (ex: chamando `orchestratorAgent.execute()`
duas vezes em paralelo por fora), os dois competiriam pelo **mesmo** `Workspace` (mesmo diretório em
disco), já que todos os sub-agentes de `orchestrator-example.js` compartilham uma única instância —
duas escritas concorrentes no mesmo arquivo, ou dois `git add`/`git commit` ao mesmo tempo, correm
risco real de se pisar.

### A capability nova, não uma extensão da antiga

`AgentParallelDispatchCapability` (`agent.dispatch_parallel`, `capabilities/agent-parallel-dispatch.js`)
é uma capability **separada** de `AgentDispatchCapability` — decisão deliberada: `agent.dispatch`
continua exatamente como era, sem nenhuma mudança de comportamento pra quem já usa; a nova é a
ferramenta pra quem precisa de fan-out de verdade. Mesmo critério de `agent.dispatch`: não faz parte
do protocolo HTTP externo, uso interno via `Agent.execute()` direto (roteada em `task-router.js`,
adicionada via `extraCapabilities` em quem monta o Orquestrador — não em `agent.js`).

Aceita uma lista de dispatches (`{ targetRole, payload, isolateWorkspace? }`) e roda até `concurrency`
(padrão 4, teto rígido 10, via `p-limit` — dependência que já existia no `package.json` desde o
início, nunca usada até agora) ao mesmo tempo. Cada dispatch é isolado (uma falha em um NÃO aborta os
outros — mesmo critério de isolamento por-action já usado em `POST /run`), e os resultados voltam na
MESMA ordem da lista de entrada, independente de qual terminou primeiro.

### Isolamento por padrão — `isolateWorkspace` é opt-OUT, não opt-in

Como esta capability não conhece (nem deveria conhecer — mesmo princípio de desacoplamento já
documentado no header de `AgentDispatchCapability`) o que cada handler faz de verdade por dentro, o
padrão seguro é isolar SEMPRE que não for explicitamente dispensado (`isolateWorkspace: false`, útil
pra roles só-leitura como "architect", que nunca toca workspace).

Isolamento = `git worktree add --detach <path> HEAD` (`orchestration/git-worktree-pool.js`) — um
diretório de trabalho novo, separado, mas compartilhando o histórico do MESMO repositório. Cada
handler recebe esse workspace isolado via um SEGUNDO argumento novo, `context: { workspace,
workspaceRoot, isolated }` — handlers que não usam workspace (ex: "architect") ignoram o argumento
extra sem quebrar; handlers que precisam de fato tocar arquivos precisam ser reescritos pra usar
`context.workspace` em vez de um `Agent`/`Workspace` fixo capturado por closure (ver
`coder_isolated` em `orchestrator-example.js`, o exemplo real adicionado nesta rodada — monta um
`Agent` novo, na hora, escopado ao workspace isolado recebido).

O worktree é **sempre removido** ao final de cada dispatch (sucesso ou falha, via `finally` +
`git worktree remove --force`), depois do resultado já ter sido capturado — nada de valor se perde,
e não sobra worktree órfão ocupando disco (relevante em Cloud Run, onde o allowance de disco é fixo
por sessão). Deliberadamente NÃO tenta mesclar/publicar as mudanças de um worktree de volta sozinho —
mesclagem automática de git é decisão de negócio (pode ter conflito, exige escolha de estratégia),
fora do escopo desta capability; quem quiser persistir precisa fazer isso explicitamente dentro do
próprio handler (ex: commit + push, como o exemplo `packager` já faz) antes do worktree sumir.

### Permissão: mesmo critério de `agent.dispatch`

Negada por padrão (`DEFAULT_PERMISSIONS`), só o preset do Orquestrador libera — mesma linha de
`agent.dispatch` (não listada nos outros 5 presets porque `Permissions` já mescla qualquer chave
ausente com o default negado, então não precisa repetir `false` em cada um).

### Validado de ponta a ponta com um repositório git REAL, não mockado

`agent-parallel-dispatch.e2e.test.js` usa um repositório git de verdade, criado num diretório
temporário (`git init` + commit inicial), e as funções REAIS de `git-worktree-pool.js` (nenhum
`createWorktreeFn`/`removeWorktreeFn` injetado, diferente de `agent-parallel-dispatch.test.js`, que
usa fakes). Prova o que fakes sozinhos não conseguem provar:

- **Isolamento real**: dois dispatches concorrentes escrevendo no MESMO caminho relativo
  (`saida.txt`), cada um com um `setTimeout` no meio pra dar chance de colisão se estivessem
  compartilhando o mesmo diretório — cada um lê de volta exatamente o que ELE escreveu, não o valor
  do último a escrever (que é o que aconteceria se não estivessem isolados de verdade).
- **Limpeza real**: depois da chamada retornar, os diretórios dos worktrees não existem mais no disco
  (`fs.access` rejeita), e `git worktree list --porcelain` não deixa nenhum worktree órfão — só o
  principal.
- **`isolateWorkspace: false` real**: um dispatch sem isolamento lê o `README.md` do repositório
  principal de verdade, confirmando que o workspace compartilhado (não um worktree) foi usado.

17 testes novos (14 `agent-parallel-dispatch.test.js` com fakes injetados + 3
`agent-parallel-dispatch.e2e.test.js` com git real) — `npm test` do `agent/`: todos passando.

## `plan.*` — registro de progresso, equivalente ao meu TaskCreate/TaskList

Terceiro dos 5 itens restantes da mesma auditoria (depois de `web.fetch` e
`agent.dispatch_parallel`). Restam 2: este e o par background+notificação/escalonamento humano, que
continua por último por serem os mais complexos e relacionados entre si.

### O problema

Pra tarefas longas de vários passos, não existia nenhuma capability que registrasse "isso já foi
feito, isso está pendente" — cada task era isolada, o estado do plano vivia só na cabeça de quem
orquestrava (fora do código, sem nenhum registro estruturado).

### Onde persistir — decisão confirmada com o usuário antes de implementar

A pergunta real: o `agent/` roda em Cloud Run, sem garantia de ser a MESMA instância entre chamadas
e com disco efêmero por instância — onde esse estado deveria morar? Três opções levantadas: em
memória (escopado à vida do processo), arquivo no workspace (sobrevive a reinício do mesmo diretório,
mas fragmenta entre worktrees isolados de `agent.dispatch_parallel`), ou Firestore via app principal
(sobrevive a tudo, mas adiciona uma chamada de rede a cada atualização de progresso). Perguntado
diretamente qual das três batia com o comportamento do meu próprio `TaskCreate`/`TaskList` — a
resposta honesta foi: sem acesso aos detalhes internos exatos, mas o comportamento OBSERVÁVEL (estado
escopado à sessão atual, não sobrevive entre conversas diferentes) bate mais com "em memória". Opção
confirmada pelo usuário com essa ressalva.

### `capabilities/plan-tracker.js` — `PlanTrackerCapability`

Terminologia deliberadamente "plan"/"item", não "task" — "task" já tem um significado muito
específico e onipresente neste codebase (`task.type`, `TaskRouter`, `TaskRunner`,
`Agent.execute(task)`); reusar a palavra criaria duas coisas diferentes com o mesmo nome no mesmo
sistema.

- `plan.create` (`title`, `description?`, `items?: [{description}]`) — cria um plano, cada item
  começa `pending`.
- `plan.add_item` (`planId`, `description`) — adiciona um item novo, descoberto no meio do trabalho
  (mesmo espírito do meu próprio `TaskCreate`: "After completing a task... add any new follow-up
  tasks discovered").
- `plan.update_item` (`planId`, `itemId`, `status?`, `description?`, `note?`) — atualiza um item.
  `status: "deleted"` REMOVE o item de verdade (não é um estado visível, é um comando) — mesmo
  contrato do meu próprio `TaskUpdate` ("Setting status to `deleted` permanently removes the task").
- `plan.list` — resumo de todos os planos (contagem de items por status), não o detalhe completo.
- `plan.get` (`planId`) — plano completo, com todos os items.

Mesmo critério de `agent.dispatch`/`agent.dispatch_parallel`: não faz parte do protocolo HTTP
externo, capability extra (`extraCapabilities.planTracker`) exclusiva do Orquestrador — sub-agentes
(Investigador, Programador, Validador, Empacotador) não têm motivo pra tocar o plano diretamente, é
o Orquestrador quem inspeciona o resultado de cada dispatch e decide como isso reflete no progresso.
Permissão negada por padrão em todo preset, só o Orquestrador libera (mesma linha de `agent.dispatch`).

### Demonstrado de ponta a ponta em `orchestrator-example.js`

O `example()` já existente ganhou um plano real, criado no início (`Investigar código existente`,
`Planejar mudança`, `Codificar + validar`, `Empacotar`) e atualizado (`in_progress`/`completed`/
`pending` com nota) antes/depois de cada etapa do pipeline — prova o padrão de uso pretendido: o
Orquestrador cria o plano, despacha, inspeciona o resultado de cada dispatch e reflete isso no
progresso, tudo dentro do mesmo processo.

22 testes novos (`plan-tracker.test.js`, cobrindo o ciclo de vida completo — criação, adição,
atualização incluindo `deleted`, listagem resumida, detalhe completo, isolamento entre planos) —
`npm test` do `agent/`: 164/164 passando. Sem teste de ponta a ponta separado (diferente das rodadas
anteriores) — não há infraestrutura externa nenhuma pra provar contra (é só um `Map` em memória), o
teste de unidade já exercita o comportamento real por completo.

## Background + notificação — webhook assinado em `process.start` (4º dos 5 itens)

Quarto dos 5 itens da mesma auditoria. Falta 1: o canal de escalonamento humano — combinado
explicitamente com o usuário pra ficar por último, já que reusa a MESMA entrega de webhook construída
aqui, mas precisa também de uma rota HTTP nova (pra receber a decisão de volta).

### O problema

`process.js` já rodava comandos em background (`process.start`), mas só de forma *polling*:
`process.status`/`process.output` sob consulta — sem nenhum jeito de o chamador ser AVISADO quando o
processo termina, precisando ficar consultando em loop.

### Não existia nenhum webhook de saída reutilizável — confirmado antes de construir um novo

Antes de implementar, uma auditoria (não achismo) procurou por qualquer mecanismo de entrega de
webhook de SAÍDA, Pub/Sub, Cloud Tasks, ou notificação já existente no monorepo pra reusar. Achado:

- **Nenhum webhook de saída existe no código da aplicação.** O único `POST` pra uma URL configurável
  é o `curl` direto do workflow `.github/workflows/deploy.yml` (CI, não código do app) — sem
  assinatura no lado de saída (a URL em si é o segredo, via secret do GitHub).
- **Nenhum Pub/Sub/Cloud Tasks** em nenhum `package.json` do monorepo.
- O mais próximo de uma convenção existente é **webhook de ENTRADA** (`POST /webhook/mercado-pago`
  em `src/routes/apiRoutes.js`, HMAC via `verificarAssinaturaMP`) e o **shared-secret** de endpoints
  internos (`verificarSegredoRagBusca` etc.) — nenhum dos dois cobre o lado de SAÍDA, mas a
  convenção de segurança (segredo dedicado, comparação em tempo constante) foi a que se seguiu aqui.
- **Notificação de humano** já existe (`src/services/emailService.js`, nodemailer + Resend), mas mora
  no app principal — fora do alcance do `agent/`, que nunca guarda credenciais de e-mail.

Conclusão: teria que ser construído do zero. Confirmado com o usuário antes de codar (arquitetura
nova, decisão cara de reverter):

- **`callbackUrl` fornecida pelo CHAMADOR em cada requisição** (não uma URL fixa pré-configurada em
  env var) — é o único jeito real de "avisar de volta" num worker Cloud Run sem conexão persistente.
- **Assinado com HMAC-SHA256**, segredo também fornecido pelo chamador por requisição — pra quem
  recebe poder verificar que o `POST` veio de verdade deste `agent/`.

### `security/ssrf-guard.js` — extraído de `web-fetch.js` quando apareceu o 2º consumidor real

Entregar um webhook pra uma URL fornecida pelo chamador é exatamente o mesmo risco de SSRF que
`web.fetch` já mitigava (ver seção acima) — reaproveitado, não reimplementado: a lógica de 3 camadas
(protocolo, hosts de metadata sempre bloqueados, resolução DNS contra faixas privadas/reservadas) foi
extraída de dentro de `web-fetch.js` pra `security/ssrf-guard.js`, com `web-fetch.js` reescrito pra
importar e usar a mesma função — **zero mudança de comportamento** (confirmado rodando a suíte
completa de `web-fetch.test.js`/`web-fetch.e2e.test.js`, sem alteração nenhuma nelas, antes e depois
da extração). 28 testes novos dedicados só à função extraída (`ssrf-guard.test.js`), cobrindo cada
faixa de IPv4/IPv6 privado/reservado individualmente — cobertura que não existia isolada antes
(só indireta, via mensagens de erro de `web.fetch`).

### `notifications/webhook-delivery.js` — `deliverWebhook`/`verifyWebhookSignature`

- **Entrega ÚNICA, sem retry automático** — decisão deliberada, mesmo critério já em uso nas
  instruções de monitoramento de PR desta própria sessão ("webhooks don't reliably deliver... don't
  rely on events alone"): quem recebe o callback nunca deveria depender só dele — o polling
  continua sendo o caminho confiável, o webhook só evita ficar consultando à toa.
- **Nunca segue redirecionamento** (`redirect: "manual"`, qualquer 3xx conta como falha de entrega)
  — um redirecionamento pra um host arbitrário vazaria o payload assinado (dados do processo) pra um
  destino não pretendido.
- **Nunca lança por falha de ENTREGA** (rede, timeout, status não-2xx, bloqueio de SSRF) — sempre
  devolve `{delivered, statusCode, error}` estruturado, pra uma falha de entrega nunca derrubar o
  fluxo de quem chamou. Só lança por erro de INPUT (`url`/`secret`/`payload` ausente).
- `verifyWebhookSignature` (lado receptor): comparação em tempo constante (`timingSafeEqual`), mesmo
  padrão de `verificarSegredoRagBusca`/`verificarAssinaturaMP` no app principal.

### `process.start` ganha `callbackUrl`/`callbackSecret` (opcionais, os dois JUNTOS ou nenhum)

Sem NENHUM `task.type` novo — só dois campos opcionais na operação `process.start` já existente
(`protocol.js`: `callback_url`/`callback_secret`; `protocol-adapter.js`: rename pra
`callbackUrl`/`callbackSecret`) — por isso, diferente das rodadas anteriores, não precisou tocar
`task-router.js`/`permissions.js`/`role-permissions.js`: a permissão de `process.start` já existente
cobre isso.

Quando configurado, o webhook dispara quando o processo termina (`exited`/`timeout`/`error`/
`killed`), com o payload `{processId, command, status, exitCode, stdout, stderr, durationMs}`.
`process.status`/`process.output` ganharam o campo `webhookDelivery` (`null` até o processo terminar,
depois `{delivered, statusCode, error}`) — pra quem preferir continuar consultando (ou confirmar se a
entrega funcionou) sem depender só do callback chegar.

### Validado de ponta a ponta com HTTP real, sem NENHUM atalho pra desligar a proteção

`process.test.js` (14 testes novos, arquivo que não existia antes desta rodada) roda comandos reais
(`node -e ...`) até o fim de verdade, com `deliverWebhookFn` injetado pra testar o payload/tratamento
de falha sem rede. `webhook-delivery.e2e.test.js` usa o `fetch` GLOBAL real contra um servidor HTTP
real que verifica a assinatura com `verifyWebhookSignature` do lado receptor — prova que entrega e
verificação funcionam juntas sobre HTTP de verdade.

`server.test.js` ganhou um teste de pipeline HTTP COMPLETO (`process.start` com `callback_url`/
`callback_secret` via `POST /run`, sem nenhum fake) que aponta o callback pra `127.0.0.1` — e confirma
que a proteção real contra SSRF bloqueia a entrega mesmo passando pelo pipeline inteiro. Achado
relevante ao escrever esse teste: `agent.js` não expõe NENHUM jeito de injetar `resolveHostname`
através da API HTTP — de propósito, seria uma porta pra desligar a proteção contra SSRF por fora.

63 testes novos no total (28 `ssrf-guard.test.js` + 17 `webhook-delivery.test.js` + 3
`webhook-delivery.e2e.test.js` + 14 `process.test.js`, arquivo que não existia antes desta rodada + 1
novo em `server.test.js`) — `npm test` do `agent/`: 227/227 passando, incluindo os 31 testes de
`web-fetch.test.js`/`web-fetch.e2e.test.js` de antes, sem NENHUMA alteração neles, confirmando que a
extração do `ssrf-guard.js` não mudou o comportamento existente.

## Escalonamento humano — `escalation.*` (5º e último item da auditoria)

Fecha os 5 itens da auditoria comparando o `agent/` com o ambiente deste Claude Code.
`Permissions.grant()` já existia como *hook* pra "usuário aprovou pontualmente", mas não havia
nenhum mecanismo VIVO de "pausa e pergunta" — nenhum jeito de um fluxo automatizado dizer "preciso
que um humano decida isso" e ter essa decisão chegar de volta de forma estruturada.

### Assíncrono por natureza, nunca bloqueante

Mesma restrição já enfrentada no item anterior: um worker Cloud Run não pode segurar uma requisição
HTTP aberta esperando um humano decidir por minutos/horas — estouraria o timeout da requisição bem
antes disso. O fluxo real:

1. `escalation.request` cria um registro `pending` e, se `callbackUrl`/`callbackSecret`
   configurados, dispara um webhook assinado (reusando `notifications/webhook-delivery.js`,
   construído na rodada anterior) avisando que uma decisão humana é necessária.
2. Quem recebeu o webhook (ou está fazendo polling via `escalation.get`/`escalation.list`) mostra a
   pergunta pra um humano.
3. A decisão volta via `POST /escalations/:escalationId/respond` (rota HTTP **nova**) ou via
   `escalation.respond` chamado internamente — as duas formas caem na MESMA lógica, sem duplicação.
4. Quem estava esperando a decisão consulta `escalation.get` numa chamada **separada e posterior** e
   só então prossegue. A "pausa" é responsabilidade de quem orquestra o fluxo mais amplo, não desta
   capability — ela só guarda o estado da pergunta/resposta.

### Achado real: por que `escalation.*` é uma capability PADRÃO, não Orquestrador-only

Diferente de `plan.*`/`agent.dispatch`/`agent.dispatch_parallel` (só via `extraCapabilities`, fora
do protocolo HTTP externo, exclusivos do Orquestrador) — `escalation.*` está registrada direto em
`agent.js`, disponível em QUALQUER `Agent`. Motivo, descoberto ao desenhar a rota HTTP nova:
`index.js` sobe o Worker de produção com `new Agent()` simples, **sem nenhum preset de role
aplicado** (`orchestration/orchestrator-example.js` é só demonstração, nunca importada por
`index.js`). Se `escalation.*` fosse Orquestrador-only como os outros três, a rota HTTP de resposta
nunca teria uma capability disponível pra chamar no Worker real que está de fato implantado —
humano-no-loop é fundamentalmente uma interação EXTERNA (alguém de fora decide), não uma
preocupação interna de orquestração de sub-agentes.

### `POST /escalations/:escalationId/respond` — a primeira rota HTTP fora de `/run`

Gated pelo MESMO segredo compartilhado de `/run` (`x-worker-secret`) — mesmo perímetro de confiança:
quem pode despachar tasks pra este Worker também pode responder um escalonamento dele. Reusa
`agent.execute({type:"escalation.respond",...})` — mesma lógica de validação/estado de
`escalation.js`, sem duplicar nada na rota.

**Achado real ao escrever os testes desta rota**: a primeira versão assumia que `agent.execute()`
*lança* pra qualquer falha, e fazia `try { ... } catch { mapeia status }`. Rodando os testes de
verdade, 4 de 8 falharam — a causa real é que `agent.execute()` (via `TaskRunner`) só lança pra
falha de ROTEAMENTO (`task.type` desconhecido); falhas de execução (validação, não encontrado, já
respondido, permissão negada) são capturadas DENTRO do `TaskRunner` e devolvidas normalmente como
`{ok:false, error:{message,code}}` — mesmo formato usado por `/run`. Corrigido pra checar
`outcome.ok` explicitamente antes de decidir o status HTTP, em vez de depender só de `try/catch`.

Mapa de `error.code` (escalation.js/permissions.js) -> status HTTP:

| `code`                          | status |
|----------------------------------|--------|
| `VALIDATION_ERROR`                | 400    |
| `PERMISSION_DENIED`               | 403    |
| `ESCALATION_NOT_FOUND`            | 404    |
| `ESCALATION_ALREADY_RESPONDED`    | 409    |
| (qualquer outro)                  | 500    |

### Estado: em memória (mesma decisão de `plan-tracker.js`)

Mesmo critério, mesma ressalva já confirmada com o usuário: escopado à vida do processo, não
sobrevive a reinício do container. `escalation.respond` é transição de mão única (`pending` ->
`resolved`) — responder um escalonamento já resolvido lança erro claro (`409` na rota HTTP) em vez
de sobrescrever silenciosamente uma decisão anterior. `_publicView()` nunca expõe `callbackSecret`
de volta em nenhuma resposta — mesmo critério de `mcp-client.js` nunca expor `headers` em
`list_servers`.

### Permissão: `request`/`respond` como ação (negados por padrão), `get`/`list` como consulta

Mesmo critério de `process.start`/`status`/`output`/`kill`: `escalation.request`/`escalation.respond`
têm efeito real (criam/resolvem uma pendência, disparam webhook) — negados por padrão em todo
preset. `escalation.get`/`escalation.list` são só consulta — liberados por padrão nos papéis que já
liberam leitura equivalente de `process.*` (Investigador/Programador/Validador/Empacotador),
negados em Arquiteto/Orquestrador (que negam tudo por padrão, mesma defesa em profundidade já
documentada pra esses dois papéis).

### Validado de ponta a ponta com webhook real, verificado por um servidor real

`escalation.e2e.test.js` usa a função REAL `deliverWebhook` (não um fake — só o `resolveHostname`
é fabricado, mesma técnica já usada em `webhook-delivery.e2e.test.js`) contra um servidor HTTP real
que verifica a assinatura HMAC de verdade do lado receptor, e confirma o fluxo completo
request→webhook real→respond→get. `server.test.js` ganhou 6 testes novos provando a rota HTTP nova
de ponta a ponta: fluxo completo via `/run` + rota dedicada, `404`/`400`/`409` reais, e `401` sem o
segredo compartilhado.

27 testes novos (19 `escalation.test.js` + 3 `escalation.e2e.test.js` + 5 novos em
`server.test.js`, incluindo os 4 que primeiro revelaram o achado real acima) — `npm test` do
`agent/`: 254/254 passando.

---

**As 5 lacunas da auditoria original estão fechadas**: `web.fetch` (PR de leitura de URL específica),
`agent.dispatch_parallel` (fan-out isolado por git worktree), `plan.*` (registro de progresso),
webhook assinado em `process.start` (background + notificação) e `escalation.*` (canal de
escalonamento humano, reusando a mesma entrega de webhook). Cada um chegou como sua própria PR,
testado de ponta a ponta com infraestrutura real sempre que fez sentido (servidor HTTP real,
repositório git real, servidor MCP real), com pelo menos uma decisão de arquitetura genuína
confirmada com o usuário antes de codar em cada rodada.

## Extração segura de ZIP (`archive.extract_zip`) — primeira etapa de uma evolução gradual do "Sandbox" pra contenção geral

Pedido explícito: mover a extração de arquivo compactado enviado por usuário do Node principal
(entrada não-confiável por definição) pra uma camada de contenção, começando por ZIP, com uma lista
concreta de defesas (zip bomb, path traversal, symlink, profundidade, timeout, disco, limpeza em
falha) — sem reescrever parser próprio, reusando bibliotecas maduras. Regra explícita do pedido:
**auditar antes de mexer em código, e não presumir que "Sandbox C++" já existe do jeito que o nome
sugere.**

### O achado da auditoria: não existe "Sandbox C++" hoje — existem DUAS coisas diferentes

1. `native/diff_patch_engine.cpp` — um motor de diff/patch (ainda "em desenvolvimento", ver
   `Power-up/Observações.md`), compilado num estágio Docker isolado só pra manter o toolchain g++
   fora da imagem final. O **binário resultante roda como subprocesso DENTRO do mesmo container**
   deste Worker Agent — mesmo usuário, mesmo filesystem, **zero isolamento próprio**. E nenhuma
   capability o invoca ainda (nenhuma chamada encontrada em todo `agent/src`).
2. `sandbox-efemoro/` — um **serviço Node.js genuinamente separado** (Dockerfile próprio, deploy
   próprio, usuário não-root, sem credenciais de git/shell/workspace), hoje usado só pra
   `websandbox.run` (Playwright isolado).

Ou seja: "C++" e "Sandbox" apontavam pra dois componentes diferentes, e nenhum dos dois fazia as
duas coisas ao mesmo tempo. Extrair dentro do binário C++ entregaria "C++" no nome, mas nenhuma
contenção real (mesmo container). Reescrever o parser em C++ pra rodar isolado também violaria o
próprio pedido de reusar bibliotecas maduras em vez de parser próprio. A opção que sobrou —
adicionada como nova capacidade em `sandbox-efemoro/` (que JÁ é isolado de verdade) — é a que
entrega contenção real usando peças que já existiam.

### Lógica de extração PORTADA, não reescrita

`sandbox-efemoro/src/archive/extractZip.js` implementa o mesmo algoritmo de duas fases já maduro e
testado em produção em `src/solaris/tools/fileTools.js` (app principal, `yauzl` — fase 1 valida o
zip inteiro via metadados do central directory sem escrever nada em disco; fase 2 extrai de
verdade, revalidando o byte count real de cada entrada contra o declarado). Três defesas que
`fileTools.js` não tinha foram adicionadas: limite de tamanho COMPACTADO (antes só existia na borda
do multer no app principal, nunca dentro da própria função de extração), limite de profundidade de
caminho, e rejeição EXPLÍCITA de entrada marcada como symlink (Unix mode em
`externalFileAttributes`) — `fileTools.js` já era imune a isso por efeito colateral do design (grava
bytes crus, nunca chama `fs.symlink`), agora é uma decisão deliberada, com teste que constrói um
symlink de verdade via `archive.symlink()` do `archiver` pra provar a rejeição. Timeout de
wall-clock e checagem de espaço em disco (`fs.statfs`) completam a lista pedida. Limpeza do
diretório temporário é garantida DENTRO da própria função `runArchiveExtract` (criado e destruído
na mesma chamada) — diferente de `fileTools.js`, que delegava isso ao chamador.

### Por que o `.zip` nunca viaja pelo protocolo externo do agent (`POST /run`)

`POST /run` é JSON com corpo limitado a 1MB (ver seção "API HTTP" acima) — um zip de poucos MB já
estouraria isso, e base64 ainda infla ~33% em cima. Em vez disso, `archive.extract_zip` espera que
o `.zip` já esteja no **Workspace** do agent (`zipPath`, escrito antes por `file.write` ou por outra
capability) — `capabilities/archive.js` lê os bytes crus de lá (`workspace.read(path, null)` força
Buffer, não string utf8) e manda pro serviço isolado via `POST /extract-zip` com o corpo cru
(`Content-Type: application/octet-stream`, não JSON — mesmo raciocínio de evitar inflar o corpo à
toa). Ao voltar, só os arquivos de TEXTO (heurística de byte nulo, aplicada do lado do serviço) são
gravados de volta no workspace, em `destPath`; binário fica listado em `ignorados` — fora de escopo
desta primeira etapa (projetos de texto, mesmo escopo do fluxo de upload do app principal).

### Contrato de falha: mais simples que `websandbox.run`, de propósito

`websandbox.run` devolve `{success:false, errors:[...]}` sem lançar quando a auditoria em si falhou
(há valor diagnóstico em inspecionar o que deu errado). `archive.extract_zip` **lança** também nesse
caso (`result.success === false` dentro de um 200) — decisão deliberada, não uma cópia automática do
padrão anterior: uma extração recusada não deixa nada de útil pra inspecionar (nada é gravado no
workspace quando falha), então um único formato de falha (exceção) é mais simples pro chamador tratar
do que exigir um `if (!result.success)` extra sem nenhum resultado parcial pra usar.

### Permissão: liberada somente para o Programador

O preset `createCoderPermissions` libera `archive.extract_zip`: receber um projeto compactado,
ler o ZIP e materializar seus arquivos no workspace é uma operação de edição, e o Programador já
possui `file.read`/`file.write`. O preset default continua negando a capability (fail closed).
Investigador e Validador permanecem somente leitura, então conceder a extração a eles quebraria o
contrato desses papéis; Arquiteto, Empacotador e Orquestrador também continuam negados. Quando um
desses fluxos realmente precisar extrair um arquivo, ainda é possível usar `permissions.grant()`
pontualmente.

### Validado com zips reais, sem NENHUM mock na lógica de extração

`sandbox-efemoro/src/archive/extractZip.test.js` (17 testes): zips reais construídos com
`archiver` — extração legítima, zip-slip, arquivo grande, zip bomb (total descomprimido), excesso
de arquivos, buffer corrompido/vazio, tamanho compactado, symlink real (via `archive.symlink()`),
profundidade, limpeza garantida (com e sem falha), arquivo binário detectado corretamente. Achado
real ao escrever o teste de binário: `fs.readFile(path, "utf8")` do Node **nunca lança** por byte
inválido (silenciosamente substitui por U+FFFD) — a primeira versão da detecção de binário via
try/catch nunca disparava de verdade; corrigida pra checar byte nulo nos bytes crus antes de
decodificar (mesma heurística de git/grep). `checkDiskSpace`/`withTimeout` testados diretamente
contra o filesystem/timers reais, sem fake.

`agent/src/capabilities/archive.test.js` (11 testes, mesmo padrão de `web-sandbox.test.js`: unitário
com `fetchImpl` mockado pro lado HTTP, mas contra um `Workspace` REAL — não fake): valida
`zipPath`/`destPath`, lê o Buffer certo do workspace, repassa limites como query string só quando
definidos, grava só texto e lista binário em `ignorados`, distingue falha de infraestrutura
(HTTP não-ok, lança) de extração recusada (200 com `success:false`, também lança — ver acima),
respeita `Permissions`, e confirma que um `zipPath` tentando escapar do workspace é recusado ANTES
de qualquer chamada de rede.

28 testes novos (17 `extractZip.test.js` em `sandbox-efemoro/` + 11 `archive.test.js` em `agent/`) —
`npm test` do `agent/`: 265/265 passando; `npm test` do `sandbox-efemoro/`: 44/46 (os 2 que falham
são pré-existentes, testes de `runWebSandbox` que precisam de um Chromium instalado, ausentes deste
ambiente — não relacionados a esta mudança).

**Deixado de propósito fora de escopo desta etapa** (evolução gradual, não big-bang): RAR/7z/TAR,
migrar o fluxo de upload já existente do app principal (`/dashboard/solaris/upload`) pra este novo
caminho — continua usando `fileTools.js` como está, sem risco de regressão —, e qualquer capacidade
de contenção mais ampla (limite de CPU/memória/disco a nível de container, controle de processo,
isolamento de filesystem mais forte, controle de rede genérico) — ver seção "Evolução planejada"
no README de `sandbox-efemoro/`.

## `file.diff`/`file.patch` — conectando o `diff_patch_engine` que já existia, mas não tinha consumidor

Auditoria de "o que ainda falta" nesta base de código encontrou um subsistema inteiro pronto e sem
uso: `Power-up/diff_patch_engine.cpp` — motor de diff/patch estrutural (Myers sobre tokens, não
linhas), já compilado no Dockerfile do agent (`COPY --from=cpp-builder ... /app/bin/diff_patch_engine`)
desde antes desta rodada, com `Observações.md` documentando um design bem pensado (14 testes reais,
auditoria com AddressSanitizer/UndefinedBehaviorSanitizer, um bug crítico de loop infinito já
encontrado e corrigido) — mas NENHUMA capability chamava o binário. Trabalho substancial, zero
consumidor real.

### A decisão: terminar de conectar, não abandonar

`file.edit` (substituição `oldString`/`newString`) já resolve o caso mais comum de "trocar um
trecho sem sobrescrever o arquivo inteiro" — então o motor C++ não preenche esse gap. O que ele
preenche, que nada mais no agent fazia, é diferente: pegar um arquivo inteiro **regenerado** (ex:
por uma chamada de LLM que devolve a versão nova completa) e (1) calcular exatamente o que mudou,
de forma auditável/revisável ANTES de gravar, e (2) garantir, com verificação criptográfica, que o
arquivo não foi tocado por ninguém entre o cálculo e a aplicação — nenhuma das duas coisas dá pra
fazer com `file.write` (sobrescreve sempre) nem com `file.edit` (não tem noção de "isso ainda é o
mesmo arquivo que eu vi?"). Motor determinístico, decisão do que virar código ficou com quem chama
(mesmo princípio #5 do `CLAUDE.md` do monorepo: IA decide O QUE mudar, código determinístico decide
COMO) — exatamente o tipo de peça que vale terminar, não descartar.

### O que faltava pra "produção", e o que foi fechado

O próprio `Observações.md` já listava os gaps, sem ambiguidade: hash SHA-256 do arquivo de origem,
aplicação atômica, e integração com o Agent Worker. Os três foram fechados nesta rodada:

- **SHA-256 embutido no patch** (`Power-up/diff_patch_engine.cpp`): implementação própria (mesma
  restrição de "só STL" do resto do arquivo), validada byte a byte contra os vetores de teste
  oficiais (`SHA256("")` e `SHA256("abc")`) e sob ASan+UBSan. `diff` calcula `sourceHash` (hash do
  arquivo A) e embute no patch (`format` sobe pra `structural-token-diff-v2`); `apply` recusa com
  **exit code 30**, ANTES de tentar qualquer operação, se o arquivo que recebeu não é mais o mesmo
  — sem isso, dois agentes (ou um agente e um humano) editando o mesmo arquivo em paralelo
  poderiam se sobrescrever silenciosamente, exatamente a "adivinhação" que a regra de ouro do
  projeto (`Observações.md` seção 21) proíbe.
- **Aplicação atômica**: decisão de arquitetura que o próprio doc já apontava (seção 15) — o
  binário continua "burro" quanto a I/O de destino (só imprime o resultado em stdout, nunca
  escreve arquivo nenhum), e quem grava atomicamente é a camada de integração:
  `Workspace.writeAtomic()` (novo método — arquivo temporário no MESMO diretório do destino + `fs.rename`,
  nunca uma escrita parcial visível se o processo morrer no meio). Mantém a superfície do C++
  pequena e testável isolada (zero acoplamento com Workspace/permissões), e a atomicidade fica
  onde o resto da lógica de arquivo do agent já mora.
- **Integração com o Agent Worker**: `utils/diff-patch-engine.js` (cliente fino sobre `runCommand`,
  mesmo padrão de subprocesso já usado por `build.js`/`test.js`/`package.js`) chama o binário via
  arquivos temporários e mapeia os 4 exit codes documentados (10/20/30/40) pra mensagem clara.
  `FileSystemCapability` ganhou duas operações novas — `file.diff` (só calcula, não escreve — serve
  de preview/revisão) e `file.patch` (aplica um patch já calculado, grava atomicamente) — wireadas
  em `task-router.js`, `security/permissions.js` (`file.diff` acompanha `file.read`, `file.patch`
  acompanha `file.write`/`file.edit`, nos 6 presets de papel) e `protocol/protocol.js`+
  `protocol-adapter.js` (schema zod pro objeto `patch` inteiro, não só um campo solto).

### Achado real: `execa` estava cortando o `\n` final de todo arquivo aplicado

Rodando o primeiro teste de round-trip (`apply(diff(A,B)) === B`) contra um arquivo terminando em
quebra de linha — o caso comum, quase todo arquivo termina assim — o resultado vinha sem o `\n`
final. Causa: `runCommand` (via `execa`) usa `stripFinalNewline: true` por padrão, correto pra LOG
de comando (uso original do helper, em `build.js`/`test.js`/etc — ninguém quer um `\n` sobrando no
fim de um log), mas errado aqui, onde o stdout capturado **é o conteúdo de um arquivo**, não um log.
Corrigido em duas camadas: `runCommand` ganhou um parâmetro opcional `stripFinalNewline` (omitido =
comportamento antigo preservado pra todo chamador existente; só `diff-patch-engine.js` passa
`false` explicitamente) — mudança mínima e retrocompatível no utilitário compartilhado, em vez de
duplicar lógica de subprocesso só pra este caso.

### Validado com o binário REAL, compilado na própria suíte de teste

Nenhum mock no caminho crítico — `utils/diff-patch-engine.e2e.test.js` e
`capabilities/filesystem-patch.e2e.test.js` compilam `Power-up/diff_patch_engine.cpp` via `g++`
(mesmo comando do Dockerfile) uma vez, num `before()`, e `DIFF_PATCH_ENGINE_BIN` aponta pro binário
resultante — o subprocesso roda de verdade em todo teste. Cobertura inclui: round-trip completo
(`file.write` → `file.diff` → `file.patch` → conteúdo real em disco confere), rejeição por hash
divergente **sem tocar o arquivo** (simulando edição concorrente — confirma que nada foi escrito e
nenhum `.tmp-*` sobrou), patch malformado/sem `sourceHash`, `Permissions` negando `file.patch`
mesmo com `file.diff` liberado, e o protocolo HTTP `POST /run` completo, ponta a ponta, com campos
snake_case reais (`new_content`) confirmando que o rename de campo e o schema zod do patch inteiro
funcionam de verdade, não só na teoria. `Workspace.writeAtomic()` ganhou testes próprios em
`core/workspace.test.js` (escreve, sobrescreve, nenhum arquivo temporário sobra, respeita o mesmo
guard de path traversal de `resolve()`).

**Deixado de propósito fora de escopo** (já documentado como decisão, não bug, na seção 20 de
`Observações.md`): tokenização de operadores compostos (`===`, `&&`, etc — não afeta corretude, só
a qualidade/legibilidade do diff gerado) e fuzz testing do parser/tokenizador.
