'use strict';

/**
 * Testes de scripts/extractTemplate.js (extrairArquivo/extrairDiretorio)
 * -- nunca toca exemplos/ real, sempre diretório temporário isolado.
 * Mesmo padrão de scripts/ragGenerate.test.js -- não faz parte de
 * `npm test` (scripts/ fica fora do scan de scripts/runTests.js), roda
 * manual:
 *
 * Execute: node scripts/extractTemplate.test.js
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { extrairArquivo, extrairDiretorio } = require('./extractTemplate');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

const XML_MINIMO = `
<html>
<head>
<b:skin><![CDATA[body{color:#000}]]></b:skin>
<!-- DP:CSS:START -->
.custom { color: red; }
<!-- DP:CSS:END -->
</head>
<body>
<b:section id='main' class='row'>
  <b:widget id='Blog1' type='Blog'/>
</b:section>
</body>
</html>`.trim();

async function run() {
    // A. extrairArquivo lê o arquivo real e delega pra extrairTemplate.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-test-'));
        const caminho = path.join(dir, 'template.xml');
        fs.writeFileSync(caminho, XML_MINIMO, 'utf8');

        const resultado = extrairArquivo(caminho);
        assert('extrairArquivo devolve customCss extraído', resultado.customCss.includes('color: red'));
        assert('extrairArquivo devolve _meta.usouMarcadores true', resultado._meta.usouMarcadores === true);

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // B. extrairDiretorio processa todo *.xml do diretório, ignora outras extensões.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-test-'));
        fs.writeFileSync(path.join(dir, 'a.xml'), XML_MINIMO, 'utf8');
        fs.writeFileSync(path.join(dir, 'b.xml'), XML_MINIMO, 'utf8');
        fs.writeFileSync(path.join(dir, 'nao-e-xml.txt'), 'ignorar', 'utf8');

        const { extraidos, erros } = extrairDiretorio(dir);
        assert('extrairDiretorio processa só os .xml (2, não 3)', extraidos.length === 2);
        assert('extrairDiretorio não reporta erros pro caso normal', erros.length === 0);
        assert('extrairDiretorio inclui nome do arquivo', extraidos.some((e) => e.nome === 'a.xml'));

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // C. extrairDiretorio reporta erro por arquivo (XML inválido) sem abortar os demais.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-test-'));
        fs.writeFileSync(path.join(dir, 'ok.xml'), XML_MINIMO, 'utf8');
        fs.writeFileSync(path.join(dir, 'quebrado.xml'), '<html><body>', 'utf8');

        const { extraidos, erros } = extrairDiretorio(dir);
        assert('arquivo válido ainda é extraído mesmo com outro quebrado no lote', extraidos.some((e) => e.nome === 'ok.xml'));

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // D. extrairDiretorio lança erro claro pra diretório inexistente.
    {
        let lancou = false;
        try { extrairDiretorio('/caminho/que/nao/existe/de/verdade'); } catch (_) { lancou = true; }
        assert('diretório inexistente lança erro', lancou);
    }

    console.log(`\n${failed === 0 ? '✅' : '❌'} extractTemplate: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
}

run();
