import { temHeroProtegido, prepararDesignPackage, temCamposDesignPackage } from '../core/workerHeroGuard';
import type { WorkerHeroDossier, WorkerDesignPackageFields } from '../core/workerHeroGuard';
const dossie: WorkerHeroDossier = {pecas:[{tipo:'hero',protegida:true}]};
const body: WorkerDesignPackageFields = {heroHtml:'<h1>Hero</h1>',staticSections:'<p>Extra</p>'};
const protegido: boolean = temHeroProtegido(dossie);
const preparado: WorkerDesignPackageFields = prepararDesignPackage(body,protegido);
const ativo: boolean = temCamposDesignPackage(preparado);
void ativo;
// @ts-expect-error protegida deve ser boolean.
const wrong: WorkerHeroDossier = {pecas:[{tipo:'hero',protegida:'true'}]};
void wrong;
