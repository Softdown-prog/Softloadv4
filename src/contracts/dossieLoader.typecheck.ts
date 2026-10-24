import { carregarNichoDossie, parsearDossie, limparCache } from '../core/compilerEngine/dossieLoader';
import type { DossieCarregado } from '../core/compilerEngine/dossieLoader';
const found: DossieCarregado | null = carregarNichoDossie('saas-nexus');
const missing: DossieCarregado | null = carregarNichoDossie(null);
const parsed: DossieCarregado = parsearDossie('{"nicho":"x","pecas":[],"tokensCss":{}}','x');
const pieces: unknown[] = parsed.pecas;
const tokens: object = parsed.tokensCss;
const clear: void = limparCache();
void found;void missing;void pieces;void tokens;void clear;
// @ts-expect-error parsed result is not a number.
const bad: number = parsearDossie('{"nicho":"x","pecas":[],"tokensCss":{}}','x');
void bad;
// @ts-expect-error parsearDossie requires a textual JSON value.
parsearDossie(null,'x');
