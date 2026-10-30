"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compilarLote = compilarLote;
const fs = require('fs');
const path = require('path');
const { executarCompilacao } = require('../src/core/compilerWorker');
function parseArg(args, nome, padrao) {
    const prefixo = `--${nome}=`;
    const encontrado = args.find((a) => a.startsWith(prefixo));
    return encontrado ? encontrado.slice(prefixo.length) : padrao;
}
/** Compila manifestos JSON em XML, sem interromper o lote em caso de erro individual. */
function compilarLote({ dir, outDir }) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        throw new Error(`Diretório de manifestos não encontrado: ${dir}`);
    }
    const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    const compilados = [];
    const erros = [];
    if (arquivos.length === 0) {
        return { compilados, erros };
    }
    fs.mkdirSync(outDir, { recursive: true });
    for (const nome of arquivos) {
        const caminhoManifesto = path.join(dir, nome);
        try {
            const manifesto = JSON.parse(fs.readFileSync(caminhoManifesto, 'utf8'));
            const { xmlFinal } = executarCompilacao(manifesto, { telemetry: false });
            const caminhoSaida = path.join(outDir, `${path.basename(nome, '.json')}.xml`);
            fs.writeFileSync(caminhoSaida, xmlFinal, 'utf8');
            compilados.push({ manifesto: nome, saida: caminhoSaida });
        }
        catch (err) {
            erros.push({ manifesto: nome, erro: err.message });
        }
    }
    return { compilados, erros };
}
function main() {
    const args = process.argv.slice(2);
    const dir = path.resolve(parseArg(args, 'dir', 'manifests'));
    const outDir = path.resolve(parseArg(args, 'out', 'dist/compiled'));
    let resultado;
    try {
        resultado = compilarLote({ dir, outDir });
    }
    catch (err) {
        console.error(`[COMPILE-BATCH] falhou: ${err.message}`);
        process.exit(1);
        return;
    }
    const { compilados, erros } = resultado;
    if (compilados.length === 0 && erros.length === 0) {
        console.log(`Nenhum manifesto (*.json) encontrado em ${dir}`);
        process.exit(0);
        return;
    }
    console.log(`\n✅ compilados (${compilados.length}):`);
    for (const c of compilados)
        console.log(`   - ${c.manifesto} -> ${c.saida}`);
    if (erros.length) {
        console.log(`\n❌ erros (${erros.length}):`);
        for (const e of erros)
            console.log(`   - ${e.manifesto}: ${e.erro}`);
    }
    process.exit(erros.length > 0 ? 1 : 0);
}
if (require.main === module)
    main();
