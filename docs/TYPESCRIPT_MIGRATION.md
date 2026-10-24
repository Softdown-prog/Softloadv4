# Migração incremental JavaScript → TypeScript

## Objetivo e compromisso

Aumentar a confiabilidade **sem reescrever** a Softload Engine V3.
O compilador XML Blogger + Bootstrap 5.3.3, os dossiês/esqueletos por
nicho, Solaris, Workspace, Mercado Pago, Firestore e arquivos dos usuários
são funcionalidades existentes que devem ser preservadas.

**Primeira fase:** preparar uma checagem de tipos real, mas estreita;
executar regressões antes de qualquer novo deploy e preparar contratos.

## Ambiente atual

- Backend `src/`: JavaScript/CommonJS, Node 20 no Docker.
- Interface `frontend/`: React/JSX e Vite.
- Agent `agent/`: pacote isolado, ESM, Node >=22.
- CI refatoração: Node 22, `npm ci`, `npm run typecheck`, `npm test`,
  `npm run build`. O deploy também executa essas verificações **antes**
  de construir a imagem ou disparar o webhook.
- `tsconfig.json` agora inclui contratos e os módulos TS migrados.
  Os JavaScript legados ainda não têm typecheck global. Não divulgar
  “projeto convertido” até que cada módulo entre na cobertura.

## Sequência de refatoração

1. **Proteção e base**: TypeScript fixado no package-lock; contratos TS
   para geração XML e consumo de IA; pipeline de regressão.
2. **Fronteiras de dados**: contratos para modelos de IA, manifests,
   respostas HTTP, sessões, artefatos e comunicação com o Agent.
3. **Núcleo determinístico**: converter utilitários pequenos, mantendo
   os mesmos exports/imports durante migração CommonJS → JS compilado.
   Só depois avançar gradualmente para `compilerWorker` e `modules`.
4. **React**: TSX progressivo com `tsconfig` do frontend separado.
5. **Worker Agent**: migrar de forma independente com `moduleResolution`
   compatível com ESM/Node 22.
6. **Regras mais estritas**: estender `include` e usar `checkJs` seletivo
   até os módulos legados serem cobertos; evitar desabilitar erros com
   `any` indiscriminado.

## Regras de segurança

- O tipo TypeScript não substitui validação de dados externos em runtime.
- A migração não altera webhooks, créditos, saldo, preço, uso de APIs,
  autenticação, contratos de banco ou esquemas Firestore nesta fase.
- A nova carteira pré-paga em reais será uma tarefa separada com transações
  atômicas, reservas de saldo e idempotência por pagamento/uso.
- Mantenha testes de compilação por nicho; CI verde não comprova instalação
  de todos os XMLs no Blogger nem aparência visual idêntica.
- Não trocar o framework dos templates com base no nome dos arquivos:
  verificar as dependências e o XML efetivo.
- Cada mudança precisa de commit pequeno, testes, comparação de
  comportamento e possibilidade de rollback.
- O backend principal e o Agent têm configurações Node distintas; migrar
  separadamente, não misturar sistemas de módulos.

## Critérios de pronto

- `npm ci --legacy-peer-deps` reproduz o lockfile.
- `npm run typecheck`, `npm test` e `npm run build` passam no CI.
- O Docker continua construindo sob seu runtime Node real.
- Zero alteração de funcionalidades ou arquivos XML nesta primeira fase.

## Etapa 2 — núcleo determinístico tipado

Migrados como **fontes TypeScript autoritativas**:
`src/core/compilerEngine/{sanitize,orphans,fieldGraph}.ts`.

O Node 20 em produção continua lendo os arquivos CommonJS `.js` gerados
(e versionados) nas mesmas pastas, preservando as chamadas `require()`
da engine. O comando `npm run sync:typescript` regenera somente esses
espelhos. `npm run typecheck` verifica os tipos e falha se algum espelho
estiver diferente da fonte — logo, não é permitido alterar manualmente
o arquivo JavaScript gerado.

Há testes de compatibilidade em
`src/core/compilerEngine/typedMirrors.test.js` executados por `npm test`.
O grafo mantém a identidade de `trace`/`sources`; a sanitização continua
sem coerção implícita; placeholders órfãos mantêm o mesmo tratamento.

**Limite:** apenas esses três módulos do compilador foram convertidos;
`compile.js`, demais serviços, React e Agent permanecem JavaScript nesta etapa.

## Etapa 3 — fontes, SEO e layout

Convertidos em TypeScript `fonts.ts`, `seo.ts` e `layout.ts`, com
os equivalentes CommonJS `.js` compilados e versionados nas mesmas pastas.
`compile.js` e `index.js` preservam seus `require()` existentes.

O verificador de espelhos `npm run typecheck` também cobre estes arquivos.
`typedPresentation.test.js` protege saídas exatas legadas mediante hashes
SHA-256 de 4 cenários de fonte, 20 casos SEO, 16 combinações de layout
e HTML da newsletter. Os hashes foram calculados antes da conversão e
comparados localmente com a implementação tipada.

Esta etapa não altera a estrutura XML, os dossiês de nicho, nem os contratos
da API, da autenticação, dos pagamentos ou do Agent.

## Etapa 4 — manifesto e contrato de compilarTemplate

- `slotManifest.ts` é a fonte tipada autoritativa dos 38 slots do trace
  e das 7 opções de grade. `slotManifest.js` é o espelho CommonJS versionado.
  A versão tipada usa `satisfies` sem `Object.freeze` ou alteração da ordem.
- `CompilerTemplateOptions` descreve a entrada **já normalizada** fornecida
  pelo worker; não substitui a validação de manifesto bruto em runtime.
- `CompilerTemplateResult` descreve a saída bruta `{ xml, trace }`;
  não deve ser confundida com `CompiledBloggerTheme` produzida mais tarde.
- `compile.d.ts` disponibiliza assinatura de tipos para novos consumidores
  TypeScript. `compile.js` mantém a implementação e export CommonJS inalterados.
- `compilerContract.typecheck.ts` verifica os tipos em CI.
  `slotManifest.test.js` garante a paridade com o manifesto JS anterior
  (hash FNV32 da serialização, 38 slots, 7 grades, ordem e grafo).
- `npm run typecheck` passa a verificar também o espelho de `slotManifest.ts`.
  Não converter `compile.js` ou mudar o motor XML nessa etapa.

A lógica do compilador continua JavaScript enquanto os seus contratos são
gradualmente utilizados pelos novos módulos tipados.

## Etapa 5 — extrair os estágios determinísticos de compile.js

A injeção ordenada dos placeholders e a construção do trace saíram de
`compile.js` para `compileStages.ts`, sem trocar a lógica da seleção dos
valores. O Node 20 usa `compileStages.js` CommonJS gerado e conferido por
`npm run typecheck`.

`injetarSlotsXml` mantém a **ordem exata** dos `split/join` originais,
principalmente módulo → nicho → imagem → widgets; os marcadores de CSS/hero
continuam condicionados ao conteúdo real. A remoção de placeholders órfãos
permanece no motor depois da injeção.

`construirTraceCompilacao` usa o mesmo SLOT_MANIFEST, Buffer.byteLength
UTF-8 e a referência original do array `sources`, preservando o grafo.
Os testes cobrem substituição, marcadores DP, dependência da ordem,
placeholders aninhados, UTF-8 e o grafo. Uma prova estática em TS garante
os tipos de entrada e saída do estágio.

`compile.js` continua em JavaScript para a orquestração, presets, módulos,
dossiês, SEO e imagem. **Não considerar o compilador inteiro migrado.**
A auditoria visual de 14 nichos e a suite de regressões continuam como
gate de deploy.

## Etapa 6 — resolvedMap tipado

A montagem do mapa slot → valores saiu de `compile.js` para
`resolvedMap.ts`, com `resolvedMap.js` espelhado em CommonJS e verificado
por `npm run typecheck`. A seleção de presets, a sanitização, os dossiês
e a geração de CSS permanecem no compilador JS e nos módulos existentes.

`montarMapaSlotsResolvidos` reproduz o laço de normalização de módulos,
a ordem das propriedades do `resolvedMap` e o espalhamento final
`...modMap`, de modo que módulos dinâmicos continuam podendo substituir
chaves do mapa como antes. Os callbacks de hero, header e navegação são
invocados na mesma ordem do objeto literal legado, preservando a
avaliação preguiçosa do widget HTML89: design package ou widget nativo
não dispara geração de hero HTML padrão.

