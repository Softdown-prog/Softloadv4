# Softload Blogger

Gerador comercial de templates XML para Blogger, por compilação procedural. Frontend canônico Angular 22, API Node.js/Express e compilador procedural TypeScript; nichos, cores, fontes e layouts determinísticos.

## Produto

- Landing, editor, conta e administração em Angular 22; Firebase Authentication e sessões persistidas no Firestore.
- Testes públicos e dois downloads gratuitos por conta, com controle transacional.
- Plano Essencial: R$ 5 por 30 dias, pagamento único pelo Mercado Pago.
- Arquivos e históricos existentes no Cloud Storage, cotas de armazenamento, exclusão de conta e administração restrita em `/eu`.
- Telemetria, Sentinel e logs operacionais. Nenhum provedor de IA ou serviço de agente é necessário.

## Código

- `frontend/`: aplicação Angular 22 canônica, rotas, prévia e componentes de interface.
- `src/routes/angular-shell.cjs`: gateway de páginas Angular, bootstrap e acesso a arquivos.
- `server.ts` / `server.js`: HTTP, sessões e inicialização.
- `src/routes`, `src/middlewares`: páginas, autenticação, cotas e endpoints.
- `src/core`: compilação, validação e diagnóstico XML.
- `src/blogger/templates`, `src/blogger/nichos`: chassis, dossiês e blocos estáticos do compilador.
- `src/services`: Firebase, pagamentos, email, armazenamento e monitoramento.
- `views`: telas EJS legadas preservadas durante transição dos contratos, sem uso como interface canônica de produção.
- `public`: assets locais e bundles Angular gerados no Docker.
- `scripts`: ferramentas de compilação, qualidade, espelhos TypeScript e deploy.
- `manifests`: entradas de exemplo para a compilação em lote.

## Desenvolvimento

Use Node.js 22 para API/compilador TypeScript 7. O frontend Angular 22 tem ambiente isolado de build: Node.js 24 e TypeScript 6. Os `.ts` da API são autoritativos; o runtime atual usa `.js` CommonJS versionados.

```sh
npm ci --legacy-peer-deps
npm run sync:typescript
npm run typecheck
npm run typecheck:workers
npm test
npm run test:quality
npm run build
npm start
```

Frontend canônico (Node.js 24, dentro de `frontend/`):

```sh
npm --prefix frontend install --no-audit --no-fund
npm --prefix frontend run typecheck
npm --prefix frontend run test
npm --prefix frontend run build
```

**Hospedagem:** frontend Angular e backend Express ficam ambos na VPS, juntos na imagem Docker do Softload. O estágio de build do Angular ocorre no CI, mas o HTML, os assets e as APIs são servidos pelo container Node/Express atrás do Caddy da VPS. Cloudflare pode atuar como DNS/proxy; **Cloudflare Pages não faz parte do deploy**.
`/api/frontend/bootstrap` retorna dados do editor e o token de testes públicos; o compilador XML e os pagamentos continuam no backend.
Em ambientes legados de teste (`NODE_ENV=test`), o fallback EJS permanece disponível até a substituição dos contratos antigos.
Não usar Angular e EJS como duas interfaces paralelas em produção.

Configuração: `SESSION_SECRET`, `FIREBASE_API_KEY`, `FIREBASE_APP_ID`, credenciais Google por `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT`, `GCS_BUCKET_NAME`, `BASE_URL`. Email: Resend SMTP via `RESEND_API_KEY`. Pagamentos: `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `MP_PUBLIC_KEY` e `BLOGGER_ESSENCIAL_CHECKOUT_ENABLED`. Nunca versionar valores privados.

O banco e os caminhos atuais de clientes permanecem compatíveis. Campos antigos são dados históricos, não dependências de serviços aposentados. Não executar deploy de índices Firebase ou remoção de dados como parte de uma atualização da aplicação.

Ver [infraestrutura e deploy](docs/VPS_DEPLOY.md), [pagamentos](docs/PAGAMENTOS.md) e [resultado da limpeza](docs/LIMPEZA_BLOGGER_20261030.md).

Para liberar o checkout e os uploads na VPS após homologar, configure `BLOGGER_ESSENCIAL_CHECKOUT_ENABLED=true` e `SOFTLOAD_LITE_FILES_ENABLED=true` no ambiente do Compose. Os padrões continuam desligados em instalações novas.

Ver [migração Angular](docs/ANGULAR_CANONICO.md) para o mapeamento de rotas, limitações e testes.
