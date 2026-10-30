# Limpeza Blogger — rotas e telas antigas desligadas (30/10/2026)

## Removido neste recorte

- `src/routes/dashboard_routes/forgeStandalone.cjs/js/ts`, teste e `views/pages/forge-2d.ejs`: Forge web não está montado no `dashboard_routes/index.js` desde a migração para Blogger; também não é empacotado no Docker de produção.
- `src/routes/dashboard_routes/reactTest.js/ts`: ponte de teste React não está montada no dashboard, enquanto o frontend React/Vite já foi excluído.
- `views/pages/react-landing.ejs`, `react-public.ejs` e `upgrade.ejs`: cascas antigas sem rota na versão Blogger. As páginas atuais são `landing-blogger.ejs`, `auth-simples.ejs` e `plano-essencial.ejs`.
- Inventário TS, lista de espelhos, teste do dashboard e exclusões obsoletas do Docker atualizados.

## Cuidados obrigatórios para os próximos recortes

**Não apagar diretamente** `views/pages/react-admin.ejs` ou `views/pages/react-test.ejs`: `src/routes/adminRoutes.js` ainda renderiza o primeiro em várias rotas e `src/routes/dashboard_routes/historico.js` renderiza o segundo em prévias salvas. O React foi removido; essas telas são lacunas funcionais já existentes, a corrigir com páginas EJS equivalentes ou desativação explícita segura. Rotas de admin podem incluir exportação, cobrança e auditoria: preservar acesso e dados enquanto forem migradas.

**Não apagar `src/solaris/**` em massa** enquanto `src/routes/apiRoutes.js` ainda possuir `/internal/solaris/limpar-projetos-expirados` e `/internal/solaris/rag/buscar`, e `src/routes/adminRoutes.js` ainda carregar `solAgent` e `chatStorageService`. Também há rotas antigas em `dashboard_routes/chat,solaris,workspace,workspaceChat` não montadas mas cobertas por testes/contratos de compatibilidade. Fazer inventário de rotas, separar o que deve manter acesso histórico e só depois remover o grafo de imports, TypeScript e testes legados.

**Não apagar o Agent/Forge subjacente** até migrar o receptor v2 e o workflow de deploy `app+agent` para um contrato `app-only` com rollback testado na VPS. Remover o Forge web aposentado não altera `agent/forge` nem o contrato de publicação.

## Critérios de aprovação

- `npm run typecheck`, `npm test`, `npm run build`, `docker build` e gates de workflow verdes.
- Deploy posterior confirmar SHA no `/health`, conexão Firestore e XML real via `/criar/download`.
- Nenhuma exclusão de dados, projetos persistidos, arquivos GCS/Firestore, chaves ou registros financeiros.
