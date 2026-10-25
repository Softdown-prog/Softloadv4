# GitHub App por usuário — Solaris Code

## Estado

O botão de Ferramentas > GitHub no Solaris e a autorização OAuth da GitHub App já existiam.
Esta etapa adiciona o gateway de operações **por conta, por repositório**, sem PAT e
sem token compartilhado: `src/services/solarisGithubOperations.js`.
O gateway chama a API REST oficial com o token do usuário, criptografado no Firestore
pelo serviço `solarisGithubApp.js`. Não há configuração de credenciais no browser.

**Importante:** criar o GitHub App no GitHub, configurar a instalação e ligar o
orquestrador de tool-calling do Solaris ao gateway ainda são passos externos/
posteriores. O chat GitHub, nesta etapa, continua exibindo contexto de leitura.
Não dizer ao usuário que um commit ocorreu sem que a operação retorne SHA.

## Configuração administrativa

1. Em https://github.com/settings/apps crie um GitHub App instalável por qualquer conta.
2. Callback OAuth: `https://softload.analysepro.com/dashboard/solaris/github/callback`.
   Não confundir com a URL de instalação do GitHub App.
3. Permissões do repositório: Metadata read; Contents read/write; Pull requests read/write.
   Issues e Workflows não são necessárias nesta fase.
4. Na VPS, defina:
   - `SOLARIS_GITHUB_APP_CLIENT_ID`
   - `SOLARIS_GITHUB_APP_CLIENT_SECRET`
   - `SOLARIS_GITHUB_APP_SLUG`
   - `SOLARIS_GITHUB_ENCRYPTION_KEY` (32 bytes aleatórios em hexadecimal)
5. Configure `BASE_URL=https://softload.analysepro.com` para validação de Origin.
6. Reinicie a aplicação, faça login no Solaris, conecte a conta e instale
   o GitHub App nos repositórios explicitamente escolhidos.

Segredos: nunca fazer commit dessas variáveis. O OAuth existente armazena
tokens de usuário com AES-256-GCM no Firestore. Tokens expiram e hoje exigem
nova autorização; implementação de refresh token é trabalho pendente.

## Contrato HTTP autenticado

`POST /dashboard/solaris/github/action` (sessão Softload exigida e Origin
igual ao BASE_URL). Enviar JSON `{ "action": "...", ... }`.

Operações suportadas:
- `repository_get`: metadados e `canPush` do repositório selecionado.
- `file_read`: `path`, `branch` opcional. Responde conteúdo de texto e `sha`.
- `pull_requests_list`: até 20 PRs abertos.
- `branch_create`: `confirm: true`, `branch: "solaris/minha-tarefa"`,
  `base` opcional.
- `file_commit`: `confirm: true`, `path`, `content`, `message`,
  `branch` opcional; em arquivos existentes exige `expectedSha` retornado
  por `file_read`. Para escrever na branch principal exige ainda
  `allowDefaultBranch: true`.
- `pull_request_create`: `confirm: true`, `head`, `base` opcional,
  `title`, `body` opcional, `draft` opcional.

Os caminhos são relativos à raiz do repositório vinculado; não existe
parâmetro para trocar de conta ou de repositório em uma chamada. Arquivos de
workflows e possíveis chaves/segredos não são alteráveis por este gateway.
A API aplica limites de 96 KiB para conteúdo de arquivo e tempo de 15 s por
requisição externa. GitHub pode recusar cada operação conforme as permissões.

Exemplo de leitura (mesmo navegador autenticado):
```js
await fetch('/dashboard/solaris/github/action', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ action: 'file_read', path: 'README.md' })
}).then(r => r.json());
```

## Pendências para o agente / Codex

- Integrar estas ferramentas ao loop de tool-calling do Solaris/agent com
  autenticação por usuário, catálogo de ações e confirmação humana de writes.
  **Não** reutilizar `GITHUB_TOKEN` da VPS nem `MCP_SERVERS_JSON` global
  para solicitações de clientes diferentes.
- Se optar pelo GitHub MCP Server oficial, fornecer tokens por sessão no
  transporte MCP e escopo por usuário/instalação; evitar credenciais estáticas
  comuns a todos os clientes.
- Acrescentar UI para diff/preview, aprovação de proposta e exibição de SHA/PR
  antes de executar commits, sem aceitar `confirm:true` diretamente de texto
  arbitrário produzido pelo modelo.
- Melhorar callback de instalação e inventário de repositórios autorizados
  com paginação; exigir permissão de gravação para cada ação.
- Implementar refresh/revogação OAuth, expiração de registros no Firestore,
  testes HTTP autenticados e E2E com GitHub App real (ambiente de teste).
- Adicionar suporte a commits atômicos de múltiplos arquivos, tratamento
  de rate limits e reconciliação de conflito de branches.

Execução local dos testes do serviço: `node --test src/services/solarisGithubOperations.test.js`.
