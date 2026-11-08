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
- `PremiumGuard`: serviço Nest com `PremiumAccessModule.register(reader)`, 
  capaz de revalidar a assinatura vencida/inativa após um webhook. O leitor
  de status é **injetado explicitamente** (sem import de Firebase no piloto)
  e os testes usam respostas em memória, inclusive falha de banco. O módulo
  não é montado no backend Express, e a leitura real de Firestore ainda não
  foi implementada para Nest.

Os testes HTTP do piloto verificam `401` sem sessão, `403` sem Premium,
`200` com Premium ativo ou renovado e `403` quando a verificação falha.
O `AccessContractFilter` implementa agora o **contrato de navegação HTML**
sem alterar os erros de API: para `GET /dashboard/nest-proof/session` e
`/premium` (rotas exclusivamente de teste), a sessão ausente recebe `302`
para login e o Premium negado recebe `302` para upgrade. Requisições
`/api/*`, `Accept: application/json` e `XMLHttpRequest` preservam
`401/403` com o corpo JSON esperado. O filtro só captura denegações de
autorização explicitamente tipadas; um `404` ou `500` de outra origem
continua sendo tratado pelo Nest normalmente.

A suíte `nest-middleware/test/express-premium.parity.test.mjs` executa
**o middleware Express real** com Firestore substituído por um adaptador em
memória, e compara sua decisão à função `decidePremium` do Nest nos mesmos
8 cenários: sem login, Premium válido, free, expiração sem renovação,
renovação posterior ao webhook, sessão inativa reativada, falha de banco em
Premium vencido e falha de banco em sessão inativa. Também compara atualização
da sessão e chave de lookup normalizada em lowercase. Não chama a API real
nem aceita credenciais vindas do cliente.

**A cobertura HTML ainda não equivale a renderizar EJS**, nem garante
compatibilidade de cookies Firestore, do Express 5 ou da navegação comercial:
o filtro existe apenas na aplicação Nest efêmera criada pelos testes.

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
`package.json` e `package-lock.json` da produção. O subprojeto possui
`nest-middleware/package-lock.json` próprio (npm lockfile v3), gerado no
Node 24, revisado e versionado. O workflow isolado instala com
`npm ci --prefix nest-middleware --ignore-scripts`, compila TypeScript e
testa os Guards e contratos HTTP. O lockfile congela **inclusive dependências
transitivas**, mas não habilita por si só o Nest na VPS nem comprova
compatibilidade de cookies e sessions do backend comercial. O Nest permanece
fora da imagem Docker de produção.

A prova é um gate técnico **do piloto isolado**, não uma autorização de
deploy do novo backend. Antes de habilitar Nest em produção, ainda é
necessário homologar Express 5, rever Node 22/24 na imagem real e verificar
sessões Firestore, autenticação, rotas HTML/API, webhooks e rollback.

## Sequência para migração de verdade

1. Registrar o contrato atual em testes (login HTML redireciona, API recebe
   JSON 401; Premium pode reler Firestore após renovação; admin/worker 404).
   O piloto já cobre Premium com um leitor simulado, mas **ainda não** cobre
   o adaptador Firestore real nem os templates EJS/cookies comerciais. Os
   redirecionamentos HTTP de navegação já têm uma prova Nest isolada.
2. Migrar Express 4 → 5 em PR separado, revisar rotas catch-all, parsers,
   cookie, `express-session`, limite de requisições e webhook.
3. Criar factory do servidor legado sem `listen()` e remover 404 catch-all
   na hora de acoplar Nest, mantendo ordens de middleware e sessão Firestore.
4. Montar Nest via `ExpressAdapter`, migrar uma rota protegida de baixo
   risco com testes HTTP equivalentes e só depois mover as demais.
5. Acoplar o leitor real de assinatura com testes de integração, mantendo a
   consulta à coleção correta, e levar rate limiting para Middleware/Providers.
   Um fluxo legado de reativação de sessões inativas aceita o campo
   `is_active` vindo do banco sem conferir `premium_ate` nesse ramo; essa
   regra preexistente precisa de revisão separada, sem mudar permissões
   silenciosamente durante a migração.
6. Validar Angular/Chrome, SAC, Docker, download Blogger, pagamento simulado,
   sessão e rollback antes de qualquer merge que afete produção.

Este módulo **não declara endpoints comerciais, migra webhooks nem reimplementa
o motor de templates**. O comportamento atual permanece canônico enquanto
a equivalência não for provada.
