# Migração JavaScript → TypeScript — Softloadv4

Estado de referência: inventário da main de 24/10/2026, antes deste lote.

## Contagem e exclusões

- 597 arquivos `.js`; 218 arquivos `.ts`; 480 `.js` sem irmão `.ts/.tsx`.
- **480 NÃO é uma lista de arquivos de produção para converter**: inclui testes em JavaScript, bundles versionados de `public/dist/`, exemplos de código e entradas independentes como `agent/` e `sandbox-efemoro/`.
- `scripts/audit-typescript-migration.js` fornece o **saldo confiável do núcleo**: exclui `.test.js` e confere cadastro, typecheck e espelho CommonJS de cada módulo migrado.
- Diretórios ainda com muitos arquivos JS sem fonte TS: `agent/src/`, `src/routes/dashboard_routes/`, `sandbox-efemoro/src/`, `scripts/codeCorpus/`, `src/services/` e scripts CLI. Não alterar `public/dist/` manualmente: é saída gerada.

## Critério de convivência

O backend executa CommonJS `.js` com Node. Cada migração de scripts e do núcleo deve entregar **fonte TypeScript tipada**, **espelho CommonJS gerado**, cadastro em `scripts/typescript-mirror-sources.json` e `tsconfig.json`, e testes. `npm run typecheck` detecta mirrors divergentes.

Evitar áreas em migração simultânea: conferir os commits da `main` e a presença de `.ts` antes de começar; nunca sobrescrever arquivos cuja origem foi alterada sem reconciliar. Exemplos originais para RAG podem continuar em JavaScript porque são conteúdo didático, não necessariamente legado de runtime.

## Lote inicial feito nesta conversa

- `scripts/diagnostico-sweep.ts`: interfaces tipadas para manifesto, diagnósticos, achados e relatórios; preserva a CLI e o JavaScript usado pelo Node.
- `scripts/limparProjetosSolarisExpirados.ts`: contrato tipado de limpeza Firestore/GCS, retorno e erros; espelho CommonJS preserva os parâmetros e a execução manual. **Não executar esse comando para validar uma migração**: ele elimina projetos reais no ambiente configurado.
- `scripts/typescriptCliSmoke.test.js`: testes com dependências inteiramente simuladas, sem Firestore, GCS ou compilação de templates reais.

## Comandos seguros

```sh
npm run test:typescript-clis
npm run typecheck
npm run audit:typescript
```

Para novos scripts: usar os arquivos já convertidos como referência, executar os testes e manter ambos os arquivos sob controle de versão. Os testes completos em GitHub Actions dependem de um runner disponível.

## Lote complementar — segmentação de código para RAG

- `scripts/codeCorpus/codeChunker.ts` passou a ser a fonte tipada do particionador de código. Mantém o JavaScript CommonJS para os consumidores, a extensão de linguagens, o limite de 220 palavras e os filtros de possíveis segredos.
- `src/solaris/rag/codeCorpus.test.js` já testa chunking por linhas, preservação de recuos, extensões de código e limites. O gate TypeScript também valida o novo espelho.

## Etapa incremental — carregamento do catálogo autoral de códigos

- `scripts/codeCorpus/authoredCatalog.ts` é agora a fonte tipada do carregador de receitas do Solaris, incluindo caminhos permitidos, estrutura do manifesto, metadados, limites e chunks.
- `scripts/codeCorpus/authoredCatalog.js` continua como espelho CommonJS para indexação e testes sem alterar a API `loadAuthoredCorpus`.
- A origem histórica `Softdown-prog/softload-engine-v3` é mantida nos metadados para evitar que uma refatoração de linguagem altere URLs e hashes sem uma migração de conteúdo separada.
- O corpus Blogger (`src/rag/`) não é consultado; as receitas autorais continuam em `src/solaris/code-examples/` e `examples/solaris-code/`.
- Regressões: `npm run rag:code-test`, `npm run rag:boundaries-test` e `npm run typecheck` (auditoria e espelho).

## Novo lote — organizador de rascunhos Solaris RAG

