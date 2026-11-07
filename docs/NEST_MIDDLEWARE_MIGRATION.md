# Softload v4 — Migração da caixa de middlewares para NestJS

## Estado inicial e limites da etapa

O servidor comercial continua em `server.js` (Express **4**): sessão
Firestore, CORS, headers, rate limiting, rotas de autenticação, Premium,
webhooks Mercado Pago, Angular e compilador Blogger não foram trocados.
**Nada neste diretório sobe um segundo servidor em produção.**

O `nest-middleware/` é uma prova isolada que usa os pacotes reais de
NestJS 12, não um mock de framework. `MiddlewareModule` registra três
guards como providers, e a suíte inicializa um servidor Nest **apenas no CI**,
com sessões artificiais, para testar 401/404/200:
- `SessionGuard`: sessão autenticada;
- `SuperAdminGuard`: oculta rotas administrativas (404);
- `WorkerGuard`: conserva a allowlist rígida do painel workers.

As decisões são compartilhadas pela fonte tipada `src/middlewares/accessPolicy.ts`, sem
Firebase, I/O ou execução de código de terceiros. Não aceitar papel
administrativo enviado pelo cliente no corpo, cabeçalhos ou URL.

O espelho `accessPolicy.js` é validado pelo verificador TypeScript 6, sem código JS independente.

## Por que ainda não montar Nest no Express comercial

O servidor é Express 4 e Nest moderno usa Express 5. A documentação oficial
de migração exige atualizar Express **antes** de montar Nest no servidor
existente, ou migrar tudo de uma vez. Há diferenças de roteamento e
compatibilidade: não usar `NestFactory.create(..., new ExpressAdapter(app))`
com o Express 4 atual.

Nesta fase a prova Nest fica isolada, sem qualquer alteração em
`package.json` e `package-lock.json` da produção. **Ainda não existe um
lockfile reproduzível para o subprojeto experimental**; por isso o workflow
instala dependências em runner descartável e é apenas uma prova, nunca um gate
de aprovação de deploy. Antes de habilitar um Nest em produção, gerar e
revisar um lockfile, usar `npm ci`, rever a versão de Node da imagem e
provar compatibilidade Express 5.

## Sequência para migração de verdade

1. Registrar o contrato atual em testes (login HTML redireciona, API recebe
   JSON 401; Premium pode reler Firestore após renovação; admin/worker 404).
   O guard Nest atual cobre somente sessão/admin/worker, **não** Premium.
2. Migrar Express 4 → 5 em PR separado, revisar rotas catch-all, parsers,
   cookie, `express-session`, limite de requisições e webhook.
3. Criar factory do servidor legado sem `listen()` e remover 404 catch-all
   na hora de acoplar Nest, mantendo ordens de middleware e sessão Firestore.
4. Montar Nest via `ExpressAdapter`, migrar uma rota protegida de baixo
   risco com testes HTTP equivalentes e só depois mover as demais.
5. Levar autenticação Premium e rate limiting para Guards/Providers/Middleware
   com testes de expiração/renovação de assinatura e falha do Firestore.
6. Validar Angular/Chrome, SAC, Docker, download Blogger, pagamento simulado,
   sessão e rollback antes de qualquer merge que afete produção.

Este módulo **não declara endpoints comerciais, migra webhooks nem reimplementa
o motor de templates**. O comportamento atual permanece canônico enquanto
a equivalência não for provada.
