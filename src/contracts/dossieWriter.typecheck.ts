import { adicionarPeca, substituirPecas, substituirDossieCompleto } from '../core/compilerEngine/dossieWriter';
import type { DossieWriterResult, DossieWriterPatch } from '../core/compilerEngine/dossieWriter';
const added: DossieWriterResult = adicionarPeca('appstore-bulma-mobile', {id:'nova'});
const replaced: DossieWriterResult = substituirPecas('appstore-bulma-mobile', []);
const rejected: DossieWriterResult = substituirPecas('appstore-bulma-mobile', null);
const patch: DossieWriterPatch = { tokensCss: { light_mode: {} }, pecas: [] };
const complete: DossieWriterResult = substituirDossieCompleto('appstore-bulma-mobile', patch);
const errors: string[] = complete.erros;
const ok: boolean = added.ok;
void replaced; void rejected; void errors; void ok;
// @ts-expect-error nome do nicho é string.
adicionarPeca(12, {id:'x'});
// @ts-expect-error exige objeto de atualização.
substituirDossieCompleto('appstore-bulma-mobile');
// @ts-expect-error retorno é objeto, não number.
const invalid: number = substituirPecas('appstore-bulma-mobile', []);
void invalid;
