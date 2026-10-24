'use strict';

/**
 * Testes para validarSemanticaBlogger (xmlValidator.js)
 * Execute: node src/core/xmlValidator.test.js
 */

const { validarSemanticaBlogger, validarXmlEstrutura, validarXmlCompilado } = require('./xmlValidator');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

const BLOG1_OK = `
<b:widget id='Blog1' type='Blog' version='2'>
  <b:widget-settings><b:widget-setting name='showShareButtons'>false</b:widget-setting></b:widget-settings>
  <b:includable id='main'><b:include name='post'/></b:includable>
  <b:includable id='post'>ok</b:includable>
</b:widget>`;

// G. Blog1 sem widget-settings → erro
{
    const semSettings = BLOG1_OK.replace(/<b:widget-settings>[\s\S]*?<\/b:widget-settings>/, '');
    const r = validarSemanticaBlogger(semSettings);
    assert('Blog1 sem widget-settings é erro', r.erros.some(e => e.includes('widget-settings')));
    const rOk = validarSemanticaBlogger(BLOG1_OK);
    assert('Blog1 com widget-settings passa', rOk.erros.length === 0, rOk.erros.join('; '));
}

// H. Ref órfã estática → erro; builtin e expr:name não são órfãs
{
    const comOrfa = BLOG1_OK.replace("<b:include name='post'/>", "<b:include name='post'/><b:include name='naoExiste'/>");
    const r = validarSemanticaBlogger(comOrfa);
    assert('include órfão é erro', r.erros.some(e => e.includes('naoExiste')));

    const comBuiltin = BLOG1_OK.replace("<b:include name='post'/>", "<b:include name='post'/><b:include data='blog' name='all-head-content'/>");
    assert('all-head-content (builtin) não é órfã', validarSemanticaBlogger(comBuiltin).erros.length === 0);

    const comExpr = BLOG1_OK.replace("<b:include name='post'/>", "<b:include name='post'/><b:include expr:name='data:widget.instanceId + \"_dyn\"'/>");
    assert('expr:name dinâmico não é órfã', validarSemanticaBlogger(comExpr).erros.length === 0);
}

// I. Scripts aninhados / desbalanceados / falsos positivos
{
    const aninhado = BLOG1_OK + '<script>//<![CDATA[ x ]]>\n<script>y</script></script>';
    assert('script aninhado é erro', validarSemanticaBlogger(aninhado).erros.some(e => e.includes('aninhado')));

    const emCdata = BLOG1_OK + '<script>//<![CDATA[ document.write("<script>ignorado</" + "script>") ]]></script>';
    assert('"<script>" dentro de CDATA não conta', validarSemanticaBlogger(emCdata).erros.length === 0,
        validarSemanticaBlogger(emCdata).erros.join('; '));

    const emComentario = BLOG1_OK + '<!-- explicação: use <script> aqui -->';
    assert('"<script>" em comentário XML não conta', validarSemanticaBlogger(emComentario).erros.length === 0);

    const autoFechado = BLOG1_OK + "<script src='https://x.com/a.js' async='async'/>";
    assert('<script/> auto-fechado não abre bloco', validarSemanticaBlogger(autoFechado).erros.length === 0);

    const semFechar = BLOG1_OK + '<script>var x = 1;';
    assert('script sem fechamento é erro', validarSemanticaBlogger(semFechar).erros.some(e => e.includes('desbalanceadas')));
}

// J. Cadeia de ícones dinâmica sem stubs → aviso (não erro)
{
    const comChain = BLOG1_OK.replace("<b:include name='post'/>",
        "<b:include name='post'/><b:loop values='data:platforms' var='platform'><b:include expr:name='data:platform.key + \"Icon\"'/></b:loop>");
    const r = validarSemanticaBlogger(comChain);
    assert('cadeia de ícones sem stubs gera aviso', r.avisos.some(a => a.includes('shareIcon')));
    assert('cadeia de ícones sem stubs NÃO é erro', r.erros.length === 0, r.erros.join('; '));

    const comStubs = comChain
        + "<b:includable id='shareIcon'>s</b:includable><b:includable id='emailIcon'>e</b:includable>"
        + "<b:includable id='facebookIcon'>f</b:includable><b:includable id='twitterIcon'>t</b:includable>";
    assert('cadeia de ícones com stubs passa limpa', validarSemanticaBlogger(comStubs).avisos.length === 0);
}

