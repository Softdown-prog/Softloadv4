import { buscarNaBiblioteca, registrarNaBiblioteca, _gerarPalavrasChave, _melhorCandidato } from '../core/compilerEngine/bibliotecaPecas';
import type { PecaBiblioteca, ResultadoBiblioteca, ResultadoRankingBiblioteca } from '../core/compilerEngine/bibliotecaPecas';
const item: PecaBiblioteca = { id: 'card', descricao: 'Card de noticias', css: '.card{}' };
const encontrou: Promise<PecaBiblioteca | null> = buscarNaBiblioteca('card de noticias', { excluirNicho: 'esportes' });
const registrou: Promise<ResultadoBiblioteca> = registrarNaBiblioteca(item, 'tecnologia');
const palavras: string[] = _gerarPalavrasChave('Card de notícias', 'tecnologia', 'card');
const ranking: ResultadoRankingBiblioteca = _melhorCandidato('card de noticias', [{ ...item, palavras_chave: palavras }]);
void encontrou; void registrou; void ranking;
// @ts-expect-error busca exige texto, não número.
buscarNaBiblioteca(42);
// @ts-expect-error opções não podem conter nicho numérico.
buscarNaBiblioteca('card', { excluirNicho: 1 });
// @ts-expect-error gravação precisa de peça/objeto.
registrarNaBiblioteca('texto', 'nicho');
// @ts-expect-error retorno não é inteiro.
const invalido: number = _melhorCandidato('card', []);
void invalido;
