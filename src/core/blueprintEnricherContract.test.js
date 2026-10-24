'use strict';
const assert = require('node:assert/strict');
const { enriquecerBlueprint } = require('./blueprintEnricher');

(async () => {
    const original = {
        siteName: 'A&B <Studio>',
        nichoTema: 'gamer-playerone',
        heroTitle: 'Destaques & <Jogos>',
        heroSubtitle: 'Melhores <reviews> & guias',
        categoryBadges: [
            {nome:'Notícias & mais', bg:'#010203',text:'#fafafa'},
            'Simuladores',
            {nome:'Novidades'},
            {nome:'Quatro'},
            {nome:'Cinco'},
            {nome:'SEIS'},
        ],
        metaOriginal: {preservar:true},
    };
    const chamadas=[];
    const enriched = await enriquecerBlueprint(original, label => chamadas.push(label));
    assert.deepEqual(chamadas,['Personalizando identidade visual...']);
    assert.notStrictEqual(enriched,original,'enriquecimento cria objeto independente');
    assert.strictEqual(enriched.metaOriginal,original.metaOriginal,'campos não visuais mantêm referência original');
    assert.equal(original.heroHtml,undefined,'não muta entrada');
    assert.ok(enriched.heroHtml.includes('Destaques &amp; &lt;Jogos&gt;'));
    assert.ok(enriched.heroHtml.includes('Melhores &lt;reviews&gt; &amp; guias'));
    assert.ok(enriched.heroHtml.includes('Notícias &amp; mais'));
    assert.ok(enriched.heroHtml.includes("background:#010203;color:#fafafa"));
    assert.ok(enriched.heroHtml.includes("background:var(--sl-primary);color:#ffffff"),'fallback de cores para categorias avulsas');
    assert.equal((enriched.heroHtml.match(/class='badge rounded-pill/g)||[]).length,5,'limite de cinco categorias');
    assert.ok(!enriched.heroHtml.includes('SEIS'),'não inclui sexta categoria');

    const css='.ja-existe{color:orange}',hero='<section id="ja-existe"><h1>Original</h1></section>';
    const ready={siteName:'Site',heroHtml:hero,customCss:css};
    const unchanged=await enriquecerBlueprint(ready);
    assert.strictEqual(unchanged.heroHtml,hero);
    assert.strictEqual(unchanged.customCss,css);
    assert.notStrictEqual(unchanged,ready);
    assert.strictEqual(unchanged.siteName,'Site');

    const withoutNiche=await enriquecerBlueprint({siteName:'Site'});
    assert.ok(withoutNiche.heroHtml.includes('informação de verdade'));
    const withNiche=await enriquecerBlueprint({siteName:'Site',nichoTema:'tecnologia-techwind'});
    assert.ok(withNiche.heroHtml.includes('Programação, ferramentas'));

    const invalidBadges=await enriquecerBlueprint({siteName:'Site',categoryBadges:[null,0,'Jogos']});
    assert.equal((invalidBadges.heroHtml.match(/class='badge rounded-pill/g)||[]).length,3);
    assert.ok(invalidBadges.heroHtml.includes('Jogos'));
    console.log('✅ blueprintEnricher: escapes, 5 categorias, cores, imutabilidade e compatibilidade.');
})().catch(err=>{console.error(err);process.exitCode=1;});