// K. validarXmlEstrutura — b:section self-closing não deve "engolir" o
// próximo </b:section> do documento e gerar falso positivo de HTML direto
// (bug real: <b:section id='x' .../> era tratada como abertura, e o regex
// não-guloso capturava tudo até o PRÓXIMO </b:section>, mesmo de uma seção
// completamente alheia com HTML de verdade).
{
    const semSelfClosing = `
<b:widget id='Blog1' type='Blog' version='2'><b:widget-settings/></b:widget>
<b:section id='header-right' maxwidgets='2' name='Botões' showaddelement='yes'/>
<b:section id='outra-secao' name='Outra'><div class='card'>conteúdo alheio</div></b:section>`;
    const r = validarXmlEstrutura(semSelfClosing);
    assert('self-closing não gera falso positivo pro id próprio',
        !r.avisos.some(a => a.includes("id='header-right'")), r.avisos.join('; '));
    assert('mas a seção alheia com HTML de verdade continua sendo pega',
        r.avisos.some(a => a.includes("id='outra-secao'")), r.avisos.join('; '));
}

// L. validarXmlEstrutura — b:section com HTML direto (não self-closing) — true positive preservado
{
    const comHtmlDireto = `
<b:widget id='Blog1' type='Blog' version='2'><b:widget-settings/></b:widget>
<b:section id='sidebar-html' name='Sidebar'><div class='widget-html'>texto solto</div></b:section>`;
    const r = validarXmlEstrutura(comHtmlDireto);
    assert('b:section com div direto continua detectado', r.avisos.some(a => a.includes("id='sidebar-html'")));
}

// M. validarXmlEstrutura — b:section só com b:widget não gera aviso
{
    const soWidget = `
<b:widget id='Blog1' type='Blog' version='2'><b:widget-settings/></b:widget>
<b:section id='ok-section' name='OK'><b:widget id='HTML1' type='HTML' version='2'><div class='interno-do-widget'>ok</div></b:widget></b:section>`;
    const r = validarXmlEstrutura(soWidget);
    assert('b:section com só b:widget não gera aviso de HTML direto',
        !r.avisos.some(a => a.includes("id='ok-section'")), r.avisos.join('; '));
}

// N. validarXmlEstrutura — b:section aninhada DENTRO do corpo de um b:widget
// (padrão real do chassis: Blog1 define sozinho o grid conteúdo+sidebar, com
// b:section filhas nomeadas pra outros widgets serem soltos por dentro — ver
// 'main'/'sidebar-bottom' no template_blog.xml real). Como o widget inteiro
// é removido do XML antes do tokenizer de seções rodar, nada do que está
// dentro do corpo dele — incluindo as b:section filhas — deve gerar aviso.
{
    const aninhada = `
<b:section id='pai' name='Pai'>
  <b:widget id='Blog1' locked='false' title='Blog' type='Blog' version='2'>
    <b:widget-settings/>
    <b:includable id='main'>
      <div class='row'>
        <div class='col-8'><data:post.body/></div>
        <aside>
          <b:section id='filha-vazia' name='Vazia'/>
          <b:section id='filha-com-widget' name='ComWidget'>
            <b:widget id='Label1' type='Label' version='2'/>
          </b:section>
        </aside>
      </div>
    </b:includable>
  </b:widget>
</b:section>`;
    const r = validarXmlEstrutura(aninhada);
    assert('seção pai cujo único filho é um b:widget (mesmo com b:section aninhada dentro do corpo dele) não gera aviso próprio',
        !r.avisos.some(a => a.includes("id='pai'")), r.avisos.join('; '));
    assert('seção filha vazia (self-closing) declarada dentro do corpo do widget não gera aviso', !r.avisos.some(a => a.includes("id='filha-vazia'")));
    assert('seção filha só com widget declarada dentro do corpo do widget não gera aviso', !r.avisos.some(a => a.includes("id='filha-com-widget'")));
}

