# Softload v4 — Auditoria Angular com SAC da Data Library

**Frontend e backend permanecem na mesma VPS.** O SAC é usado somente em CI
descartável do GitHub Actions, antes do deploy. Nenhum módulo do SAC é
instalado no container comercial ou no worker compartilhado da VPS.

## Fonte independente e imutável

O workflow baixa a revisão pública `97d5ae71844b56cfb073b5202c2f32398e9d532a`
de `Softdown-prog/Data_libray`, com `persist-credentials:false`, para
`.sac-tools/`. O runner `scripts/sac-softload-audit.mjs` verifica o SHA local,
enumera somente `frontend/src/` (arquivos regulares limitados) e chama as
implementações reais da biblioteca:

| Regra | Verificação |
| --- | --- |
| SAC-PRE002 | Imports relativos e ciclo de dependências em TS |
| SAC-PRE003 | Estrutura dos metadados e imports de componentes |
| SAC-PRE004 | Ligações de componentes com templates |
| SAC-PRE005 | Parser Angular oficial para templates inline/externos, eventos e bindings |
| SAC-P001 | HTML Angular compilado, host, recursos e modo angular-only |

O SAC é separado do `ng build` AOT oficial e do teste de navegador
`frontend/tests/browser-smoke.mjs`. Os dados de pagamento e XML são simulados
no navegador; o smoke de container exercita o motor XML com três nichos reais,
mas sem credenciais externas. Nenhum teste emite cobrança.

A validação do dist acontece em um diretório temporário: `frontend/dist/softload/browser/`
mais o JS de prévia procedural que o Docker serve em `public/js/`.
Não altera o bundle, os dados de usuários, a VPS ou a versão publicada.

## Estado e interpretação do relatório

O JSON com `schema_version:1` contém `source_sha`, `tool_sha`, escopo,
contagens e códigos fixos. É arquivado por 14 dias em `softload-sac-report`
(PR) e `softload-sac-release` (verificação de deploy).

- **fail**: erro estrutural comprovado, parser Angular com erro, ou
  pós-compilador retornando `fail`/`infra-error`. Bloqueia o pipeline.
- **needs-review**: observação não conclusiva do pós-compilador ou binding
  suspeito; preserva `unverified` e exige revisão contextual. Não é uma
  aprovação e, por si só, não bloqueia testes posteriores de navegador.
- **observed**: regras observacionais sem erro demonstrado e pós-compilador
  estático aprovado **no escopo analisado**; não equivale a aplicação sem bugs.

Todo relatório registra `deployment_authorized:false`, inclusive quando o
CI é verde. A decisão de publicação cabe aos gates de CI/deploy, não ao SAC.

## Primeira auditoria do Softload

Na revisão inicial foram analisados **5 arquivos TypeScript, 12 componentes
e 12 templates inline**. O PRE002 encontrou 6 arestas e nenhum ciclo;
PRE003/004/005 não encontraram falhas estruturais, referências suspeitas ou
erros de parser. Os status dessas três regras permanecem `unverified`.

O P001 registrou `html-resources:unverified` porque o HTML compilado inclui
um script executável inline, que precisa de inspeção runtime; **não tratar essa
condição como falha comprovada nem como certificação estática**.
O teste independente com Chrome em **1366 px** e celular emulado em **390 px**
observou as rotas, prévia, download XML simulado, formulário de aceite,
checkout simulado e páginas legais: **17 verificações, nenhuma exceção JS**
na execução de referência. Isso não é prova de Android físico nem de
pagamento Mercado Pago real.

## Reproduzir em checkout descartável

Execute em um ambiente Node 24 de CI, com a revisão SAC fixada:

```sh
npm --prefix frontend install --no-audit --no-fund
npm --prefix frontend run typecheck
npm --prefix frontend run build
git clone --no-checkout https://github.com/Softdown-prog/Data_libray.git .sac-tools
git -C .sac-tools checkout 97d5ae71844b56cfb073b5202c2f32398e9d532a
npm ci --prefix .sac-tools/packages/angular-postcompiler --ignore-scripts --no-audit --no-fund
SAC_ANGULAR_BUILD_PASSED=true node scripts/sac-softload-audit.mjs
```

Nunca marque `deployment_authorized:true` no relatório do SAC. O One Worker
da VPS **não é invocado aqui**: seu executor Angular isolado exige revisão
rootless, políticas do operador e provas de autorização próprias.
