import { verificarDomIdsNoOutput, verificarSecoesPreenchidas, SECOES_MOBILIA_ESPERADAS } from '../core/compilerEngine/dossieIntegrityChecker';
import type { DossieIntegridade, IntegridadeResult, PecaIntegridade } from '../core/compilerEngine/dossieIntegrityChecker';
const pecas: PecaIntegridade[] = [{id:'hero',domIds:['site-hero']}];
const dossie: DossieIntegridade = {pecas};
const validacao: IntegridadeResult = verificarDomIdsNoOutput("<div id='site-hero'></div>",dossie);
const seo: IntegridadeResult = verificarSecoesPreenchidas('<b:section id="sidebar"/>','blog',null);
const secoes: Record<string,string[]> = SECOES_MOBILIA_ESPERADAS;
void validacao;void seo;void secoes;
// @ts-expect-error verificarSecoesPreenchidas exige chassis string.
verificarSecoesPreenchidas('XML',4);
// @ts-expect-error resultado de validação retorna boolean, não número.
const erro: number = verificarDomIdsNoOutput('',dossie).ok;
void erro;
