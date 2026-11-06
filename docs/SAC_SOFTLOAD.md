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

O P001 registrou `html-resources:unverified` porque o HTML otimizado pelo
Beasties (integrado ao build Angular) injeta um **script inline de 163 bytes**
para restaurar o atributo `media` das folhas CSS não críticas. **Remover esse
script só para satisfazer a regra estática quebraria o carregamento de estilos.**
A auditoria aceita exclusivamente esse trecho conhecido ou ausência total de
scripts inline; qualquer código inline inesperado reprova o CI. O resultado
do P001 continua `unverified`, pois a regra não executa JavaScript.

A validação complementar em Chrome verifica que o navegador realmente ativa
as folhas CSS em desktop e celular emulado e que não sobram atributos
`data-beasties-media` pendentes. Não se confunde essa prova de runtime com
um `pass` do P001. O navegador também verifica páginas, prévia, downloads
XML simulados, checkout sem cobrança e a correspondência **SHA-256** de
`index.html`, JS Angular, CSS e código procedural entre o estágio auditado
e o container Docker que entrega a aplicação.

O smoke do container, sem acesso à rede, valida todas as rotas privadas
`/dashboard/*`, as duas páginas `/eu*`, a API de arquivos autenticada
e o acesso público a `/planos`, além de compilar XML de três nichos reais.
O workflow de deploy repete esse smoke **na imagem de release efetiva,
antes de criptografá-la e enviá-la à VPS**.

Resultados históricos verificáveis:
- [CI 42151883568](https://github.com/Softdown-prog/Softloadv4/actions/runs/42151883568):
  18 verificações Chrome e 4 arquivos auditados idênticos aos servidos por Docker.
- [CI 42153281686](https://github.com/Softdown-prog/Softloadv4/actions/runs/42153281686):
  smoke das rotas protegidas da aplicação aprovado.

Esses testes não constituem prova de Android físico nem de pagamento real no
Mercado Pago, não substituem homologação de credenciais e não autorizam deploy.

## Reproduzir em checkout descartável

O Angular utiliza o `frontend/package-lock.json` testado e versionado; tanto o CI quanto a imagem Docker de release executam `npm ci`, não `npm install`. Alterações nas dependências exigem atualização revisada do lockfile e repetição dos gates SAC/Chrome. Execute em um ambiente Node 24 de CI, com a revisão SAC fixada:

```sh
npm --prefix frontend ci --no-audit --no-fund
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