- `scripts/ragOrganizarRascunhos.ts` passa a ser a fonte TypeScript do organizador; o arquivo `.js` é apenas espelho CommonJS executável pelo Node.
- Interfaces cobrem triagem de rascunhos, entradas de catálogo, decisão de validação/deduplicação e relatório de arquivos movidos ou rejeitados.
- Preservadas as regras originais: arquivos inválidos ficam em drafts, candidatos repetidos ficam bloqueados e somente entradas aprovadas entram nas pastas do catálogo Solaris.
- O comando `npm run rag:organizar` continua tendo efeitos de escrita/movimentação **quando executado manualmente**. No CI executa-se apenas `node scripts/ragOrganizarRascunhos.test.js`, com diretórios temporários isolados.
- Não há acesso ao RAG Blogger, à coleção vetorial de código, ao Firestore ou a credenciais no teste do organizador.

## Lote — indexador vetorial técnico Solaris

- `scripts/ragEmbedIndex.ts` tipa entradas do catálogo, parâmetros, resultados de embedding, Firestore injetado e o relatório de indexação; `ragEmbedIndex.js` continua sendo o espelho CommonJS do CLI.
- `npm run rag:embed-index` mantém o comportamento original de indexar o catálogo técnico. **Não executar em CI com credenciais reais.**
- `removerVetoresOrfaos` atua somente na coleção técnica `solaris_rag_vectors` e não remove vetores quando o catálogo está vazio ou quando `idsFiltro` restringe a indexação.
- O RAG de receitas `solaris_code_vectors` e o RAG Blogger (`src/rag/`) continuam isolados. `ragEmbedIndex.test.js` usa Firestore falso e embeddings injetáveis.
- O gatilho de GitHub Actions também cobre mudanças no novo `.ts`, no espelho `.js` e nos testes do indexador.

## Lote — indexador de receitas autorais Solaris Code

- `scripts/ragCodeIndex.ts` passa a ser a fonte TypeScript do CLI de receitas originais; `ragCodeIndex.js` permanece espelho CommonJS, sem mudança na API de `loadCorpus`, `indexCorpus` ou `verifyAuthoredExamples`.
- A leitura de fontes externas legadas continua restrita por validações de licença, hash, origem e segredos. O CLI principal indexa o catálogo autoral versionado.
- O indexador de código usa exclusivamente `solaris_code_vectors`, separado de `solaris_rag_vectors` e dos arquivos do Blogger.
- Comando padrão `npm run rag:code-index` é **dry-run**: não chama Firestore nem o serviço de embeddings; `--apply` continua exigindo a execução prévia dos testes de exemplos e credenciais.
- CI inclui `npm run rag:code-index -- --limit=3` sem `--apply` e regressões dos corpora. Nenhuma gravação ou limpeza de produção é feita nos testes.

## Lote — pipeline gerador de entradas do RAG técnico Solaris

- `scripts/ragGenerate.ts` é a fonte TypeScript do gerador de catálogo, com contratos para modelo de IA injetável, tópicos, resultados e entradas. O `.js` é o espelho CommonJS preservado para o Node.
- Mantidas as validações de grupo/tópico, unicidade, schema e similaridade antes de escrever JSON no catálogo. Entradas suspeitas de duplicação são reportadas para revisão humana em vez de gravadas.
- O teste `node scripts/ragGenerate.test.js` usa model router falso, catálogos injetados e diretórios temporários. **Não chamar `npm run rag:generate` no CI**, pois o CLI real invoca o modelo e grava arquivos.
- Arquivos do RAG Blogger e a coleção de embeddings do Solaris Code não são consultados por esse gerador. A migração não altera dados reais.

## Lote — CLI administrativa de recuperação de bloqueios Solaris

- Fonte `scripts/solarisProjectLockRecovery.ts` tipa identificadores de sessão, carimbo de atualização e a inspeção/recuperação. O espelho `.js` mantém a API CommonJS e o comando atual.
- Operação real exige `recover UID SESSION OWNER UPDATED_AT --instances-stopped --confirm`; o módulo `src/solaris/tools/projectLockRecovery.js` continua impondo validações, idade mínima e exclusão com precondição do Firestore.
- Testes de CLI em `scripts/solarisProjectLockRecovery.test.js` verificam argumentos e chamadas usando apenas mocks locais. Não acessam VPS, Firestore nem liberam locks.

