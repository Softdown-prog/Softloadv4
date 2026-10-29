/** Adapter tipado para a rota Blogger anônima; lógica HTTP e testes em CJS.
 * A migração do handler será feita após estabilizar o acesso público. */
declare const require: (path: string) => unknown;
declare const module: { exports: unknown };
interface PublicBloggerRouter {
  get(path: string, ...handlers: unknown[]): unknown;
  post(path: string, ...handlers: unknown[]): unknown;
}
const publicBloggerRouter: PublicBloggerRouter = require('./publicBlogger.cjs') as PublicBloggerRouter;
module.exports = publicBloggerRouter;
export {};
