import { validarEdicao, EDIT_ENUMS, GEMINI_EDIT_RESPONSE_SCHEMA } from '../ai/templateEditSchema';
import type { EditSchemaValidation, EditChangeFields, EditSchemaEnumKey, EditSchemaEnumValue } from '../ai/templateEditSchema';
import type { BlueprintEnumValue } from '../ai/blueprintSchema';

const key: EditSchemaEnumKey = 'mobileMenuType';
const menu: EditSchemaEnumValue<'mobileMenuType'> = 'offcanvas';
const comments: EditSchemaEnumValue<'commentsSystem'> = 'desativado';
const palette: EditSchemaEnumValue<'colorPreset'> = 'tech-blue';
const preset: BlueprintEnumValue<'typography'> = EDIT_ENUMS.typography[0];
const changes: EditChangeFields = { siteName: 'Novo', modules: { backToTop: false } };
const result: EditSchemaValidation = validarEdicao({ ...changes, resumoMudancas: 'Atualiza o site' });
const invalidShape: EditSchemaValidation = validarEdicao(null);
const parameters: object = GEMINI_EDIT_RESPONSE_SCHEMA;
const errors: string[] = result.erros;
const message: string = result.resumoMudancas;
void key; void menu; void comments; void palette; void preset; void changes; void invalidShape; void parameters; void errors; void message;
// @ts-expect-error menu inválido, não exposto ao Gemini.
const badMenu: EditSchemaEnumValue<'mobileMenuType'> = 'hamburger-unsupported';
// @ts-expect-error valor interno vazio não pode ser enviado como enum Gemini.
const badComment: EditSchemaEnumValue<'commentsSystem'> = '';
// @ts-expect-error campo editável desconhecido.
const badField: EditSchemaEnumKey = 'command';
// @ts-expect-error validarEdicao é síncrono.
const badPromise: Promise<EditSchemaValidation> = validarEdicao({});
void badMenu; void badComment; void badField; void badPromise;
