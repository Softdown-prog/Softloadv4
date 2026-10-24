import type { AchadoDiagnostico, CategoriaDiagnostico, ScoreDiagnostico } from './diagnostico';
import { calcularScore } from '../core/diagnostico/score';
import { checarAcessibilidade } from '../core/diagnostico/acessibilidadeChecker';
import { checarResponsividade } from '../core/diagnostico/responsividadeChecker';

const categorias: readonly CategoriaDiagnostico[] = [{
    id: 'acessibilidade',
    nome: 'Acessibilidade',
    achados: checarAcessibilidade('<html></html>'),
}];
const score: ScoreDiagnostico = calcularScore(categorias);
const achados: AchadoDiagnostico[] = checarResponsividade('<html></html>');
void score;
void achados;

import type { DiagnosticoResultado } from './diagnostico';
import { gerarDiagnostico } from '../core/diagnostico/index';
const resultado: DiagnosticoResultado = gerarDiagnostico('<html/>');
void resultado;

import { checarSeo } from '../core/diagnostico/seoChecker';
const seo: import('./diagnostico').AchadoDiagnostico[] = checarSeo('<h1>Título</h1>');
void seo;
