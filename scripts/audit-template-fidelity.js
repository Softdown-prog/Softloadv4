'use strict';

/**
 * Diagnostica FIDELIDADE ESTRUTURAL do XML gerado em relação ao exemplo
 * autoral, além de executar a auditoria existente do Blogger.
 *
 * A nota aqui mede preservação de seções e componentes, NÃO semelhança
 * visual ou aprovação de instalação no Blogger. Não chamar isso de nota
 * de aparência; screenshots desktop/mobile são uma etapa separada.
 *
 * node scripts/audit-template-fidelity.js [--out=out/template-fidelity]
 */
const fs = require('fs');
const path = require('path');
const { executarCompilacao } = require('../src/core/compilerWorker');
const { gerarDiagnostico } = require('../src/core/diagnostico');
const { NICHO_PAGE_TYPE_MAP } = require('../src/core/nichoTaxonomy');

const ROOT = path.resolve(__dirname, '..');
// Gate de regressão ESTRUTURAL, não nota de beleza nem teste no Blogger.
const MIN_STRUCTURAL_SCORE = 75;
const BOOTSTRAP_5 = /bootstrap@5\.[\d.]+\/dist\/css\/bootstrap\.min\.css/i;
const BUNDLE_5 = /bootstrap@5\.[\d.]+\/dist\/js\/bootstrap\.bundle\.min\.js/i;

// Exclusivamente substituições documentadas nos esqueletos autorais.
// Registrar IDs sem equivalência real como "ausentes", nunca inventar
// pontuação visual alta para esconder uma regressão de design.
const ALIASES_SECOES = {
    'pop-retro-pixel': {
        'header-top': 'header-logo', // seção de Header1 preservada
        'main-feed': 'main',         // seção Blog1 preservada
    },
    'biolink-social': {
        'profile-section': 'header-logo', // perfil Header1
        'links-section': 'main',          // lista de links editáveis
        'whatsapp-floating': 'whatsapp-float', // gadget de WhatsApp
        // footer-copyright não tem equivalente 1:1: revisão necessária.
    },
};


function uniqueMatches(xml, regex) {
    return [...new Set([...xml.matchAll(regex)].map(m => m[1]))].sort();
}

function signatures(xml) {
    return {
        sections: uniqueMatches(xml, /<b:section\b[^>]*\bid=['"]([^'"]+)['"]/g),
        widgets: uniqueMatches(xml, /<b:widget\b[^>]*\btype=['"]([^'"]+)['"]/g),
        includables: uniqueMatches(xml, /<b:includable\b[^>]*\bid=['"]([^'"]+)['"]/g),
        bootstrapCss5: BOOTSTRAP_5.test(xml),
        bootstrapJs5: BUNDLE_5.test(xml),
    };
}

function comparison(original, generated, aliases = {}) {
    const matched = (before, after) => before.filter(x => after.includes(x));
    const sectionsKept = original.sections.filter(id => generated.sections.includes(id) ||
        (aliases[id] && generated.sections.includes(aliases[id])));
    const renamedSections = original.sections
        .filter(id => !generated.sections.includes(id) &&
            aliases[id] && generated.sections.includes(aliases[id]))
        .map(id=>({oldId:id,newId:aliases[id]}));
    const widgetsKept = matched(original.widgets, generated.widgets);
    const missingSections = original.sections.filter(x => !sectionsKept.includes(x));
    const missingWidgets = original.widgets.filter(x => !widgetsKept.includes(x));
    const sectionCoverage = original.sections.length ? sectionsKept.length/original.sections.length : null;
    const widgetCoverage = original.widgets.length ? widgetsKept.length/original.widgets.length : null;
    // A semântica do Blogger pode exigir substituir widgets originais, então
    // perdas são SINAIS para inspeção, não erros automáticos de compilação.
    const weighted = [
        ...(sectionCoverage === null ? [] : [{ v:sectionCoverage, weight:75 }]),
        ...(widgetCoverage === null ? [] : [{ v:widgetCoverage, weight:25 }]),
    ];
    const score = weighted.length
        ? Math.round(100 * weighted.reduce((sum,x)=>sum + x.v*x.weight, 0) /
          weighted.reduce((sum,x)=>sum+x.weight,0))
        : null;
    return { scoreEstrutural: score, sectionCoverage, widgetCoverage,
        sectionsKept, renamedSections, missingSections, missingWidgets,
        originalSections: original.sections.length, generatedSections: generated.sections.length,
        originalWidgetTypes: original.widgets, generatedWidgetTypes: generated.widgets };
}

