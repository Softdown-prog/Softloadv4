'use strict';
interface DashboardHomeRequest { session: { user?: unknown } }
interface DashboardHomeResponse { render(view: string, locals: { activePage: string; user?: unknown }): unknown }
type DashboardHomeHandler = (req: DashboardHomeRequest, res: DashboardHomeResponse, next?: () => void) => unknown;
declare const require: (id: string) => unknown;
declare const module: { exports: unknown };
const express         = (require('express') as { Router(): { get(path: string, ...handlers: DashboardHomeHandler[]): unknown } });
const router          = express.Router();
const { exigirLogin } = (require('../../middlewares/authGuard') as { exigirLogin: DashboardHomeHandler });

// Home do dashboard — antes renderizava 'pages/dashboard' (EJS/Bootstrap
// antigo, com sua própria sidebar em partials/dashboard-sidebar.ejs).
// Migrado para o app React (frontend/pages/DashboardHome.jsx), que já
// existe e já busca seus próprios dados via GET /api/dashboard/stats
// (ver src/routes/apiRoutes.js). Por isso o cálculo de créditos/projetos
// que existia aqui foi removido: ele agora vive só no endpoint da API,
// evitando ter a mesma lógica duplicada em dois lugares.
//
// 'pages/react-test' é a mesma view-ponte usada por todas as outras
// rotas do dashboard (chat, historico, workspace, solaris,
// configuracoes, upgrade) — ela só monta a div#react-root e carrega o
// bundle /dist/assets/main.js; quem decide o que renderizar dentro é o
// React Router em frontend/App.jsx.
router.get('/dashboard', exigirLogin, (req: DashboardHomeRequest, res: DashboardHomeResponse) => {
    res.render('pages/react-test', {
        activePage: 'home',
        user: req.session.user,
    });
});

module.exports = router;

export {};