// O. validarXmlEstrutura — HTML solto de verdade na seção PAI, ao lado de
// uma seção filha aninhada — ainda precisa ser detectado (true positive
// preservado mesmo com aninhamento no meio)
{
    const paiComHtmlDeVerdade = `
<b:widget id='Blog1' type='Blog' version='2'><b:widget-settings/></b:widget>
<b:section id='pai-com-bug' name='Pai'>
  <p>Texto solto fora de qualquer widget</p>
  <b:section id='filha' name='Filha'><b:widget id='HTML1' type='HTML' version='2'/></b:section>
</b:section>`;
    const r = validarXmlEstrutura(paiComHtmlDeVerdade);
    assert('HTML solto na seção pai (ao lado de seção filha) ainda é detectado',
        r.avisos.some(a => a.includes("id='pai-com-bug'")), r.avisos.join('; '));
}

// P. validarSemanticaBlogger — b:widget-setting inválido pro tipo do widget
// (regra K). Bug real: 'showEmail' inventado pro ContactForm1 — Blogger
// rejeitava o upload com "'showEmail' is not a valid setting name".
{
    const comShowEmail = `
<b:widget id='ContactForm1' locked='false' title='Fale Conosco' type='ContactForm' version='2' visible='true'>
  <b:widget-settings>
    <b:widget-setting name='showEmail'>true</b:widget-setting>
  </b:widget-settings>
  <b:includable id='main'>ok</b:includable>
</b:widget>`;
    const r1 = validarSemanticaBlogger(comShowEmail);
    assert("ContactForm com 'showEmail' inventado é erro (regressão do bug real)",
        r1.erros.some(e => e.includes('showEmail')), r1.erros.join('; '));

    const contactFormOk = `
<b:widget id='ContactForm1' locked='false' title='Fale Conosco' type='ContactForm' version='2' visible='true'>
  <b:includable id='main'>ok</b:includable>
</b:widget>`;
    assert('ContactForm sem widget-settings (correto — nenhuma setting válida documentada) não é erro',
        validarSemanticaBlogger(contactFormOk).erros.length === 0);

    const popularPostsOk = `
<b:widget id='PopularPosts1' locked='false' title='Mais Baixados' type='PopularPosts' version='2' visible='true'>
  <b:widget-settings>
    <b:widget-setting name='numItemsToShow'>5</b:widget-setting>
    <b:widget-setting name='showThumbnails'>true</b:widget-setting>
    <b:widget-setting name='showSnippets'>true</b:widget-setting>
    <b:widget-setting name='timeRange'>ALL_TIME</b:widget-setting>
  </b:widget-settings>
</b:widget>`;
    assert('PopularPosts com settings reais (numItemsToShow/showThumbnails/showSnippets/timeRange) não é erro',
        validarSemanticaBlogger(popularPostsOk).erros.length === 0,
        validarSemanticaBlogger(popularPostsOk).erros.join('; '));

    const popularPostsInventado = `
<b:widget id='PopularPosts1' locked='false' title='X' type='PopularPosts' version='2'>
  <b:widget-settings><b:widget-setting name='inventado'>true</b:widget-setting></b:widget-settings>
</b:widget>`;
    const r2 = validarSemanticaBlogger(popularPostsInventado);
    assert("PopularPosts com setting inventado ('inventado') é erro",
        r2.erros.some(e => e.includes('inventado')), r2.erros.join('; '));

    const tipoSemWhitelist = `
<b:widget id='LinkList1' locked='false' title='X' type='LinkList' version='2'>
  <b:widget-settings><b:widget-setting name='qualquerCoisa'>true</b:widget-setting></b:widget-settings>
</b:widget>`;
    assert('Tipo de widget sem whitelist confirmada (ex: LinkList) não gera falso positivo',
        validarSemanticaBlogger(tipoSemWhitelist).erros.length === 0);
}