function auditNiche(nicho, siteName = 'Auditoria Softload') {
    const originalPath = path.join(ROOT,'exemplos',nicho+'.xml');
    const hasOriginal = fs.existsSync(originalPath);
    const original = hasOriginal ? fs.readFileSync(originalPath,'utf8') : null;
    const generated = executarCompilacao({ siteName, nichoTema:nicho });
    const xml = generated.xmlFinal;
    const s = signatures(xml);
    const diag = gerarDiagnostico(xml);
    const originalSignature = original ? signatures(original) : null;
    const reference = original ? comparison(originalSignature,s,ALIASES_SECOES[nicho]||{}) : null;
    const errors = diag.categorias.flatMap(c=>c.achados
        .filter(a=>a.nivel==='erro').map(a=>'['+c.id+'] '+a.mensagem));
    return {
        nicho, siteName,
        example: hasOriginal ? 'exemplos/'+nicho+'.xml' : null,
        sizes:{ exampleBytes:original?Buffer.byteLength(original):null,
                generatedBytes:Buffer.byteLength(xml) },
        generated:{ sections:s.sections.length, widgetTypes:s.widgets.length,
            bootstrapCss5:s.bootstrapCss5, bootstrapJs5:s.bootstrapJs5 },
        reference, originalFramework:originalSignature
            ? {bootstrapCss5:originalSignature.bootstrapCss5,
               bootstrapJs5:originalSignature.bootstrapJs5} : null,
        diagnostic:{ score:diag.score, errors:diag.totalErros,
            warnings:diag.totalAvisos, findings:errors },
        // Somente erros OBJETIVOS barram o CI. Similaridade exige inspeção
        // humana: um tema pode alterar IDs por segurança/parametrização.
        // Não exigir Bootstrap onde o próprio exemplo autoral não o usa.
        // Para nichos sem exemplo, conferir separadamente no piloto visual.
        blocked:diag.totalErros>0 ||
            !!(originalSignature?.bootstrapCss5 && !s.bootstrapCss5) ||
            !!(originalSignature?.bootstrapJs5 && !s.bootstrapJs5) ||
            !!(reference && reference.scoreEstrutural < MIN_STRUCTURAL_SCORE),
    };
}

function run({outDir} = {}) {
    const result = {schemaVersion:1,kind:'structural-not-visual',time:new Date().toISOString(),
        niches:[],summary:{}};
    for (const nicho of Object.keys(NICHO_PAGE_TYPE_MAP)) {
        try {
            const a=auditNiche(nicho);
            result.niches.push(a);
            console.log((a.blocked?'FAIL':'OK  ')+' '+nicho+
                ' XML='+a.diagnostic.score+'/100'+
                ' fidelidade='+(a.reference?.scoreEstrutural??'sem-exemplo')+
                ' seções perdidas='+(a.reference?.missingSections.length??'n/a')+
                ' b5='+a.generated.bootstrapCss5+'/'+a.generated.bootstrapJs5);
        } catch(e) {
            result.niches.push({nicho,blocked:true,compilationError:e.message});
            console.error('FAIL '+nicho+' compilação: '+e.message);
        }
    }
    result.summary={total:result.niches.length,
        blocked:result.niches.filter(x=>x.blocked).map(x=>x.nicho),
        missingExample:result.niches.filter(x=>!x.example).map(x=>x.nicho),
        lowFidelityForReview:result.niches.filter(x=>x.reference &&
            x.reference.scoreEstrutural<85).map(x=>({nicho:x.nicho,score:x.reference.scoreEstrutural,
                missing:x.reference.missingSections}))};
    if(outDir){
        fs.mkdirSync(outDir,{recursive:true});
        fs.writeFileSync(path.join(outDir,'fidelity.json'),JSON.stringify(result,null,2)+'\n');
        const rows=result.niches.map(x=>'| '+x.nicho+' | '+
            (x.compilationError?'FALHA':x.diagnostic.score)+' | '+
            (x.reference?.scoreEstrutural??'sem referência')+' | '+
            (x.reference?.missingSections.join(', ')||'-')+' | '+
            (x.reference?.renamedSections.map(a=>a.oldId+' → '+a.newId).join(', ')||'-')+
            ' | '+(x.blocked?'BLOQUEADO':'-')+' |');
        fs.writeFileSync(path.join(outDir,'fidelity.md'),
            '# Auditoria de fidelidade estrutural\n\n'+
            'Comparação de seções por ID e tipos de widget do XML gerado contra os exemplos autorais. '+
            '**Não representa nota visual, aprovação no Blogger, ou semelhança pixel a pixel.**\n'+
            'Gate de regressão: '+MIN_STRUCTURAL_SCORE+'/100 de fidelidade estrutural; revisões visuais abaixo de 85/100.\n\n'+
            '| Nicho | Diagnóstico XML | Fidelidade estrutural | Seções ausentes | Renomeações documentadas | Bloqueio |\n'+
            '|---|---:|---:|---|---|---|\n'+rows.join('\n')+'\n');
    }
    return result;
}
if (require.main===module) {
    const arg=process.argv.find(x=>x.startsWith('--out='));
    const outDir=path.resolve(arg?.slice(6)||'out/template-fidelity');
    const result=run({outDir});
    console.log('\nNICHOS BLOQUEADOS:',result.summary.blocked.join(', ')||'nenhum');
    console.log('PARA REVISÃO:',JSON.stringify(result.summary.lowFidelityForReview));
    process.exitCode=result.summary.blocked.length?1:0;
}
module.exports={signatures,comparison,auditNiche,run};