`resolvedMap.test.js` compara o resultado, a ordem de chamadas, a injeção
XML e o trace com o algoritmo JS anterior em **18 cenários**;
`resolvedMap.typecheck.ts` testa os contratos de entrada/saída.

Esta etapa **não** migra a orquestração de `compile.js` inteira, nem muda
esquemas externos, Blogger XML, créditos, pagamentos, ou Agent.

## Etapa 7 — orquestrador compile.ts

`compile.ts` passa a ser a fonte TypeScript autoritativa do motor
`compilarTemplate`; `compile.js` permanece no mesmo caminho como espelho
CommonJS gerado para Node 20. Removemos a assinatura temporária
`compile.d.ts`, agora substituída pela função real tipada.

A migração preserva os `require()` na mesma ordem e o fluxo do chassis:
presets e tema → módulos/nicho → hero e H1 de fallback → resolvedMap
→ injeção DNA → limpeza de órfãos → trace. As funções JS ainda não
migradas recebem contratos estruturais locais tipados, enquanto módulos
TS existentes são vinculados por `typeof import`.

Os contratos descrevem apenas o lado interno depois da normalização;
entradas HTTP continuam sendo validadas pelo worker. Esta etapa não muda
nicho, XML, orçamento, Mercado Pago, infraestrutura, agente ou UI.

`npm run typecheck` exige tipagem estrita da fonte e igualdade do espelho
JS gerado. `compileTyped.test.js` protege o export CommonJS; o conjunto
de regressões de compilação e a auditoria XML/visual de nichos continuam
sendo executados antes do deploy.

## Etapa 8 — fronteira do compilerWorker

`src/core/workerInput.ts` é a fonte TypeScript para `validarManifesto`,
`resolverEnum` e `resolverDesignVoice`. O `compilerWorker.js` permanece
em JavaScript e as importa via `workerInput.js` CommonJS gerado, preservando
`validarManifesto` em seu `module.exports` público.

O worker fornece os enums da fonte real `blueprintSchema.js` e os mapas
de identidade visual existentes como argumentos; isso evita criar
dependências circulares no novo helper. A checagem de `modules: null`,
os defaults de enum e a prioridade nicho → cor permanecem como antes.
Os dados HTTP continuam sem coerção ou validação extra nesta etapa.

`workerInput.test.js` protege os retornos do algoritmo legado e a
referência exportada pelo worker. A normalização abrangente, o
sorteio determinístico de layout e todos os efeitos de compilação
continuam no worker JS; migraremos essas partes só com testes adequados.

## Etapa 9 — módulos e badges em TypeScript

`src/core/workerNormalize.ts` é a fonte autoritativa da normalização de
`modulosAtivos` e `badgesProcessados`, executada pelo `compilerWorker.js`
através do espelho CommonJS `workerNormalize.js`.

Módulos explícitos continuam vencendo os defaults de cada nicho e
`Boolean('false')` mantém o comportamento anterior: não introduzimos
parser de booleanos em uma migração de linguagem. Widgets, menus, títulos
e tema da página 404 seguem a ordem e os limites legados (títulos: 60).
Os três formatos de badges permanecem aceitos; a implementação mantém
o limite de 8, nomes de 40 caracteres, escape XML e fallback das cores.

`workerNormalize.test.js` verifica os 34 campos e fingerprints fixos em
26 casos de entradas. A suite de nichos e a auditoria XML/visual permanecem
como gates independentes antes do build/deploy. Este commit não muda
as escolhas de grid/sidebar por seed, o chassis nem o contrato HTTP.

## Etapa 10 — identidade e layout determinístico

O workerLayout.ts agora resolve siteNameBruto (máximo 60 unidades UTF-16),
slug (NFD, remoção de acentos, 40 caracteres) e defaults de grid/sidebar.
O worker ainda injeta hashSeed de blockLibrary e pageTypeParaNicho de
nichoTaxonomy, preservando o seed site+nicho e os namespaces gridlayout e
sidebar. A sanitização XML e escolhas explícitas via resolverEnum permanecem
no compilerWorker.js. O helper CommonJS é gerado do TypeScript e
workerLayout.test.js compara as saídas à implementação legada para todos
os nichos e uma matriz de nomes. Nada muda em chassis, HTTP ou pagamentos.

## Etapa 11 — SEO, descrição e textos do hero

`workerContent.ts` centraliza os flags `seoAtivo` e `lazyLoadAtivo`,
a descrição (240 caracteres), títulos do hero (120/200 caracteres) e
`buttonStyle` (fallback `default` somente para tipo não-string).

A extração preserva o opt-out SEO estrito (`false` ou `'false'`)
e o legado `Boolean('false') === true` para lazy loading.
Textos vazios ou só espaços tornam-se `null`; texto válido é aparado
e truncado em unidades UTF-16. O escape HTML/XML continua sendo
responsabilidade das etapas de compilação existentes.

O worker segue em JavaScript, consumindo o mirror `workerContent.js`
CommonJS validado no CI. `workerContent.test.js` compara fórmulas
originais e tipagem com centenas de casos. Sem alteração em SEO gerado,
HTML do hero, nichos, saldo, API ou deploy.

## Etapa 12 — normalizarManifesto em TypeScript

`workerManifest.ts` é a fonte TypeScript autoritativa da função
`normalizarManifesto`. Ela reúne os auxiliares tipados `workerInput`,
`workerNormalize`, `workerLayout`, `workerContent` e `sanitize`.
`compilerWorker.js` continua responsável por validar a entrada HTTP,
carregar chassis, compilar, aplicar Design Package, reparar XML,
verificar dossiês e registrar telemetria.

As dependências de nicho, presets e hash permanecem nas fontes JS
existentes e são injetadas explicitamente. A ordem de execução
original (flags → nicho → defaults → badges → layout → textos →
enums/voz) foi preservada, inclusive o aviso de nicho inválido.
`NormalizedWorkerManifest` descreve o contrato interno completo,
verificado contra `CompilerTemplateOptions` pelo typecheck.

`workerManifest.test.js` compara objetos completos, ordem das chaves
e avisos com a implementação anterior em cenários combinatórios.
O espelho `workerManifest.js` é checado pelo TypeScript 5.9.3 no CI.
Nenhuma alteração no XML, chassis, créditos, pagamentos ou rotas HTTP.

## Etapa 13 — carregamento de chassis em TypeScript

`workerChassis.ts` contém o carregador que antes vivia dentro
de `compilerWorker.js`. Acesso ao disco, composição de caminhos,
taxonomia de nichos e avisos são dependências explícitas,
fornecidas pelo worker Node 20. O export público
`carregarChassisParaNicho` continua disponível no mesmo lugar.

Conservados: arquivo próprio do nicho antes do chassis da família,
fallback de família ausente para o template base, fallback direto
para base em falha de leitura do arquivo próprio, limite mínimo
de 200 caracteres, mensagens de erro/aviso, e substituição literal
dos `[[BLOGGER_INCLUDABLES_PADRAO]]`.
O partial é carregado preguiçosamente, com cache compartilhado por
todas as compilações da mesma instância do loader.

`workerChassis.test.js` compara XML real com uma implementação
independente do loader anterior para todos os nichos, além de
exercitar filesystem virtual, fallback, cache e exceções.
Não foram alterados chassis, design packages, finanças, rotas
HTTP ou lógica de reparos.

## Etapa 14 — Design Package em TypeScript

`workerDesignPackage.ts` centraliza `injetarDesignPackage` e
`verificarMarcadoresDesignPackage` (export público preservado no worker).
O worker injeta as mesmas implementações de entidades XML, widgets e
avisos que já utilizava. Nenhuma nova sanitização ou parse de HTML/XML.

Preservados os marcadores DP:CSS/LOGO/HERO/SECTIONS, o CSS no CDATA
de b:skin (ou escapado fora do CDATA), inserção de SVG no header-logo
ou nas classes de marca, widgets HTML90/HTML91 com HTML original e
o gate home-only `data:view.isMultipleItems`. Dossiês com hero protegido
continuam suprimindo apenas heroHtml, nunca staticSections.

`workerDesignPackage.test.js` verifica caminhos ausentes, CSS e escape,
marcadores, widgets e integração real com dossiê protegido.
Os espelhos CommonJS continuam sujeitos ao gate TypeScript.

## Etapa 15 — validação não bloqueante do XML final em TypeScript

