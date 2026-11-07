/** Bloqueia a área de administração para sessões sem superadministrador. */
interface AdminGuardRequest {
    session?: { user?: { is_super_admin?: boolean } };
}
interface AdminGuardResponse {
    status(code: number): { render(view: string): unknown };
}
type NextGuard = () => unknown;
declare const require: (id: string) => {decideAccess(scope: string, request: unknown): {allow: boolean}};
const {decideAccess}=require('./accessPolicy.js');
function exigirSuperAdmin(req: AdminGuardRequest, res: AdminGuardResponse, next: NextGuard): unknown {
    if (decideAccess('admin',req).allow) return next();
    res.status(404).render('pages/404');
}

declare const module: { exports: unknown };
module.exports = { exigirSuperAdmin };
export {};
