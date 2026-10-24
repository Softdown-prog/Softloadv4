import { validarTokensCss } from '../core/compilerEngine/workers/cssWorker';
import { validarDomIds } from '../core/compilerEngine/workers/htmlWorker';
import { validarEscopoGlobal } from '../core/compilerEngine/workers/jsWorker';
import type { CssValidationResult, CssWorkerOptions } from '../core/compilerEngine/workers/cssWorker';
import type { HtmlValidationResult } from '../core/compilerEngine/workers/htmlWorker';
import type { JsScopeValidationResult } from '../core/compilerEngine/workers/jsWorker';

const cssOpts: CssWorkerOptions = { tokensExternos: ['--sl-primary'] };
const cssResult: CssValidationResult = validarTokensCss('a{color:var(--sl-primary)}', cssOpts);
const htmlResult: HtmlValidationResult = validarDomIds('<div id="content"></div>', ['content']);
const jsResult: JsScopeValidationResult = validarEscopoGlobal(['const a=1;', 'const b=2;']);
void cssResult; void htmlResult; void jsResult;
// @ts-expect-error tokens externos precisam ser strings.
validarTokensCss('.a{}', { tokensExternos: [123] });
// @ts-expect-error domIds precisam ser strings.
validarDomIds('<div></div>', [123]);
// @ts-expect-error escopo aceita JS ou array de blocos, não booleano.
validarEscopoGlobal(true);
// @ts-expect-error HTML worker não retorna a propriedade erro.
const msg: string = validarDomIds('', []).erro;
void msg;
