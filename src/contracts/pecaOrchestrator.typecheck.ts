import { resolverPeca, jaExisteNoDossie, validarPecaGerada, _tokensExternos } from '../core/compilerEngine/pecaOrchestrator';
import type { PecaCandidata, DossiePecas, ResultadoResolucaoPeca, ValidacaoPeca } from '../core/compilerEngine/pecaOrchestrator';
const peca: PecaCandidata = {id:'x',css:'.x{}',html:'',js:'',domIds:[]};
const dossie: DossiePecas = {pecas:[peca],tokensCss:{light_mode:{'--tw-primary':'#000'}}};
const resultado: Promise<ResultadoResolucaoPeca> = resolverPeca('appstore-bulma-mobile',{pedido:'criar card'});
const existente: PecaCandidata | null = jaExisteNoDossie(dossie,'criar card');
const valida: ValidacaoPeca = validarPecaGerada(peca,dossie);
const tokens: string[] = _tokensExternos(dossie.tokensCss);
void resultado; void existente; void valida; void tokens;
// @ts-expect-error resolucao exige nicho textual.
resolverPeca(10,{pedido:'teste'});
// @ts-expect-error validação retorna objeto, nunca número.
const invalido: number = validarPecaGerada(peca,dossie);
void invalido;
// @ts-expect-error tokens externos devolvem strings, não number.
const numeros: number[] = _tokensExternos(null);
void numeros;
