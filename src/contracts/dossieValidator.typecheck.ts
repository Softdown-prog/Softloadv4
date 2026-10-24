import { validarDossie } from '../core/compilerEngine/dossieValidator';
import type { DossieInput, DossieValidationResult } from '../core/compilerEngine/dossieValidator';
const d: DossieInput = {nicho:'gamer-playerone',versaoDossie:1,tokensCss:{light_mode:{}},pecas:[]};
const result: DossieValidationResult = validarDossie(d);
const malformed: DossieValidationResult = validarDossie(null);
const messages: string[] = result.erros;
void malformed; void messages;
// @ts-expect-error result is an object, not a boolean.
const invalid: boolean = validarDossie(d);
void invalid;
// @ts-expect-error errors always string[].
const invalidErrors: number = result.erros;
void invalidErrors;
