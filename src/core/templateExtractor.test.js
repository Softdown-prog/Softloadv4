'use strict';

/**
 * Testes do templateExtractor — extração estruturada (customCss, hero,
 * peças granulares) a partir de um XML de template Blogger compilado ou
 * hand-authored. Módulo mantido standalone (sem consumidor ativo no
 * momento — o pipeline que o usava pra popular design-packages/ foi
 * removido junto com esse sistema).
 *
 * Execute: node src/core/templateExtractor.test.js
 */

const { extrairTemplate } = require('./templateExtractor');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// ── extrairHeroESecoes — comentário de dev sozinho não vira heroHtml ──
// Regressão: doce-mania.xml tem um comentário explicativo entre o
// marcador base (</b:if>) e <b:section id='main', sem nenhum conteúdo
// injetado de verdade ali. Antes da correção, o heurístico de fallback
// tratava o texto do comentário como se fosse o hero.
{
    const xml = `
<html>
<body>
<b:if cond='data:view.isHomepage'>
  <p>algo</p>
</b:if>
<!-- b:section id='main' embrulha a row inteira (feed + sidebar) — nota
     explicativa de dev, não é conteúdo de hero. -->
<b:section id='main' class='row'>
  <b:widget id='Blog1' type='Blog'/>
</b:section>
</body>
</html>`.trim();

    const r = extrairTemplate(xml, 'doce-mania-regressao');
    assert('comentário líder isolado: heroHtml null (não vira o texto do comentário)', r.heroHtml === null, JSON.stringify(r.heroHtml));
    assert('comentário líder isolado: staticSections null', r.staticSections === null);
}

// ── extrairHeroESecoes — comentário líder seguido de hero real ────────
// O comentário deve ser descartado, mas o hero de verdade logo depois
// continua sendo extraído normalmente.
{
    const xml = `
<html>
<body>
<b:if cond='data:view.isHomepage'>
  <p>algo</p>
</b:if>
<!-- nota de dev qualquer, sem relação com o conteúdo -->
<section class='hero-banner'>
  <h1>Bem-vindo</h1>
</section>
<b:section id='main' class='row'>
  <b:widget id='Blog1' type='Blog'/>
</b:section>
</body>
</html>`.trim();

    const r = extrairTemplate(xml, 'com-hero-real');
    assert('comentário líder + hero real: heroHtml extraído (não null)', r.heroHtml !== null, JSON.stringify(r.heroHtml));
    assert('comentário líder + hero real: heroHtml não contém o comentário', r.heroHtml && !r.heroHtml.includes('nota de dev'), r.heroHtml);
    assert('comentário líder + hero real: heroHtml contém o h1 do hero', r.heroHtml && r.heroHtml.includes('Bem-vindo'), r.heroHtml);
}

// ── extrairHeroESecoes — sem b:section id='main': null, não lança ─────
{
    const xml = '<html><body><p>sem estrutura de blog</p></body></html>';
    const r = extrairTemplate(xml, 'sem-main');
    assert('XML sem b:section main: heroHtml null', r.heroHtml === null);
    assert('XML sem b:section main: staticSections null', r.staticSections === null);
}

// ── extrairPecas — CSS fatiado por comentário vira peças tipo:'modulo' ─
{
    const xml = `
<html>
<body>
<b:skin><![CDATA[
<!-- DP:CSS:START -->
:root { --sl-primary: #4F46E5; --sl-bg-body: #0e0e0e; }

/* Cards */
.card { border: 1px solid red; }
.card:hover { border-color: blue; }

/* Botões */
.btn-cta { background: var(--sl-primary); }
<!-- DP:CSS:END -->
]]></b:skin>
<b:section id='main' class='row'>
  <b:widget id='Blog1' type='Blog'/>
</b:section>
</body>
</html>`.trim();

    const r = extrairTemplate(xml, 'css-modulo-teste');
    const modulos = r.pecas.filter(p => p.tipo === 'modulo');
    assert('extrairPecas: :root (design tokens) não vira peça', !modulos.some(p => p.css.includes(':root')));
    assert('extrairPecas: 2 peças modulo (Cards, Botões)', modulos.length === 2, JSON.stringify(modulos.map(p => p.id)));
    assert('extrairPecas: peça "Cards" contém .card e .card:hover', modulos.find(p => p.id === 'modulo-cards')?.css.includes('.card:hover'));
    assert('extrairPecas: peça "Botões" contém .btn-cta', modulos.find(p => p.id === 'modulo-botoes')?.css.includes('.btn-cta'));
    assert('extrairPecas: peças modulo não têm html', modulos.every(p => p.html === ''));
    assert('extrairPecas: peças modulo têm protegida:false', modulos.every(p => p.protegida === false));
}

