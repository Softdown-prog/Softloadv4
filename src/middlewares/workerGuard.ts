/** Worker Guard — Restringe acesso ao dashboard de workers ao usuário autorizado. */
interface WorkerGuardRequest {
    session?: { user?: { email?: string } };
}
interface WorkerGuardResponse {
    status(code: number): { render(view: string): unknown };
}
type NextWorkerGuard = () => unknown;
declare const require: (id: string) => {decideAccess(scope: string, request: unknown): {allow: boolean}};
const {decideAccess}=require('./accessPolicy.cjs');
function exigirWorkerAccess(req: WorkerGuardRequest, res: WorkerGuardResponse, next: NextWorkerGuard): unknown {
    if (decideAccess('worker',req).allow) return next();
    res.status(404).render('pages/404');
}

declare const module: { exports: unknown };
module.exports = { exigirWorkerAccess };
export {};
