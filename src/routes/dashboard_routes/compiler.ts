'use strict';
interface DashboardRequest { session?: { user?: unknown } }
interface DashboardResponse { redirect(status: number, path: string): unknown }
type RouteHandler = (req: DashboardRequest, res: DashboardResponse, next: () => void) => unknown;
interface DashboardRouter { get(path: string, ...handlers: RouteHandler[]): void }
declare const require: (id: string) => unknown;
const express = require('express') as { Router(): DashboardRouter };
const router = express.Router();
const { exigirLogin } = require('../../middlewares/authGuard') as { exigirLogin: RouteHandler };

// Redirecionamentos antigos do compilador continuam apontando para o chat.
router.get('/dashboard/compiler', exigirLogin, (_req: DashboardRequest, res: DashboardResponse) => {
    res.redirect(301, '/dashboard/chat');
});
router.get('/dashboard/compiler-blogger-xml', exigirLogin, (_req: DashboardRequest, res: DashboardResponse) => {
    res.redirect(301, '/dashboard/chat');
});

declare const module: { exports: unknown };
module.exports = router;
export {};