`workerXmlValidation.ts` é agora a fonte de verdade de `validarXmlSaida`.
O `compilerWorker.js` preserva o mesmo export público e chama a rotina
no mesmo momento do pipeline (após `repararXml`). Não foram modificados
o reparador, o compilador nem o tratamento de erro da rota.

Preservados a ordem e as mensagens dos avisos: tags html/head/body;
presença de b:skin e Bootstrap; detecção de tokens `[[UPPERCASE]]`
com deduplicação estável; remoção dos blocos CDATA antes de localizar
ampersands sem entidade válida. A verificação continua heurística e
não bloqueante; não é uma validação SAX formal.

`workerXmlValidation.test.js` usa a implementação legada independente,
256 combinações e XMLs compilados reais. O CommonJS espelhado segue
o contrato do `scripts/check-typescript-mirrors.js` no CI.

## Etapa 16 — grafo, diagnóstico, telemetria e metadados

`workerDiagnostics.ts` reúne quatro transformações puras:
resumo do grafo e cinco campos mais influentes; formatação dos
erros do Diagnóstico; evento interno de telemetria; e objeto meta
da resposta do compilador. A execução do diagnóstico (try/catch),
o registro Firestore fire-and-forget e a integridade bloqueante
dos dossiês continuam no `compilerWorker.js`.

Preservados a ordem das propriedades do JSON, o ranking de slots,
o timestamp gerado no worker, o `Buffer.byteLength` em UTF-8,
o `toFixed(1)` em KB, os módulos filtrados pela verdade de JS
e o estado null/true/false dos validadores.

`workerDiagnostics.test.js` compara as fórmulas legadas em centenas
de combinações e verifica 3 compilações reais. O espelho CommonJS
é verificado pelo TypeScript no CI; sem mudanças no XML gerado,
no Firestore ou no tratamento de pagamentos.

A auditoria visual anterior da etapa 15 teve timeout de navegação
do Chromium para pop-retro-pixel, mas não encontrou diferença no XML.
O job foi reenfileirado separadamente para verificar intermitência.

## Etapa 17A — proteção de hero e ativação de Design Package em TypeScript

`workerHeroGuard.ts` extrai as regras puras de hero protegido e
de ativação dos cinco campos do Design Package. A lógica mantém
o hero original do dossiê quando ele é declarado protegido,
suprimindo apenas `heroHtml` e preservando `staticSections`.

Os testes `workerHeroGuard.test.js` comparam 218 combinações com
as expressões legadas; o espelho CommonJS está no gate TypeScript.

Esta é a primeira parcela da etapa 17: `executarCompilacao()`
continua em JavaScript para manter a integração estável enquanto
os contratos externos do orquestrador são formalizados. A migração
completa do coordenador principal permanece pendente, sem mudança
nas rotas, XMLs, dossiês, pagamentos ou telemetria.

## Etapa 17B — orquestração completa em TypeScript

`workerOrchestrator.ts` passa a executar o pipeline inteiro: manifesto,
chassis, dossiê, compilação, grafo, Design Package, reparos,
integridade do DOM, diagnóstico não bloqueante, telemetria e resposta.

`compilerWorker.js` permanece como adaptador CommonJS pequeno, com
as cinco exportações públicas inalteradas e dependências JS injetadas.
Os três gates da etapa 17A continuam usados pela execução tipada.

Continuam iguais os prefixos `[MANIFEST]`, `[ENGINE]`, `[DOSSIE]`,
a supressão do hero quando protegido e a preservação de `staticSections`.
Os logs, chamadas ao Firestore, relógio e demais I/O permanecem nos
adaptadores externos. Não muda a saída XML ou os contratos HTTP.

`workerOrchestrator.test.js` exercita dependências simuladas,
falhas do motor e integridade, telemetria e proteção contra hero duplo.
Além dos testes existentes, a auditoria XML/visual continua obrigatória.

## Etapa 18 — inventário e controle de cobertura

A etapa 17B terminou com as duas pipelines verdes (build/Docker e
auditoria XML/visual). O `compilerWorker.js` permanece **de propósito**
como adaptador CommonJS e o executor completo mora em
`workerOrchestrator.ts`.

### Situação real do núcleo (`src/core/`)

- **21 fontes TS autoritativas**, cada uma com espelho `.js` CommonJS
  versionado e verificado. A presença no `tsconfig.include` é obrigatória.
- **46 arquivos JS legados** no mesmo escopo (excluindo `*.test.js`),
  incluindo `compilerWorker.js` (adaptador) e `compilerEngine/index.js`
  (barrel CommonJS). Esta proporção é por **quantidade de arquivos**,
  não por linhas, cobertura de testes ou maturidade do projeto inteiro.
- React, services, agente ESM e rotas não foram migrados nesta série
  e não entram neste contador.

### Nova trava automatizada

`scripts/typescript-mirror-sources.json` contém a lista única dos
espelhos compilados. `check-typescript-mirrors.js` a utiliza sem alterar
o código gerado. `scripts/audit-typescript-migration.js` compara a lista
com os arquivos reais de `src/core` e o `tsconfig.include`, falhando
se faltar registro, arquivo `.ts`, espelho `.js`, ou se houver
duplicação/caminho inválido. A verificação roda em `npm run typecheck`
(logo, também no build de CI) e via `npm run audit:typescript`, com
opção `-- --json` para análise externa. Uma suíte com filesystem
temporário exercita as situações de erro.

### Próximas migrações recomendadas

1. **`compilerEngine/xmlEntities.js` (113 linhas):** manipulação pura
   de strings e escape XML; testar byte a byte, incluindo CDATA,
   HTML de hero, entidades numéricas e casos inválidos.
2. **`nichoTaxonomy.js` (104 linhas):** mapeamento de nichos/chassis
   com contratos já consumidos pelo worker tipado; testar a tabela
   completa e aliases antes de alterar exports.
3. **`compilerEngine/designTokensCss.js` (266 linhas):** CSS de
   apresentação; migrar somente com hashes de saída e auditoria visual.
4. **`repairEngine.js` (321 linhas):** mecanismo de reparo; requer
   testes de idempotência e entradas malformadas antes de qualquer
   mudança, já que atua sobre todo XML gerado.
5. **`compilerEngine/dossieIntegrityChecker.js` (233 linhas):**
   contrato DOM bloqueante para dossiês; migrar por último com
   testes que comprovem rejeição de integridade quebrada.

Não mudar os limiares das auditorias, o conteúdo dos XMLs ou o
webhook de deploy durante a consolidação. O `npm run typecheck`
continua executando o TypeScript estrito e o gate byte a byte.

## Etapa 19 — entidades e texto do hero em TypeScript

`src/core/compilerEngine/xmlEntities.ts` passa a ser a fonte de verdade
das três funções `sanitizarEntidadesXml`, `escaparTextoXml` e
`injetarHeroTexto`, com espelho CommonJS `.js` que o Node continua
carregando pelo mesmo `compilerEngine/index.js` (API inalterada).

Preservamos o mapeamento original de entidades HTML nomeadas,
a regra para `&` residual, as entidades XML e numéricas aceitas,
o fechamento dos elementos HTML vazios e a substituição apenas da
primeira heading e do primeiro parágrafo. Entradas não-string são
devolvidas sem coerção pelas duas funções do legado que assim operavam;
`escaparTextoXml` mantém a sua conversão explícita `String(s)`.

Não modificamos o parser, os templates nem o fluxo de CDATA.
`xmlEntities.test.js` cobre escapes, tags autocontidas, conteúdo
de hero, aliases HTML e centenas de combinações, enquanto a
fidelidade XML/visual Blogger permanece obrigatória no CI.

O inventário tipado agora possui 22 fontes TypeScript espelhadas e
45 arquivos JavaScript sem fonte TS no núcleo `src/core/`.

## Etapa 20 — taxonomia de nichos em TypeScript

`src/core/nichoTaxonomy.ts` passa a ser a fonte de verdade das tabelas
`NICHO_PAGE_TYPE_MAP`, `NICHO_CHASSIS_MAP`, `PAGE_TYPES_VALIDOS` e
`PAGE_TYPES_SEM_CHASSIS_DEDICADO`, e das consultas
`pageTypeParaNicho` / `chassisParaNicho`.

Os 15 nichos continuam com suas duas classificações distintas:
`tecnologia-techwind` é `portal-noticias` e usa chassis `magazine`;
`elearning-academy` e `appstore-bulma-mobile` mantêm fallback `blog`.
A função de taxonomia **não** remove o prefixo `tema-`; a normalização
de strings de entrada continua no carregador de chassis.

