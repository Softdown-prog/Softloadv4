import { refinarBlueprint } from '../core/blueprintSelector';
import type { SelectorBlueprint, SelectorReport, SelectorResult } from '../core/blueprintSelector';

const blueprint: SelectorBlueprint = {
    siteName: 'Meu Portal',
    nichoTema: 'tecnologia-techwind',
    colorPreset: 'tech-blue',
    menuType: 'offcanvas',
};
const promise: Promise<SelectorResult> = refinarBlueprint(blueprint);
async function check(): Promise<void> {
    const { blueprint: selected, report } = await refinarBlueprint(blueprint);
    const errors: string[] = report.erros;
    const refinado: boolean = report.refined;
    const typed: SelectorReport = report;
    void selected; void errors; void refinado; void typed;
}
void promise; void check;
// @ts-expect-error não aceita texto em vez de blueprint.
refinarBlueprint('portal');
// @ts-expect-error retorno assíncrono e não um objeto síncrono.
const result: SelectorResult = refinarBlueprint(blueprint);
void result;
// @ts-expect-error refined precisa ser booleano.
const invalidReport: SelectorReport = { criticas: [], erros: [], correcoes: [], refined: 'sim' };
void invalidReport;
