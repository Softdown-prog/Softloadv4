'use strict';
const assert = require('node:assert/strict');
const { temHeroProtegido, prepararDesignPackage, temCamposDesignPackage } = require('./workerHeroGuard');
function legacyHero(dossie) {
    return !!(dossie && dossie.pecas.some(p => p.tipo === 'hero' && p.protegida));
}
function legacyFields(body) {
    const CAMPOS = ['customCss','svgLogo','heroHtml','staticSections','darkTheme'];
    return CAMPOS.some(c => body[c] !== undefined && body[c] !== null && body[c] !== '');
}
let checked = 0;
for (const dossie of [null, undefined, {pecas:[]}, {pecas:[{tipo:'hero',protegida:true}]},
    {pecas:[{tipo:'hero',protegida:false}]}, {pecas:[{tipo:'menu',protegida:true}]},
    {pecas:[{tipo:'menu',protegida:false},{tipo:'hero',protegida:true}]}]) {
    const protectedHero = temHeroProtegido(dossie);
    assert.equal(protectedHero, legacyHero(dossie));
    for (const heroHtml of [undefined,null,'','  ','<h1>Custom</h1>',false]) {
        for (const staticSections of [undefined,null,'','<p>Sections</p>']) {
            const body = {heroHtml,staticSections,customCss:undefined,svgLogo:'',darkTheme:false};
            const got = prepararDesignPackage(body,protectedHero);
            const expected = protectedHero ? {...body,heroHtml:undefined} : body;
            assert.deepEqual(got,expected);
            assert.equal(temCamposDesignPackage(got),legacyFields(expected));
            assert.equal(got.staticSections,staticSections);
            if(!protectedHero)assert.equal(got,body,'Sem proteção, objeto original preservado');
            checked++;
        }
    }
}
for(const key of ['customCss','svgLogo','heroHtml','staticSections','darkTheme']) {
    for(const value of [undefined,null,'',0,false,'false','true',true,{},[]]) {
        assert.equal(temCamposDesignPackage({[key]:value}),legacyFields({[key]:value}));
        checked++;
    }
}
console.log('✅ workerHeroGuard: '+checked+' combinações idênticas ao worker anterior.');
