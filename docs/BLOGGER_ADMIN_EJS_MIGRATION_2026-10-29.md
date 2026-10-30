# Limpeza do painel administrativo React — 29/10/2026

## Contexto
O aplicativo Blogger publicado não contém mais o bundle React/Vite, mas as rotas de superadmin `/eu`, `/eu/usuarios`, `/eu/analytics` e `/eu/sol` continuavam renderizando `views/pages/react-admin.ejs`, que dependia de `/dist/assets/main.js`. Isso deixava a administração sem a interface esperada.

## Alterações
- As quatro rotas continuam protegidas por `exigirSuperAdmin` e pelo rate limit original, mas agora carregam `views/pages/admin-simples.ejs`.
- A interface EJS apresenta indicadores históricos, a primeira página de contas e dados históricos de consumo via APIs existentes; o script `public/js/admin-simples.js` só faz **GET** autenticado, usa `textContent` e não monta HTML recebido do banco.
- A página `/eu/sol` informa que o chat administrativo foi aposentado na versão Blogger, sem apagar registros ou sessões.
- Removida a casca `react-admin.ejs` e incluído teste que protege a guarda das rotas, a renderização EJS e a ausência do bundle React.

## Funcionalidades e dados preservados
- Rotas internas de administração e APIs de usuários, histórico, billing e conciliação; **nenhuma escrita de contas, crédito, pagamentos, sessões ou Firestore** é feita por esta mudança.
- A listagem nativa é **somente leitura** e limitada aos 50 primeiros registros; ações administrativas de alteração de planos não são expostas nela para evitar mudança de saldo sem confirmação adequada.
- `react-test.ejs` continua usado nas prévias de compilações históricas e precisa de migração separada.
- Endpoints Solaris/RAG permanecem ativos no backend enquanto houver dependências de Agent, limpeza TTL ou código administrativo. Desligá-los e remover `src/solaris` exige um recorte próprio, com testes de compatibilidade e retenção de dados.

## Validação
Testes de EJS, guards e módulos TypeScript; Docker Blogger; posteriormente deploy com SHA em `/health`, `/criar` e geração XML real de `/criar/download`.
