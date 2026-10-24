export type BloggerWidgetXml = string;
/** API de widgets Blogger gerados deterministicamente e consumidos pelo compilador. */
// ==========================================
// WIDGETS (header / navegação / HTML genérico)
// ==========================================

// Widget padrão de logo/título — sempre mostra data:blog.title como link para a home.
// Injected in [[HEADER_WIDGET]] slot inside b:section id='header-logo'.
function gerarHeaderWidget(): string {
    return `<b:widget id='Header1' locked='false' title='Título do Blog' type='Header' version='2'>
  <b:includable id='content'>
    <a class='sl-header-brand text-decoration-none' expr:href='data:blog.homepageUrl'><data:blog.title/></a>
  </b:includable>
</b:widget>`;
}

// Embrulha HTML cru num widget HTML editável pelo painel de Layout do Blogger.
// type='HTML' é um tipo GERENCIADO pelo Blogger (como Blog/PageList/Profile) —
// não aceita/usa b:includable custom; o conteúdo pré-preenchido de
// b:widget-setting name='content' é renderizado internamente pelo próprio
// motor do Blogger. CDATA evita ter que escapar cada '&'/'<'/'>' do HTML/CSS/JS
// interno. Um b:includable aqui, além de redundante, arrisca conflitar com a
// renderização nativa do tipo gerenciado — padrão confirmado em
// rag/ia-de-balcao/blogger-xml/ia-balcao-blogger-gadgets-parser-xml.json
// (gadgets_essenciais.HTML_widget.xml_newsletter).
function montarWidgetHtml(widgetId: string, titulo: string, html: string | null | undefined): string {
    if (!html || !html.trim()) return '';
    // ]]> encerraria a seção CDATA prematuramente — split-and-reopen padrão XML.
    const conteudo = html.trim().replace(/\]\]>/g, ']]]]><![CDATA[>');
    return `<b:widget id='${widgetId}' locked='false' title='${titulo}' type='HTML' version='2'>
  <b:widget-settings>
    <b:widget-setting name='content'><![CDATA[${conteudo}]]></b:widget-setting>
  </b:widget-settings>
</b:widget>`;
}

// Hero dinâmico via widget NATIVO FeaturedPost — usado quando o hero
// autoral do nicho precisa mostrar dado real de post (imagem/título/link)
// que um blob HTML estático (montarWidgetHtml, tipo 'HTML' gerenciado)
// nunca teria como preencher de verdade: tipo 'HTML' nunca recebe
// data: binding, só renderiza texto literal. Achado real (auditoria
// hero/corpo-do-post): o hero-mosaico de noticias-mag-news tinha
// placeholders "[TITULO]"/"[URL_POST_0]"/"[AUTOR]"/"[DATA]" que nunca
// eram preenchidos, vazando literalmente pro XML compilado. FeaturedPost
// é widget GERENCIADO como Header/PageList — aceita b:includable com
// data:postTitle/postUrl/postFirstImage reais, ao contrário do tipo
// 'HTML' genérico. useMostRecentPost=true sempre aponta pro post mais
// recente automaticamente, sem exigir configuração manual do dono do
// site (mesmo critério já usado em featuredPostWidget(), abaixo).
// Reaproveita as classes hero-mosaic/hero-card/hero-overlay/mag-badge/
// hero-title já definidas no CSS do nicho — zero CSS novo necessário.
function gerarHeroDestaqueMosaico(titulo: string, wrapperId: string): string {
    return `
<b:widget id='FeaturedPost1' locked='false' title='${titulo}' type='FeaturedPost' version='2' visible='true'>
  <b:widget-settings>
    <b:widget-setting name='showSnippet'>false</b:widget-setting>
    <b:widget-setting name='showPostTitle'>true</b:widget-setting>
    <b:widget-setting name='postId'>0</b:widget-setting>
    <b:widget-setting name='showFirstImage'>true</b:widget-setting>
    <b:widget-setting name='useMostRecentPost'>true</b:widget-setting>
  </b:widget-settings>
  <b:includable id='main'>
    <b:include name='content'/>
  </b:includable>
  <b:includable id='content'>
    <b:if cond='data:postFirstImage'>
      <div class='hero-mosaic' id='${wrapperId}'>
        <div class='hero-card rounded-3 hero-item-0'>
          <a expr:href='data:postUrl'>
            <img expr:alt='data:postTitle' expr:src='data:postFirstImage' loading='lazy'/>
            <div class='hero-overlay'>
              <span class='mag-badge'>Destaque</span>
              <h1 class='hero-title playfair mt-3'><data:postTitle/></h1>
            </div>
          </a>
        </div>
      </div>
    </b:if>
  </b:includable>
</b:widget>`;
}

