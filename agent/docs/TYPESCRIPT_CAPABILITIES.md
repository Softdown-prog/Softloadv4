# Migração TypeScript — `agent/src/capabilities`

O Worker Agent em produção usa **Node 22 ESM** e carrega `.js` pela
árvore de imports em `agent/src/agent.js`. Esta migração não renomeia
esses imports nem exige um loader TypeScript em produção.

## Contrato de transição

- A fonte de evolução de cada módulo migrado é seu `.ts` tipado.
- Seu `.js` adjacente continua sendo o artefato ESM executável.
- O script `scripts/check-agent-capabilities-ts-mirrors.cjs` transpila
  o TS e compara a AST resultante à AST do JS, ignorando apenas espaços,
  pontuação de comentários e posição de tokens. Divergência de lógica
  bloqueia o `npm run typecheck:agent`.
- Novos módulos convertidos devem ser adicionados ao array `sources`
  desse script. Não contar um módulo como migrado sem entrar no gate.
- Nenhum npm install novo no Worker, binário de Chromium, nem container
  adicional é necessário.
- `npm run build:agent:capabilities` recompila os módulos TS listados no gate para ESM
  apenas se **todos** corresponderem semanticamente ao JS já versionado.
  O comando sobrescreve arquivos `.js` no diretório atual: deve rodar em
  um **checkout descartável** de CI, não diretamente em um workspace com
  alterações locais. O compilador e o analisador AST são dependências do
  repositório raiz, não dependências de produção do Worker.
- O workflow do Agent executa os testes de runtime **após** essa compilação.
  Assim, ele verifica código JavaScript realmente gerado das fontes TS.
  Na publicação do Agent, o GitHub Actions recompila os `.ts` listados no gate,
  sobrescreve os `.js` **apenas no checkout temporário** e então monta a
  imagem Docker. A VPS recebe somente a imagem pronta, sem TypeScript nem
  compilação adicional. A execução permanece em Node 22 ESM.

## Módulos tipados nesta rodada

- `storage.ts` — interface de permissões do placeholder de storage.
- `artifacts.ts` — interface de permissões do placeholder de artefatos.
- `knowledge-search.ts` — tarefa de busca semântica, transporte HTTP e
  validação de entrada.
- `web-sandbox.ts` — contrato de auditoria web, transporte HTTP e
  encaminhamento opcional de parâmetros sem alterar defaults.
- `archive.ts` — validação de caminhos, parâmetros de extração e
  persistência de arquivos de texto no workspace.
- `plan-tracker.ts` — contrato de plano, itens e estados de execução.

- `build.ts` — detecção de build e execução limitada à CommandPolicy.
- `test.ts` — detecção de suítes e execução de testes autorizados.
- `package.ts` — instalação de pacotes, validação de nomes e ecossistemas.

- `code-analysis.ts` — inspeção estática somente leitura, com limites de tamanho,
  prazo e tipos para estatísticas de código.
- `project-inspector.ts` — detecção tipada de linguagens, framework, scripts
  de testes/build e estrutura do projeto, sem execução de comandos.

- `asset-forge.ts` — contratos de operações de receitas/assets mantendo
  Forge em CommonJS sem instalar runtime TypeScript.
- `shell.ts` — execução restrita com validação de comando e argumentos,
  preservando a política de segurança do Worker.

- `git.ts` — comandos Git tipados, commit, staging e workspace.
- `github.ts` — contratos de issues, PRs e repositórios via Octokit,
  com validações obrigatórias preservadas.

- `code-search.ts` — busca no código com ripgrep/fallback e limites de
  resultados, sem alterar a execução existente.

- `escalation.ts` — pedidos e respostas humanas, estados e webhook,
  mantendo segredo fora do resultado público.
- `agent-parallel-dispatch.ts` — contratos de subagentes e worktrees
  isolados, incluindo limites de concorrência e erros estruturados.

- `filesystem.ts` — contratos de leitura, escrita, edição, diff, patch,
  listagem e busca de arquivos, preservando as verificações do workspace.

- `mcp-client.ts` — integração MCP remota com permissões, allowlist de
  ferramentas e fechamento da sessão, mantendo segredos fora da listagem.
