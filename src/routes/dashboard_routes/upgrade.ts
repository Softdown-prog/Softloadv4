'use strict';
interface DashboardRequest { session: { user?: unknown } }
interface DashboardResponse { render(view: string, locals: { activePage: string; user?: unknown }): unknown }
type RouteHandler = (req: DashboardRequest, res: DashboardResponse, next: () => void) => unknown;
interface DashboardRouter { get(path: string, ...handlers: RouteHandler[]): void }
declare const require: (id: string) => unknown;
const express = require('express') as { Router(): DashboardRouter };
const router = express.Router();
const { exigirLogin } = require('../../middlewares/authGuard') as { exigirLogin: RouteHandler };

router.get('/dashboard/upgrade', exigirLogin, (req: DashboardRequest, res: DashboardResponse) => {
    res.render('pages/plano-essencial', {
        activePage: 'plano-essencial',
        user: req.session.user
    });
});

router.get('/dashboard/plano-essencial', exigirLogin, (req: DashboardRequest, res: DashboardResponse) => {
    res.render('pages/plano-essencial', {
        activePage: 'plano-essencial',
        user: req.session.user
    });
});

declare const module: { exports: unknown };
module.exports = router;
export {};
