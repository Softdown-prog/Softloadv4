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

## Como validar

```bash
npm ci --legacy-peer-deps
npm run typecheck:agent
cd agent && npm ci && npm test
```

O workflow `Solaris Agent - TypeScript capabilities` executa esse gate
em todo push que altere capabilities. O workflow principal de deploy
também roda `npm run typecheck`, que inclui este gate.

Os demais módulos JS permanecem em funcionamento. Migrá-los requer
contratos explícitos próprios, testes preservados e verificação de AST.
