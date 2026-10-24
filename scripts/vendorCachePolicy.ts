/**
 * Cache de arquivos estaticos em server.js. Os bundles com hash mantem o
 * cache longo do express.static; /vendor/ usa nomes estaveis em releases
 * diferentes (Bootstrap/Chart.js) e nao pode ser marcado immutable por 1 ano.
 */
interface StaticHeaderSink { setHeader(name: string, value: string): void }
interface StaticPath {
    join(...parts: string[]): string;
    relative(from: string, to: string): string;
    sep: string;
}
declare function require(id: string): unknown;
declare const __dirname: string;
const path = require('node:path') as StaticPath;
const DEFAULT_PUBLIC = path.join(__dirname, '..', 'public');

/**
 * Invocado por express.static({ setHeaders }) ANTES de escrever a resposta.
 * O caminho de main.js continua sem cache como antes; outros chunks
 * continuam com o maxAge/immutable globais do express.static.
 */
export function setPublicStaticHeaders(
    res: StaticHeaderSink,
    filePath: string,
    publicRoot: string = DEFAULT_PUBLIC,
): void {
    const relative = path.relative(publicRoot, filePath);
    if (relative === path.join('dist', 'assets', 'main.js') || relative.startsWith('vendor' + path.sep)) {
        res.setHeader('Cache-Control', 'no-store, max-age=0');
    }
}