- `web-fetch.ts` — busca HTTP textual com validação SSRF em todos os
  redirecionamentos, timeout e limites de leitura em streaming.

- `process.ts` — controle de processos com encerramento, captura limitada
  de saída, status e notificações opcionais assinadas.
- `web-search.ts` — pesquisa Gemini com limites por tarefa, domínio
  permitido, citações e tratamento tipado de quota e timeout.

## Inicialização do Worker em TypeScript

- `agent/src/index.ts` passa a tipar os sinais `SIGINT/SIGTERM`, o
  encerramento do servidor HTTP e o tratamento de falhas fatais.
- `agent/src/utils/logger.ts` declara a estrutura de logging com
  severidade, mensagens e metadados sem modificar o formato JSON.
- Ambos entram no mesmo gate AST e no build ESM das capabilities. O
  Docker executa os equivalentes `.js` gerados no runner do GitHub;
  não há compilação dentro da VPS nem mudança de entrypoint.

## Roteamento e execução tipados

- `agent/src/core/task-router.ts` declara os tipos de tarefa, capability,
  mapa de roteamento e erro para operações desconhecidas.
- `agent/src/core/task-runner.ts` declara o contrato do executor,
  duração, resultados e tratamento de falhas. A compilação é verificada
  por equivalência AST com os respectivos `.js` de produção.

## Contratos do protocolo

- `agent/src/protocol/protocol-adapter.ts` traduz as ações HTTP
  validadas em tarefas tipadas, preservando as renomeações dos campos
  de protocolo (snake_case) para os campos internos (camelCase).
- `agent/src/utils/errors.ts` tipa o erro do Agent e seu código de
  falha, preservando as mensagens e respostas de execução.
- Ambos passam pela mesma compilação ESM e verificação AST antes dos
  testes HTTP de ponta a ponta.

## Servidor HTTP tipado

- `agent/src/server.ts` tipa o contrato de `Agent.execute()`, as
  respostas HTTP e as rotas de `/run` e escalonamento humano.
- `agent/src/express-types.d.ts` limita a superficie de tipos do
  Express usada no Worker. E um arquivo so de declaracoes,
  sem codigo ou dependencia na imagem.
- A autenticacao por `WORKER_SHARED_SECRET`, limite JSON de 1 MB,
  execucao sequencial das actions e tratamento de erros sao preservados
  pela verificacao de equivalencia AST e pelos testes de HTTP.

## Validacao Zod tipada

- `agent/src/protocol/protocol.ts` tipa as operacoes suportadas, os
  resultados de `safeParse` e o contrato das requisicoes validas.
- Os schemas Zod e os limites de tamanho/quantidade continuam
  inalterados, e o gate exige AST identica ao `.js` existente.
- `agent/src/protocol/zod-types.d.ts` descreve somente os metodos Zod
  usados pelo protocolo para o compilador do checkout raiz. O Worker
  continua usando a biblioteca `zod` real de `agent/package.json`
  no runtime, sem nova dependencia no deploy.
- O teste HTTP existente garante que erros de input sejam rejeitados
  antes de executar qualquer action.

## Composição central do Worker

- `agent/src/agent.ts` tipa as opções de inicialização, workspace,
  permissões, políticas de comandos, capabilities externas e o ciclo
  `start/execute/wait/stop`.
- A ligação entre TaskRouter e TaskRunner usa as interfaces tipadas
  existentes, sem alterar a instanciação das ferramentas nem as
  permissões. A fonte entra no gate AST e na compilação ESM usada
  pelo Docker após validação no GitHub Actions.
- Os arquivos `.js` continuam sendo o runtime Node 22; nenhuma
  instalação ou execução de TypeScript acontece na VPS.

## Política de segurança tipada

- `agent/src/security/permissions.ts` tipa permissões por ação,
  os presets sobrepostos, `grant/revoke` e o snapshot de auditoria.
  A tabela de ações e o comportamento fail-closed permanecem iguais.
- `agent/src/security/command-policy.ts` tipa allowlist de comandos,
  prefixos autorizados e regexes de bloqueio. O parse e a execução
  de processos permanecem sem `shell: true`.