`nichoTaxonomy.test.js` fixa a ordem das duas tabelas, todos os 15
pares pageType/chassis, os 7 tipos válidos e as 2 famílias sem
chassis próprio. O teste cobre valores desconhecidos e preserva a
consulta normal a propriedades herdadas de Object.prototype.
São preservados todos os exports consumidos por `blueprintCritics`,
`compilerWorker` e demais módulos; não há mudança nos XMLs.

A auditoria de cobertura passa de 22 para 23 fontes TypeScript
e de 45 para 44 arquivos JavaScript legados em `src/core`.

## Etapa 21 — tokens CSS em TypeScript

`compilerEngine/designTokensCss.ts` tipa as 5 funções legadas de
CSS dinâmico, tipografia, badges, estilos de botão e variantes de grid;
o `designTokensCss.js` CommonJS permanece no mesmo caminho para o
Node de produção e o `compilerEngine/index.js` continua inalterado.

Preservados o mapeamento e ordem dos 16 tokens globais, os fallbacks de
cor, rodapé específico do BioLink, seletores CSS, unidades, espaços,
ordem dos blocos, estilos neon/flat/pill/brutalist e os seis estilos
de grid `lista`, `dupla`, `quadrado`, `mural`, `coluna-unica`, `zigzag`.

Os testes de tokens globais anteriores continuam, acrescidos de
`designTokensCssParity.test.js` para toda a API e
`designTokensCss.typecheck.ts` para os contratos TypeScript.
Não há mudanças nos arquivos template_*.xml, no CSS gerado
intencionalmente ou nas regras de auditoria visual.

Inventário atualizado: **24** fontes TypeScript espelhadas e
**43** arquivos JavaScript legados no núcleo `src/core/`.

## Etapa 22 — reparador de XML e CSS truncado em TypeScript

`src/core/repairEngine.ts` passa a ser a fonte tipada de `repararXml`
e `repararCssTruncado`. O arquivo `.js` continua como espelho
CommonJS para `compilerWorker` e `chatCodeValidator`.

Preservados a ordem das oito regras de XML: b:loop corrompido, tokens
residuais, duplicação de IDs, escapes de atributos, booleanos HTML5,
whitespace Unicode, includable principal de widget HTML e remoção
de comentários XML inválidos. Os detalhes dos reparos, inclusive as
chaves históricas `acção` e `acao`, mantêm o mesmo formato.

O código legado possui heurísticas deliberadamente preservadas
nesta migração: normalização de espaços em todo o texto (não apenas
dentro das tags), regra de atributos booleanos inclusive no CDATA
e detecção de widgets HTML somente com `type='HTML'`.
Essas regras NÃO foram alteradas nesta etapa para evitar regressões;
se forem corrigidas, precisarão de projeto separado e golden tests.

`repairEngine.test.js` testa a ordem dos reparos, escapes em CDATA,
IDs duplicados, tipagem de CSS truncado, idempotência e XML real
do compilador. Contratos TypeScript adicionados com `strict`.

Inventário: **25 fontes TS** e **42 arquivos JS legados** no núcleo.

## Etapa 23 — integridade mecânica de dossiês em TypeScript

`compilerEngine/dossieIntegrityChecker.ts` agora concentra os contratos
tipados para `verificarDomIdsNoOutput`, `verificarSecoesPreenchidas` e
`SECOES_MOBILIA_ESPERADAS`. O `.js` CommonJS permanece no mesmo caminho
e as exportações existentes do barrel `compilerEngine/index.js` não mudam.

Regras preservadas: match textual de `id='...'` ou `id="..."`
(inclusive o comportamento legado com comentários e CDATA), emissão
de um erro para cada domId ausente na ordem das peças do dossiê,
precedência do conjunto de seções por nicho sobre o chassis, `[]`
explícito para nichos sem mobília genérica e retorno `{ok,erros}`.

O teste novo cobre 256 combinações de IDs, seções vazias/presentes,
prioridades e fallbacks de nichos, além de compilações reais.

**Limitações preservadas:** a checagem de `domIds` continua textual
e pode encontrar uma referência dentro de comentário/CDATA; seções
não encontradas no XML não provocam erro. Alterar isso requer uma
fase independente com golden tests e contrato funcional aprovado.

Inventário atualizado: **26 fontes TypeScript espelhadas** e
**41 módulos JavaScript legados** no núcleo.

## Etapa 24 — contratos de entrada dos dossiês em TypeScript

`compilerEngine/dossieValidator.ts` passa a ser a fonte autoritativa
de `validarDossie`, com `dossieValidator.js` CommonJS no caminho
original. A taxonomia de chassis e pageType, a ordem de erros e
avisos, os tokens `light_mode/dark_mode`, IDs únicos e os tipos
`hero|widget|modulo|secao` mantêm a semântica anterior.

Uma peça que introduza HTML próprio ou `widgetNativo` continua
obrigada a declarar `domIds`; um módulo só de CSS pode omiti-los.

Limitações legadas preservadas: `dark_mode:null` pode lançar
TypeError em `Object.keys(null)` e avisos sobre domIds sem HTML
mencionam CSS/JS mesmo quando estão presentes. Corrigir tais
comportamentos exige etapa funcional independente.

Os testes de paridade fixam mensagens completas, sua ordem,
combinações de entradas inválidas e dossiês reais carregados.
Inventário: 27 fontes TypeScript espelhadas, 40 módulos JS legados.

## Etapa 25 — carregador de dossiês em TypeScript

`compilerEngine/dossieLoader.ts` agora é a fonte autoritativa de
`parsearDossie`, `carregarNichoDossie` e `limparCache`, com o
espelho `.js` CommonJS no mesmo caminho para todos os consumidores.

O cache por nicho mantém a remoção de um prefixo `tema-` e os
resultados positivos e negativos. O retorno `null` é reservado a
ausência de arquivo (além de entradas vazias/não-string), enquanto
JSON corrompido e contrato inválido interrompem a compilação com
mensagem `[DOSSIE]`, sem serem armazenados no cache.

O parser faz apenas a checagem estrutural antiga (nicho, array
`pecas` e `tokensCss` como objeto); a validação canônica continua
separada em `dossieValidator`. Testes de paridade exercitam leitura
real, cache, alias, falhas, recuperação e limpeza do cache.

Inventário: 28 fontes TypeScript espelhadas e 39 arquivos JS legados
no núcleo. Nenhuma alteração intencional na geração de XML.

## Etapa 26 — paletas por nicho em TypeScript

Fonte autoritativa `src/core/compilerEngine/nichoPaletas.ts`, com
espelho CommonJS `nichoPaletas.js` **gerado pelo compilador** e
verificado byte a byte por `npm run typecheck`.

A tabela original de cinco paletas de `pop-retro-pixel`, seus
três tokens CSS fixos e a seleção determinística por
`hashSeed((seed || '') + ':paleta')` não mudam. Valores desconhecidos
continuam retornando CSS vazio; não há normalização `tema-` neste
módulo. A API pública preserva `gerarPaletaCss` e `PALETAS`.

`nichoPaletasParity.test.js` verifica CSS completo com exemplos
fixos, seeds numéricas e Unicode e mais 320 seeds combinatórias.
A suíte anterior `nichoPaletas.test.js` permanece. A fidelidade
XML e visual Blogger é conferida em uma pipeline independente.

Inventário: 29 fontes TS espelhadas e 38 JS legados em `src/core`.

## Atualização 2026-10-24 — diagnóstico estático tipado

Migrados `src/core/diagnostico/score.ts`, `acessibilidadeChecker.ts` e
`responsividadeChecker.ts` como fontes autoritativas, com espelhos CommonJS
versionados nos caminhos originais. `src/contracts/diagnostico.ts` descreve
os achados, categorias e score; o typecheck cobre as assinaturas dos três
módulos e a auditoria exige a sincronização dos espelhos.

Preservadas as penalidades de erro (15) e aviso (4), limite do score 0–100,
heurísticas de alt, lang, aria-label, viewport e media queries, mensagens e
ordem dos achados. Os testes legados permanecem; teste adicional valida
saídas e as exportações CommonJS. `seoChecker.js` e `diagnostico/index.js`
continuam JavaScript e são candidatos à próxima etapa.

Inventário do escopo `src/core` + `src/ai`: 54 módulos com fonte TS e
19 módulos JavaScript ainda sem fonte TypeScript (excluindo testes).

## Etapa 28 — agregador de diagnóstico Blogger em TypeScript

