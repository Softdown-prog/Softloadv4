'use strict';
const assert = require('node:assert/strict');
const { criticarBlueprint, NICHO_TEMAS_VALIDOS, COLOR_PRESETS_VALIDOS,
    MODULE_OVERRIDES_PERMITIDOS, NICHO_COLOR_INCOMPATIVEIS,
    NICHO_PAGE_TYPE_MAP, NICHOS_HERO_DE_POSTS_REAIS } = require('./blueprintCritics');

const origem = {
    siteName: 'Revista Gamer Real', nichoTema:'gamer-playerone',
    colorPreset:'forest-green', darkMode:'disabled', menuType:'simple',
    moduleOverrides: {contactForm:true, relatedPosts:false, admin:true, popularPostsRanking:'yes'},
    categoryBadges:[{nome:'Reviews',bg:'#fff',text:'#000'},'Notícias',null],
    customCss:'.section{}', postModules:['reading-time'], coreFeatures:['lazy-load']
};
const {blueprint, erros, criticas, correcoes} = criticarBlueprint(origem);
assert.deepEqual(erros, []);
assert.ok(correcoes.some(x=>x.includes('colorPreset')));
assert.equal(blueprint.colorPreset,'gamer-dark');
assert.equal(blueprint.darkMode,'toggle-btn');
assert.equal(blueprint.menuType,'offcanvas');
assert.equal(blueprint.pageType,NICHO_PAGE_TYPE_MAP['gamer-playerone']);
assert.deepEqual(blueprint.moduleOverrides,{contactForm:true,relatedPosts:false});
assert.equal(blueprint.categoryBadges.length,2);
assert.equal(blueprint.categoryBadges[0].text,'#ffffff');
assert.notEqual(blueprint.categoryBadges[0].bg,'#fff');
assert.ok(criticas.some(x=>x.includes('categoryBadge')));
assert.ok(criticas.some(x=>x.includes('moduleOverrides.admin')));
assert.equal(origem.colorPreset,'forest-green','não muta origem');
assert.equal(origem.moduleOverrides.admin,true,'mantém referência original intacta');

const unsafe=criticarBlueprint({siteName:'Blog Oficial',nichoTema:'gamer-playerone',
    heroHtml:'<b:widget/>',customCss:'@import url(https://example.invalid/style.css);'});
assert.ok(unsafe.erros.some(x=>x.includes('heroHtml rejeitado')));
assert.ok(unsafe.erros.some(x=>x.includes('customCss rejeitado')));
assert.ok(!('heroHtml' in unsafe.blueprint));
assert.ok(!('customCss' in unsafe.blueprint));

const absent=criticarBlueprint({siteName:'',nichoTema:'nicho-externo',colorPreset:'inexistente',
    moduleOverrides:['contactForm']});
assert.ok(absent.erros.some(x=>x.includes('siteName ausente')));
assert.ok(absent.criticas.some(x=>x.includes('não existe no catálogo')));
assert.equal(absent.blueprint.colorPreset,'tech-blue');
assert.equal(absent.blueprint.moduleOverrides,undefined);
assert.equal(absent.blueprint.pageType,'blogger-conteudo');

const badName=criticarBlueprint({siteName:'Softload'});
assert.ok(badName.erros.some(x=>x.includes('identificador técnico interno')));

assert.ok(NICHO_TEMAS_VALIDOS.has('gamer-playerone'));
assert.ok(COLOR_PRESETS_VALIDOS.has('tech-blue'));
assert.ok(MODULE_OVERRIDES_PERMITIDOS.has('contactForm'));
assert.deepEqual(NICHO_COLOR_INCOMPATIVEIS['gamer-playerone'].proibidos.includes('forest-green'),true);
assert.ok(NICHOS_HERO_DE_POSTS_REAIS.has('noticias-mag-news'));

const nativeHero=criticarBlueprint({siteName:'Notícias Reais',nichoTema:'noticias-mag-news',
    heroTitle:'Texto inútil',heroSubtitle:'Conteúdo invisível'});
assert.equal(nativeHero.blueprint.heroTitle,undefined);
assert.equal(nativeHero.blueprint.heroSubtitle,undefined);
assert.ok(nativeHero.correcoes.some(x=>x.includes('heroTitle removido')));

const longCss=criticarBlueprint({siteName:'Portal Novo',customCss:'x'.repeat(450)});
assert.equal(longCss.blueprint.customCss.length,400);
assert.ok(longCss.correcoes.some(x=>x.includes('customCss truncado')));

console.log('✅ blueprintCritics: cores, módulos, CSS/XML, nomenclatura, pageType e hero nativo.');