// ── extrairPecas — hero vira peça tipo:'hero' com domIds reais ────────
{
    const xml = `
<html>
<body>
<b:skin><![CDATA[
<!-- DP:CSS:START -->
/* Hero */
.hero-banner { padding: 4rem; }
<!-- DP:CSS:END -->
]]></b:skin>
<!-- DP:HERO:START -->
<section class='hero-banner'>
  <h1 id='hero-titulo'>Bem-vindo</h1>
</section>
<!-- DP:HERO:END -->
<b:section id='main' class='row'>
  <b:widget id='Blog1' type='Blog'/>
</b:section>
</body>
</html>`.trim();

    const r = extrairTemplate(xml, 'hero-peca-teste');
    const hero = r.pecas.find(p => p.tipo === 'hero');
    assert('extrairPecas: peça hero existe', !!hero);
    assert('extrairPecas: peça hero tem domIds do próprio HTML', hero && hero.domIds.includes('hero-titulo'), JSON.stringify(hero && hero.domIds));
    assert('extrairPecas: peça hero herda CSS correlacionado (.hero-banner)', hero && hero.css.includes('.hero-banner'), hero && hero.css);
    assert('extrairPecas: CSS movido pro hero não duplica em peça modulo separada', !r.pecas.some(p => p.tipo === 'modulo' && p.css.includes('.hero-banner')));
}

// ── extrairPecas — b:section com id fora do vocabulário estrutural vira
// secao (tem <b:widget> real — precisa da própria <b:section>) ────────
{
    const xml = `
<html>
<body>
<b:skin><![CDATA[
<!-- DP:CSS:START -->
/* WhatsApp flutuante */
.whatsapp-btn { position: fixed; bottom: 20px; right: 20px; }
<!-- DP:CSS:END -->
]]></b:skin>
<b:section class='whatsapp-section' id='whatsapp-float' maxwidgets='1'>
  <b:widget id='HTML99' type='HTML' version='1'>
    <b:includable id='main'>
      <a class='whatsapp-btn' href='https://wa.me/'>Fale conosco</a>
    </b:includable>
  </b:widget>
</b:section>
<b:section id='main' class='row'>
  <b:widget id='Blog1' type='Blog'/>
</b:section>
</body>
</html>`.trim();

    const r = extrairTemplate(xml, 'widget-peca-teste');
    const secao = r.pecas.find(p => p.tipo === 'secao');
    assert('extrairPecas: seção não-estrutural (whatsapp-float, com <b:widget> real) vira peça tipo:secao', !!secao, JSON.stringify(r.pecas.map(p => p.id)));
    assert('extrairPecas: peça secao contém o HTML do botão', secao && secao.html.includes('whatsapp-btn'));
    assert('extrairPecas: peça secao herda CSS correlacionado (.whatsapp-btn)', secao && secao.css.includes('.whatsapp-btn'), secao && secao.css);
    assert('extrairPecas: b:section id="main" (estrutural) NÃO vira peça', !r.pecas.some(p => p.id === 'widget-main' || p.id === 'secao-main'));
}

// ── extrairPecas — b:section não-estrutural SEM <b:widget> (HTML solto +
// script) continua virando tipo:'widget', não 'secao' ──────────────────
{
    const xml = `
<html>
<body>
<b:section id='floating-cta' maxwidgets='0'>
  <div id='floating-cta-box' class='floating-cta'>
    <a href='#'>Fale com a gente</a>
  </div>
  <script>
    document.getElementById('floating-cta-box').classList.add('ready');
  </script>
</b:section>
<b:section id='main' class='row'>
  <b:widget id='Blog1' type='Blog'/>
</b:section>
</body>
</html>`.trim();

    const r = extrairTemplate(xml, 'widget-sem-bwidget-teste');
    const widget = r.pecas.find(p => p.tipo === 'widget');
    assert('extrairPecas: seção sem <b:widget> (HTML solto) vira tipo:widget, não secao', !!widget, JSON.stringify(r.pecas.map(p => p.tipo + ':' + p.id)));
    assert('extrairPecas: nenhuma peça tipo:secao criada aqui', !r.pecas.some(p => p.tipo === 'secao'));
}