`src/core/diagnostico/index.ts` agora é a fonte tipada de
`gerarDiagnostico`, com `index.js` como espelho CommonJS.
O contrato `DiagnosticoResultado` cobre score, categorias ordenadas,
reparos e XML opcional. A função permanece responsável por juntar
as seis categorias (XML, estrutura, semântica Blogger, SEO,
acessibilidade e responsividade) e encaminhar o mesmo XML a
`repararXml`, sem alterar o algoritmo legado.
O `seoChecker.js` ainda é JavaScript e será migrado em etapa posterior.

A migração preserva as mensagens, ordem e os reparos, inclusive
a condição `total > 0` para devolver o XML corrigido. O
`npm run typecheck` valida contratos, registro e igualdade
do espelho, enquanto a suite `src/core/diagnostico/index.test.js`
verifica a integração com compilação real.

## Etapa 29 — auditoria SEO em TypeScript

`src/core/diagnostico/seoChecker.ts` é a fonte autoritativa de `checarSeo`, com
`seoChecker.js` CommonJS mantido no caminho original. A migração preserva
heurísticas de título, descrição, canonical, H1 por includable/gate de view
e JSON-LD com placeholders Blogger, mensagens e ordem de achados.
Os testes de SEO e do diagnóstico completo permanecem nas regressões.

## Etapa 30 — parser EJS em TypeScript

`src/core/parser/ejsParser.ts` passa a ser fonte tipada autoritativa de
`parseEjs` e `analisarEjs`, espelhada em `ejsParser.js` para CommonJS.
A validação continua a usar `ejs.compile` sem executar o template;
`includesReferenciados` continua limitado aos primeiros 30 caminhos,
com mesmo tratamento de entrada vazia e erros do compilador.
`EjsParseResult` e `EjsAnalysisResult` são uniões discriminadas,
verificadas por `src/contracts/ejsParser.typecheck.ts`.
O teste de regressão EJS foi adicionado também ao gate TypeScript,
independente da auditoria visual Blogger.

O bloqueio de `test:quality` pela exclusão da pasta `exemplos/`
permanece separado, sem silenciar os testes nem restaurar os exemplos.

## Etapa 31 — parser PHP em TypeScript

`src/core/parser/phpParser.ts` passa a ser fonte estrita de `parsePhp` e
`analisarPhp`, com mirror CommonJS `phpParser.js`. O motor `php-parser`
continua validando sintaxe sem executar o PHP. Preservados `arquivo.php`,
linha/coluna do erro e as duas listas de declarações de até 30 nomes.
Contratos e teste `phpParser.test.js` passam pelo Gate TypeScript independente.
A AST é modelada apenas pelos campos consumidos pelo analisador;
não se promete verificação semântica PHP.

## Etapa 32 — parser CSS (PostCSS) tipado

`src/core/parser/cssParser.ts` passa a ser a fonte de `parseCss` e
`analisarCss`, com `cssParser.js` CommonJS preservando a API.
Os contratos discriminam entrada inválida, AST `Root`, erro com
linha/coluna e relatórios de seletores, declarações e `var()` órfãs.
A análise continua suportando `tokensExternos`, regras aninhadas e
limitação de 30 resultados, sem alterar heurísticas ou dependências.
O teste funcional `cssParser.test.js` foi incluído no Gate TypeScript.

## Etapa 33 — parser HTML5 (parse5) tipado

`src/core/parser/htmlParser.ts` vira fonte de `parseHtml` e
`analisarHtml`; `htmlParser.js` permanece como espelho CommonJS.
Os contratos tipam os nós e atributos percorridos, avisos reais de parse,
contagem de tags e IDs duplicados. Continua usando `parseFragment` e
a recuperação normal de erros permitida pela especificação HTML5.
Os achados seguem com limite de 30 entradas. O teste
`htmlParser.test.js` passa a fazer parte do Gate TypeScript.

## Etapa 34 — parser XML genérico em TypeScript

`src/core/parser/xmlParser.ts` vira a fonte estritamente tipada de
`parseXml` e `analisarXml`, mantendo o espelho CommonJS e a API.
A árvore continua produzida por `fast-xml-parser`, com validação de
sintaxe anterior ao parse, limites de 30 IDs duplicados e relatório de
tags sem pretender inspecionar regras Blogger. O contrato e o teste
`xmlParser.test.js` são executados pelo Gate TypeScript.

## Etapa 35 — parser JavaScript (Acorn) em TypeScript

`src/core/parser/jsParser.ts` torna-se a fonte estrita de `parseJs` e
`analisarJs`, preservando `jsParser.js` como espelho CommonJS.
O relatório mantém contagem de funções/variáveis, identificadores
potencialmente não declarados em escopo achatado (conservador),
tratamento de destructuring, globais conhecidas e chamadas `console.*`.
Os contratos tipam os nós utilizados na AST e o resultado discriminado;
o teste `jsParser.test.js` foi integrado ao Gate TypeScript.

## Etapa 36 — telemetria em TypeScript

`src/core/telemetria.ts` passa a ser fonte autoritativa do registro
Firestore de compilações, agregador puro e consulta sob demanda. O
`telemetria.js` permanece espelho CommonJS, preservando a escrita
assíncrona sem await, o teto de 5000 leituras e o resumo dos eventos.
`src/contracts/telemetria.typecheck.ts` exercita os tipos de evento,
resumo e consulta; `src/core/telemetria.test.js` agora faz parte do
Gate TypeScript. Não muda a estrutura da coleção existente.

## Etapa 37 — design voice presets em TypeScript

`src/core/designVoicePresets.ts` torna-se a fonte dos arquétipos CSS,
do mapa nicho→voz e das pistas por `colorPreset`, com contratos
`Record<string,string>` e `gerarDesignVoiceCss` tipada.
O espelho `designVoicePresets.js` continua CommonJS, sem modificar
as regras CSS existentes nem as associações de nichos. O teste
`designVoicePresets.test.js` valida os mapeamentos e o contrato de
retorno e roda no Gate TypeScript.

## Etapas 38–39 — defaults de nicho e catálogo de presets

As fontes autoritativas `src/core/nichoModuleDefaults.ts` e
`src/core/presets.ts` tipam os módulos-padrão por nicho e os
catálogos de cores, botões e tipografia sem mudar os valores atuais.
Os espelhos `.js` continuam CommonJS para os consumidores legados.
Foram adicionados contratos compilados e testes de regressão para o
comportamento das APIs, incluindo fallback de nicho desconhecido,
mapeamentos já existentes e a integridade dos 50 presets cromáticos.

## Etapas 40–41 — validação de snippets e redação de esqueletos

`src/core/codeValidator.ts` fornece validação tipada para XML, CSS e JS
sem execução dos snippets, além de extração/validação de blocos Markdown.
`src/core/skeletonRedactor.ts` redige URLs reais e sinaliza settings
suspeitos sem remover configurações automaticamente. Os dois módulos
mantêm espelhos `.js` CommonJS para os consumidores existentes.
Contratos e testes determinísticos foram incluídos no Gate TypeScript.

## Etapa 42 — busca de conhecimento técnico do Solaris em TypeScript

`src/ai/solConhecimentoTecnico.ts` tipa o índice técnico e os resultados
da busca externa do Solaris, mantendo o matching existente e o limite de
3 referências de 40 KB cada. O espelho CommonJS continua compatível
com `solAgent.js`. O teste existente `solConhecimentoTecnico.test.js`
passa a fazer parte do Gate TypeScript.

## Etapa 43 — validação XML Blogger com TypeScript

`src/core/xmlValidator.ts` é a fonte tipada da validação bloqueadora,
estrutural e semântica do XML Blogger; cada API preserva seus retornos
`string[]` e `{ erros, avisos }`. A análise por árvore `preserveOrder`,
a verificação de entidades, comentários, includes, widgets e settings
continuam com as mesmas regras do código existente. O espelho JavaScript
continua CommonJS, validado byte a byte pelo Gate TypeScript, que
passa a executar também `xmlValidator.test.js`.

## Etapa 44 — extrator de templates Blogger em TypeScript

`src/core/templateExtractor.ts` tipa a extração de tokens CSS,
hero, seções, widgets, scripts e peças granulares de templates XML.
O contrato público `ExtractedTemplate` descreve o resultado completo
(incluindo `config`, `pecas` e `_meta`), mantendo o formato já
consumido pelo compilador. O JavaScript CommonJS espelhado permanece
carregável sem TypeScript em runtime; o teste
`templateExtractor.test.js` entra no Gate TypeScript.

