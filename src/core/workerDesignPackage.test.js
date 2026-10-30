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
const fs = require('node:fs');
const path = require('node:path');
const { injetarDesignPackage, verificarMarcadoresDesignPackage } = require('./workerDesignPackage');
const { executarCompilacao, verificarMarcadoresDesignPackage: checkPublico } = require('./compilerWorker');
const { sanitizarEntidadesXml, montarWidgetHtml } = require('./compilerEngine');
const { NICHO_CHASSIS_MAP } = require('./nichoTaxonomy');

const warnings = [];
const widgetCalls = [];
const dependencies = {
    sanitizarEntidadesXml,
    montarWidgetHtml: (id, title, html) => {
        widgetCalls.push({id,title,html});
        return montarWidgetHtml(id,title,html);
    },
    warn: message => warnings.push(message),
};
const xml = '<html><head></head><body><b:skin><![CDATA[ .x{} ]]></b:skin>'
    + "<b:section id='header-logo'/>"
    + "<b:section id='main'/>"
    + '</body></html>';
const inject = (source, body) => injetarDesignPackage(source,body,dependencies);
for(const body of [{},{darkTheme:'false'},{customCss:'  '},{heroHtml:'',staticSections:null},{svgLogo:45},{darkTheme:false}]) {
    assert.deepEqual(inject(xml,body),{xml,injecoes:[]});
}
assert.deepEqual(inject(xml,{darkTheme:'true'}).injecoes,['darkTheme']);
assert.ok(inject(xml,{darkTheme:true}).xml.indexOf("setAttribute('data-bs-theme','dark')")<inject(xml,{darkTheme:true}).xml.indexOf('</head>'));
assert.deepEqual(inject('<html></html>',{darkTheme:true}).injecoes,[]);
const css='  .x:after{content:"a&b"}  ';
const inside=inject(xml,{customCss:css});
assert.deepEqual(inside.injecoes,['customCss']);
assert.ok(inside.xml.includes('<!-- DP:CSS:START -->\n.x:after{content:"a&b"}'));
const noCdata=xml.replace('<![CDATA[ .x{} ]]>','.x{}');
const outside=inject(noCdata,{customCss:css});
assert.ok(outside.xml.includes('<!-- DP:CSS:START -->\n.x:after{content:"a&amp;b"}'));
const noSkin=xml.replace('<b:skin><![CDATA[ .x{} ]]></b:skin>','');
assert.deepEqual(inject(noSkin,{customCss:css}).injecoes,[]);

const svg='<svg data-label="a&b"/>';
const logo=inject(xml,{svgLogo:svg});
assert.deepEqual(logo.injecoes,['svgLogo']);
assert.ok(logo.xml.indexOf('DP:LOGO:START')<logo.xml.indexOf("<b:section id='header-logo'"));
assert.ok(logo.xml.includes('a&amp;b'));
for(const brand of ['saas-nav-brand','sl-header-brand','mag-nav-brand','portfolio-brand','navbar-brand']) {
    const brandXml=xml.replace("<b:section id='header-logo'/>","<a class='"+brand+"'>Marca</a>");
    const result=inject(brandXml,{svgLogo:svg});
    assert.deepEqual(result.injecoes,['svgLogo']);
    assert.ok(result.xml.includes("class='"+brand+"'>\n        <!-- DP:LOGO:START -->"));
}
const noBrand=xml.replace("<b:section id='header-logo'/>",'');
const nWarnings=warnings.length;
assert.deepEqual(inject(noBrand,{svgLogo:svg}),{xml:noBrand,injecoes:[]});
assert.deepEqual(warnings.slice(nWarnings),['[COMPILER-WORKER] svgLogo: nenhum marcador de brand encontrado no template.']);

widgetCalls.length=0;
const heroHtml=' <h1>Hero</h1> ';
const staticSections='<p>Seções</p>';
const everything=inject(xml,{darkTheme:true,customCss:css,svgLogo:svg,heroHtml,staticSections});
assert.deepEqual(everything.injecoes,['darkTheme','customCss','svgLogo','heroHtml','staticSections']);
assert.deepEqual(widgetCalls.map(c=>c.id),['HTML90','HTML91']);
assert.deepEqual(widgetCalls.map(c=>c.html),[heroHtml,staticSections]);
assert.ok(everything.xml.includes("<b:if cond='data:view.isMultipleItems'>"));
assert.ok(everything.xml.indexOf("id='landing-hero'")<everything.xml.indexOf("id='landing-sections'"));
assert.ok(everything.xml.indexOf('DP:SECTIONS:END')<everything.xml.indexOf('</b:if>'));
assert.ok(everything.xml.indexOf('</b:if>')<everything.xml.indexOf("<b:section id='main'"));
const noMain=xml.replace("<b:section id='main'/>",'');
assert.deepEqual(inject(noMain,{heroHtml,staticSections}),{xml:noMain,injecoes:[]});

assert.deepEqual(verificarMarcadoresDesignPackage('<xml/>'),{ok:false,erros:[
    'darkTheme: marcador "</head>" ausente.',
    'customCss: nem "]]></b:skin>" (CDATA) nem "</b:skin>" (fallback) presentes.',
    'svgLogo: nem "header-logo" nem nenhuma classe de marca conhecida presentes.',
    'heroHtml/staticSections: marcador canônico "<b:section id=\'main\'" ausente.',
]});
assert.deepEqual(verificarMarcadoresDesignPackage(xml),{ok:true,erros:[]});
assert.deepEqual(verificarMarcadoresDesignPackage(noCdata),{ok:true,erros:[]});
assert.equal(checkPublico,verificarMarcadoresDesignPackage);
for(const niche of Object.keys(NICHO_CHASSIS_MAP)) {
    const file=path.join(__dirname,'../blogger/templates','template_'+niche+'.xml');
    if(fs.existsSync(file)) {
        const data=fs.readFileSync(file,'utf8');
        assert.deepEqual(checkPublico(data),verificarMarcadoresDesignPackage(data));
    }
}
// Regressão integrada: dossiê com hero protegido suprime hero genérico, não staticSections.
const actual=executarCompilacao({
    siteName:'Teste Etapa 14',nichoTema:'gamer-playerone',
    heroHtml:'<h1>Hero boilerplate Etapa 14</h1>',
    staticSections:'<p class="dp-etapa14-marker">Extra</p>',
});
assert.ok(!actual.xmlFinal.includes('Hero boilerplate Etapa 14'));
assert.ok(actual.xmlFinal.includes('dp-etapa14-marker'));
console.log('✅ workerDesignPackage: CDATA, SVG, home-only widgets, marcadores e hero protegido.');
