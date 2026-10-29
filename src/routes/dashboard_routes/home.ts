'use strict';
interface DashboardHomeRequest { session: { user?: unknown } }
interface DashboardHomeResponse { render(view: string, locals: { activePage: string; user?: unknown }): unknown }
type DashboardHomeHandler = (req: DashboardHomeRequest, res: DashboardHomeResponse, next?: () => void) => unknown;
declare const require: (id: string) => unknown;
declare const module: { exports: unknown };
const express = require('express') as { Router(): { get(path: string, ...handlers: DashboardHomeHandler[]): unknown } };
const router = express.Router();
const { exigirLogin } = require('../../middlewares/authGuard') as { exigirLogin: DashboardHomeHandler };

// Entrada simples, renderizada no servidor. O gerador Blogger também é EJS.
// As rotas React legadas continuam disponíveis para preservar projetos,
// históricos e contratos enquanto cada tela é migrada de maneira segura.
router.get('/dashboard', exigirLogin, (req: DashboardHomeRequest, res: DashboardHomeResponse) => {
    res.render('pages/dashboard-simples', {
        activePage: 'home',
        user: req.session.user,
    });
});
module.exports = router;
export {};