## Etapa 45 — catálogo de módulos visuais em TypeScript

`src/core/modules.ts` tipa as opções de módulos injetáveis e o mapa
`placeholder → snippet` sem alterar os trechos literais de XML, CSS e
JavaScript usados pelo Blogger. O arquivo `modules.js` permanece espelho
CommonJS de produção; as variantes de dark mode, paginação, cookie banner,
back-to-top e widgets preservam escolha determinística por seed. Contrato
de import e suíte `src/core/modules.test.js` incluídos no Gate TypeScript.

## Etapa 46 — agente principal Solaris em TypeScript

`src/ai/solAgent.ts` tipa mensagens, eventos de progresso,
opções do chat, orçamento de tokens, resultados de buscas locais,
status dos nichos e adaptador para a API Gemini. As ferramentas
continuam **somente leitura**, com a mesma proteção contra acesso a
arquivos sensíveis, limitação de chamadas e consulta de telemetria.
O contrato `solAgent.typecheck.ts` exercita a API; o Gate TypeScript
executa `solAgent.test.js`, incluindo testes de segurança de caminhos.
O arquivo `solAgent.js` segue como espelho CommonJS do módulo tipado.
 
## Etapa 47 — base RAG Solaris em TypeScript

O inventário de TypeScript e CommonJS passa a cobrir também `src/solaris`,
com teste específico para fontes sem registro e espelhos ausentes.
Quatro utilitários determinísticos de RAG passam a ter fontes TypeScript:
`ragChunker` (máximo de 250 palavras por padrão), `ragEntryText`
(texto estável para embeddings), `ragTopicMatrix` (matriz curada de
assuntos) e `ragDeduplicator` (Jaccard e revisão de similaridade).
Mantidos os módulos `.js` em runtime e as quatro suítes de regressão
no Gate TypeScript. Nenhum endpoint, banco ou modelo é alterado.

## Etapa 48 — busca semântica e contexto RAG Solaris tipados

Fontes autoritativas TypeScript para `ragVectorStore` (interface estrutural
Firestore testável por fake), `ragSearchService` (geração de query embedding,
limite topK=20 e exclusão de entradas descontinuadas) e
`ragPromptContext` (limpeza e limite de referências não confiáveis).
Espelhos CommonJS garantem funcionamento no runtime Node. Três
contratos e suítes de regressão incluídos no Gate TypeScript; a
integração real com índice vetorial Firestore não foi alterada.

## Etapa 49 — cliente HTTP de embeddings do Solaris em TypeScript

`src/solaris/rag/ragEmbeddingsClient.ts` tipa os contratos do serviço
Python, fetch e respostas HTTP, cabeçalhos de autenticação, task types,
retries e injeção de dependências. São preservados os limites de 20
textos por requisição, três tentativas para falhas transitórias, falha
imediata em HTTP 4xx, autenticação IAM e segredo opcional. A fonte `.ts`
continua produzindo espelho CommonJS `.js` para o Node de produção.
`ragEmbeddingsClient.test.js` foi adicionado ao Gate TypeScript,
inclusive cenários sem acesso real ao serviço.

## Etapa 50 — geração e leitura do catálogo RAG Solaris

`ragEntryGenerator.ts` declara os contratos do router de triagem Gemini, do
schema de saída estruturada e da entrada gerada por tópico, preservando
a fixação determinística de `id` e `slug`. `ragCatalogLoader.ts` tipa
a leitura e cache do catálogo JSON e seu ranking por palavras-chave;
continua somente leitura e tolerante a arquivos inválidos. Ambos
mantêm os espelhos CommonJS e suas suítes preexistentes no Gate.

## Etapa 51 — workers de organização e triagem RAG

`ragOrganizerWorker.ts` tipa a classificação por campos estruturados e o relatório de organização. O modo padrão continua dry-run; apenas `aplicar:true` permite mover arquivos, respeitando a proibição de sobrescrita.
`ragDraftWorker.ts` tipa a triagem de rascunhos e seu resumo, permanecendo exclusivamente de leitura, sem promover rascunhos automaticamente. Espelhos CommonJS continuam no runtime e as duas suítes de regressão entraram no Gate TypeScript.

## Etapa 52 — auditoria e normalização do catálogo RAG em TypeScript

`src/solaris/workers/ragKebabWorker.ts` é a fonte tipada das regras
determinísticas de nomenclatura kebab-case, enumeração de JSON (até um nível
de grupo), normalização opcional, auditoria de IDs duplicados, campos
recomendados e validação rigorosa de entradas geradas. A varredura ignora
`drafts/` e arquivos não JSON; nunca altera conteúdo do catálogo e só
renomeia arquivos em modo explícito `aplicar: true`. O espelho CommonJS
continua em produção e os testes de regressão entram no Gate TypeScript.

## Etapa 53 — adaptadores de validação HTML/CSS/JavaScript do Solaris

`htmlWorker.ts`, `cssWorker.ts` e `jsWorker.ts` tipam os relatórios
`{ ok, erros, avisos, analise? }` e resultados dos parsers de núcleo,
sem refazer parsing ou alterar a semântica de avisos (IDs duplicados,
variáveis CSS órfãs e console logs). Os três espelhos CommonJS são
sincronizados pelo TypeScript, e suas suítes específicas são executadas
pelo Gate TypeScript.

## Etapa 54 — validação JSON, PHP, Python e EJS no Solaris

Fontes TypeScript para `jsonWorker`, `phpWorker`, `pythonWorker` e
`ejsWorker`, mantendo o contrato de resposta `{ ok, erros, avisos, analise? }`.
O PHP reutiliza o parser local; EJS preserva os avisos de includes; JSON
usa o parser nativo. Python preserva a validação exclusiva por `ast.parse`
(via stdin, sem execução do código do usuário), teto de 200 kB, timeout
de 5 segundos e fallback explícito se `python3` estiver indisponível.
Espelhos CommonJS e regressões das quatro linguagens incluídos no Gate.

## Etapa 55 — detecção, inspeção e memória do projeto Solaris

`frameworkDetector.ts` tipa evidências estruturais por arquivo e classificação
com pontuação e desempate sem IA. `projectInspector.ts` tipa o router do
Gemini e as três ferramentas somente leitura, preservando confinamento ao
projeto e limite de 60 KB por leitura. `projectMemory.ts` tipa o cabeçalho
`solaris.md` e o registro incremental exclusivamente de mudanças confirmadas.
Os três módulos possuem espelhos CommonJS e regressões integradas ao Gate.

## Etapa 56 — manifesto de geração Solaris em TypeScript

`src/solaris/manifest/manifestSchema.ts` torna-se a fonte tipada autoritativa
do contrato Brainstorm → Orquestrador → Workers. Frameworks, tipos de arquivos,
assets do Forge, caminhos, descrição e campos opcionais têm contratos explícitos,
com retorno discriminado (sucesso com manifesto; falha com `manifesto: null`).
O schema para a API Gemini e a validação determinística de dados não confiáveis
preservam seu comportamento e mensagens. O espelho CommonJS é verificado
pelo Gate TypeScript, que inclui o teste do manifesto e seu contrato de tipos.
Nenhuma alteração de rotas, persistência, geração de assets ou cobrança.

## Etapa 57 — editor de projetos Solaris em TypeScript

Fonte TypeScript autoritativa para `projectEditor`, incluindo contratos de propostas, estado, validação, persistência e geração de assets. O JavaScript de runtime continua CommonJS, espelhado pelo TypeScript 5.9.3. O gate verifica os tipos e os testes preexistentes.

## Etapa 56 — arquivos, sandbox ZIP e persistência Solaris

`fileTools.ts` tipa o confinamento dos caminhos a um diretório-base,
leitura de texto sem binários, escrita em bytes, busca literal e geração ZIP.
`archiveExtractClient.ts` mantém a extração exclusivamente no sandbox,
com limites de upload e falhas explícitas.
`projectStorage.ts` tipa os contratos de bucket GCS, rastreamento Firestore,
cota, carregamento binário e TTL de 30 dias.
As três suítes existentes entram no Gate; o teste da persistência cobre
apenas a função TTL pura e exports, não acessa GCS/Firestore reais.

## Etapa 58 — gatilho de geração e interface Asset Forge em TypeScript

