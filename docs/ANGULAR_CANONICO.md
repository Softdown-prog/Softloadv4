# Frontend canônico Angular — Softload Blogger

## Objetivo

A interface de produção é exclusivamente Angular 22 em `frontend/`. **Frontend e backend são hospedados na mesma VPS**. O Express permanece responsável pelos contratos do negócio; o NestJS será migrado separadamente, sem reescrever o motor XML.

- Build de `frontend/`: Node.js 24 + TypeScript 6 (isolado do TypeScript 7 do compilador).
- Runtime da API: Node.js 22, Express, Firestore, Firebase Auth, GCS e Mercado Pago.
- Docker: estágio `angular-build` gera bundles com hash no `public/` e guarda `index.html` em `angular/`. O container Node/Express serve tanto o frontend Angular como as APIs pela **mesma VPS e mesma origem**; o HTML é enviado com `Cache-Control: no-store`.
- Entrada pública: o **Caddy já compartilhado na VPS** continua fazendo proxy HTTPS para o container do Softload. Cloudflare pode continuar apenas como DNS/proxy externo; **não utilizar Cloudflare Pages nem hospedar frontend em outro provedor**.
- Deployment: manter o contrato v3 App-only e **uma imagem Docker de produção**. O build pode ocorrer no GitHub Actions, mas o frontend compilado e o backend rodam na VPS; não criar serviço, porta ou domínio público separados para Angular.
- A SPA se comunica com a mesma origem do backend; não armazena tokens de autenticação nem segredos no navegador.
- `/api/frontend/bootstrap` expõe metadados permitidos do gerador e emite o token CSRF por sessão para convidados.
- `/api/frontend/files` expõe apenas os arquivos que pertencem ao usuário autenticado, mantendo o mesmo token CSRF dos endpoints de upload e exclusão.
- `/criar/download` e `/dashboard/gerador-blogger/download` permanecem os endpoints autoritativos para cota, compilação e download.
- `/dashboard/checkout-create` e `/webhook/mercado-pago` permanecem no servidor. Nunca confiamos no preço enviado pelo frontend.
- Termos e privacidade preservam a redação anterior como assets estáticos servidos sem cache imutável.

## Rotas visuais migradas

| Área | Caminhos |
| --- | --- |
| Público | `/`, `/criar`, `/contato`, `/termos-de-uso`, `/privacidade` |
| Autenticação | `/login`, `/register`, `/recover` |
| Usuários | `/dashboard`, `/dashboard/gerador-blogger`, `/dashboard/historico`, `/dashboard/arquivos`, `/dashboard/configuracoes`, `/dashboard/upgrade`, `/dashboard/plano-essencial` |
| Administração | `/eu`, `/eu/usuarios` |

O servidor protege páginas privadas antes de servir o shell Angular. A autorização de cada API e download também continua sendo validada no backend.

## Escopo de transição

Arquivos EJS antigos continuam no repositório para permitir regressões e smoke tests anteriores durante a migração, mas o ambiente de produção os ignora para as rotas acima. Não criar novas funcionalidades EJS. O gateway CommonJS é um adaptador temporário e deliberado, coberto por contrato; novas funcionalidades de negócio devem continuar TypeScript.

Para desenvolvimento visual local sem dados reais, execute o build Angular. O `npm start` do backend fora de produção ainda pode usar o fallback EJS, portanto não representa a UI final. O smoke Docker usa `SOFTLOAD_USE_ANGULAR=true` para exercitar o shell isoladamente.

## Gates antes de merge

1. `npm ci --legacy-peer-deps`, `npm run typecheck`, `npm run typecheck:workers`, `npm test` no core.
2. No ambiente Node.js 24: `npm --prefix frontend install`, `npm --prefix frontend run typecheck`, `npm --prefix frontend run test`, `npm --prefix frontend run build`.
3. Docker multi-stage, verificando o `angular/index.html` e os arquivos estáticos.
4. Testes de contrato e fluxo público XML sem emitir cobranças.
5. No navegador real: mobile Android, preview, navegação de conta, sessão, armazenamento e checkout de homologação, antes de publicar.

Sem migração de coleções, exclusão de recibos, alteração de preços ou deploy automático a partir desta branch.
