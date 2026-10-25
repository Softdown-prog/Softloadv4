/** Worker Guard — Restringe acesso ao dashboard de workers ao usuário autorizado. */
interface WorkerGuardRequest {
    session?: { user?: { email?: string } };
}
interface WorkerGuardResponse {
    status(code: number): { render(view: string): unknown };
}
type NextWorkerGuard = () => unknown;
function exigirWorkerAccess(req: WorkerGuardRequest, res: WorkerGuardResponse, next: NextWorkerGuard): unknown {
    const email = req.session?.user?.email || '';
    if (email.toLowerCase() === 'softloady@gmail.com') return next();
    res.status(404).render('pages/404');
}

declare const module: { exports: unknown };
module.exports = { exigirWorkerAccess };
export {};
