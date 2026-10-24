import { parseJs, analisarJs } from '../core/parser/jsParser';
import type { JsAnalysisResult, JsParseResult } from '../core/parser/jsParser';

const parsed: JsParseResult = parseJs('const answer = 42;');
if (parsed.ok) {
    const nodeType: string = parsed.ast.type;
    void nodeType;
} else {
    const line: number | null = parsed.erro.linha;
    void line;
}
const analysed: JsAnalysisResult = analisarJs('function x(){ console.log("ok"); }');
if (analysed.ok) {
    const count: number = analysed.estrutura.funcoes;
    const ids: { nome: string; linha: number | null }[] = analysed.identificadoresNaoDeclarados;
    const logs: { metodo: string; linha: number | null }[] = analysed.consoleLogs;
    void count;
    void ids;
    void logs;
} else {
    const message: string = analysed.erro.mensagem;
    void message;
}
