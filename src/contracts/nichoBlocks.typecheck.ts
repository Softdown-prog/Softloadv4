import { carregarNichoImplComBlocos, montarNichoDeDossie, montarNichoLegado, _escolherVariantePeca } from '../core/compilerEngine/nichoBlocks';
import type { DossieNicho, NichoBlocosResultado, PecaNicho, TokensCssNicho } from '../core/compilerEngine/nichoBlocks';
const peca: PecaNicho = { id: 'hero-1', tipo: 'hero', html: '<h1>Título</h1>', htmlVariantes: ['<h1>A</h1>','<h1>B</h1>'] };
const tokens: TokensCssNicho = { light_mode: { '--sl-extra': 'red' } };
const dossie: DossieNicho = { nicho: 'site', tokensCss: tokens, pecas: [peca] };
const render: NichoBlocosResultado = montarNichoDeDossie(dossie, 'Site A');
const legacy: NichoBlocosResultado = montarNichoLegado('site','Site A');
const runtime: NichoBlocosResultado = carregarNichoImplComBlocos('site', 'Site A');
const variante: string = _escolherVariantePeca('Site A', peca, 'htmlVariantes', '');
void render; void legacy; void runtime; void variante;
// @ts-expect-error nomes de campos de variantes são restritos.
_escolherVariantePeca('Site A', peca, 'widgetNativo', '');
// @ts-expect-error tipo de peça desconhecido não é válido.
const invalida: PecaNicho = { id: 'x', tipo: 'invalido' };
void invalida;
// @ts-expect-error dossiê precisa incluir peças tipadas.
montarNichoDeDossie({ nicho: 'site', pecas: [12] }, 'Site');
// @ts-expect-error resultado contém CSS textual.
const erro: number = carregarNichoImplComBlocos(null, 'Site').css;
void erro;
