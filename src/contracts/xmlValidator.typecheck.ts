import {
    validarXmlCompilado,
    validarXmlEstrutura,
    validarSemanticaBlogger,
} from '../core/xmlValidator';
import type { XmlValidationReport } from '../core/xmlValidator';

const xml = "<html xmlns:b='http://www.google.com/2005/gml/b'><b:section><b:widget id='Blog1' type='Blog'/></b:section></html>";
const blocking: string[] = validarXmlCompilado(xml);
const structure: XmlValidationReport = validarXmlEstrutura(xml);
const semantics: XmlValidationReport = validarSemanticaBlogger(xml);
const issues: string[] = structure.erros.concat(semantics.avisos);
void blocking;
void issues;