// Q. validarXmlEstrutura — b:widget self-closing SEM par depois dele na
// mesma seção não pode "engolir" seções/conteúdo alheios até o PRÓXIMO
// </b:widget> do documento inteiro. Bug real: <b:widget .../> self-closing
// (ex: Label1 numa b:section irmã do Blog1, achado ao restruturar
// template_blog.xml/template_magazine.xml pra tirar b:section de dentro do
// includable do Blog1) era tratado pelo regex de pares não-guloso como
// "abertura" — varria até o widget par MAIS PRÓXIMO NO DOCUMENTO INTEIRO,
// mesmo que completamente alheio, engolindo pelo caminho o fechamento da
// seção atual e a seção seguinte inteira (falso negativo silencioso: nem
// aviso nem erro, a seção simplesmente sumia do tokenizer).
{
    const selfClosingEngolindoSecaoAlheia = `
<b:section id='main' name='Main'>
  <b:widget id='Label1' locked='false' title='X' type='Label' version='2'/>
</b:section>
<b:section id='outra' name='Outra'>
  <p>Texto solto de verdade</p>
  <b:widget id='PageList1' locked='false' title='Y' type='PageList' version='2'>
    <b:includable id='content'><nav/></b:includable>
  </b:widget>
</b:section>`;
    const r = validarXmlEstrutura(selfClosingEngolindoSecaoAlheia);
    assert("seção alheia 'outra' com HTML solto de verdade continua detectada (não foi engolida pelo widget self-closing de 'main')",
        r.avisos.some(a => a.includes("id='outra'")), r.avisos.join('; '));
    assert("seção 'main' com só um widget self-closing não gera aviso próprio",
        !r.avisos.some(a => a.includes("id='main'")), r.avisos.join('; '));
}

// R. Árvore DOM — b:include dentro de COMENTÁRIO não conta como órfã.
// O coletor antigo (regex sobre texto cru) escaneava comentários e acusava
// falso positivo; a árvore descarta comentários no parse.
{
    const comentado = `
<b:widget id='Blog1' type='Blog' version='2'>
  <b:widget-settings><b:widget-setting name='showShareButtons'>false</b:widget-setting></b:widget-settings>
  <b:includable id='main'><!-- exemplo: <b:include name='naoExiste'/> --><b:include name='post'/></b:includable>
  <b:includable id='post'>ok</b:includable>
</b:widget>`;
    const r = validarSemanticaBlogger(comentado);
    assert('b:include comentado não é ref órfã', r.erros.length === 0, r.erros.join('; '));
}

// S. Árvore DOM — Regra K enxerga widget ANINHADO dentro do includable de
// outro widget. Falso negativo do regex antigo: o match não-guloso do widget
// externo consumia a abertura do interno, que nunca era validado — uma
// setting inventada nele passava batida. A árvore visita cada widget
// individualmente e atribui cada b:widget-settings ao seu dono direto.
{
    const aninhadoInvalido = `
<b:widget id='Blog1' type='Blog' version='2'>
  <b:widget-settings><b:widget-setting name='showShareButtons'>false</b:widget-setting></b:widget-settings>
  <b:includable id='main'>
    <b:widget id='Label9' type='Label' version='2'>
      <b:widget-settings><b:widget-setting name='settingInventada'>x</b:widget-setting></b:widget-settings>
    </b:widget>
  </b:includable>
</b:widget>`;
    const r = validarSemanticaBlogger(aninhadoInvalido);
    assert('setting inventada em widget aninhado é detectada (falso negativo do regex antigo)',
        r.erros.some(e => e.includes('Label9') && e.includes('settingInventada')), r.erros.join('; '));

    // E as settings VÁLIDAS do interno não são atribuídas por engano ao externo
    const aninhadoValido = aninhadoInvalido.replace("name='settingInventada'>x", "name='sorting'>ALPHA");
    const r2 = validarSemanticaBlogger(aninhadoValido);
    assert('settings válidas do widget interno não geram erro no externo', r2.erros.length === 0, r2.erros.join('; '));
}

