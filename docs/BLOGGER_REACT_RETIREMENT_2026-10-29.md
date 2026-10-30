# Lote 2 — aposentadoria React e Vite (2026-10-29)

## O que foi retirado

- Toda a pasta de código-fonte `frontend/` (55 arquivos) e os quatro arquivos de configuração `vite.config.ts/js`, `tsconfig.frontend.json`, `tsconfig.vite.json`.
- `package.json`: remove scripts TypeScript/build/test exclusivos da interface React, altera `build` para conferir assets EJS (Bootstrap/Chart.js) e retira 13 dependências diretas de frontend que não são necessárias ao Blogger.
- `package-lock.json`: ajusta a raiz do pacote para refletir as dependências declaradas (a árvore resolvida remanescente poderá ser regenerada por npm sem riscos na próxima manutenção de dependências).
- Workflows `deploy.yml`, `refactor-ci.yml` e `softload-typescript-gate.yml` passam a exigir testes de EJS, sessão pública e XML Blogger no lugar dos testes React.
- Auditoria `check-typescript-remaining.cjs` não exige mais configuração Vite/React; os testes legados só rodam com fixture explícita.

## Contratos preservados

Backend Node e EJS, compilador e validação XML, Firebase/Firestore, autenticação, cookies, histórico/arquivos, Mercado Pago/webhooks, recibos e conciliação financeira. Container Agent continua porque o receptor VPS v2 exige app+agent e seu rollback. O checkout **não** deve ser habilitado por esta mudança.

## Portas de segurança

Não mesclar sem `npm ci`, typecheck e mirrors, testes Blogger/MP, build Docker e smoke real de compilação do deploy. Não modificar dados de usuários nem infra da VPS diretamente.

## Pendente

Distinguir antigas rotas React para admin/solaris das rotas efetivas Blogger; migrar ou desativar sem perder dados/recibos. Depois, migração coordenada receptor app-only para permitir remover `agent/` e `Power-up/`.
