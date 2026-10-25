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