// Variante de gerarHeroDestaqueMosaico com o mesmo racional (post real, não
// placeholder estático) mas pro layout "card grande com legenda gradient"
// de tecnologia-techwind — achado real (auditoria de qualidade com template
// de usuário real): o carousel-destaque original tinha 2 slides 100%
// estáticos ("Título do Destaque"/"Segundo Destaque", "Breve descrição do
// conteúdo") com CTA "Ler Artigo" apontando pra href="#" (não leva a lugar
// nenhum) — nenhum dos dois nunca mudava, e o link nunca funcionava, pra
// TODO site gerado com este nicho. Reduz de "2 slides falsos" pra "1 post
// real" (showSnippet:true dá acesso a data:postSnippet, que o hero-mosaico
// de noticias-mag-news não usa) — carousel Bootstrap (indicadores/prev/next)
// não faz sentido pra 1 item só, removido; card/badge/gradient/CTA do
// design original preservados via CSS (ver tema-tecnologia-techwind-dossie.json).
function gerarHeroDestaqueCard(titulo: string, wrapperId: string): string {
    return `
<b:widget id='FeaturedPost1' locked='false' title='${titulo}' type='FeaturedPost' version='2' visible='true'>
  <b:widget-settings>
    <b:widget-setting name='showSnippet'>true</b:widget-setting>
    <b:widget-setting name='showPostTitle'>true</b:widget-setting>
    <b:widget-setting name='postId'>0</b:widget-setting>
    <b:widget-setting name='showFirstImage'>true</b:widget-setting>
    <b:widget-setting name='useMostRecentPost'>true</b:widget-setting>
  </b:widget-settings>
  <b:includable id='main'>
    <b:include name='content'/>
  </b:includable>
  <b:includable id='content'>
    <b:if cond='data:postFirstImage'>
      <div class='hero-destaque-card rounded-4 shadow-sm overflow-hidden animate-up' id='${wrapperId}'>
        <img expr:alt='data:postTitle' expr:src='data:postFirstImage' class='d-block w-100 object-fit-cover' loading='lazy'/>
        <div class='hero-destaque-caption d-none d-md-block'>
          <span class='badge mb-2 py-2 px-3 hero-destaque-badge'>Destaque</span>
          <h1 class='fw-bold text-white'><data:postTitle/></h1>
          <b:if cond='data:postSnippet'>
            <p class='text-light opacity-75'><data:postSnippet/></p>
          </b:if>
          <a expr:href='data:postUrl' class='btn btn-sm btn-primary mt-2'>Ler Artigo</a>
        </div>
      </div>
    </b:if>
  </b:includable>
</b:widget>`;
}

// Widget padrão de navegação — sempre mostra "Início" + pages criadas pelo autor.
// Injected in [[NAV_WIDGET]] slot inside b:section id='main-nav' | 'menu-links'.
//
// id parametrizável (default 'PageList1') — o painel mobile (collapse/
// offcanvas, ver [[MOBILE_NAV_WIDGET]] em compile.js) precisa de uma 2ª
// instância deste widget com id diferente ('PageList2'), lendo o MESMO
// data:pages (Blogger popula as 2 instâncias de forma idêntica — não é
// duplicação de conteúdo, é o padrão normal do Blogger pra 2 gadgets
// bound à mesma fonte de dados). Nunca reaproveitar o mesmo id 2x no
// mesmo template — Blogger rejeita id de widget duplicado.
function gerarNavWidget(id: string = 'PageList1'): string {
    return `<b:widget id='${id}' locked='false' title='Navegação' type='PageList' version='2'>
  <b:includable id='content'>
    <ul>
      <li><a expr:href='data:blog.homepageUrl'>Início</a></li>
      <b:loop values='data:pages' var='p'>
        <li><a expr:href='data:p.href'><data:p.title/></a></li>
      </b:loop>
    </ul>
  </b:includable>
</b:widget>`;
}

export { gerarHeaderWidget, montarWidgetHtml, gerarHeroDestaqueMosaico, gerarHeroDestaqueCard, gerarNavWidget };