// ── extrairPecas — HTML sem id próprio recebe domId injetado ──────────
// Regressão: HTML hand-authored raramente usa id (só class) — sem isso,
// toda peça hero/widget extraída de exemplos/ ficaria com domIds:[] e
// seria rejeitada por dossieValidator.js ao tentar reaproveitá-la numa
// geração real (adicionarPeca exige domIds não-vazio quando há html).
{
    const xml = `
<html>
<body>
<!-- DP:HERO:START -->
<section class='hero-sem-id'>
  <h1>Bem-vindo, sem id nenhum aqui</h1>
</section>
<!-- DP:HERO:END -->
<b:section id='main' class='row'>
  <b:widget id='Blog1' type='Blog'/>
</b:section>
</body>
</html>`.trim();

    const r = extrairTemplate(xml, 'sem-id-teste');
    const hero = r.pecas.find(p => p.tipo === 'hero');
    assert('injetarIdRaiz: peça hero sem id próprio recebe domId injetado', hero && hero.domIds.length === 1, JSON.stringify(hero && hero.domIds));
    assert('injetarIdRaiz: domId injetado é o próprio id da peça', hero && hero.domIds[0] === hero.id);
    assert('injetarIdRaiz: id injetado aparece de fato no html (não só no array)', hero && hero.html.includes(`id='${hero.id}'`), hero && hero.html);
    assert('injetarIdRaiz: injeta na tag raiz (<section>), não em qualquer lugar', hero && /^<section id='[^']*' class='hero-sem-id'>/.test(hero.html), hero && hero.html.slice(0, 80));
}

// ── extrairPecas — HTML que já tem id próprio não é sobrescrito ───────
{
    const xml = `
<html>
<body>
<!-- DP:HERO:START -->
<section id='ja-tenho-id' class='hero-com-id'>
  <h1>Bem-vindo</h1>
</section>
<!-- DP:HERO:END -->
<b:section id='main' class='row'>
  <b:widget id='Blog1' type='Blog'/>
</b:section>
</body>
</html>`.trim();

    const r = extrairTemplate(xml, 'com-id-teste');
    const hero = r.pecas.find(p => p.tipo === 'hero');
    assert('injetarIdRaiz: não sobrescreve id já existente', hero && hero.domIds.includes('ja-tenho-id'), JSON.stringify(hero && hero.domIds));
    assert('injetarIdRaiz: html original não é duplicado com 2 ids', hero && (hero.html.match(/\bid=/g) || []).length === 1, hero && hero.html);
}

// ── extrairPecas — widget custom com raiz dentro de b:if/b:includable ─
// A raiz de DOM real de um widget nativo do Blogger costuma estar
// embrulhada em várias tags b:* (b:widget > b:includable > b:if) — a
// injeção precisa pular todas elas e achar o primeiro elemento HTML de
// verdade, não injetar id num <b:widget> (que não é elemento de DOM).
{
    const xml = `
<html>
<body>
<b:section class='cta-flutuante-section' id='cta-flutuante' maxwidgets='1'>
  <b:widget id='HTML55' type='HTML' version='1'>
    <b:includable id='main'>
      <b:if cond='data:content != &quot;&quot;'>
        <a class='cta-flutuante-btn' href='#'>Fale conosco</a>
      </b:if>
    </b:includable>
  </b:widget>
</b:section>
<b:section id='main' class='row'>
  <b:widget id='Blog1' type='Blog'/>
</b:section>
</body>
</html>`.trim();

    const r = extrairTemplate(xml, 'widget-b-tags-teste');
    const secao = r.pecas.find(p => p.tipo === 'secao');
    assert('injetarIdRaiz: secao custom existe (tem <b:widget> real)', !!secao, JSON.stringify(r.pecas.map(p => p.id)));
    assert('injetarIdRaiz: NÃO injeta id em tag b:* (b:widget/b:includable/b:if)', secao && !secao.html.includes(`<b:widget id='${secao.id}'`));
    assert('injetarIdRaiz: injeta no primeiro elemento HTML real (<a>)', secao && secao.html.includes(`<a id='${secao.id}' class='cta-flutuante-btn'`), secao && secao.html);
    assert('injetarIdRaiz: domIds reflete o id injetado', secao && secao.domIds.includes(secao.id));
}

// ── extrairPecas — CSS inválido não derruba a extração inteira ────────
{
    const xml = `
<html>
<body>
<b:skin><![CDATA[
<!-- DP:CSS:START -->
.card { border: 1px solid red;
<!-- DP:CSS:END -->
]]></b:skin>
<b:section id='main' class='row'>
  <b:widget id='Blog1' type='Blog'/>
</b:section>
</body>
</html>`.trim();

    let lancou = false;
    let r;
    try {
        r = extrairTemplate(xml, 'css-invalido-teste');
    } catch (e) {
        lancou = true;
    }
    assert('extrairPecas: CSS malformado não lança exceção', !lancou);
    assert('extrairPecas: CSS malformado resulta em pecas: []', r && Array.isArray(r.pecas) && r.pecas.length === 0);
}

