import { parseXml, analisarXml } from '../core/parser/xmlParser';
import type { XmlParseResult, XmlAnalysisResult } from '../core/parser/xmlParser';

const parsed: XmlParseResult = parseXml('<root><item id="x"/></root>');
if (parsed.ok) {
    const tree: Record<string, unknown> = parsed.arvore;
    void tree;
} else {
    const linha: number | null = parsed.erro.linha;
    void linha;
}
const report: XmlAnalysisResult = analisarXml('<root><item id="a"/></root>');
if (report.ok) {
    const tags: Record<string, number> = report.estrutura.tags;
    const ids: { id: string; tag: string }[] = report.idsDuplicados;
    void tags;
    void ids;
} else {
    const message: string = report.erro.mensagem;
    void message;
}
