import { validarPeca, TIPOS_VALIDOS, GEMINI_PECA_RESPONSE_SCHEMA } from '../ai/pecaRequestSchema';
import type { PecaTipo, PecaGerada, ValidacaoPecaResposta } from '../ai/pecaRequestSchema';

const tipo: PecaTipo = 'hero';
const payload: ValidacaoPecaResposta = validarPeca({
    tipo: 'widget', css: '.x{}', html: '<div id="x"></div>', js: '',
    domIds: ['x'], descricao: 'Exemplo',
});
const badPayload: ValidacaoPecaResposta = validarPeca(null);
const candidate: PecaGerada = {
    tipo, protegida: false, domIds: [], css: '.x{}', html: '', js: '', descricao: 'Peça',
};
const options: readonly PecaTipo[] = TIPOS_VALIDOS;
const geminiSchema: object = GEMINI_PECA_RESPONSE_SCHEMA;
if (payload.peca) {
    const type: PecaTipo = payload.peca.tipo;
    const ids: string[] = payload.peca.domIds;
    void type; void ids;
}
void badPayload; void candidate; void options; void geminiSchema;
// @ts-expect-error tipo de peça inexistente.
const wrongType: PecaTipo = 'template';
// @ts-expect-error o modelo nunca decide se a peça está protegida.
const wrongPiece: PecaGerada = {tipo:'widget',protegida:true,domIds:[],css:'x',html:'',js:'',descricao:'x'};
// @ts-expect-error retorno de validação é síncrono.
const wrongResponse: Promise<ValidacaoPecaResposta> = validarPeca({});
void wrongType; void wrongPiece; void wrongResponse;
