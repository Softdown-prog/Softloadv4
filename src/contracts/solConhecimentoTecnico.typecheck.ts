import { buscarConhecimentoTecnico } from '../ai/solConhecimentoTecnico';
import type { TecnicoIndex, TecnicoIndexItem, TecnicoBuscaResultado, TecnicoResultado } from '../ai/solConhecimentoTecnico';

const registro: TecnicoIndexItem = { arquivo: 'guia.md', palavras_chave: ['typescript', 'node'] };
const index: TecnicoIndex = { ficheiros: [registro] };
const result: TecnicoBuscaResultado = buscarConhecimentoTecnico('typescript');
const item: TecnicoResultado | undefined = result.resultados[0];
void index;
void item;
