import { injetarDesignPackage, verificarMarcadoresDesignPackage } from '../core/workerDesignPackage';
import type { DesignPackageBody, DesignPackageDependencies, DesignPackageResult, DesignPackageMarkersResult } from '../core/workerDesignPackage';
const input: DesignPackageBody = {customCss:'.x{}',heroHtml:'<h1>Hello</h1>'};
const deps: DesignPackageDependencies = {sanitizarEntidadesXml: x => x,montarWidgetHtml: (id,title,html) => id+title+html,warn: () => {}};
const result: DesignPackageResult = injetarDesignPackage('<xml/>',input,deps);
const markers: DesignPackageMarkersResult = verificarMarcadoresDesignPackage('<xml/>');
void result;void markers;
// @ts-expect-error sanitização recebe string.
const invalidDeps: DesignPackageDependencies = {...deps,sanitizarEntidadesXml: (_x: number) => ''};
void invalidDeps;
// @ts-expect-error injecoes contém apenas strings.
const invalidResult: DesignPackageResult = {xml:'',injecoes:[2]};
void invalidResult;
