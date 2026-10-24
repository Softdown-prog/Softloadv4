'use strict';

/**
 * Testes para seoChecker.js
 * Execute: node src/core/diagnostico/seoChecker.test.js
 */

const { checarSeo } = require('./seoChecker');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

function temErro(achados, trecho) {
    return achados.some(a => a.nivel === 'erro' && a.mensagem.includes(trecho));
}
function temAviso(achados, trecho) {
    return achados.some(a => a.nivel === 'aviso' && a.mensagem.includes(trecho));
}

// ── title / meta description / canonical ────────────────────────────────
{
    const semNada = '<html><head></head><body></body></html>';
    const r = checarSeo(semNada);
    assert('sem <title> é erro', temErro(r, 'title'));
    assert('sem meta description é aviso', temAviso(r, 'description'));
    assert('sem canonical é aviso', temAviso(r, 'canonical'));
}
{
    const completo = `<html><head>
        <title>X</title>
        <meta content='desc' name='description'/>
        <link href='x' rel='canonical'/>
    </head><body><h1>Único</h1></body></html>`;
    const r = checarSeo(completo);
    assert('title/description/canonical presentes não geram esses achados',
        !temErro(r, 'title') && !temAviso(r, 'description') && !temAviso(r, 'canonical'));
}

// ── H1: caso real validado — hero fora de includable + título dentro de 'post' ──
{
    const comBug = `<html><body>
      <b:widget id='HTML1' type='HTML'>
        <b:widget-setting name='content'><![CDATA[<h1>Hero incondicional</h1>]]></b:widget-setting>
      </b:widget>
      <b:widget id='Blog1' type='Blog'>
        <b:includable id='main'><b:if cond='data:view.isMultipleItems'>feed</b:if></b:includable>
        <b:includable id='post'><h1>Título do post</h1></b:includable>
      </b:widget>
    </body></html>`;
    const r = checarSeo(comBug);
    assert('H1 fora de includable + H1 em includable = duplicidade real (erro)',
        temErro(r, 'fora de qualquer'));
}

// ── H1 em includables DIFERENTES (main vs post) não é falso positivo ────────
{
    // Replica o padrão real dos chassis: hero H1 dentro do <b:else/> de 'main'
    // (só renderiza quando NÃO é isMultipleItems) + título dentro de 'post'
    // (includable separado, só invocado nesse mesmo caso) — mutuamente exclusivo
    // do H1 do feed, e o Blogger nunca roda 'main' e 'post' ao mesmo tempo.
    const semBug = `<html><body>
      <b:widget id='Blog1' type='Blog'>
        <b:includable id='main'>
          <b:if cond='data:view.isMultipleItems'>
            <div>feed sem h1 aqui</div>
          <b:else/>
            <h1>Fallback hero</h1>
          </b:if>
        </b:includable>
        <b:includable id='post'>
          <h1>Título do post</h1>
        </b:includable>
      </b:widget>
    </body></html>`;
    const r = checarSeo(semBug);
    assert('H1 em includables diferentes (main-else vs post) NÃO é falso positivo',
        !temErro(r, 'H1'), JSON.stringify(r));
}

// ── H1 duplicado DENTRO do mesmo includable, sem gate ──────────────────────
{
    const duploNoMesmoIncludable = `<html><body>
      <b:widget id='Blog1' type='Blog'>
        <b:includable id='main'>
          <h1>Primeiro</h1>
          <h1>Segundo</h1>
        </b:includable>
      </b:widget>
    </body></html>`;
    const r = checarSeo(duploNoMesmoIncludable);
    assert('2 H1 sem gate no MESMO includable é erro', temErro(r, 'main'));
}

// ── H1 duplicado com o MESMO gate (b:if repetido, não if/else) ─────────────
{
    const mesmoGate = `<html><body>
      <b:widget id='Blog1' type='Blog'>
        <b:includable id='main'>
          <b:if cond='data:view.isPost'><h1>A</h1></b:if>
          <b:if cond='data:view.isPost'><h1>B</h1></b:if>
        </b:includable>
      </b:widget>
    </body></html>`;
    const r = checarSeo(mesmoGate);
    assert('2 H1 com o MESMO cond (não mutuamente exclusivo) é erro', temErro(r, 'main'));
}

// ── zero H1 ──────────────────────────────────────────────────────────────
{
    const semH1 = '<html><body><h2>Só H2</h2></body></html>';
    const r = checarSeo(semH1);
    assert('zero H1 gera aviso', temAviso(r, 'h1'));
}

// ── um único H1 nunca gera achado de duplicidade ────────────────────────
{
    const umH1 = '<html><body><h1>Único título</h1></body></html>';
    const r = checarSeo(umH1);
    assert('1 H1 não gera nenhum achado de H1', !r.some(a => /h1|H1/.test(a.mensagem)));
}

// ── JSON-LD ──────────────────────────────────────────────────────────────
{
    const semJsonLd = '<html><head><title>X</title></head><body><h1>Y</h1></body></html>';
    const r = checarSeo(semJsonLd);
    assert('sem JSON-LD é aviso', temAviso(r, 'JSON-LD'));
}
{
    // Caso real: tag <data:.../> do Blogger dentro de um valor de string do
    // JSON-LD — válido por design (é assim que o Blogger injeta a URL real),
    // NÃO deve ser reportado como JSON inválido.
    const jsonLdComTagBlogger = `<html><head><title>X</title>
      <script type='application/ld+json'>
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "url": "<data:blog.homepageUrl/>"
      }
      </script>
    </head><body><h1>Y</h1></body></html>`;
    const r = checarSeo(jsonLdComTagBlogger);
    assert('JSON-LD com tag <data:.../> do Blogger dentro de string NÃO é erro',
        !temErro(r, 'JSON-LD'), JSON.stringify(r));
}
{
    const jsonLdQuebrado = `<html><head><title>X</title>
      <script type='application/ld+json'>
      { "@context": "https://schema.org", "@type": "WebSite", }
      </script>
    </head><body><h1>Y</h1></body></html>`;
    const r = checarSeo(jsonLdQuebrado);
    assert('JSON-LD genuinamente malformado (vírgula sobrando) é erro', temErro(r, 'JSON-LD'));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} seoChecker: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
