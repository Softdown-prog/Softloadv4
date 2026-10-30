require('./test/isolatedTelemetry.cjs');
'use strict';

// Compilação testada sem gravações Firestore nem credenciais de produção.
// A persistência é coberta separadamente por contratos de telemetria.
const telemetryPath = require.resolve('./telemetria');
require.cache[telemetryPath] = {
    id: telemetryPath, filename: telemetryPath, loaded: true,
    exports: { registrarCompilacao() {} },
};
const assert = require('node:assert/strict');
const { validarXmlSaida } = require('./workerXmlValidation');
const { validarXmlSaida: validarXmlSaidaNoWorker, executarCompilacao } = require('./compilerWorker');

// Implementação anterior congelada, independente do novo módulo.
function validarXmlSaidaLegado(xml) {
    const avisos = [];

    if (!xml.includes('<html') || !xml.includes('</html>')) {
        avisos.push('Estrutura <html> ausente no XML de saída.');
    }
    if (!xml.includes('<head') || !xml.includes('</head>')) {
        avisos.push('Estrutura <head> ausente no XML de saída.');
    }
    if (!xml.includes('<body') || !xml.includes('</body>')) {
        avisos.push('Estrutura <body> ausente no XML de saída.');
    }
    if (!xml.includes('<b:skin>') && !xml.includes("<b:skin ")) {
        avisos.push('Tag <b:skin> ausente — CSS não será aplicado pelo Blogger.');
    }
    if (!xml.includes('bootstrap@5') && !xml.includes('bootstrap.min.css')) {
        avisos.push('Bootstrap CDN não encontrado no <head> — layout depende do Bootstrap.');
    }

    // Tokens residuais após repararXml indicam problema no engine
    const orfaos = xml.match(/\[\[[A-Z0-9_]+\]\]/g);
    if (orfaos) {
        avisos.push(`Placeholders residuais detectados: ${[...new Set(orfaos)].join(', ')}`);
    }

    // & nu fora de CDATA → causa SAXParseException no Blogger/Java
    // Remove blocos CDATA antes de checar para não gerar falso positivo
    const xmlForaCdata = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
    const ampNus = xmlForaCdata.match(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g);
    if (ampNus) {
        avisos.push(`SAXParseException potencial: ${ampNus.length} '&' não-escapado(s) fora de CDATA. Use &amp; em heroHtml/svgLogo/staticSections.`);
    }

    return avisos;
}

assert.equal(validarXmlSaidaNoWorker, validarXmlSaida, 'Export público do compilerWorker deve permanecer');

// Diagnóstico correto num esqueleto mínimo com Bootstrap, CDATA e entidades válidas.
const xmlOk = "<html><head><link href='bootstrap.min.css'/><b:skin><![CDATA[.x{content:'a & b'}]]></b:skin></head><body></body></html>";
assert.deepEqual(validarXmlSaida(xmlOk), [], 'CDATA não produz falso positivo para &');
assert.deepEqual(validarXmlSaida('<xml/>'), [
    'Estrutura <html> ausente no XML de saída.',
    'Estrutura <head> ausente no XML de saída.',
    'Estrutura <body> ausente no XML de saída.',
    'Tag <b:skin> ausente — CSS não será aplicado pelo Blogger.',
    'Bootstrap CDN não encontrado no <head> — layout depende do Bootstrap.',
]);
assert.deepEqual(validarXmlSaida(xmlOk.replace('bootstrap.min.css','bootstrap@5')), []);
assert.deepEqual(validarXmlSaida(xmlOk.replace('<b:skin>','<b:skin class="test">')), []);
assert.deepEqual(validarXmlSaida(xmlOk.replace('bootstrap.min.css','BOOTSTRAP.CSS')),
    ['Bootstrap CDN não encontrado no <head> — layout depende do Bootstrap.']);
assert.deepEqual(validarXmlSaida(xmlOk.replace('<head>','<HEAD>')),
    ['Estrutura <head> ausente no XML de saída.']);

// Preserva ordem das mensagens e primeira ocorrência de cada token órfão.
const tokens = xmlOk + ' [[A]] [[B_01]] [[A]] [[a]] [[C9]]';
assert.deepEqual(validarXmlSaida(tokens), [
    'Placeholders residuais detectados: [[A]], [[B_01]], [[C9]]',
]);
assert.deepEqual(validarXmlSaida(xmlOk+'<![CDATA[[[ORFAO]]]>'), [
    'Placeholders residuais detectados: [[ORFAO]]',
], 'O teste de tokens continua incluindo conteúdo do CDATA (legado)');

const entidadesValidas = ['&amp;','&lt;','&gt;','&quot;','&apos;','&#123;','&#xFF;','&#x00af;'];
assert.deepEqual(validarXmlSaida(xmlOk+entidadesValidas.join(' ')), []);
const entidadesInvalidas = '&nbsp; &AMP; &#X3A; &amp &foo; &&';
assert.deepEqual(validarXmlSaida(xmlOk+entidadesInvalidas),[
    "SAXParseException potencial: 7 '&' não-escapado(s) fora de CDATA. Use &amp; em heroHtml/svgLogo/staticSections.",
]);
assert.deepEqual(validarXmlSaida(xmlOk+'<![CDATA[&nbsp;&fo;&&]]>'), []);
assert.deepEqual(validarXmlSaida(xmlOk+'<![CDATA[&bad]]>&other;'),[
    "SAXParseException potencial: 1 '&' não-escapado(s) fora de CDATA. Use &amp; em heroHtml/svgLogo/staticSections.",
]);

// Matriz combinatória: cada condição de estrutura e erros XML pode variar
// independentemente, com comparação exata contra a fórmula JavaScript legada.
let checked=0;
for(let mask=0;mask<256;mask++){
    let sample='';
    if(mask&1)sample+='<html>';
    if(mask&2)sample+='</html>';
    if(mask&4)sample+='<head></head>';
    if(mask&8)sample+='<body></body>';
    if(mask&16)sample+='<b:skin id="theme">';
    if(mask&32)sample+='bootstrap@5';
    if(mask&64)sample+=' [[A]] [[B]] [[A]]';
    if(mask&128)sample+=' &x; <![CDATA[&x;&y;]]> &z;';
    const expected=validarXmlSaidaLegado(sample);
    assert.deepEqual(validarXmlSaida(sample),expected,'Fórmula legada divergiu no mask '+mask);
    assert.deepEqual(validarXmlSaidaNoWorker(sample),expected);
    checked++;
}
// Casos reais: diagnóstico após o motor completo permanece inalterado.
for(const nichoTema of [null,'gamer-playerone','noticias-mag-news','tecnologia-techwind']) {
    const result=executarCompilacao({siteName:'Teste de validação XML',nichoTema});
    assert.deepEqual(validarXmlSaida(result.xmlFinal),validarXmlSaidaLegado(result.xmlFinal));
    checked++;
}
console.log('✅ workerXmlValidation: '+checked+' cenários de equivalência, entidades, CDATA, tokens e XMLs reais.');