`solarisGenerationTrigger.ts` tipa a extração do marcador
`[[SOLARIS_GERAR:{...}]]` sem executá-lo, além da limpeza de marcador
truncado no streaming. `assetForge.ts` oferece um adaptador tipado para
o catálogo, validação de IDs e tarefas e funções de consulta às receitas
procedurais A7 Forge. A implementação e allowlist de recipes continuam no
`agent/forge/index.cjs`, sem habilitar shell, Python ou providers remotos.
Os espelhos CommonJS permanecem no runtime; os testes de marcador e Asset
Forge (inclusive integração com geração de projeto) entram no Gate.

## Etapa 58 — orquestrador Solaris em TypeScript

`src/solaris/pipeline/orchestrator.ts` tipa o fluxo granular
manifesto → worker por linguagem → geração de arquivo → persistência → ZIP.
Contratos incluem o retorno discriminado do manifesto, o adaptador de
arquitetura do modelo, contexto RAG, assets Forge, resultados de diagnóstico,
relatórios por arquivo e a resposta completa do projeto. O JavaScript CommonJS
permanece como espelho do TypeScript 5.9.3 para Node em produção.

Sem mudança de prompts, ordem das chamadas ao modelo, regras de validação
ou critério de entrega do ZIP. O Gate TypeScript executa os testes de
regressão existentes do orquestrador além do contrato compilado.

## Etapa 59 — roteador de modelos Solaris em TypeScript

`src/solaris/llm/modelRouter.ts` é a fonte autoritativa para as chamadas
Gemini Flash/Pro. Define contratos do cliente injetável, configuração,
respostas e metadados de tokens, streaming assíncrono e chamadas de
ferramentas com progresso e retorno. Preserva os modelos configuráveis
por variáveis de ambiente, temperaturas (0.2, 2.0, 0.7 e 0.4),
limite de saída, thinking opcional, execução paralela de ferramentas
e retorno explícito após maxToolCalls. O runtime Node continua com o
espelho CommonJS gerado pelo TypeScript 5.9.3.
Testes existentes do modelRouter agora integram o Gate TypeScript.

## Etapa 59 — prompt de sistema Solaris como fonte TypeScript

`src/solaris/prompts/systemPrompt.ts` é a fonte tipada autoritativa da
instrução do Solaris Code; `systemPrompt.js` continua um espelho CommonJS
para o chat de produção. O texto completo e a interpolação da lista de
frameworks válidos permanecem idênticos, sem alterar o gatilho de geração,
as regras do Asset Forge ou o comportamento de escopo.

O teste `src/solaris/prompts/systemPrompt.test.js` fixa o fingerprint
UTF-16 FNV-1a do prompt efetivo e verifica a dependência do manifesto,
o marcador de geração e os limites declarados do Forge. Mudanças
intencionais de comportamento do prompt devem atualizar esse golden test
em revisão separada. O Gate TypeScript também audita a fonte e seu espelho.

## Etapa 60 — entrada conversacional Solaris em TypeScript

`src/solaris/chat/solarisChat.ts` tipa as mensagens de histórico,
o roteador de triagem Flash, o gerador de streaming, a referência
de tokens e o callback de recuperação RAG. Preserva a concatenação
de contexto, a decisão por palavra-chave do catálogo e do Forge,
o atalho para não consultar embeddings em conversas não técnicas e
as instruções de sistema. A fonte gera o CommonJS carregado pelo
backend; os testes `solarisChat.test.js` passam a integrar o Gate.

## Etapa 61 — geração dos arquivos public/vendor/ em TypeScript

A pasta `public/vendor/` permanece gerada por `postinstall`, fora do Git e
dos fontes TypeScript: Bootstrap CSS/JS e Chart.js são dependências terceiras
copiadas a partir dos pacotes npm. Não são reescritos como código próprio.

`scripts/vendorAssets.ts` passa a ser a fonte TypeScript autoritativa do
copiador e `scripts/vendorAssets.js` continua espelho CommonJS executado
diretamente pelo `postinstall` e copiado nos dois estágios do Dockerfile.
Os três caminhos públicos e a cópia byte a byte foram preservados.
O novo teste `src/core/vendorAssets.test.js` usa diretório temporário,
compara bytes binários e verifica que ausência de fonte falha explicitamente.

A auditoria de TypeScript foi ampliada para cobrir `scripts/`, além de
`src/core`, `src/ai` e `src/solaris`. O campo histórico
`arquivosJavaScriptNoNucleo` mantém seu nome por compatibilidade do JSON,
agora contabilizando também scripts.

## Etapa 61 — fronteira HTTP e protocolo SSE do Solaris em TypeScript

`solarisHttpProtocol.ts` reúne o contrato discriminado para entrada
da mensagem (até 2000 caracteres), identificador de sessão, histórico
(limitado às últimas 10 mensagens válidas) e eventos SSE status/chunk/done/error
com tokens e ZIP. Rejeita tipos inesperados e IDs com caracteres de caminho,
antes de consultar o GCS; mantém os eventos no formato data: JSON + linha vazia.
A rota `src/routes/dashboard_routes/solaris.js` consome esses helpers
nos dois endpoints sem alterar autenticação, crédito, extração em sandbox,
tratamento de falhas nem o fluxo de geração de projetos. Essa etapa tipa
a fronteira HTTP; a rota Express inteira permanece JavaScript nesta rodada,
por conter lógica de persistência e billing que exige migração separada.

Incluído teste do wire format SSE, histórico, validação de entrada e IDs
de sessão, além de contrato de tipos; espelho CommonJS verificado no Gate.

## Etapa 62 — handlers HTTP do Solaris tipados e desacoplados

Os endpoints existentes `/dashboard/solaris/chat/stream` e
`/dashboard/solaris/upload` agora delegam a
`solarisChatHandler.ts` e `solarisUploadHandler.ts`, com interfaces
explícitas para requisição/resposta HTTP, sessões, tokens, propostas
de edição, armazenamento GCS, ZIP, inspeção, geração e cobrança.
Dependências são injetadas a partir do router, permitindo testar handlers
sem acesso ao Gemini, GCS ou Firebase. O router continua proprietário
dos middlewares Express de login, saldo, rate limiting e Multer.

Mantidos nomes de rotas, cabeçalhos/eventos SSE, salvamento,
fallbacks e tempos de vida dos diretórios temporários. O CommonJS
de cada handler é gerado pelo TypeScript 5.9.3 e auditado pelo gate.

## Etapa 62 — gate de integridade para public/vendor

`scripts/vendorAssets.ts` oferece `verificarAssetsVendorizados(root)`
e o modo CLI `node scripts/vendorAssets.js --verify` (ou
`npm run verify:vendor`). A verificacao e somente leitura: confere
os bytes reais de Bootstrap CSS, Bootstrap JS e Chart.js com os
arquivos das dependencias instaladas em `node_modules`, recusando
fontes ausentes, publicacoes ausentes, arquivos vazios e corrupcao,
inclusive quando o tamanho permanece igual.

O Gate TypeScript valida os assets apos `npm ci` e a imagem Docker
frontend executa a mesma verificacao no estagio que contem as
dependencias de desenvolvimento, ANTES de copiar `public/vendor/`
para a imagem de producao. Isso mantem a separacao de estagios e
nao inclui Bootstrap/Chart.js em `node_modules` de producao.
O comportamento padrao do `postinstall` permanece copia.
Testes com diretorio temporario protegem fidelidade binaria e
leitura sem mutacoes.

## Etapa 63 — referencias EJS para assets vendor validadas

`scripts/vendorTemplateRefs.ts` e fonte TypeScript com espelho CommonJS
`scripts/vendorTemplateRefs.js`. O comando `npm run verify:vendor:templates`
percorre recursivamente `views/**/*.ejs`, coleta `href` e `src`
que comecam com `/vendor/` (inclusive com `?v=<%= gitSha %>`),
desconsidera comentarios HTML e EJS e compara o caminho com o
manifesto `ASSETS` de `scripts/vendorAssets`.

Qualquer link desconhecido, arquivo ausente/vazio, pasta views ausente,
ausencia de templates ou ausencia total de referencias faz o gate falhar,
mostrando o EJS e o caminho com erro. O script nao modifica arquivos
nem avalia EJS. Os testes exercitam casos reais e falhas.

O Gate TypeScript valida os links apos o `postinstall`; o Docker valida
novamente DEPOIS da copia de `public/vendor` ao stage final, onde
`views/` esta disponivel. Mantem a cadeia de integridade sem carregar
as dependencias dev na imagem final.

