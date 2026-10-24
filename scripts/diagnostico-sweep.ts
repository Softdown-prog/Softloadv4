export {};
/**
 * Diagnóstico em lote dos nichos Blogger. O CLI permanece idêntico:
 * node scripts/diagnostico-sweep.js
 *
 * O compilador e os serviços de diagnóstico continuam em CommonJS;
 * esta fonte TypeScript define os contratos consumidos pelo script.
 */
interface SweepManifest {
    siteName: string;
    nichoTema: string;
    colorPreset: string;
    typography: string;
    gridLayout: string;
}
interface SweepFinding { nivel: string; mensagem: string }
interface SweepCategory { nome: string; achados: SweepFinding[] }
interface SweepDiagnosis {
    score: number;
    totalErros: number;
    totalAvisos: number;
    categorias: SweepCategory[];
}
interface SweepResult { id: string; erro: boolean; achadosErro: string[] }

declare const console: { log(...values: unknown[]): void; error(...values: unknown[]): void };
declare const require: (id: string) => unknown;
declare const process: { exit(code: number): never };
const { executarCompilacao } = require('../src/core/compilerWorker') as {
    executarCompilacao(corpo: SweepManifest): { xmlFinal: string };
};
const { gerarDiagnostico } = require('../src/core/diagnostico') as {
    gerarDiagnostico(xml: string): SweepDiagnosis;
};
const { NICHO_PAGE_TYPE_MAP } = require('../src/core/nichoTaxonomy') as {
    NICHO_PAGE_TYPE_MAP: Record<string, string>;
};

function diagnosticarCorpo(id: string, corpo: SweepManifest): SweepResult {
    let xmlFinal: string;
    try {
        ({ xmlFinal } = executarCompilacao(corpo));
    } catch (err) {
        console.log(`❌ ${id.padEnd(28)} FALHA NA COMPILAÇÃO: ${(err as Error).message}`);
        return { id, erro: true, achadosErro: [] };
    }

    const diag = gerarDiagnostico(xmlFinal);
    const achadosErro: string[] = [];
    for (const cat of diag.categorias) {
        for (const a of cat.achados) {
            if (a.nivel === 'erro') achadosErro.push(`[${cat.nome}] ${a.mensagem}`);
        }
    }

    const status = achadosErro.length > 0 ? '❌' : '✅';
    console.log(`${status} ${id.padEnd(28)} score=${String(diag.score).padEnd(4)} erros=${diag.totalErros} avisos=${diag.totalAvisos}`);
    if (achadosErro.length > 0) {
        achadosErro.forEach(m => console.log(`     erro: ${m}`));
    }

    return { id, erro: achadosErro.length > 0, achadosErro };
}

function main(): void {
    const resultados: SweepResult[] = [];

    console.log('\n🩺 diagnostico-sweep — 14 nichos (opções default)\n');
    for (const nichoTema of Object.keys(NICHO_PAGE_TYPE_MAP)) {
        const corpo: SweepManifest = {
            siteName: 'Diagnóstico Sweep', nichoTema,
            colorPreset: 'tech-blue', typography: 'inter', gridLayout: 'revista',
        };
        resultados.push(diagnosticarCorpo(nichoTema, corpo));
    }

    const comErro = resultados.filter(r => r.erro);
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`${resultados.length - comErro.length}/${resultados.length} sem erro real | ${comErro.length} com erro real`);

    if (comErro.length > 0) {
        console.log(`\n❌ Itens com erro: ${comErro.map(r => r.id).join(', ')}`);
        process.exit(1);
    }
    console.log('✅ Nenhum erro real encontrado (avisos, se houver, foram listados acima).\n');
}

main();
