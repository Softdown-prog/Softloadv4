import { validarXmlSaida } from '../core/workerXmlValidation';
const avisos: string[] = validarXmlSaida('<html></html>');
const total: number = avisos.length;
void total;
// @ts-expect-error entrada XML deve ser string.
validarXmlSaida(42);
// @ts-expect-error retorno é lista de strings, não boolean.
const errado: boolean = validarXmlSaida('<xml/>');
void errado;
