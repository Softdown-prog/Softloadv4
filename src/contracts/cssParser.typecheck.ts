import { parseCss, analisarCss } from '../core/parser/cssParser';
import type { CssParseResult, CssAnalysisResult } from '../core/parser/cssParser';

const parsed: CssParseResult = parseCss('.card { color: red }');
if (parsed.ok) {
    const selector: string = parsed.root.nodes[0]?.type ?? '';
    void selector;
} else {
    const linha: number | null = parsed.erro.linha;
    void linha;
}
const result: CssAnalysisResult = analisarCss('.card { color: var(--global); }', { tokensExternos: ['--global'] });
if (result.ok) {
    const unused: { nome: string; linha: number | null }[] = result.variaveisOrfas;
    void unused;
} else {
    const mensagem: string = result.erro.mensagem;
    void mensagem;
}