## Lote — fake Firestore tipado para testes RAG Solaris

- `src/solaris/rag/__testUtils__/fakeFirestore.ts` exporta a mesma função `criarFakeFirestore` e contratos tipados para documentos, vetores, filtros, consultas KNN e lotes atômicos simulados.
- O `.js` é somente o espelho CommonJS. O helper não carrega `firebase-admin`, credenciais, Firestore de produção nem serviços HTTP.
- A etapa `node --test src/solaris/rag/ragVectorStore.test.js` no CI verifica a substituição de chunks, deduplicação, isolamento entre entradas e busca por distância de cosseno com dados em memória.

## Lote — recuperação manual segura de bloqueios do Solaris

- `src/solaris/tools/projectLockRecovery.ts` é agora a fonte autoritativa tipada: contratos de leitura Firestore, carimbo de versão, identidade, confirmação e inspeção. O `.js` continua espelho CommonJS compatível.
- Mantidas sem mudanças as proteções de segurança: sem desbloqueio automático por idade, confirmação explícita de instâncias paradas, validação de UID/sessão, idade mínima de 60 minutos, comparação de `owner`/`updateTime` e exclusão atômica com `lastUpdateTime`.
- Acrescentado teste de identificadores malformados incluindo barra, contrabarra e NUL. O teste `src/solaris/tools/projectLockRecovery.test.js` roda com banco simulado, sem conexão de produção.


## Lote — utilitário administrativo de promoção de acesso

- `scripts/setupAdmin.ts` define contratos tipados para o documento Firestore e a atualização restrita `{is_super_admin:true}`. Mantido o CLI manual `node scripts/setupAdmin.js <email>`.
- `scripts/setupAdmin.js` é o espelho CommonJS de produção. Em ausência de conta, mantém o código de saída 1 sem atualizar o registro.
- Novo `scripts/setupAdmin.test.js` verifica normalização de email, campo gravado, conta ausente e falta de argumento somente com Firestore simulado; não concede permissões reais.
- Corrigidos os testes de segurança do bloqueio Solaris para testar os bytes reais de contrabarra e NUL, evitando escapes indevidos nas fixtures.


## Lote — gerador Blogger RAG Balcão

- `scripts/generateRagBalcao.ts` é fonte TypeScript para os dois prompts existentes de grid/sidebar e imagens responsivas, com contratos de serviço Gemini, extração/validação de JSON e escrita local. O `.js` continua como espelho CommonJS para a CLI.
- Execução principal foi protegida por `require.main === module`, preservando `node scripts/generateRagBalcao.js` e evitando chamadas de API por simples importação.
- `scripts/generateRagBalcao.test.js` simula Gemini, sistema de arquivos e temporização. Inclui dry-run sem rede/escrita, extração de JSON, bloqueio de conteúdo incompleto e retry de 429.
- Nenhum arquivo de RAG real foi criado nem houve chamada real ao serviço de IA; `--dry-run` continua sem custo de API.

## Lote — gerador de 15 blocos de interface do Blogger

- `scripts/gerar-blocos-rag.ts` é a fonte TypeScript tipada para a lista de prompts, os campos das variantes do bloco, o relatório de geração, o serviço de IA e a escrita do JSON no catálogo Blogger.
- `scripts/gerar-blocos-rag.js` segue como espelho CommonJS executável. Importar a API não chama o modelo; somente executar a CLI diretamente inicia a geração real.
- Mantido o comportamento de não sobrescrever arquivos existentes, validar identidade/categoria/conceito, exigir ao menos duas variantes HTML, rejeitar tags Blogger dentro de variantes e repetir até três tentativas.
- `node --test scripts/gerar-blocos-rag.test.js` injeta respostas do Gemini e escrita de arquivo simuladas; nenhum dado real é gravado e nenhuma chamada de IA é feita pelos testes.

## Lote — gerador de blocos CSS e hero para os temas Blogger

