"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extrairArquivo = extrairArquivo;
exports.extrairDiretorio = extrairDiretorio;
const fs = require('fs');
const path = require('path');
const { extrairTemplate } = require('../src/core/templateExtractor');
function extrairArquivo(caminho) {
    const xml = fs.readFileSync(caminho, 'utf8');
    return extrairTemplate(xml);
}
function extrairDiretorio(dir) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        throw new Error(`Diretório não encontrado: ${dir}`);
    }
    const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith('.xml'));
    const extraidos = [];
    const erros = [];
    for (const nome of arquivos) {
        const caminho = path.join(dir, nome);
        try {
            extraidos.push({ nome, meta: extrairArquivo(caminho)._meta });
        }
        catch (err) {
            erros.push({ nome, erro: err.message });
        }
    }
    return { extraidos, erros };
}
function main() {
    const args = process.argv.slice(2);
    const modoTodos = args.includes('--all');
    const posicional = args.find((a) => !a.startsWith('--'));
    if (modoTodos) {
        const dir = path.resolve(posicional || '.');
        const { extraidos, erros } = extrairDiretorio(dir);
        if (extraidos.length === 0 && erros.length === 0) {
            console.log(`Nenhum .xml encontrado em ${dir}`);
            process.exit(0);
        }
        for (const { nome, meta } of extraidos) {
            console.log(`\n=== ${nome} ===`);
            console.log(JSON.stringify(meta, null, 2));
        }
        if (erros.length) {
            console.log(`\n❌ falhas (${erros.length}):`);
            for (const { nome, erro } of erros)
                console.log(`   - ${nome}: ${erro}`);
        }
        process.exit(erros.length > 0 ? 1 : 0);
        return;
    }
    if (!posicional) {
        console.error('Uso: npm run extract -- <arquivo.xml>\n   ou: npm run extract:all -- [diretorio]');
        process.exit(1);
    }
    const caminho = path.resolve(posicional);
    if (!fs.existsSync(caminho)) {
        console.error(`Arquivo não encontrado: ${caminho}`);
        process.exit(1);
    }
    try {
        console.log(JSON.stringify(extrairArquivo(caminho), null, 2));
    }
    catch (err) {
        console.error(`Falha ao extrair ${caminho}: ${err.message}`);
        process.exit(1);
    }
}
if (require.main === module)
    main();
