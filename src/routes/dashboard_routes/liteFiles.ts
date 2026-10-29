/** Rotas da área de arquivos 5/50 MB, independentes de Worker Agent. */
declare const require: (name: string) => unknown;
declare const module: {exports: unknown};
const liteFilesRouter: unknown = require('./liteFiles.cjs');
module.exports = liteFilesRouter;
export {};