// T. validarXmlCompilado — comentários malformados (XMLValidator.validate()
// não cobre isso; scan textual dedicado). '--' dentro do conteúdo do
// comentário é proibido pela spec XML e é o padrão típico de comentário
// aninhado (<!-- fora <!-- dentro --> resto -->).
{
    const raiz = `<html xmlns:b='http://www.google.com/2005/gml/b'><body>__CONTEUDO__</body></html>`;

    const aninhado = raiz.replace('__CONTEUDO__', "<!-- fora <!-- dentro --> resto -->");
    const r1 = validarXmlCompilado(aninhado);
    assert('comentário com "--" no conteúdo (aninhado) é erro bloqueador',
        r1.some(e => e.includes('--') && e.toLowerCase().includes('coment')), r1.join('; '));

    const naoFechado = raiz.replace('__CONTEUDO__', "<!-- abriu e nunca fechou");
    const r2 = validarXmlCompilado(naoFechado);
    assert('comentário aberto sem "-->" é erro bloqueador',
        r2.some(e => e.toLowerCase().includes('nunca fechado')), r2.join('; '));

    const comentarioOk = raiz.replace('__CONTEUDO__', "<!-- comentário normal e válido -->");
    const r3 = validarXmlCompilado(comentarioOk);
    assert('comentário bem-formado não é erro', r3.length === 0, r3.join('; '));
}

// U. Regras B/H/K — mensagens de erro/aviso trazem linha/coluna (antes só o
// check de sintaxe do Nível 1 trazia posição; as regras baseadas na árvore
// preserveOrder não têm posição nativa por nó, então buscamos a localização
// no texto cru como complemento).
{
    const comHtmlDireto = `
<b:widget id='Blog1' type='Blog' version='2'><b:widget-settings/></b:widget>
<b:section id='sidebar-com-linha' name='Sidebar'>
  <div class='solto'>texto</div>
</b:section>`;
    const rB = validarXmlEstrutura(comHtmlDireto);
    assert('Regra B (HTML direto na seção) traz linha/coluna na mensagem',
        rB.avisos.some(a => a.includes("id='sidebar-com-linha'") && /linha \d+, col \d+/.test(a)),
        rB.avisos.join('; '));

    const comOrfa = BLOG1_OK.replace("<b:include name='post'/>", "<b:include name='post'/><b:include name='refOrfaComLinha'/>");
    const rH = validarSemanticaBlogger(comOrfa);
    assert('Regra H (include órfão) traz linha/coluna na mensagem',
        rH.erros.some(e => e.includes('refOrfaComLinha') && /linha \d+, col \d+/.test(e)),
        rH.erros.join('; '));

    const settingInvalida = `
<b:widget id='ContactForm1' type='ContactForm' version='2'>
  <b:widget-settings><b:widget-setting name='settingComLinha'>true</b:widget-setting></b:widget-settings>
</b:widget>`;
    const rK = validarSemanticaBlogger(settingInvalida);
    assert('Regra K (setting inválida) traz linha/coluna na mensagem',
        rK.erros.some(e => e.includes('settingComLinha') && /linha \d+, col \d+/.test(e)),
        rK.erros.join('; '));
}

