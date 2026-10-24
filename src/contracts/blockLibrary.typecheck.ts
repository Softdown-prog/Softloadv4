import { hashSeed, pickBlock, temBlocos, carregarBlocos, limparCache } from '../core/blockLibrary';
import type { BlocosNicho } from '../core/blockLibrary';

const hash: number = hashSeed('Site A');
const css: string | null = pickBlock('teste', 'card_css', 'Site A');
const has: boolean = temBlocos('teste');
const blocks: BlocosNicho | null = carregarBlocos('teste');
const typed: BlocosNicho = {card_css: ['.a{}'], hero_html: null};
const selected: string | null | undefined = typed.card_css?.[0];
const reset: void = limparCache();
void hash; void css; void has; void blocks; void selected; void reset;
// @ts-expect-error o seed do hash precisa ser texto.
hashSeed(77);
// @ts-expect-error o slot do bloco precisa ser texto.
pickBlock('teste', 3, 'Site A');
// @ts-expect-error carregar blocos requer nicho textual.
carregarBlocos(null);
// @ts-expect-error variantes tipadas contêm strings.
const malformed: BlocosNicho = { card_css: [true] };
void malformed;
