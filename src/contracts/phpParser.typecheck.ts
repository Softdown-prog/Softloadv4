import { parsePhp, analisarPhp } from '../core/parser/phpParser';
import type { PhpAnalysisResult, PhpParseResult } from '../core/parser/phpParser';

const parsed: PhpParseResult = parsePhp('<?php echo "ok";');
if (parsed.ok) {
    const nodes = parsed.ast.children;
    void nodes;
} else {
    const mensagem: string = parsed.erro.mensagem;
    const linha: number | null = parsed.erro.linha;
    void mensagem;
    void linha;
}

const report: PhpAnalysisResult = analisarPhp('<?php function soma() {}');
if (report.ok) {
    const functions: string[] = report.estrutura.funcoesDeclaradas;
    const classes: string[] = report.estrutura.classesDeclaradas;
    void functions;
    void classes;
} else {
    const coluna: number | null = report.erro.coluna;
    void coluna;
}