- `scripts/generateBlocks.ts` é a fonte TypeScript do gerador de 14 nichos do compilador Blogger, com contratos explícitos para metadados, variantes CSS/hero, retorno do modelo e arquivos.
- `scripts/generateBlocks.js` continua o CLI CommonJS. Importar o módulo deixa de executar a geração automaticamente; `node scripts/generateBlocks.js [nicho ...]` mantém a execução explícita.
- Mantidos os prompts visuais originais, cinco variantes CSS e três hero por nicho, filtros que rejeitam sintaxe Blogger e placeholders, e armazenamento em `pipeline/temas/tema-{nicho}-blocks.json`.
- `scripts/generateBlocks.test.js` utiliza Gemini, FS e pausa simulados, conferindo que importação não chama API nem grava temas reais.

## Lote — migração do atualizador CSS de temas Blogger

- `scripts/fixImplCssVars.ts` torna a fonte TypeScript do reescritor de cores fixas para variáveis de tema, incluindo estruturas tipadas para caminhos CSS, alterações solicitadas ao modelo, carga e persistência de `impl.json`.
- `scripts/fixImplCssVars.js` permanece como espelho CommonJS; importar o módulo não executa mais o processamento.
- Por segurança de custos, executar a CLI sem argumentos ou com `--dry-run` **não chama Gemini nem altera o disco**. Para efetivar mudanças, usar `node scripts/fixImplCssVars.js --apply [nicho]`, com custo de API conforme provedor.
- O fluxo real preserva a extração recursiva de CSS, cardinalidade do retorno, substituições por caminho, backoff contra 429 e a manutenção de campos não-CSS.
- `node --test scripts/fixImplCssVars.test.js` verifica todos esses contratos com Gemini e FS em memória, sem chaves reais nem alterações em temas.

## Lote — autoverificador de espelhos CommonJS

- `scripts/check-typescript-mirrors.ts` agora é a fonte TypeScript autoritativa do próprio auditor de espelhos. O arquivo `scripts/check-typescript-mirrors.js` é o executável CommonJS produzido por `typescript.transpileModule` e entra no próprio registro auditado.
- `verificarEspelhos` recebe diretório, lista de fontes, sistema de arquivos e compilador injetáveis para permitir testes independentes; por padrão, mantém a comparação byte a byte com TypeScript ES2022/CommonJS.
- `npm run typecheck` continua **somente leitura**: acusa divergências ou erros de transpile sem corrigir nada automaticamente. `npm run sync:typescript` mantém `--write` explícito para atualização dos espelhos.
- `node --test scripts/check-typescript-mirrors.test.js` testa 7 cenários em diretórios temporários (arquivo válido, divergência, ausente, escrita explícita, erro TypeScript e processamento de múltiplas fontes), sem modificar os espelhos da aplicação.
- Os seis exemplos `src/solaris/code-examples/javascript/*.js` permanecem intencionalmente em JavaScript para os exemplos pedagógicos do Solaris Code.

## Frontend React — etapa 1: serviços, preferências e hooks

- Arquivos `frontend/services/api.js`, `frontend/utils/accessibilityPrefs.js`, `frontend/hooks/useFocusTrap.js` e `frontend/hooks/useHeroEntrance.js` foram **substituídos** pelas fontes `.ts`, sem espelhos CommonJS. Os imports no React continuam sem extensão e o Vite resolve automaticamente `.ts`.
- `tsconfig.frontend.json` mantém uma checagem `strict` independente do `tsconfig.json` do Node, com bibliotecas DOM, JSX para React e suporte temporário a JS/JSX ainda não migrados. A cada etapa, novas fontes `.tsx`/`.ts` entram neste escopo.
- `npm run typecheck:frontend` verifica tipos; `npm run build` recompila o frontend no Vite. A build em CI não altera os bundles versionados nem roda o servidor; o deploy continua responsável pelos assets finais.
- `npm run test:frontend-base` usa mocks e JavaScript compilado em memória para validar GET de configuração, fallback de rede, persistência de preferências, controle de foco/Escape e acessibilidade com redução de movimento, sem navegador externo.
- Preservada a política de imports dinâmicos para GSAP/ScrollTrigger; nenhuma mudança no contrato de login, dados de usuários, sessão ou cobranças.
