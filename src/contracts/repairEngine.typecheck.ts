import { repararXml, repararCssTruncado } from '../core/repairEngine';
import type { XmlRepair, XmlRepairResult, CssTruncadoResult } from '../core/repairEngine';
const reparo: XmlRepairResult = repararXml('<html/>');
const lista: XmlRepair[] = reparo.reparos;
const html: string = reparo.xml;
const css: CssTruncadoResult<string> = repararCssTruncado('a { color:red');
const originalNull: CssTruncadoResult<null> = repararCssTruncado(null);
const originalNumber: CssTruncadoResult<number> = repararCssTruncado(33);
void html;void css;void lista;void originalNull;void originalNumber;
// @ts-expect-error repararXml exige string.
repararXml(null);
// @ts-expect-error resultado de reparo não é um número.
const malformed: number = repararXml('<xml/>');
void malformed;
// @ts-expect-error metadado 'reparado' precisa ser boolean.
const badCss: CssTruncadoResult<string> = {css:'', reparado:1};
void badCss;