- `agent/src/security/role-permissions.ts` tipa os presets dos
  seis papéis de subagentes, mantendo as allowlists específicas de cada um.
- Os arquivos de segurança participam da checagem estrita de tipos,
  da comparação AST e dos testes de regressão antes da publicação.

## Proteção SSRF e parser de comandos

- `agent/src/security/ssrf-guard.ts` tipa o resolvedor DNS injetável,
  endereços IPv4/IPv6 e validação de URLs antes de requisições externas.
  Preserva bloqueio de metadados, faixas privadas e inspeção de todos
  os endereços retornados pelo DNS.
- `agent/src/utils/parse-command.ts` tipa a separação de argumentos
  com aspas/escapes, utilizada pela política de comandos.
- O gate AST impede diferenças de execução entre os dois arquivos
  TypeScript e os JavaScript existentes. O DNS nativo só recebe uma
  declaração de tipos local, sem dependências novas.

## Configurações de rede tipadas

- `agent/src/config/solaris-allowed-domains.ts` tipa a lista
  permitida de fontes de documentação, mantendo os domínios atuais.
- `agent/src/config/sandbox-endpoints.ts` tipa a seleção de URLs
  dedicadas ao navegador e ao serviço de extração, incluindo fallback
  para as variáveis de ambiente legadas.
- Ambas passam pelo gate de equivalência ESM; não há modificação nos
  endpoints, chaves ou valores de configuração em produção.

## Configuração MCP tipada

- `agent/src/config/mcpServers.ts` define contratos de ambiente e de
  servidores MCP, mantendo a validação Zod do JSON, a allowlist de
  ferramentas e os presets GitHub/Supabase (HTTPS obrigatório).
- O shim de tipos do Zod inclui `url()` para compilar no checkout raiz,
  mas a validação em produção continua utilizando a biblioteca real.
- A comparação AST garante que a configuração, os endpoints e o
  comportamento dos segredos permaneçam iguais ao JavaScript original.

## Execução de comandos tipada

- `agent/src/utils/run-command.ts` descreve entrada e saída dos
  subprocessos sem shell, preservando os argumentos literais, a opção
  `stripFinalNewline`, timeout e os limites de saída existentes.
- O contrato de tipos local de `execa` inclui a opção opcional de
  preservação da quebra de linha; não altera a instalação de produção.

## Workspace isolado tipado

- `agent/src/core/workspace.ts` tipa a resolução de caminhos, leitura,
  escrita, listagem e gravação atômica; a checagem textual e real
  (via `realpath`) contra traversal e symlinks continua inalterada.
- Os contratos locais de `node:fs/promises` e `node:path` suportam
  o typecheck sem instalar tipos Node adicionais na imagem de produção.
- A equivalência AST é exigida antes de gerar os arquivos `.js` do
  Worker, e os testes existentes cobrem path traversal, symlinks e
  gravação atômica.

## Webhook assinado tipado

- `agent/src/notifications/webhook-delivery.ts` tipa envio de callbacks,
  assinaturas HMAC-SHA256, timeouts, resposta HTTP e o verificador
  de assinatura em tempo constante.
- Mantidos o bloqueio SSRF, a ausência de redirecionamentos
  automáticos e os testes unitários e de ponta a ponta existentes.
- Os shims locais de `node:crypto` e `Buffer` são somente tipos,
  sem novos pacotes ou mudanças nos containers.

## Como validar

```bash
npm ci --legacy-peer-deps
npm run typecheck:agent
npm run build:agent:capabilities  # somente em checkout descartável
cd agent && npm ci && npm test
```

O workflow `Solaris Agent - TypeScript capabilities` executa o gate,
compila os `.ts` e testa os `.js` gerados. O deploy principal valida o
TypeScript e, **somente quando o Agent precisa ser reconstruído**, recompila
os módulos TS no runner do GitHub antes de executar `docker build`:
assim, o Docker já recebe JavaScript ESM pronto. O container final não
instala TypeScript ou acorn como dependências de compilação.

Os demais módulos JS permanecem em funcionamento. Migrá-los requer
contratos explícitos próprios, testes preservados e verificação de AST.
