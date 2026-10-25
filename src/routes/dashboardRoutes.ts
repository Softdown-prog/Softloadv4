/** Mantém o entrypoint CommonJS legado para o agregador de rotas. */
declare const require: (id: string) => unknown;
declare const module: { exports: unknown };
module.exports = require('./dashboard_routes');
export {};
