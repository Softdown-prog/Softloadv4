import { parseHtml, analisarHtml } from '../core/parser/htmlParser';
import type { HtmlAnalysisResult, HtmlParseResult } from '../core/parser/htmlParser';

const parsed: HtmlParseResult = parseHtml('<div id="x">Texto</div>');
if (parsed.ok) {
    const fragment = parsed.fragment;
    const parseWarnings = parsed.errosParse;
    void fragment;
    void parseWarnings;
} else {
    const mensagem: string = parsed.erro;
    void mensagem;
}
const report: HtmlAnalysisResult = analisarHtml('<div id="hero"><span id="hero"></span></div>');
if (report.ok) {
    const total: number = report.estrutura.elementos;
    const tags: Record<string, number> = report.estrutura.tags;
    const ids: string[] = report.idsDuplicados;
    void total;
    void tags;
    void ids;
} else {
    const erro: string = report.erro;
    void erro;
}
