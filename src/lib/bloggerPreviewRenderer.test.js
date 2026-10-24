'use strict';

// ============================================================
// Testes de bloggerPreviewRenderer.js + o interpretador determinístico
// que o move (bloggerTemplateEngine.js/bloggerTemplateTree.js/
// bloggerTemplateRenderer.js/bloggerMockContext.js).
//
// Achado real (ago/2026): o renderer anterior era puramente regex/
// substituição de string com uma lista pequena e hardcoded de
// condições — quebrava pra praticamente todo nicho (valores de
// widget-setting vazando como texto bruto, includables não-'main'
// descartados inteiros). Cada bloco abaixo é uma regressão concreta
// encontrada ao rodar o novo interpretador contra os 15 templates
// reais (`src/rag/templates/template_*.xml`), reduzida a um fixture
// mínimo — ver comentário de cada bloco pro achado original.
//
// Execute: node src/lib/bloggerPreviewRenderer.test.js
// ============================================================

const { parseBloggerXMLToHTML } = require('./bloggerPreviewRenderer');
const { evalCond, evalValueExpr } = require('./bloggerTemplateEngine');
const { renderBloggerTree } = require('./bloggerTemplateRenderer');
const { buildBaseContext } = require('./bloggerMockContext');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

function wrapMinimalDoc(bodyXml) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns:b='http://www.google.com/2005/gml/b' xmlns:data='http://www.google.com/2005/gml/data' xmlns:expr='http://www.google.com/2005/gml/expr'>
<head><b:skin><![CDATA[body{color:#000}]]></b:skin></head>
<body>${bodyXml}</body>
</html>`;
}

// A. Avaliador de expressão — operadores confirmados no corpus real
// (ver docstring de bloggerTemplateEngine.js: 124 expressões cond
// distintas, todas cobertas por esta gramática pequena e fechada).
{
    const ctx = { post: { showAuthor: false, title: 'X' }, blog: { pageType: 'index' }, i: 2 };
    assert('setting false via truthy', evalCond("data:post.showAuthor", ctx) === false);
    assert('not X', evalCond('not data:post.showAuthor', ctx) === true);
    assert('!X', evalCond('!data:post.showAuthor', ctx) === true);
    assert('comparação numérica de índice', evalCond('data:i == 2', ctx) === true);
    assert('comparação de string', evalCond('data:blog.pageType == &quot;index&quot;', ctx) === true);
    assert('in {set} falso', evalCond('data:blog.pageType in {&quot;item&quot;,&quot;static_page&quot;}', ctx) === false);
    assert('not in {set} verdadeiro', evalCond('data:blog.pageType not in {&quot;item&quot;}', ctx) === true);
    assert('ternário', evalValueExpr('data:post.showAuthor ? &quot;a&quot; : &quot;b&quot;', ctx) === 'b');
    assert('elvis', evalValueExpr('data:post.title ?: &quot;fallback&quot;', ctx) === 'X');
    assert('concat string', evalValueExpr('&quot;a&quot; + &quot;b&quot;', ctx) === 'ab');
}

// B. Achado real (tecnologia-mag-tech): <b:includable id='X' var='Y'/>
// self-closing (sem corpo) fazia o parser procurar um </b:includable>
// que nunca chega, "engolindo" o resto do documento inteiro (Blog1,
// sidebar, footer somem). Regressão: documento sobrevive inteiro.
{
    const xml = wrapMinimalDoc(`
      <b:widget id='W1' type='Blog' title='Postagens'>
        <b:includable id='backlinks' var='post'/>
        <b:includable id='main'>
          <div class='conteudo-real'>OK</div>
        </b:includable>
      </b:widget>
      <div class='marcador-apos-widget'>SOBREVIVEU</div>`);
    const html = parseBloggerXMLToHTML(xml, 'Teste');
    assert('includable self-closing não trava o parser', html.includes('conteudo-real'));
    assert('conteúdo após o widget sobrevive', html.includes('marcador-apos-widget') && html.includes('SOBREVIVEU'));
}

// C. Achado real (tecnologia-techwind): doc-comments citam nomes de tag
// como prosa (ex.: "o <b:includable id='main'> customizado") dentro de
// um <!-- --> real — sem tratar comentário como região opaca, o
// scanner interpretava esse texto como tag de verdade.
{
    const xml = wrapMinimalDoc(`
      <!-- nota: o <b:includable id='main'> customizado nunca referencia <data:content/> -->
      <div class='depois-do-comentario'>SOBREVIVEU</div>`);
    const html = parseBloggerXMLToHTML(xml, 'Teste');
    assert('comentário com tag-like text não corrompe o parser', html.includes('depois-do-comentario') && html.includes('SOBREVIVEU'));
}

// D. Achado real (BlogArchive1): <data:i.post-count/> — hífen no nome
// do campo não era aceito pelo tokenizer de path, deixando a tag sem
// resolver; o fix de self-closing-tag-pra-HTML5 então confundia
// "data" como nome de tag e gerava `<data:i.post-count></data>`.
{
    const xml = wrapMinimalDoc(`
      <b:widget id='W2' type='BlogArchive' title='Arquivo'>
        <b:includable id='main'>
          <b:loop values='data:data' var='i'>
            <span><data:i.post-count/></span>
          </b:loop>
        </b:includable>
      </b:widget>`);
    const html = parseBloggerXMLToHTML(xml, 'Teste');
    assert('campo com hífen resolve (não sobra <data:...>)', !html.includes('<data:'));
    assert('campo com hífen resolve (não sobra </data>)', !html.includes('</data>'));
}

// E. Achado real (BlogArchive1): <b:loop index='i' values='...' var='post'>
// nomeia a variável de posição via atributo index= — quando o loop usa
// var='i' SEM index= (BlogArchive real: var='i' é o item da iteração,
// não a posição), o índice automático não deve pisar no valor real.
{
    const ctxBase = buildBaseContext('Teste');
    const xml = `
      <b:loop values='data:data' var='i'>
        <span class='nome'><data:i.name/></span>
      </b:loop>`;
    const html = renderBloggerTree(xml, ctxBase);
    assert('var=i do loop não é sobrescrito pelo índice automático', html.includes('2026') || html.includes('2025'),
        html.slice(0, 200));
}

// F. Achado real (natureza-bulma-vegan): <b:if cond='data:view.search.query'>
// (sem sufixo .escaped) — modelar o campo como objeto {escaped:''} faz
// truthy() ver Object.keys().length>0 (sempre verdadeiro); precisa ser
// string vazia primitiva pra "Resultados para" só aparecer em busca real.
{
    const xml = wrapMinimalDoc(`
      <b:widget id='W3' type='Blog' title='Postagens'>
        <b:includable id='main'>
          <b:if cond='data:view.search.query'>
            <h3 class='resultado-busca'>Resultados para: &quot;<data:view.search.query/>&quot;</h3>
          </b:if>
          <div class='sempre-visivel'>OK</div>
        </b:includable>
      </b:widget>`);
    const html = parseBloggerXMLToHTML(xml, 'Teste');
    assert('bloco de resultado de busca NÃO aparece sem query ativa', !html.includes('resultado-busca'));
    assert('resto do widget renderiza normalmente', html.includes('sempre-visivel'));
}

// G. Achado real: widget-setting vazando como texto bruto (o bug
// original reportado) — settings NUNCA devem sobreviver como texto
// solto; só devem influenciar o que é renderizado (b:if/b:loop).
{
    const xml = wrapMinimalDoc(`
      <b:widget id='W4' type='PopularPosts' title='Mais Lidas'>
        <b:widget-settings>
          <b:widget-setting name='showThumbnail'>false</b:widget-setting>
          <b:widget-setting name='numItemsToShow'>5</b:widget-setting>
        </b:widget-settings>
        <b:includable id='main'>
          <h2><data:title/></h2>
          <b:if cond='data:showThumbnail'><span class='thumb'>IMG</span></b:if>
        </b:includable>
      </b:widget>`);
    const html = parseBloggerXMLToHTML(xml, 'Teste');
    assert('título do widget vem do atributo title= (não vaza settings)', html.includes('Mais Lidas'));
    assert('setting boolean false NÃO vaza como texto "false"', !/>\s*false\s*</.test(html));
    assert('setting numérico NÃO vaza como texto solto "5"', !html.includes('>5<'));
    assert('bloco condicionado a setting false não renderiza', !html.includes('class=\'thumb\''));
}

// H. Achado real (PageList1): <b:include data='data' name='interval'/>
// passa data:<atributo> (sem prefixo 'data:') do escopo do chamador pro
// var= declarado no <b:includable> alvo.
{
    const xmlWidget = wrapMinimalDoc(`
      <b:widget id='W5' type='PageList' title='Páginas'>
        <b:includable id='menu' var='data'>
          <ul><b:loop values='data:data' var='p'><li><data:p.title/></li></b:loop></ul>
        </b:includable>
        <b:includable id='main'>
          <b:include data='links' name='menu'/>
        </b:includable>
      </b:widget>`);
    const html = parseBloggerXMLToHTML(xmlWidget, 'Teste');
    assert('b:include data= passa o valor certo pro var= do includable alvo', html.includes('Início'), html.slice(html.indexOf('<ul'), html.indexOf('<ul') + 300));
}

// I. Achado real (Header1/pop-retro-pixel): <b:include name='responsiveImage'
// data='{ image: data:image, altText: ... }'/> — data= aqui é uma expressão
// COMPLETA (objeto-literal com seus próprios data: internos), não um
// caminho solto. evalIncludeDataAttr precisa distinguir os dois casos.
// 'responsiveImage' é includable da PLATAFORMA Blogger (nunca declarado no
// tema) — o fallback builtin deve renderizar um <img> em vez de ficar vazio.
{
    const xml = wrapMinimalDoc(`
      <b:widget id='W6' type='Header' title='Cabeçalho'>
        <b:includable id='main' var='this'>
          <a class='header-image-wrapper' expr:href='data:blog.homepageUrl'>
            <b:include data='{ image: data:image, altText: data:blog.title.escaped }' name='responsiveImage'/>
          </a>
        </b:includable>
      </b:widget>`);
    const html = parseBloggerXMLToHTML(xml, 'Teste');
    assert('data= com objeto-literal não trava/esvazia o include', html.includes('<img'), html.slice(html.indexOf('header-image-wrapper'), html.indexOf('header-image-wrapper') + 200));
}

// J. Achado real (gamer-playerone/culinaria-boutique-gourmet, reproduzido
// via Chromium de verdade — 2 bugs empilhados no MESMO widget Translate,
// o 2º só apareceu depois de corrigir o 1º):
//
// J1. Widget do Google Translate tem &#39; (aspas simples) dentro de
// <script> — Blogger real decodifica isso no servidor, mas HTML5 nunca
// decodifica entidades dentro de <script> (raw text element), então
// &#39; sobrevivia como texto literal no JS final e o parser travava em
// "Unexpected token '&'".
//
// J2. `<data:layout/>` usado SEM aspas como sufixo de identificador
// (`InlineLayout.<data:layout/>`) não é widget-setting declarada — é
// dado computado pela plataforma Blogger, sem mock antes desta correção;
// resolvia pro fallback "desconhecido → vazio" e deixava `InlineLayout.`
// sem nada depois do ponto — `Unexpected token '}'`. Corrigido em
// bloggerMockContext.js: widget Translate espelha `layout` a partir da
// setting real `displayMode`.
{
    const xml = wrapMinimalDoc(`
      <b:widget id='Translate1' locked='false' title='Translate' type='Translate'>
        <b:widget-settings>
          <b:widget-setting name='displayMode'>SIMPLE</b:widget-setting>
        </b:widget-settings>
        <b:includable id='main'>
          <div id='google_translate_element'/>
          <script>
            function googleTranslateElementInit() {
              new google.translate.TranslateElement({
                pageLanguage: &#39;<data:pageLanguage/>&#39;,
                autoDisplay: &#39;true&#39;,
                layout: google.translate.TranslateElement.InlineLayout.<data:layout/>
              }, &#39;google_translate_element&#39;);
            }
          </script>
        </b:includable>
      </b:widget>`);
    const html = parseBloggerXMLToHTML(xml, 'Teste');
    const scriptBody = html.slice(html.indexOf('<script'), html.indexOf('</script>'));
    assert('aspas simples decodificadas dentro do <script> (sem &#39; residual)', !scriptBody.includes('&#39;'), scriptBody);
    assert('aspas simples decodificadas viram JS válido (string literal real)', scriptBody.includes("'true'"), scriptBody);
    assert('data:layout resolve pro valor real de displayMode (não fica InlineLayout. pendurado)', scriptBody.includes('InlineLayout.SIMPLE'), scriptBody);
    assert('data:pageLanguage resolve pra algo não-vazio dentro da string', /pageLanguage: '[a-z]+'/.test(scriptBody), scriptBody);
}

// K. Entidades FORA de <script> (atributo/texto normal) não devem ser
// tocadas -- já são decodificadas corretamente pelo navegador; decodificar
// de novo aqui corromperia uma entidade genuinamente dupla-escapada.
{
    const xml = wrapMinimalDoc(`<p class='fora-do-script'>Empresas &amp; Parceiros</p>`);
    const html = parseBloggerXMLToHTML(xml, 'Teste');
    assert('entidade fora de <script> permanece intacta (navegador decodifica)', html.includes('Empresas &amp; Parceiros'), html);
}

// L. Regressão BioLink: os previews usam fixtures INDEPENDENTES para links
// e sociais, sem usar URLs pessoais reais nem criar WhatsApp fantasma.
{
    const xml = wrapMinimalDoc(`
      <div class='biolink-wrapper'>
      <b:widget id='LinkList1' type='LinkList' title='Links'>
        <b:includable id='main'><div class='links-container'>
          <b:loop values='data:links' var='link'><a expr:href='data:link.target'><data:link.name/></a></b:loop>
        </div></b:includable>
      </b:widget>
      <b:widget id='LinkList2' type='LinkList' title='Redes'>
        <b:includable id='main'><div class='social-list'>
          <b:loop values='data:links' var='link'><a expr:href='data:link.target'><data:link.name/></a></b:loop>
        </div></b:includable>
      </b:widget>
      <b:widget id='HTML99' type='HTML' title='WhatsApp'>
        <b:includable id='main'>
          <b:if cond='data:content != &quot;&quot;'><a class='wa' expr:href='&quot;https://wa.me/&quot; + data:content'>Whatsapp</a></b:if>
        </b:includable>
      </b:widget>
      </div>`);
    const html = parseBloggerXMLToHTML(xml, 'BioLink Preview');
    const main = html.split("class='links-container'>")[1]?.split('</div>')[0] || '';
    const social = html.split("class='social-list'>")[1]?.split('</div>')[0] || '';
    assert('mock biolink principal tem links relevantes', main.includes('Meu portfólio') && main.includes('Fale comigo'), main);
    assert('mock biolink redes tem sociais com URLs locais', social.includes('#instagram.com') && social.includes('#github.com'), social);
    assert('mock biolink não usa navegação comum para sociais', !social.includes('Sobre'), social);
    assert('widget HTML vazio não cria WhatsApp fantasma', !html.includes('class=\'wa\''), html);
}
{
    const html = parseBloggerXMLToHTML(wrapMinimalDoc(`
      <b:widget id='HTML100' type='HTML'>
        <b:widget-settings><b:widget-setting name='content'>5511999999999</b:widget-setting></b:widget-settings>
        <b:includable id='main'><b:if cond='data:content != &quot;&quot;'><span class='configured'>ON</span></b:if></b:includable>
      </b:widget>`));
    assert('HTML preenchido mantém CTA condicional', html.includes('class=\'configured\''));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} bloggerPreviewRenderer: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
