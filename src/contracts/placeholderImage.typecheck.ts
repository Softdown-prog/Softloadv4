import { gerarPlaceholderImagemSvg } from '../core/compilerEngine/placeholderImage';

const imagem: string = gerarPlaceholderImagemSvg('#0ea5e9', '#f8fafc');
const comFundoAusente: string = gerarPlaceholderImagemSvg('#0ea5e9');
void imagem;
void comFundoAusente;

// @ts-expect-error a cor primária deve ser uma string.
gerarPlaceholderImagemSvg(123, '#ffffff');
// @ts-expect-error o fundo não aceita números.
gerarPlaceholderImagemSvg('#ffffff', 123);
// @ts-expect-error o retorno é uma URI textual.
const invalido: number = gerarPlaceholderImagemSvg('#abcdef');
void invalido;
