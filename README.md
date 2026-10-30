# Softload Blogger

Gerador comercial de templates XML para Blogger, por compilação procedural. Aplicação única em Node.js, TypeScript e EJS; nichos, cores, fontes e layouts determinísticos.

## Produto

- Landing e formulários EJS; Firebase Authentication e sessões persistidas no Firestore.
- Testes públicos e dois downloads gratuitos por conta, com controle transacional.
- Plano Essencial: R$ 5 por 30 dias, pagamento único pelo Mercado Pago.
- Arquivos e históricos existentes no Cloud Storage, cotas de armazenamento, exclusão de conta e administração restrita em `/eu`.
- Telemetria, Sentinel e logs operacionais. Nenhum provedor de IA ou serviço de agente é necessário.

## Código

- `server.ts` / `server.js`: HTTP, sessões e inicialização.
- `src/routes`, `src/middlewares`: páginas, autenticação, cotas e endpoints.
- `src/core`: compilação, validação e diagnóstico XML.
- `src/blogger/templates`, `src/blogger/nichos`: chassis, dossiês e blocos estáticos do compilador.
- `src/services`: Firebase, pagamentos, email, armazenamento e monitoramento.
- `views`, `public`: EJS e assets locais; scripts do navegador também têm fonte TypeScript.
- `scripts`: ferramentas de compilação, qualidade, espelhos TypeScript e deploy.
- `manifests`: entradas de exemplo para a compilação em lote.

## Desenvolvimento

Use Node.js 22. Os `.ts` são autoritativos; o runtime usa os `.js` CommonJS versionados.

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

Configuração: `SESSION_SECRET`, `FIREBASE_API_KEY`, `FIREBASE_APP_ID`, credenciais Google por `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_CLOUD_PROJECT`, `GCS_BUCKET_NAME`, `BASE_URL`. Email: Resend SMTP via `RESEND_API_KEY`. Pagamentos: `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `MP_PUBLIC_KEY` e `BLOGGER_ESSENCIAL_CHECKOUT_ENABLED`. Nunca versionar valores privados.

O banco e os caminhos atuais de clientes permanecem compatíveis. Campos antigos são dados históricos, não dependências de serviços aposentados. Não executar deploy de índices Firebase ou remoção de dados como parte de uma atualização da aplicação.

Ver [infraestrutura e deploy](docs/VPS_DEPLOY.md), [pagamentos](docs/PAGAMENTOS.md) e [resultado da limpeza](docs/LIMPEZA_BLOGGER_20261030.md).
