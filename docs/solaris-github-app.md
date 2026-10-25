# GitHub App do Solaris — ativação no ambiente

O menu **Ferramentas > GitHub** usa uma GitHub App **do produto Softload**, nunca a
conexão GitHub individual de quem desenvolve o produto. Cada cliente da Softload
autoriza a própria conta, escolhe os repositórios aos quais conceder acesso e
pode desconectar a integração na interface.

## Cadastro da App

1. Nas configurações de desenvolvedor do GitHub, criar uma **GitHub App** da Softload.
2. URL de callback do OAuth (autorização do usuário):
   `https://softload.analysepro.com/dashboard/solaris/github/callback`.
3. Setup URL (após instalação): `https://softload.analysepro.com/dashboard/solaris`.
4. Repository permissions: **Metadata: read**, **Contents: read**.
   Não conceder Write antes de implementar operações com confirmação.
5. Habilitar autorização de usuário e, se disponível, tokens de usuário expiráveis.
6. Configurar na VPS (não no repositório, nem no frontend):
   - `SOLARIS_GITHUB_APP_CLIENT_ID` — client ID da GitHub App.
   - `SOLARIS_GITHUB_APP_CLIENT_SECRET` — segredo da GitHub App.
   - `SOLARIS_GITHUB_APP_SLUG` — slug público da App para instalação no GitHub.
   - `SOLARIS_GITHUB_ENCRYPTION_KEY` — chave **64 caracteres hexadecimais**
     gerada aleatoriamente (ex.: `openssl rand -hex 32`), mantida em secret store.
   - `BASE_URL=https://softload.analysepro.com` — usado para validar origem dos POST/DELETE.
7. Reiniciar somente a aplicação pelo deploy controlado; validar
   `GET /dashboard/solaris/github/status` autenticado:
   `configured: true`. **Nunca expor o client secret ou a chave.**

## Fluxo no chat

- **Criar Assets 2D** ativa as receitas já importadas do A7 Forge 2D. Quando
  o Gemini solicita execução pelo marcador de geração, o orquestrador valida,
  renderiza e disponibiliza os arquivos ZIP como já ocorre nos projetos Solaris.
- **GitHub** permite colocar um link `https://github.com/dono/repo`.
  Repositório público: a primeira mensagem pode ler nome, descrição, branch,
  lista limitada da raiz e README, mesmo sem login.
- Conta GitHub conectada: **Conectar GitHub** inicia OAuth por usuário;
  **Autorizar repositórios no GitHub** permite instalar a App no repositório
  desejado; **Vincular repositório** confirma que a API autorizou seu acesso.
  A seleção fica associada à identidade autenticada no Firestore.
- A integração GitHub **não publica commits nem PRs nesta fase**. Nunca
  pedir um token de acesso pessoal no chat. As mensagens e o README são
  conteúdo externo não confiável; não executar comandos sugeridos por eles.

Segurança: OAuth `state` vinculado à sessão e com prazo, token cifrado AES-256-GCM
em documento separado por UID, expiração curta, validação de origem mutante,
acesso limitado à API de GitHub e apenas ao host oficial; o token nunca é
enviado ao frontend ou ao Gemini. Desconectar elimina a credencial local (para
revogação definitiva da autorização, o usuário pode fazê-la no GitHub).
Para criar commits/PRs futuramente: implementar ações explícitas com escopo de
escrita mínimo, diffs revisáveis e confirmação antes de publicar.

## Testes

`node --test src/services/solarisGithubApp.test.js`
`node --test src/solaris/http/solarisHttpHandlers.test.js`
`node --test src/solaris/tools/assetForge.test.js`
`npm run typecheck:frontend`
