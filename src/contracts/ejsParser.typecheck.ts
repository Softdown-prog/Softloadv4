import { parseEjs, analisarEjs } from '../core/parser/ejsParser';
import type { EjsParseResult, EjsAnalysisResult } from '../core/parser/ejsParser';

const parsed: EjsParseResult = parseEjs('<h1><%= titulo %></h1>');
if (parsed.ok) {
    const html: string = parsed.fn({ titulo: 'Softload' });
    void html;
} else {
    const mensagem: string = parsed.erro.mensagem;
    void mensagem;
}

const analysis: EjsAnalysisResult = analisarEjs('<%- include("header") %>');
if (analysis.ok) {
    const includes: string[] = analysis.includesReferenciados;
    const sintaxeValida: true = analysis.sintaxeValida;
    void includes;
    void sintaxeValida;
} else {
    const mensagem: string = analysis.erro.mensagem;
    void mensagem;
}