// ── extrairCss — Prioridade 4: export bruto do Blogger (Theme Designer) ─
// Sem marcador DP:CSS, sem comentário "CUSTOM", sem separador ── ── —
// convenções que só os templates hand-authored pelo softload seguem. Um
// export baixado direto do Blogger (17 templates novos em exemplos/,
// nomeados theme-<id>.xml) usa a sintaxe nativa <Group>/<Variable> do
// Theme Designer do Blogger, sem nenhuma dessas marcas.
{
    const xml = `
<html>
<body>
<b:skin><![CDATA[
/*
<Group description="Cores do Tema" selector=":root">
  <Variable name="cor.primaria" type="color" default="#FF4500" value="#FF4500"/>
</Group>
*/
:root {
  --primary: $(cor.primaria);
}
.card { border: 2px solid var(--primary); }
]]></b:skin>
<b:section id='main' class='row'>
  <b:widget id='Blog1' type='Blog'/>
</b:section>
</body>
</html>`.trim();

    const r = extrairTemplate(xml, 'blogger-export-teste');
    assert('extrairCss P4: extrai CSS mesmo sem nenhuma convenção conhecida', r.customCss !== null, JSON.stringify(r.customCss));
    assert('extrairCss P4: remove a declaração <Group>/<Variable> do Blogger', r.customCss && !r.customCss.includes('<Group'), r.customCss);
    assert('extrairCss P4: mantém o CSS de verdade (.card)', r.customCss && r.customCss.includes('.card'), r.customCss);
}

// ── _pareceEstrutural — convenção de nomenclatura diferente (export bruto
// do Blogger) não escapa da detecção de seção estrutural ─────────────────
// Regressão: os 17 templates theme-<id>.xml usam ids como 'main-blog',
// 'sidebar-right', 'footer-left', 'HeaderLogo' — fora do vocabulário
// exato SECOES_ESTRUTURAIS (só cobre a convenção 'header-logo'/'main-nav'
// do softload). Sem o fallback por palavra-chave, cada uma dessas seções
// de LAYOUT inteiras (não widgets autônomos) virava 1 peça tipo:'widget'.
{
    const xml = `
<html>
<body>
<b:section id='HeaderLogo' class='header'>
  <b:widget id='Header1' type='Header'/>
</b:section>
<b:section id='sidebar-right' class='sidebar'>
  <b:widget id='PopularPosts1' type='PopularPosts'/>
</b:section>
<b:section id='footer-left' class='footer'>
  <b:widget id='Text1' type='Text'/>
</b:section>
<b:section id='widget-html-1' class='free-widget'>
  <b:widget id='HTML1' type='HTML'/>
</b:section>
<b:section id='main-blog' class='row'>
  <b:widget id='Blog1' type='Blog'/>
</b:section>
</body>
</html>`.trim();

    const r = extrairTemplate(xml, 'nomenclatura-diferente-teste');
    const idsCandidatos = r.pecas.filter(p => p.tipo === 'widget' || p.tipo === 'secao').map(p => p.id);
    assert('_pareceEstrutural: HeaderLogo (PascalCase) NÃO vira peça', !idsCandidatos.some(id => id.toLowerCase().includes('headerlogo')), JSON.stringify(idsCandidatos));
    assert('_pareceEstrutural: sidebar-right NÃO vira peça', !idsCandidatos.some(id => id.includes('sidebar-right')), JSON.stringify(idsCandidatos));
    assert('_pareceEstrutural: footer-left NÃO vira peça', !idsCandidatos.some(id => id.includes('footer-left')), JSON.stringify(idsCandidatos));
    // widget-html-1 é <b:widget type='HTML'/> de verdade — vira tipo:'secao'
    // (precisa da própria <b:section>), não tipo:'widget' (slot solto).
    assert('_pareceEstrutural: widget-html-1 (genuinamente arbitrário) AINDA vira peça, como secao', idsCandidatos.some(id => id.includes('widget-html-1')), JSON.stringify(idsCandidatos));
    assert('_pareceEstrutural: widget-html-1 classificado como tipo:secao (tem <b:widget> real)', r.pecas.some(p => p.tipo === 'secao' && p.id.includes('widget-html-1')), JSON.stringify(r.pecas.map(p => p.tipo + ':' + p.id)));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} templateExtractor: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
