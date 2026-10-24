"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { executarCompilacao } = require('../src/core/compilerWorker');
const { gerarDiagnostico } = require('../src/core/diagnostico');
const { NICHO_PAGE_TYPE_MAP } = require('../src/core/nichoTaxonomy');
function diagnosticarCorpo(id, corpo) {
    let xmlFinal;
    try {
        ({ xmlFinal } = executarCompilacao(corpo));
    }
    catch (err) {
        console.log(`❌ ${id.padEnd(28)} FALHA NA COMPILAÇÃO: ${err.message}`);
        return { id, erro: true, achadosErro: [] };
    }
    const diag = gerarDiagnostico(xmlFinal);
    const achadosErro = [];
    for (const cat of diag.categorias) {
        for (const a of cat.achados) {
            if (a.nivel === 'erro')
                achadosErro.push(`[${cat.nome}] ${a.mensagem}`);
        }
    }
    const status = achadosErro.length > 0 ? '❌' : '✅';
    console.log(`${status} ${id.padEnd(28)} score=${String(diag.score).padEnd(4)} erros=${diag.totalErros} avisos=${diag.totalAvisos}`);
    if (achadosErro.length > 0) {
        achadosErro.forEach(m => console.log(`     erro: ${m}`));
    }
    return { id, erro: achadosErro.length > 0, achadosErro };
}
function main() {
    const resultados = [];
    console.log('\n🩺 diagnostico-sweep — 14 nichos (opções default)\n');
    for (const nichoTema of Object.keys(NICHO_PAGE_TYPE_MAP)) {
        const corpo = {
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