## Etapa 63 — uso de tokens e falhas nos handlers HTTP Solaris

`solarisBilling.ts` normaliza relatórios de uso recebidos do Gemini,
editor e inspetor: valores diferentes de inteiros não negativos finitos
não chegam a `debitarCreditos`. O fallback de caracteres do chat e as
estimativas de geração Pro permanecem iguais para contagens válidas.
Sem uso válido na inspeção do upload não se faz cobrança com valores
incorretos. A política de conversão de tokens em créditos em
`creditService.js` não foi modificada.

O chat valida o formato de propostas pendentes vindas da sessão do
GCS antes de entregar ao editor. O upload tipa o roteador como
`InspectionModelRouter`, sem conversões inseguras `as number`.
Novos testes injetados cobrem falhas de GCS, armazenamento de sessão,
débito, respostas SSE, fallback de projetos e tokens inválidos.

## Etapa 64 — substituição segura de projetos anexados no GCS

A substituição deixa de executar `apagarProjeto` antes de salvar a nova versão, tanto no upload quanto na edição do Solaris. `projectStorage.ts` agora grava os arquivos em `versions/<UUID>/files/`, confirma a contabilização dos bytes e só então publica o manifesto da sessão (`manifesto.json`). Leitores existentes continuam aceitando projetos legados sem `versao`, através de `files/`.

Se a criação falhar antes de publicar o manifesto, os objetos incompletos são removidos e o tracking/cota são restaurados na medida em que o armazenamento permite; o manifesto antigo não é alterado. Após a publicação, apenas a versão anterior é apagada; se sua limpeza falhar, a cota dessa versão continua contabilizada em `activeTamanhoBytes` e `tamanhoBytes` até a limpeza ou expiração. Falhas na exclusão não permitem liberar cota nem remover o documento de tracking.

Testes isolados com GCS/Firestore/cotas simulados exercitam troca bem-sucedida, versões legadas, falhas de gravação e publicação, limpeza pendente e exclusão sem perda de dados.

## Etapa 64 — politica de cache vendor e smoke HTTP

O servidor usava Cache-Control: max-age=1y, immutable para TODO o
public/, mas Bootstrap e Chart.js sao publicados em caminhos fixos
(/vendor/bootstrap/... e /vendor/chart.js/...), ao contrario dos chunks
React que tem hash no nome. Uma atualizacao npm podia ficar invisivel
para navegadores/proxies que reutilizam recursos estaticos antigos.

scripts/vendorCachePolicy.ts (espelho CommonJS .js) centraliza o
setHeaders do express.static: recursos sob /vendor/ e o entrypoint
/dist/assets/main.js nao sao armazenados (no-store, max-age=0);
outros chunks estaticos continuam com o cache longo anterior.
Nenhuma dependencia remota, variavel de ambiente ou endpoint muda.

src/core/vendorStaticPolicy.test.js inicia um Express isolado,
faz requisicoes HTTP GET/HEAD com e sem querystring de deploy,
confere status 200, bytes, MIME, Cache-Control, ETag, 404 e preservacao
do cache dos chunks com hash. O teste entra no npm test, no Gate
TypeScript e no build da imagem Docker de producao.

## Etapa 65 — verificacao de identidade visual em TypeScript

`scripts/check-frontend-branding.ts` substitui a fonte JS original do gate
pre-deploy, mantendo `scripts/check-frontend-branding.js` como espelho CommonJS.
A auditoria exporta `auditarBranding(root)` com retorno tipado, sem varrer
arquivos ao importar. A execucao CLI original permanece em `node
scripts/check-frontend-branding.js`, com codigo de saida nao-zero para
referencias proibidas.

O contrato preserva diretorios e extensoes varridos, deteccao de nomes
antigos, excecao para JS interno da RAG, e numero de linha das violacoes.
`src/core/brandingMigration.test.js` usa fixtures temporarias e verifica
sucesso, falhas na UI, bundle, JSON RAG e estabilidade em invocacoes repetidas.
A nova fonte participa do `tsc`, registro de espelhos e Gate TypeScript.

## Etapa 66 — CLIs de compilação em lote e extração de XML tipadas

`scripts/compile-batch.ts` passa a ser a fonte TypeScript autoritativa de
`scripts/compile-batch.js`; `scripts/extractTemplate.ts` faz o mesmo com
`scripts/extractTemplate.js`. Ambos mantêm os espelhos CommonJS gerados e os
quatro comandos npm anteriores (compile:batch, compile:batch:pkg, extract,
extract:all), sem mexer no compilador nem no extrator subjacentes.

Interfaces explicitam parâmetros, XML final, arrays de sucesso e erro por
arquivo, metadados de extração e dependências Node. Os manifestos JSON são
tratados como `unknown` antes de passar pelo compilador existente; o lote
prossegue após falhas por arquivo e retorna status não-zero no CLI quando
algum manifesto/XML falha, conforme os contratos originais.

Além de gerar espelhos verificados e registrar fontes no tsconfig/auditoria,
o Gate TypeScript passa a executar os testes reais já existentes em
`scripts/compile-batch.test.js` e `scripts/extractTemplate.test.js`,
que utilizam diretórios temporários. O TypeScript estrito e smoke isolado
de ambos os CLIs passaram antes do commit; CI completa depende do Actions.

## Etapa 67 — executor de testes e auditoria da migração em TypeScript

`scripts/runTests.ts` e `scripts/audit-typescript-migration.ts` são
as novas fontes tipadas. Os espelhos `.js` permanecem CommonJS e são
verificados pelo `npm run typecheck` (TypeScript 5.9.3). O `npm test`
mantém um processo Node por teste e exit status agregado, enquanto
`npm run audit:typescript` continua verificando os arquivos TS, espelhos,
registro e opções de compilação.

O executor não executa toda a suíte ao ser importado: agora só inicia
quando invocado diretamente, permitindo o teste isolado de
`encontrarTestes` em `src/core/testRunnerDiscovery.test.js`.
A auditoria preserva seu contrato `auditarMigracao(root)`, incluindo
erros por ausência de fontes, registros duplicados e espelhos faltantes.
O teste de regressão existente
`src/core/typescriptMigrationAudit.test.js` permanece ativo.

As duas fontes entram em `tsconfig.json` e
`scripts/typescript-mirror-sources.json`, com gatilhos específicos no
Gate TypeScript. Nenhuma mudança de dependências ou rotas HTTP.

## Etapa 67 — proteção da retenção de projetos Solaris

A rotina TypeScript `projectStorage.ts` agora recusa prazos TTL inválidos
(zero, negativos, fracionários e não finitos) **antes** de consultar Firestore.
O padrão de 30 dias permanece. Identificadores de projetos são validados
antes de excluir objetos do GCS. Durante a varredura, um documento vencido
cujo ID difere de `uid_sessionId` não pode apagar arquivos de outra sessão;
a inconsistência é anotada em `erros` e a limpeza continua.

`projectStorage.transaction.test.js` testa a rotina com bucket, rastreamento
e contabilização falsos: retenção válida, TTL inválido, metadados adulterados,
exclusão direta insegura e falha individual de GCS. Nenhum teste acessa
credenciais, Firestore ou GCS de produção. Os espelhos JS CommonJS
continuam derivados da fonte TS e verificados pelo gate.

## Etapa 68 — exclusão mútua distribuída para gravação e exclusão Solaris

`salvarProjeto` e `apagarProjeto` compartilham um bloqueio exclusivo por
`uid + sessionId` na coleção Firestore `solaris_projetos_bloqueios`.
`DocumentReference.create()` é atômico, inclusive entre processos e
contêineres: uma segunda requisição recebe conflito `SOLARIS_PROJECT_BUSY`
(`status=409`) **antes** de consultar GCS ou debitar cota. O bloqueio é
liberado em `finally`, inclusive após erros. A liberação verifica o
identificador de dono e usa a precondição `lastUpdateTime` quando disponível.
O TTL reutiliza `apagarProjeto` e registra o conflito sem apagar dados.

**Fail closed:** não recuperamos bloqueios órfãos automaticamente. Uma
interrupção abrupta de processo entre `create()` e `finally` pode deixar
a sessão ocupada. A remoção desses documentos exige verificação operacional
prévia de que nenhuma gravação antiga continua ativa. Não configurar TTL
Firestore automático para essa coleção sem implementar fencing para escritores.

Os testes de integração injetam Firestore/GCS falsos e verificam corrida
entre uploads, exclusão, TTL, exceções e indisponibilidade do Firestore.