// V. validarXmlCompilado — entidades XML inválidas (XMLValidator.validate()
// não cobre isso; scan textual dedicado). Nomeada fora de amp/lt/gt/quot/apos
// (entidades HTML tipo &nbsp; não existem sem DTD) e numérica fora da
// produção Char da spec XML (surrogate solto, ou acima de 0x10FFFF).
{
    const raiz = `<html xmlns:b='http://www.google.com/2005/gml/b'><body>__CONTEUDO__</body></html>`;

    const comNbsp = raiz.replace('__CONTEUDO__', 'texto&nbsp;solto');
    const r1 = validarXmlCompilado(comNbsp);
    assert("entidade nomeada '&nbsp;' (HTML-only, sem DTD) é erro bloqueador",
        r1.some(e => e.includes('&nbsp;')), r1.join('; '));

    const comSurrogate = raiz.replace('__CONTEUDO__', 'texto&#xD800;solto');
    const r2 = validarXmlCompilado(comSurrogate);
    assert("entidade numérica de surrogate UTF-16 solto ('&#xD800;') é erro bloqueador",
        r2.some(e => e.includes('#xD800')), r2.join('; '));

    const alemDoLimite = raiz.replace('__CONTEUDO__', 'texto&#9999999;solto');
    const r3 = validarXmlCompilado(alemDoLimite);
    assert("entidade numérica além de 0x10FFFF ('&#9999999;') é erro bloqueador",
        r3.some(e => e.includes('#9999999')), r3.join('; '));

    const validas = raiz.replace('__CONTEUDO__', "a&amp;b &lt;tag&gt; &quot;q&quot; it&apos;s &#160;&#x00E9;");
    const r4 = validarXmlCompilado(validas);
    assert('entidades pré-definidas e numéricas válidas não geram erro', r4.length === 0, r4.join('; '));

    const dentroDeCdata = raiz.replace('__CONTEUDO__', '<![CDATA[texto&nbsp;dentro de cdata é literal]]>');
    const r5 = validarXmlCompilado(dentroDeCdata);
    assert("'&nbsp;' dentro de CDATA não é entidade (não é erro)", r5.length === 0, r5.join('; '));
}

// W. validarXmlEstrutura — Regra G: b:widget cujo pai direto não é b:section.
// Bug real reportado pelo usuário: <div class='col-lg-8'> entre a b:section
// 'main' e o b:widget Blog1 (usado pra layout em grid) faz o Blogger rejeitar
// o upload com "The widget with id Blog1 is not within a section (actual
// parent element is: div.)" — XML bem-formado, Regra A (presença) não pega,
// só a ancestralidade direta via árvore detecta.
{
    const comDivNoMeio = `
<b:section id='main' name='Main'>
  <div class='col-lg-8'>
    <b:widget id='Blog1' locked='true' title='Postagens' type='Blog' version='2'><b:widget-settings/></b:widget>
  </div>
</b:section>`;
    const r1 = validarXmlEstrutura(comDivNoMeio);
    assert('widget com <div> entre ele e a b:section é erro bloqueador',
        r1.erros.some(e => e.includes('Blog1') && e.includes('não é filho direto')), r1.erros.join('; '));
    assert('mensagem do erro cita o pai real (div) e traz linha/coluna',
        r1.erros.some(e => e.includes('<div>') && /linha \d+, col \d+/.test(e)), r1.erros.join('; '));

    const classNaPropriaSection = `
<b:section id='main' class='col-lg-8' name='Main'>
  <b:widget id='Blog1' locked='true' title='Postagens' type='Blog' version='2'><b:widget-settings/></b:widget>
</b:section>`;
    const r2 = validarXmlEstrutura(classNaPropriaSection);
    assert('widget filho direto de b:section (grid class na própria section) não é erro',
        !r2.erros.some(e => e.includes('não é filho direto')), r2.erros.join('; '));

    // Widget self-closing direto numa section (padrão comum de sidebar) —
    // não deve gerar falso positivo.
    const selfClosingDireto = `<b:section id='sidebar' name='Sidebar'><b:widget id='Label1' type='Label' version='2'/></b:section>`;
    assert('widget self-closing filho direto de section não é erro',
        !validarXmlEstrutura(selfClosingDireto).erros.some(e => e.includes('não é filho direto')));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} xmlValidator: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
