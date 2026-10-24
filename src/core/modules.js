"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports._BACK_TO_TOP_VARIANTES = exports._DARK_MODE_VARIANTES = exports.PAGINATION_VARIANTES = exports.MOBILE_MENU_VARIANTES = exports.MOBILE_MENU_HAMBURGER_ICONS = exports.MOBILE_MENU_HAMBURGER_SVG = exports.MOBILE_MENU_OFFCANVAS_RIGHT = exports.MOBILE_MENU_OFFCANVAS = exports.MOBILE_MENU_CLASSICO = exports.ICON_AUTHOR_VARIANTES = exports.MENU_DROPDOWN_PREFIXO = exports.APP_DOWNLOAD_CTA = exports.RELATED_POSTS_JSON = exports.SLIDER_JSON = exports.REVIEW_ENGINE = exports.DROPCAP_CSS = exports.SHARE_BUTTONS = exports.READING_PROGRESS = exports.READING_TIME = exports.SLOT_AFTER = exports.SLOT_BEFORE = exports.ERROR_404_MAGNEWS = exports.ERROR_404_TECHWIND = exports.ERROR_404_NATUREZA = exports.ERROR_404_APPSTORE = exports.ERROR_404_GAMER = exports.ERROR_404 = exports.TOC = exports._COOKIE_BANNER_VARIANTES = exports.COOKIE_BANNER = void 0;
exports.resolverModulos = resolverModulos;
exports.escolherIconeAutor = escolherIconeAutor;
exports.contactFormWidget = contactFormWidget;
exports.popularPostsRankingWidget = popularPostsRankingWidget;
exports.statsWidget = statsWidget;
exports.blogArchiveWidget = blogArchiveWidget;
exports.translateWidget = translateWidget;
exports.featuredPostWidget = featuredPostWidget;
exports.labelCloudWidget = labelCloudWidget;
exports.socialLinksWidget = socialLinksWidget;
/**
 * Módulos injetáveis do Softload Engine.
 * Cada entrada é um snippet HTML/JS autocontido que substitui o placeholder
 * correspondente em template_base.xml. Se o módulo estiver desativado,
 * o placeholder é substituído por string vazia mantendo o XML limpo.
 *
 * Regras de segurança:
 *  - Todos os <script> usam <![CDATA[...]]> — obrigatório em Blogger XML
 *  - Zero eval(), zero Function(), zero innerHTML com dados do usuário
 *  - Zero inline styles com valores vindos de variáveis — apenas var(--sl-*)
 */
const { hashSeed } = require('./blockLibrary');
/**
 * Escolhe deterministicamente um item de `variantes` a partir de `seed` +
 * `papel` (namespace do ícone/módulo — 'darkmode', 'backtotop', 'author').
 * Nunca usa Math.random(): o mesmo site (mesmo siteName+nichoTema) sempre
 * recebe a mesma variante entre recompilações; sites diferentes tendem a
 * receber variantes diferentes. Papéis distintos usam namespaces distintos
 * de hash para não ficarem correlacionados (site não pode sempre cair no
 * "índice 0 de tudo" só por coincidência do mesmo hash reaproveitado).
 */
function _escolherPorSeed(seed, papel, variantes) {
    const idx = hashSeed(`${seed || ''}:${papel}`) % variantes.length;
    return variantes[idx];
}
// ==========================================
// MÓDULOS DE LAYOUT / UI
// ==========================================
// Três variantes de botão de dark mode — mesmo contrato funcional (lê/grava
// localStorage['theme'], aplica data-bs-theme no <html>, é isso que todo o
// CSS [data-bs-theme="dark"] dos templates espera): só o ícone/estilo varia.
// sun/moon paths reaproveitados de ia-de-balcao/blogger-ui/ia-balcao-dark-mode-svg-btn.json
// (já validados como referência real de Bootstrap Icons).
const _DARK_MODE_EMOJI = `
<div id='sl-dark-toggle' style='position:fixed;top:70px;right:16px;z-index:9990;'>
  <button id='sl-dm-btn'
    onclick='slDmToggle()'
    title='Alternar Modo Escuro'
    aria-label='Alternar Modo Escuro'
    style='width:40px;height:40px;border-radius:50%;border:2px solid var(--sl-primary);
           background:transparent;cursor:pointer;font-size:18px;line-height:1;
           box-shadow:0 2px 8px rgba(0,0,0,0.2);transition:all .3s;'>🌙</button>
</div>
<script>
//<![CDATA[
function slDmToggle(){
  var html=document.documentElement;
  var isDark=html.getAttribute('data-bs-theme')==='dark';
  var next=isDark?'light':'dark';
  html.setAttribute('data-bs-theme',next);
  localStorage.setItem('theme',next);
  document.getElementById('sl-dm-btn').textContent=next==='dark'?'☀️':'🌙';
}
(function(){
  var t=localStorage.getItem('theme')||'light';
  if(t==='dark')document.getElementById('sl-dm-btn').textContent='☀️';
})();
//]]>
</script>`;
const _DARK_MODE_SVG_SUNMOON = `
<div id='sl-dark-toggle' style='position:fixed;top:70px;right:16px;z-index:9990;'>
  <button id='sl-dm-btn'
    onclick='slDmToggle()'
    title='Alternar Modo Escuro'
    aria-label='Alternar Modo Escuro'
    style='width:40px;height:40px;border-radius:50%;border:2px solid var(--sl-primary);
           background:transparent;cursor:pointer;color:var(--sl-primary);
           display:flex;align-items:center;justify-content:center;
           box-shadow:0 2px 8px rgba(0,0,0,0.2);transition:all .3s;'>
    <svg id='sl-dm-icon-sun' xmlns='http://www.w3.org/2000/svg' width='19' height='19' fill='currentColor' viewBox='0 0 16 16'><path d='M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M8 0a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 0m0 13a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 13m8-5a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2a.5.5 0 0 1 .5.5M3 8a.5.5 0 0 1-.5.5h-2a.5.5 0 0 1 0-1h2A.5.5 0 0 1 3 8'/></svg>
    <svg id='sl-dm-icon-moon' xmlns='http://www.w3.org/2000/svg' width='19' height='19' fill='currentColor' viewBox='0 0 16 16' style='display:none;'><path d='M6 .278a.77.77 0 0 1 .08.858 7.2 7.2 0 0 0-.878 3.46c0 4.021 3.278 7.277 7.318 7.277q.792-.001 1.533-.16a.79.79 0 0 1 .81.316.73.73 0 0 1-.031.893A8.35 8.35 0 0 1 8.344 16C3.734 16 0 12.286 0 7.71 0 4.266 2.114 1.312 5.124.06A.75.75 0 0 1 6 .278'/></svg>
  </button>
</div>
<script>
//<![CDATA[
function slDmSyncIcon(theme){
  document.getElementById('sl-dm-icon-sun').style.display=theme==='dark'?'none':'block';
  document.getElementById('sl-dm-icon-moon').style.display=theme==='dark'?'block':'none';
}
function slDmToggle(){
  var html=document.documentElement;
  var isDark=html.getAttribute('data-bs-theme')==='dark';
  var next=isDark?'light':'dark';
  html.setAttribute('data-bs-theme',next);
  localStorage.setItem('theme',next);
  slDmSyncIcon(next);
}
(function(){
  slDmSyncIcon(localStorage.getItem('theme')||'light');
})();
//]]>
</script>`;
const _DARK_MODE_TOGGLE_PILL = `
<div style='position:fixed;top:70px;right:16px;z-index:9990;'>
  <label class='sl-toggle-pill' for='sl-theme-switch' aria-label='Alternar modo escuro'
    style='display:flex;align-items:center;width:52px;height:26px;border-radius:13px;
           background:var(--sl-card-bg,#e2e8f0);border:2px solid var(--sl-primary);
           padding:0;position:relative;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.2);'>
    <input type='checkbox' id='sl-theme-switch' onchange='slDmToggle(this.checked)' style='position:absolute;opacity:0;width:0;height:0;'/>
    <span id='sl-toggle-thumb' style='width:18px;height:18px;border-radius:50%;background:var(--sl-primary);
          position:absolute;left:3px;transition:transform .3s ease;display:flex;align-items:center;justify-content:center;color:#fff;'>
      <svg width='11' height='11' fill='currentColor' viewBox='0 0 16 16'><path d='M8 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8'/></svg>
    </span>
  </label>
</div>
<script>
//<![CDATA[
function slDmToggle(isDark){
  var html=document.documentElement;
  var next=isDark?'dark':'light';
  html.setAttribute('data-bs-theme',next);
  localStorage.setItem('theme',next);
  document.getElementById('sl-toggle-thumb').style.transform=isDark?'translateX(26px)':'translateX(0)';
}
(function(){
  var isDark=(localStorage.getItem('theme')||'light')==='dark';
  document.getElementById('sl-theme-switch').checked=isDark;
  document.getElementById('sl-toggle-thumb').style.transform=isDark?'translateX(26px)':'translateX(0)';
})();
//]]>
</script>`;
const _DARK_MODE_VARIANTES = [_DARK_MODE_EMOJI, _DARK_MODE_SVG_SUNMOON, _DARK_MODE_TOGGLE_PILL];
exports._DARK_MODE_VARIANTES = _DARK_MODE_VARIANTES;
// Três variantes de botão "voltar ao topo" — mesmo contrato funcional
// (aparece após scrollY>320, scroll suave ao topo): só o ícone/estilo varia.
// Variante SVG reaproveitada de ia-de-balcao/blogger-ui/ia-balcao-fab-scroll-top.json
// (variante_1).
const _BACK_TO_TOP_SETA_TEXTO = `
<button id='sl-back-top'
  onclick='window.scrollTo({top:0,behavior:"smooth"})'
  title='Voltar ao topo'
  aria-label='Voltar ao topo'
  style='position:fixed;bottom:24px;right:20px;z-index:9980;
         display:none;align-items:center;justify-content:center;
         width:44px;height:44px;border-radius:50%;
         background:var(--sl-primary);color:#fff;border:none;
         cursor:pointer;font-size:20px;
         box-shadow:0 4px 12px rgba(0,0,0,0.25);
         transition:opacity .3s,transform .3s;'>&#8679;</button>
<script>
//<![CDATA[
(function(){
  var btn=document.getElementById('sl-back-top');
  window.addEventListener('scroll',function(){
    btn.style.display=window.scrollY>320?'flex':'none';
  },{passive:true});
})();
//]]>
</script>`;
const _BACK_TO_TOP_CHEVRON_SVG = `
<button id='sl-back-top'
  onclick='window.scrollTo({top:0,behavior:"smooth"})'
  title='Voltar ao topo'
  aria-label='Voltar ao topo'
  style='position:fixed;bottom:24px;right:20px;z-index:9980;
         display:none;align-items:center;justify-content:center;
         width:44px;height:44px;border-radius:50%;
         background:var(--sl-primary);color:#fff;border:none;
         cursor:pointer;
         box-shadow:0 4px 12px rgba(0,0,0,0.25);
         transition:opacity .3s,transform .3s;'>
  <svg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'><polyline points='18 15 12 9 6 15'/></svg>
</button>
<script>
//<![CDATA[
(function(){
  var btn=document.getElementById('sl-back-top');
  window.addEventListener('scroll',function(){
    btn.style.display=window.scrollY>320?'flex':'none';
  },{passive:true});
})();
//]]>
</script>`;
const _BACK_TO_TOP_ARROW_SVG = `
<button id='sl-back-top'
  onclick='window.scrollTo({top:0,behavior:"smooth"})'
  title='Voltar ao topo'
  aria-label='Voltar ao topo'
  style='position:fixed;bottom:24px;right:20px;z-index:9980;
         display:none;align-items:center;justify-content:center;
         width:44px;height:44px;border-radius:50%;
         background:var(--sl-primary);color:#fff;border:none;
         cursor:pointer;
         box-shadow:0 4px 12px rgba(0,0,0,0.25);
         transition:opacity .3s,transform .3s;'>
  <svg xmlns='http://www.w3.org/2000/svg' width='18' height='18' fill='currentColor' viewBox='0 0 16 16'><path fill-rule='evenodd' d='M8 12a.5.5 0 0 0 .5-.5V3.707l3.146 3.147a.5.5 0 0 0 .708-.708l-4-4a.5.5 0 0 0-.708 0l-4 4a.5.5 0 1 0 .708.708L7.5 3.707V11.5a.5.5 0 0 0 .5.5z'/></svg>
</button>
<script>
//<![CDATA[
(function(){
  var btn=document.getElementById('sl-back-top');
  window.addEventListener('scroll',function(){
    btn.style.display=window.scrollY>320?'flex':'none';
  },{passive:true});
})();
//]]>
</script>`;
const _BACK_TO_TOP_VARIANTES = [_BACK_TO_TOP_SETA_TEXTO, _BACK_TO_TOP_CHEVRON_SVG, _BACK_TO_TOP_ARROW_SVG];
exports._BACK_TO_TOP_VARIANTES = _BACK_TO_TOP_VARIANTES;
// Paginação (anterior/próximo) — até esta rodada, os 3 chassis de blog
// (blog/magazine/saas) tinham o MESMO único estilo hardcoded direto no
// includable 'nextprev' de cada chassis (par de botões pill). Achado da
// auditoria comparativa: nenhuma referência real tem variedade aqui
// também (todas usam 1 estilo só, geralmente mais pobre que o do Engine —
// ver PR#528), mas o Engine já tem precedente de dar variedade visual
// determinística por site nos outros módulos (dark mode, back-to-top) —
// aplicado aqui pelo mesmo motivo: o mesmo par de botões pill em TODO
// site do Engine é uma assinatura visual repetitiva reconhecível.
// Todas as 3 variantes mantêm o mesmo contrato funcional: 2 links/spans
// ligados a data:newerPageUrl/data:olderPageUrl, com fallback desabilitado
// quando a página não existe (não perder a robustez já corrigida antes).
const _PAGINATION_PILLS = `
<div class='sl-pagination d-flex justify-content-between mt-5 pt-4 border-top'>
  <b:if cond='data:newerPageUrl'>
    <a class='btn btn-outline-primary rounded-pill px-4' expr:href='data:newerPageUrl' expr:title='data:newerPageTitle'>← Recentes</a>
  <b:else/>
    <span class='btn btn-outline-secondary rounded-pill px-4 disabled'>← Recentes</span>
  </b:if>
  <b:if cond='data:olderPageUrl'>
    <a class='btn btn-outline-primary rounded-pill px-4' expr:href='data:olderPageUrl' expr:title='data:olderPageTitle'>Mais antigos →</a>
  <b:else/>
    <span class='btn btn-outline-secondary rounded-pill px-4 disabled'>Mais antigos →</span>
  </b:if>
</div>`;
const _PAGINATION_MINIMAL = `
<div class='sl-pagination d-flex justify-content-between align-items-center mt-5 pt-4 border-top'>
  <b:if cond='data:newerPageUrl'>
    <a class='fw-semibold text-decoration-none' expr:href='data:newerPageUrl' expr:title='data:newerPageTitle' style='color:var(--sl-primary);'><i class='bi bi-arrow-left me-2'/>Mais recentes</a>
  <b:else/>
    <span class='fw-semibold text-muted opacity-50'><i class='bi bi-arrow-left me-2'/>Mais recentes</span>
  </b:if>
  <b:if cond='data:olderPageUrl'>
    <a class='fw-semibold text-decoration-none' expr:href='data:olderPageUrl' expr:title='data:olderPageTitle' style='color:var(--sl-primary);'>Mais antigos<i class='bi bi-arrow-right ms-2'/></a>
  <b:else/>
    <span class='fw-semibold text-muted opacity-50'>Mais antigos<i class='bi bi-arrow-right ms-2'/></span>
  </b:if>
</div>`;
const _PAGINATION_CARDS = `
<style>
  .sl-pagination-card { transition:var(--sl-transition); border-color:rgba(0,0,0,0.08) !important; }
  .sl-pagination-card:hover { border-color:var(--sl-primary) !important; transform:translateY(-2px); }
</style>
<div class='sl-pagination row g-3 mt-5 pt-4 border-top'>
  <div class='col-6'>
    <b:if cond='data:newerPageUrl'>
      <a class='sl-pagination-card d-block p-3 rounded-3 border text-decoration-none h-100' expr:href='data:newerPageUrl' expr:title='data:newerPageTitle'>
        <small class='text-muted d-block mb-1'><i class='bi bi-arrow-left me-1'/>Anterior</small>
        <span class='fw-bold' style='color:var(--sl-primary);'>Publicações mais recentes</span>
      </a>
    <b:else/>
      <span class='d-block p-3 rounded-3 border opacity-50 h-100'>
        <small class='text-muted d-block mb-1'><i class='bi bi-arrow-left me-1'/>Anterior</small>
        <span class='fw-bold'>—</span>
      </span>
    </b:if>
  </div>
  <div class='col-6 text-end'>
    <b:if cond='data:olderPageUrl'>
      <a class='sl-pagination-card d-block p-3 rounded-3 border text-decoration-none h-100' expr:href='data:olderPageUrl' expr:title='data:olderPageTitle'>
        <small class='text-muted d-block mb-1'>Próximo<i class='bi bi-arrow-right ms-1'/></small>
        <span class='fw-bold' style='color:var(--sl-primary);'>Publicações mais antigas</span>
      </a>
    <b:else/>
      <span class='d-block p-3 rounded-3 border opacity-50 h-100 text-end'>
        <small class='text-muted d-block mb-1'>Próximo<i class='bi bi-arrow-right ms-1'/></small>
        <span class='fw-bold'>—</span>
      </span>
    </b:if>
  </div>
</div>`;
const PAGINATION_VARIANTES = [_PAGINATION_PILLS, _PAGINATION_MINIMAL, _PAGINATION_CARDS];
exports.PAGINATION_VARIANTES = PAGINATION_VARIANTES;
// Ícone de autor (post meta) — hoje hardcoded como 'bi-person'/'bi-person-circle'
// idêntico em todo template; vira token [[ICON_AUTHOR]] resolvido por seed.
// As 4 classes são reais do pacote bootstrap-icons@1.11.3 (mesmo CDN já usado
// nos templates), confirmadas no changelog/font oficial da versão fixada.
const ICON_AUTHOR_VARIANTES = ['bi-person', 'bi-person-circle', 'bi-person-fill', 'bi-person-badge'];
exports.ICON_AUTHOR_VARIANTES = ICON_AUTHOR_VARIANTES;
/** Escolhe a classe do ícone de autor pro compile.js injetar em [[ICON_AUTHOR]]. */
function escolherIconeAutor(seed) {
    return _escolherPorSeed(seed, 'author', ICON_AUTHOR_VARIANTES);
}
/**
 * Barra de progresso de leitura — fixed no topo, 3px de altura.
 * Atualiza via scroll event com passive:true para performance.
 */
const READING_PROGRESS = `
<div id='sl-read-progress' style='position:fixed;top:0;left:0;height:3px;width:0%;
     background:var(--sl-primary);z-index:9999;
     transition:width 0.1s linear;pointer-events:none;'></div>
<script>
//<![CDATA[
(function(){
  var bar=document.getElementById('sl-read-progress');
  if(!bar)return;
  window.addEventListener('scroll',function(){
    var scrolled=window.scrollY||window.pageYOffset;
    var total=document.documentElement.scrollHeight-window.innerHeight;
    bar.style.width=total>0?Math.min(100,(scrolled/total)*100)+'%':'0%';
  },{passive:true});
})();
//]]>
</script>`;
exports.READING_PROGRESS = READING_PROGRESS;
// ==========================================
// MÓDULOS DE CONTEÚDO (POSTS)
// ==========================================
/**
 * Estimativa de tempo de leitura — conta palavras do post e divide por 200 WPM.
 * Injetado logo após o título do post em view de post único.
 */
const READING_TIME = `
<div id='sl-reading-time' style='display:flex;align-items:center;gap:6px;
     font-size:13px;color:var(--sl-text-muted,#64748b);margin-bottom:1rem;'>
  <svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' fill='currentColor' viewBox='0 0 16 16'>
    <path d='M8 3.5a.5.5 0 0 0-1 0V9a.5.5 0 0 0 .252.434l3.5 2a.5.5 0 0 0 .496-.868L8 8.71V3.5z'/>
    <path d='M8 16A8 8 0 1 0 8 0a8 8 0 0 0 0 16zm7-8A7 7 0 1 1 1 8a7 7 0 0 1 14 0z'/>
  </svg>
  <span id='sl-rt-label'>calculando...</span>
</div>
<script>
//<![CDATA[
(function(){
  function run(){
    var el=document.getElementById('sl-rt-label');
    var body=document.querySelector("[itemprop='articleBody']");
    if(!el||!body)return;
    var words=(body.textContent||body.innerText||'').trim().split(/\s+/).filter(Boolean).length;
    var mins=Math.max(1,Math.round(words/200));
    el.textContent=mins+(mins===1?' min de leitura':' min de leitura');
  }
  // O placeholder deste módulo é injetado ANTES de [itemprop='articleBody']
  // na maioria dos chassis — sem esperar o documento terminar de parsear, a
  // busca do post body ainda retornaria null.
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
//]]>
</script>`;
exports.READING_TIME = READING_TIME;
/**
 * Botões de compartilhamento ricos: WhatsApp, X, Facebook, copiar link.
 * Links usam expr:href do Blogger para URL/título dinâmicos.
 * Função slCopyLink() lê o span #sl-post-url já presente no template.
 */
const SHARE_BUTTONS = `
<div class='sl-share-buttons d-flex align-items-center flex-wrap gap-2 mt-4 pt-3 border-top'>
  <span class='fw-bold text-uppercase text-muted me-2' style='font-size:11px;letter-spacing:0.08em'>Compartilhe:</span>
  <a class='btn btn-sm text-white' rel='noopener noreferrer' target='_blank'
     expr:href='&quot;https://api.whatsapp.com/send?text=&quot; + data:post.title + &quot; - &quot; + data:post.url.canonical'
     style='background:#25D366;border-radius:var(--sl-btn-radius,8px);font-size:12px;'>
    <svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='currentColor' viewBox='0 0 16 16' class='me-1'>
      <path d='M13.601 2.326A7.854 7.854 0 0 0 7.994 0C3.627 0 .068 3.558.064 7.926c0 1.399.366 2.76 1.057 3.965L0 16l4.204-1.102a7.933 7.933 0 0 0 3.79.965h.004c4.368 0 7.926-3.558 7.93-7.93A7.898 7.898 0 0 0 13.6 2.326zM7.994 14.521a6.573 6.573 0 0 1-3.356-.92l-.24-.144-2.494.654.666-2.433-.156-.251a6.56 6.56 0 0 1-1.007-3.505c0-3.626 2.957-6.584 6.591-6.584a6.56 6.56 0 0 1 4.66 1.931 6.557 6.557 0 0 1 1.928 4.66c-.004 3.639-2.961 6.592-6.592 6.592zm3.615-4.934c-.197-.099-1.17-.578-1.353-.646-.182-.065-.315-.099-.445.099-.133.197-.513.646-.627.775-.114.133-.232.148-.43.05-.197-.1-.836-.308-1.592-.985-.59-.525-.985-1.175-1.103-1.372-.114-.198-.011-.304.088-.403.087-.088.197-.232.296-.346.1-.114.133-.198.198-.33.065-.134.034-.248-.015-.347-.05-.099-.445-1.076-.612-1.47-.16-.389-.323-.335-.445-.34-.114-.007-.247-.007-.38-.007a.729.729 0 0 0-.529.247c-.182.198-.691.677-.691 1.654 0 .977.71 1.916.81 2.049.098.133 1.394 2.132 3.383 2.992.47.205.84.326 1.129.418.475.152.904.129 1.246.08.38-.058 1.171-.48 1.338-.943.164-.464.164-.86.114-.943-.049-.084-.182-.133-.38-.232z'/>
    </svg>WhatsApp
  </a>
  <a class='btn btn-sm text-white' rel='noopener noreferrer' target='_blank'
     expr:href='&quot;https://twitter.com/intent/tweet?text=&quot; + data:post.title + &quot;&amp;url=&quot; + data:post.url.canonical'
     style='background:#000;border-radius:var(--sl-btn-radius,8px);font-size:12px;'>
    <svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='currentColor' viewBox='0 0 16 16' class='me-1'>
      <path d='M12.6.75h2.454l-5.36 6.142L16 15.25h-4.937l-3.867-5.07-4.425 5.07H.316l5.733-6.57L0 .75h5.063l3.495 4.633L12.601.75Zm-.86 13.028h1.36L4.323 2.145H2.865z'/>
    </svg>X
  </a>
  <a class='btn btn-sm text-white' rel='noopener noreferrer' target='_blank'
     expr:href='&quot;https://www.facebook.com/sharer.php?u=&quot; + data:post.url.canonical'
     style='background:#1877F2;border-radius:var(--sl-btn-radius,8px);font-size:12px;'>
    <svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='currentColor' viewBox='0 0 16 16' class='me-1'>
      <path d='M16 8.049c0-4.446-3.582-8.05-8-8.05C3.58 0-.002 3.603-.002 8.05c0 4.017 2.926 7.347 6.75 7.951v-5.625h-2.03V8.05H6.75V6.275c0-2.017 1.195-3.131 3.022-3.131.876 0 1.791.157 1.791.157v1.98h-1.009c-.993 0-1.303.621-1.303 1.258v1.51h2.218l-.354 2.326H9.25V16c3.824-.604 6.75-3.934 6.75-7.951z'/>
    </svg>Facebook
  </a>
  <button type='button' id='sl-copy-btn' onclick='slCopyLink(this)'
    style='background:var(--sl-card-bg,#fff);border:1px solid rgba(0,0,0,0.12);
           border-radius:var(--sl-btn-radius,8px);padding:4px 12px;font-size:12px;cursor:pointer;
           color:var(--sl-text-main,#334155);transition:all .2s;'>
    <svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='currentColor' viewBox='0 0 16 16' class='me-1'>
      <path d='M4.715 6.542 3.343 7.914a3 3 0 1 0 4.243 4.243l1.828-1.829A3 3 0 0 0 8.586 5.5L8 6.086a1.002 1.002 0 0 0-.154.199 2 2 0 0 1 .861 3.337L6.88 11.45a2 2 0 1 1-2.83-2.83l.793-.792a4.018 4.018 0 0 1-.128-1.287z'/>
      <path d='M6.586 4.672A3 3 0 0 0 7.414 9.5l.775-.776a2 2 0 0 1-.896-3.346L9.12 3.55a2 2 0 1 1 2.83 2.83l-.793.792c.112.42.155.855.128 1.287l1.372-1.372a3 3 0 1 0-4.243-4.243z'/>
    </svg>Copiar link
  </button>
</div>
<script>
//<![CDATA[
function slCopyLink(btn){
  var urlEl=document.getElementById('sl-post-url');
  var url=urlEl?urlEl.textContent.trim():window.location.href;
  if(navigator.clipboard){
    navigator.clipboard.writeText(url).then(function(){
      btn.textContent='✓ Copiado!';
      setTimeout(function(){ btn.textContent='Copiar link'; },2000);
    });
  }
}
//]]>
</script>`;
exports.SHARE_BUTTONS = SHARE_BUTTONS;
/**
 * Slider das últimas postagens — busca via Blogger JSON Feed (/feeds/posts/
 * default?alt=json), sem depender de nenhum plugin. Cobre de uma vez os
 * widgets documentados widget-slider-carousel e widget-slider-editorial
 * (apenas o estilo visual mudava entre os dois specs originais — o mecanismo
 * de busca é idêntico) para os 3 nichos que os pediam.
 * Fade cross-dissolve entre slides, setas + dots, sem dependência de
 * Bootstrap Carousel. Some silenciosamente (display:none permanece) se o
 * feed falhar ou tiver menos de 2 posts — nunca deixa um slider quebrado
 * visível.
 */
const SLIDER_JSON = `
<div class='container'>
<div id='sl-slider-json' style='display:none;position:relative;overflow:hidden;
     border-radius:12px;margin-bottom:2rem;background:#000;min-height:320px;'>
  <div id='sl-slider-track' style='position:relative;height:320px;'></div>
  <button aria-label='Anterior' id='sl-slider-prev' type='button'
    style='position:absolute;top:50%;left:12px;transform:translateY(-50%);
           width:38px;height:38px;border-radius:50%;border:none;
           background:rgba(0,0,0,0.4);color:#fff;font-size:18px;cursor:pointer;z-index:5;'>&#8249;</button>
  <button aria-label='Próximo' id='sl-slider-next' type='button'
    style='position:absolute;top:50%;right:12px;transform:translateY(-50%);
           width:38px;height:38px;border-radius:50%;border:none;
           background:rgba(0,0,0,0.4);color:#fff;font-size:18px;cursor:pointer;z-index:5;'>&#8250;</button>
  <div id='sl-slider-dots' style='position:absolute;bottom:14px;left:0;right:0;
       display:flex;justify-content:center;gap:6px;z-index:5;'></div>
</div>
</div>
<script>
//<![CDATA[
(function(){
  function upscale(url){
    if(!url)return'';
    return url.split('/s72-c/').join('/s1200/')
              .split('=s72-c').join('=s1200')
              .split('/w72-h72-c/').join('/s1200/');
  }
  function run(){
    var wrap=document.getElementById('sl-slider-json');
    var track=document.getElementById('sl-slider-track');
    var dots=document.getElementById('sl-slider-dots');
    if(!wrap||!track||!dots)return;
    fetch('/feeds/posts/default?alt=json&max-results=5')
      .then(function(r){return r.json();})
      .then(function(data){
        var entries=(data.feed&&data.feed.entry)||[];
        if(entries.length<2)return;
        entries.forEach(function(entry,i){
          var title=(entry.title&&entry.title.$t)||'';
          var link='#';
          (entry.link||[]).forEach(function(l){if(l.rel==='alternate')link=l.href;});
          var img=upscale(entry.media$thumbnail?entry.media$thumbnail.url:'');

          var slide=document.createElement('a');
          slide.href=link;
          slide.style.cssText='position:absolute;inset:0;display:block;background-size:cover;'+
            'background-position:center;transition:opacity .8s ease;opacity:'+(i===0?'1':'0')+';'+
            (img?"background-image:linear-gradient(to top,rgba(0,0,0,.75),rgba(0,0,0,.1) 55%),url('"+img+"');"
                :'background-color:#111;');
          var caption=document.createElement('div');
          caption.style.cssText='position:absolute;left:0;right:0;bottom:0;padding:24px;color:#fff;'+
            'font-weight:800;font-size:1.3rem;text-shadow:0 2px 6px rgba(0,0,0,.6);';
          caption.textContent=title;
          slide.appendChild(caption);
          track.appendChild(slide);

          var dot=document.createElement('button');
          dot.type='button';
          dot.setAttribute('aria-label','Slide '+(i+1));
          dot.style.cssText='width:8px;height:8px;border-radius:50%;border:none;padding:0;cursor:pointer;'+
            'background:rgba(255,255,255,'+(i===0?'1':'0.4')+');';
          dot.addEventListener('click',function(){ir(i);});
          dots.appendChild(dot);
        });

        var atual=0;
        var slideEls=track.children;
        var dotEls=dots.children;
        function ir(i){
          if(!slideEls.length)return;
          slideEls[atual].style.opacity='0';
          dotEls[atual].style.background='rgba(255,255,255,0.4)';
          atual=(i+slideEls.length)%slideEls.length;
          slideEls[atual].style.opacity='1';
          dotEls[atual].style.background='rgba(255,255,255,1)';
        }
        document.getElementById('sl-slider-prev').addEventListener('click',function(){ir(atual-1);});
        document.getElementById('sl-slider-next').addEventListener('click',function(){ir(atual+1);});
        setInterval(function(){ir(atual+1);},6000);

        wrap.style.display='block';
      })
      .catch(function(){ /* silencioso — sem slider se o feed falhar */ });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);
  else run();
})();
//]]>
</script>`;
exports.SLIDER_JSON = SLIDER_JSON;
/**
 * Posts relacionados — busca via Blogger JSON Feed filtrado pela primeira
 * label do post atual (/feeds/posts/default/-/LABEL?alt=json), excluindo o
 * post atual do resultado. Cobre o widget-relacionados-json-feed documentado.
 * expr:data-* (não <data:.../> direto) porque, dentro de um atributo comum,
 * a tag não é substituída de forma confiável pelo Blogger — expr: é o jeito
 * correto de jogar um valor de data: inteiro num atributo.
 */
const RELATED_POSTS_JSON = `
<b:if cond='data:post.labels'>
<div class='sl-related-posts mt-5 pt-4 border-top' expr:data-current-url='data:post.url.canonical'
     expr:data-label='data:post.labels.first.name' id='sl-related-wrap' style='display:none;'>
  <h4 class='fw-bold mb-4'>Você também pode gostar</h4>
  <div class='row g-3' id='sl-related-grid'></div>
</div>
</b:if>
<script>
//<![CDATA[
(function(){
  function upscale(url){
    if(!url)return'';
    return url.split('/s72-c/').join('/s400/')
              .split('=s72-c').join('=s400')
              .split('/w72-h72-c/').join('/s400/');
  }
  function run(){
    var wrap=document.getElementById('sl-related-wrap');
    var grid=document.getElementById('sl-related-grid');
    if(!wrap||!grid)return;
    var label=wrap.getAttribute('data-label');
    var currentUrl=wrap.getAttribute('data-current-url');
    if(!label)return;
    fetch('/feeds/posts/default/-/'+encodeURIComponent(label)+'?alt=json&max-results=4')
      .then(function(r){return r.json();})
      .then(function(data){
        var entries=(data.feed&&data.feed.entry)||[];
        var usados=0;
        entries.forEach(function(entry){
          if(usados>=3)return;
          var link='#';
          (entry.link||[]).forEach(function(l){if(l.rel==='alternate')link=l.href;});
          if(link===currentUrl)return;
          usados++;

          var title=(entry.title&&entry.title.$t)||'';
          var img=upscale(entry.media$thumbnail?entry.media$thumbnail.url:'');

          var col=document.createElement('div');
          col.className='col-md-4';
          var a=document.createElement('a');
          a.href=link;
          a.style.cssText='display:block;text-decoration:none;color:inherit;';
          if(img){
            var im=document.createElement('img');
            im.src=img;
            im.loading='lazy';
            im.alt='';
            im.style.cssText='width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:10px;margin-bottom:8px;';
            a.appendChild(im);
          }
          var h=document.createElement('div');
          h.style.cssText='font-weight:700;font-size:.95rem;line-height:1.35;';
          h.textContent=title;
          a.appendChild(h);
          col.appendChild(a);
          grid.appendChild(col);
        });
        if(usados>0)wrap.style.display='block';
      })
      .catch(function(){ /* silencioso */ });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);
  else run();
})();
//]]>
</script>`;
exports.RELATED_POSTS_JSON = RELATED_POSTS_JSON;
const COOKIE_BANNER = `
<div id='sl-cookie-bar'
  style='display:none;position:fixed;bottom:0;left:0;right:0;z-index:9999;
         background:#1e293b;color:#e2e8f0;padding:14px 20px;
         display:flex;flex-wrap:wrap;align-items:center;gap:12px;
         border-top:2px solid var(--sl-primary);font-size:13px;'>
  <span style='flex:1;min-width:200px;'>
    🍪 Este site usa cookies para melhorar sua experiência.
    <a href='/p/politica-de-privacidade.html'
       style='color:var(--sl-primary);text-decoration:underline;'>Saiba mais</a>
  </span>
  <button onclick='slCookieAccept()'
    style='padding:8px 20px;border-radius:6px;border:none;
           background:var(--sl-primary);color:#fff;cursor:pointer;font-weight:700;'>
    Aceitar
  </button>
  <button onclick='slCookieReject()'
    style='padding:8px 16px;border-radius:6px;border:1px solid #475569;
           background:transparent;color:#94a3b8;cursor:pointer;'>
    Recusar
  </button>
</div>
<script>
//<![CDATA[
(function(){
  if(!localStorage.getItem('sl-cookie-consent')){
    document.getElementById('sl-cookie-bar').style.display='flex';
  }
})();
function slCookieAccept(){
  localStorage.setItem('sl-cookie-consent','accepted');
  document.getElementById('sl-cookie-bar').style.display='none';
}
function slCookieReject(){
  localStorage.setItem('sl-cookie-consent','rejected');
  document.getElementById('sl-cookie-bar').style.display='none';
}
//]]>
</script>`;
exports.COOKIE_BANNER = COOKIE_BANNER;
// 5 variações de design adicionais pro banner de cookies (achado real do
// usuário: templates de nichos diferentes tinham SEMPRE a mesma barra
// escura full-width — nenhuma variedade visual). Mesmo contrato funcional
// da COOKIE_BANNER original em todas: id='sl-cookie-bar', funções globais
// slCookieAccept()/slCookieReject(), localStorage['sl-cookie-consent'],
// mantém os 2 botões (aceitar E recusar — a original já oferecia recusa
// explícita, removê-la seria regressão de UX/conformidade). Toggle por
// classe com transição animada (reflow forçado via offsetWidth antes de
// adicionar a classe — mesmo padrão já usado em viral-magazine's próprio
// #vm-cookie-banner) em vez do display:none/flex instantâneo da original.
const _COOKIE_BANNER_GLASS = `
<div id='sl-cookie-bar' class='sl-cookie-glass'>
  <div class='sl-cookie-glass-icon' aria-hidden='true'>🍪</div>
  <div class='sl-cookie-glass-text'>
    <strong>Aviso de Cookies</strong>
    <p>Usamos cookies para melhorar sua experiência.
      <a href='/p/politica-de-privacidade.html'>Saiba mais</a>
    </p>
  </div>
  <div class='sl-cookie-glass-actions'>
    <button onclick='slCookieAccept()' class='sl-cookie-glass-accept'>Entendi</button>
    <button onclick='slCookieReject()' class='sl-cookie-glass-reject'>Recusar</button>
  </div>
</div>
<style>
.sl-cookie-glass{display:none;position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(20px);
  width:92%;max-width:480px;background:rgba(255,255,255,.55);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
  border:1px solid rgba(255,255,255,.4);border-radius:20px;padding:18px 22px;align-items:center;gap:14px;
  box-shadow:0 12px 34px rgba(0,0,0,.18);z-index:9999;opacity:0;flex-wrap:wrap;
  transition:opacity .4s ease,transform .4s cubic-bezier(.175,.885,.32,1.275);}
.sl-cookie-glass.sl-cookie-show{opacity:1;transform:translateX(-50%) translateY(0);}
.sl-cookie-glass-icon{font-size:1.9rem;flex-shrink:0;}
.sl-cookie-glass-text{flex:1;min-width:200px;color:#1e293b;}
.sl-cookie-glass-text strong{display:block;margin-bottom:2px;}
.sl-cookie-glass-text p{margin:0;font-size:.82rem;opacity:.85;}
.sl-cookie-glass-text a{color:var(--sl-primary);text-decoration:underline;}
.sl-cookie-glass-actions{display:flex;gap:8px;}
.sl-cookie-glass-accept{background:var(--sl-primary);color:#fff;border:none;padding:9px 18px;border-radius:50px;font-weight:700;cursor:pointer;}
.sl-cookie-glass-reject{background:transparent;color:#334155;border:1px solid rgba(0,0,0,.15);padding:9px 16px;border-radius:50px;cursor:pointer;}
</style>
<script>
//<![CDATA[
function slCookieHide(){
  var el=document.getElementById('sl-cookie-bar');
  el.classList.remove('sl-cookie-show');
  setTimeout(function(){el.style.display='none';},400);
}
function slCookieAccept(){localStorage.setItem('sl-cookie-consent','accepted');slCookieHide();}
function slCookieReject(){localStorage.setItem('sl-cookie-consent','rejected');slCookieHide();}
(function(){
  if(!localStorage.getItem('sl-cookie-consent')){
    setTimeout(function(){
      var el=document.getElementById('sl-cookie-bar');
      el.style.display='flex';
      void el.offsetWidth;
      el.classList.add('sl-cookie-show');
    },800);
  }
})();
//]]>
</script>`;
const _COOKIE_BANNER_SHEET = `
<div id='sl-cookie-bar' class='sl-cookie-sheet'>
  <div class='sl-cookie-sheet-handle'></div>
  <div class='sl-cookie-sheet-body'>
    <i class='bi bi-shield-check sl-cookie-sheet-icon' aria-hidden='true'></i>
    <div>
      <strong>Privacidade</strong>
      <p>Este site utiliza cookies para garantir o funcionamento correto da plataforma.
        <a href='/p/politica-de-privacidade.html'>Saiba mais</a>
      </p>
    </div>
  </div>
  <div class='sl-cookie-sheet-actions'>
    <button onclick='slCookieAccept()' class='sl-cookie-sheet-accept'>Aceitar e Fechar</button>
    <button onclick='slCookieReject()' class='sl-cookie-sheet-reject'>Recusar</button>
  </div>
</div>
<style>
.sl-cookie-sheet{display:none;position:fixed;bottom:0;left:0;right:0;width:100%;
  background:var(--sl-card-bg,#fff);color:var(--sl-text-main,#1e293b);border-radius:24px 24px 0 0;
  padding:14px 24px 22px;box-shadow:0 -10px 40px rgba(0,0,0,.12);z-index:9999;
  transform:translateY(100%);transition:transform .35s ease-in-out;}
.sl-cookie-sheet.sl-cookie-show{transform:translateY(0);}
.sl-cookie-sheet-handle{width:40px;height:4px;background:rgba(0,0,0,.15);border-radius:10px;margin:0 auto 14px;}
.sl-cookie-sheet-body{display:flex;align-items:flex-start;gap:14px;margin-bottom:16px;}
.sl-cookie-sheet-icon{font-size:1.6rem;color:var(--sl-primary);margin-top:2px;}
.sl-cookie-sheet-body p{margin:2px 0 0;font-size:.85rem;opacity:.75;}
.sl-cookie-sheet-body a{color:var(--sl-primary);}
.sl-cookie-sheet-actions{display:flex;gap:10px;}
.sl-cookie-sheet-accept{flex:1;background:var(--sl-primary);color:#fff;border:none;padding:12px;border-radius:12px;font-weight:700;cursor:pointer;}
.sl-cookie-sheet-reject{background:transparent;color:inherit;border:1px solid rgba(0,0,0,.15);padding:12px 16px;border-radius:12px;cursor:pointer;}
</style>
<script>
//<![CDATA[
function slCookieHide(){
  var el=document.getElementById('sl-cookie-bar');
  el.classList.remove('sl-cookie-show');
  setTimeout(function(){el.style.display='none';},400);
}
function slCookieAccept(){localStorage.setItem('sl-cookie-consent','accepted');slCookieHide();}
function slCookieReject(){localStorage.setItem('sl-cookie-consent','rejected');slCookieHide();}
(function(){
  if(!localStorage.getItem('sl-cookie-consent')){
    setTimeout(function(){
      var el=document.getElementById('sl-cookie-bar');
      el.style.display='block';
      void el.offsetWidth;
      el.classList.add('sl-cookie-show');
    },800);
  }
})();
//]]>
</script>`;
const _COOKIE_BANNER_CORNER = `
<div id='sl-cookie-bar' class='sl-cookie-corner'>
  <div class='sl-cookie-corner-icon'><i class='bi bi-info-circle-fill' aria-hidden='true'></i></div>
  <div class='sl-cookie-corner-info'>
    <p>Utilizamos cookies para análises e personalização.
      <a href='/p/politica-de-privacidade.html'>Saiba mais</a>
    </p>
    <div class='sl-cookie-corner-actions'>
      <button onclick='slCookieAccept()' class='sl-cookie-corner-accept'>Prosseguir</button>
      <button onclick='slCookieReject()' class='sl-cookie-corner-reject'>Recusar</button>
    </div>
  </div>
</div>
<style>
.sl-cookie-corner{display:none;position:fixed;bottom:20px;right:20px;width:320px;max-width:90vw;
  background:var(--sl-card-bg,#fff);color:var(--sl-text-main,#1e293b);border-left:4px solid var(--sl-primary);
  padding:16px;box-shadow:0 8px 24px rgba(0,0,0,.15);align-items:flex-start;gap:12px;z-index:9999;
  opacity:0;transform:translateX(30px);transition:opacity .35s ease,transform .35s ease;}
.sl-cookie-corner.sl-cookie-show{opacity:1;transform:translateX(0);}
.sl-cookie-corner-icon{color:var(--sl-primary);font-size:1.4rem;margin-top:-2px;}
.sl-cookie-corner-info p{margin:0 0 10px;font-size:.85rem;line-height:1.4;opacity:.8;}
.sl-cookie-corner-info a{color:var(--sl-primary);}
.sl-cookie-corner-actions{display:flex;gap:8px;}
.sl-cookie-corner-accept{background:var(--sl-primary);color:#fff;border:none;padding:6px 16px;font-size:.8rem;font-weight:600;border-radius:4px;cursor:pointer;}
.sl-cookie-corner-reject{background:transparent;color:inherit;border:1px solid rgba(0,0,0,.2);padding:6px 14px;font-size:.8rem;border-radius:4px;cursor:pointer;}
</style>
<script>
//<![CDATA[
function slCookieHide(){
  var el=document.getElementById('sl-cookie-bar');
  el.classList.remove('sl-cookie-show');
  setTimeout(function(){el.style.display='none';},350);
}
function slCookieAccept(){localStorage.setItem('sl-cookie-consent','accepted');slCookieHide();}
function slCookieReject(){localStorage.setItem('sl-cookie-consent','rejected');slCookieHide();}
(function(){
  if(!localStorage.getItem('sl-cookie-consent')){
    setTimeout(function(){
      var el=document.getElementById('sl-cookie-bar');
      el.style.display='flex';
      void el.offsetWidth;
      el.classList.add('sl-cookie-show');
    },800);
  }
})();
//]]>
</script>`;
const _COOKIE_BANNER_DARKBAR = `
<div id='sl-cookie-bar' class='sl-cookie-darkbar'>
  <div class='sl-cookie-darkbar-content'>
    <i class='bi bi-shield-lock' aria-hidden='true'></i>
    <span>Nós salvamos pequenos dados para manter o site rápido e seguro.
      <a href='/p/politica-de-privacidade.html'>Saiba mais</a>
    </span>
  </div>
  <div class='sl-cookie-darkbar-actions'>
    <button onclick='slCookieAccept()' class='sl-cookie-darkbar-accept'>Permitir</button>
    <button onclick='slCookieReject()' class='sl-cookie-darkbar-reject'>Recusar</button>
  </div>
</div>
<style>
.sl-cookie-darkbar{display:none;position:fixed;bottom:0;left:0;width:100%;background:#0f172a;
  border-top:1px solid var(--sl-primary);padding:14px 22px;justify-content:space-between;
  align-items:center;flex-wrap:wrap;gap:14px;z-index:9999;
  transform:translateY(100%);transition:transform .35s ease;}
.sl-cookie-darkbar.sl-cookie-show{transform:translateY(0);}
.sl-cookie-darkbar-content{display:flex;align-items:center;gap:10px;color:#e2e8f0;font-size:.88rem;}
.sl-cookie-darkbar-content i{color:var(--sl-primary);font-size:1.3rem;}
.sl-cookie-darkbar-content a{color:var(--sl-primary);}
.sl-cookie-darkbar-actions{display:flex;gap:10px;}
.sl-cookie-darkbar-accept{background:var(--sl-primary);color:#fff;border:1px solid var(--sl-primary);padding:8px 22px;border-radius:4px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;cursor:pointer;}
.sl-cookie-darkbar-reject{background:transparent;color:#94a3b8;border:1px solid #334155;padding:8px 18px;border-radius:4px;cursor:pointer;}
</style>
<script>
//<![CDATA[
function slCookieHide(){
  var el=document.getElementById('sl-cookie-bar');
  el.classList.remove('sl-cookie-show');
  setTimeout(function(){el.style.display='none';},400);
}
function slCookieAccept(){localStorage.setItem('sl-cookie-consent','accepted');slCookieHide();}
function slCookieReject(){localStorage.setItem('sl-cookie-consent','rejected');slCookieHide();}
(function(){
  if(!localStorage.getItem('sl-cookie-consent')){
    setTimeout(function(){
      var el=document.getElementById('sl-cookie-bar');
      el.style.display='flex';
      void el.offsetWidth;
      el.classList.add('sl-cookie-show');
    },800);
  }
})();
//]]>
</script>`;
const _COOKIE_BANNER_BRUTAL = `
<div id='sl-cookie-bar' class='sl-cookie-brutal'>
  <i class='bi bi-fingerprint sl-cookie-brutal-icon' aria-hidden='true'></i>
  <div class='sl-cookie-brutal-text'>
    <strong>ALERTA DE COOKIES</strong>
    <p>Rastreamos métricas básicas pra melhorar o conteúdo.
      <a href='/p/politica-de-privacidade.html'>Saiba mais</a>
    </p>
  </div>
  <div class='sl-cookie-brutal-actions'>
    <button onclick='slCookieAccept()' class='sl-cookie-brutal-accept'>OK, BORA!</button>
    <button onclick='slCookieReject()' class='sl-cookie-brutal-reject'>Não</button>
  </div>
</div>
<style>
.sl-cookie-brutal{display:none;position:fixed;bottom:20px;left:20px;width:calc(100% - 40px);max-width:420px;
  background:#fef9c3;border:3px solid #000;padding:16px;box-shadow:6px 6px 0 #000;
  align-items:center;gap:14px;z-index:9999;opacity:0;transform:scale(.95);
  transition:opacity .2s ease,transform .2s ease;}
.sl-cookie-brutal.sl-cookie-show{opacity:1;transform:scale(1);}
.sl-cookie-brutal-icon{font-size:2.2rem;color:var(--sl-primary);flex-shrink:0;}
.sl-cookie-brutal-text strong{display:block;font-size:1rem;text-transform:uppercase;letter-spacing:-.3px;color:#000;}
.sl-cookie-brutal-text p{margin:4px 0 0;font-size:.8rem;color:#000;font-weight:500;}
.sl-cookie-brutal-text a{color:#000;text-decoration:underline;}
.sl-cookie-brutal-actions{display:flex;flex-direction:column;gap:6px;margin-left:auto;}
.sl-cookie-brutal-accept{background:#000;color:#fef9c3;border:2px solid #000;padding:7px 14px;font-weight:900;font-size:.82rem;cursor:pointer;box-shadow:3px 3px 0 var(--sl-primary);white-space:nowrap;}
.sl-cookie-brutal-accept:active{box-shadow:0 0 0 var(--sl-primary);transform:translate(3px,3px);}
.sl-cookie-brutal-reject{background:transparent;color:#000;border:2px solid #000;padding:5px 14px;font-size:.75rem;cursor:pointer;}
</style>
<script>
//<![CDATA[
function slCookieHide(){
  var el=document.getElementById('sl-cookie-bar');
  el.classList.remove('sl-cookie-show');
  setTimeout(function(){el.style.display='none';},250);
}
function slCookieAccept(){localStorage.setItem('sl-cookie-consent','accepted');slCookieHide();}
function slCookieReject(){localStorage.setItem('sl-cookie-consent','rejected');slCookieHide();}
(function(){
  if(!localStorage.getItem('sl-cookie-consent')){
    setTimeout(function(){
      var el=document.getElementById('sl-cookie-bar');
      el.style.display='flex';
      void el.offsetWidth;
      el.classList.add('sl-cookie-show');
    },800);
  }
})();
//]]>
</script>`;
// V0 (COOKIE_BANNER, barra escura full-width original) preservada como
// baseline — os 13 nichos que hoje dependem dela continuam recebendo o
// mesmo comportamento em pelo menos 1/6 das compilações, nunca perdem a
// variante já em produção.
const _COOKIE_BANNER_VARIANTES = [COOKIE_BANNER, _COOKIE_BANNER_GLASS, _COOKIE_BANNER_SHEET, _COOKIE_BANNER_CORNER, _COOKIE_BANNER_DARKBAR, _COOKIE_BANNER_BRUTAL];
exports._COOKIE_BANNER_VARIANTES = _COOKIE_BANNER_VARIANTES;
const TOC = `
<div id='sl-toc' style='display:none;background:var(--sl-card-bg);border:1px solid rgba(0,0,0,0.08);
     border-radius:12px;padding:20px 24px;margin-bottom:24px;'>
  <h6 style='font-size:11px;font-weight:800;text-transform:uppercase;
             letter-spacing:2px;color:var(--sl-primary);margin-bottom:12px;'>
    📋 Índice do Artigo
  </h6>
  <ol id='sl-toc-list' style='margin:0;padding-left:20px;font-size:14px;line-height:2;'></ol>
</div>
<script>
//<![CDATA[
(function(){
  function run(){
    var content=document.querySelector("[itemprop='articleBody']");
    if(!content)return;
    var headings=content.querySelectorAll('h2,h3');
    if(headings.length<2)return;
    var list=document.getElementById('sl-toc-list');
    headings.forEach(function(h,i){
      var id='sl-h-'+i;
      h.id=id;
      var li=document.createElement('li');
      li.style.marginLeft=h.tagName==='H3'?'16px':'0';
      var a=document.createElement('a');
      a.href='#'+id;
      a.textContent=h.textContent;
      a.style.color='inherit';
      a.style.textDecoration='none';
      li.appendChild(a);
      list.appendChild(li);
    });
    document.getElementById('sl-toc').style.display='block';
  }
  // Mesmo motivo do READING_TIME: placeholder vem antes de
  // [itemprop='articleBody'] no chassis, precisa esperar o parser terminar.
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
//]]>
</script>`;
exports.TOC = TOC;
/**
 * Motor de review: procura o shortcode [review titulo="..." nota="9.5"
 * grafico="9" som="10" gameplay="9"] em parágrafos "puros" (sem filhos)
 * dentro do corpo do post e substitui pela caixa de pontuação. Só nota é
 * obrigatória — grafico/som/gameplay são opcionais, cada um vira uma barra.
 *
 * Segurança: o único valor de texto livre do autor (titulo) é atribuído via
 * textContent, nunca concatenado em HTML — nada aqui passa por innerHTML
 * com dado do usuário (regra do topo do arquivo). Os campos numéricos
 * (nota/grafico/som/gameplay) são sempre coagidos por parseFloat + clamp
 * antes de virar style/texto, então não têm como carregar HTML/JS.
 */
const REVIEW_ENGINE = `
<script>
//<![CDATA[
(function(){
  function clampNota(v){
    var n=parseFloat(String(v).replace(',','.'));
    if(isNaN(n))n=0;
    return Math.max(0,Math.min(10,n));
  }
  function parseAttrs(str){
    var out={},re=/(\\w+)\\s*=\\s*"([^"]*)"/g,m;
    while((m=re.exec(str)))out[m[1].toLowerCase()]=m[2];
    return out;
  }
  var ROTULOS={grafico:'Gráficos',som:'Som',gameplay:'Jogabilidade'};
  function criarBarra(rotulo,valor){
    var n=clampNota(valor);
    var row=document.createElement('div');
    row.style.cssText='display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:.85rem;';
    var label=document.createElement('span');
    label.style.cssText='width:90px;flex-shrink:0;font-weight:600;';
    label.textContent=rotulo;
    var track=document.createElement('div');
    track.style.cssText='flex:1;height:8px;border-radius:4px;background:rgba(0,0,0,.08);overflow:hidden;';
    var fill=document.createElement('div');
    fill.style.cssText='height:100%;border-radius:4px;background:var(--sl-primary);transition:width .8s ease;width:0%;';
    track.appendChild(fill);
    var value=document.createElement('span');
    value.style.cssText='width:32px;text-align:right;font-weight:700;color:var(--sl-primary);';
    value.textContent=n.toFixed(1);
    row.appendChild(label);row.appendChild(track);row.appendChild(value);
    setTimeout(function(){fill.style.width=(n*10)+'%';},50);
    return row;
  }
  function criarBox(attrs){
    var nota=clampNota(attrs.nota);
    var deg=Math.round(nota/10*360);
    var box=document.createElement('div');
    box.className='sl-review-box';
    box.style.cssText='display:flex;align-items:center;gap:24px;background:var(--sl-card-bg,#fff);'+
      'border:1px solid rgba(0,0,0,.08);border-radius:16px;padding:24px;margin:2rem 0;'+
      'box-shadow:0 8px 24px rgba(0,0,0,.08);flex-wrap:wrap;';

    var ring=document.createElement('div');
    ring.style.cssText='width:96px;height:96px;flex-shrink:0;border-radius:50%;display:flex;'+
      'align-items:center;justify-content:center;'+
      'background:conic-gradient(var(--sl-primary) '+deg+'deg, rgba(0,0,0,.08) 0deg);';
    var inner=document.createElement('div');
    inner.style.cssText='width:78px;height:78px;border-radius:50%;background:var(--sl-card-bg,#fff);'+
      'display:flex;align-items:center;justify-content:center;';
    var notaSpan=document.createElement('span');
    notaSpan.style.cssText='font-size:1.4rem;font-weight:900;color:var(--sl-primary);';
    notaSpan.textContent=nota.toFixed(1);
    inner.appendChild(notaSpan);
    ring.appendChild(inner);

    var content=document.createElement('div');
    content.style.cssText='flex:1;min-width:200px;';
    var titulo=document.createElement('h4');
    titulo.style.cssText='font-size:.8rem;font-weight:800;text-transform:uppercase;'+
      'letter-spacing:1.5px;color:var(--sl-text-muted,#64748b);margin:0 0 12px;';
    titulo.textContent=attrs.titulo||'Veredicto Final';
    content.appendChild(titulo);

    ['grafico','som','gameplay'].forEach(function(campo){
      if(attrs[campo]!==undefined)content.appendChild(criarBarra(ROTULOS[campo],attrs[campo]));
    });

    box.appendChild(ring);
    box.appendChild(content);
    return box;
  }
  function run(){
    var articleBody=document.querySelector("[itemprop='articleBody']");
    if(!articleBody)return;
    var shortcodeRe=/\\[review([^\\]]*)\\]/i;
    var els=articleBody.querySelectorAll('p, div');
    for(var i=0;i<els.length;i++){
      var el=els[i];
      if(el.children.length>0)continue;
      var texto=el.textContent||'';
      var m=shortcodeRe.exec(texto);
      if(!m)continue;
      el.parentNode.replaceChild(criarBox(parseAttrs(m[1])),el);
    }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);
  else run();
})();
//]]>
</script>`;
exports.REVIEW_ENGINE = REVIEW_ENGINE;
// Achado (auditoria paginação/404/busca): as 4 referências reais comparadas
// tratam a 404 como oportunidade de recuperar o visitante perdido — pelo
// menos uma delas (natureza-bulma-vegan) coloca um formulário de busca
// (action='/search', endpoint nativo do Blogger) direto na página de erro.
// A variante 'appstore' (abaixo) já tinha essa ideia; o fallback genérico
// (usado por 9+ nichos sem tema próprio) nunca teve.
const ERROR_404 = `
<b:if cond='data:view.isError'>
<div class='container text-center py-5'>
  <div style='font-size:80px;font-weight:900;color:var(--sl-primary);line-height:1;'>404</div>
  <h2 style='font-weight:800;margin:16px 0 8px;'>Página não encontrada</h2>
  <p style='color:#64748b;max-width:400px;margin:0 auto 24px;'>
    O endereço que você tentou acessar não existe ou foi removido. Tente buscar abaixo:
  </p>
  <form action='/search' class='d-flex justify-content-center mx-auto mb-4' method='get' role='search' style='max-width:420px;gap:8px;'>
    <input aria-label='Pesquisar no site' class='form-control' name='q' placeholder='O que você procura?' type='search'/>
    <button class='btn btn-outline-primary' type='submit'>Buscar</button>
  </form>
  <a class='btn btn-primary px-4 py-2' expr:href='data:blog.homepageUrl'>
    Voltar ao início
  </a>
</div>
</b:if>`;
exports.ERROR_404 = ERROR_404;
// Variante temática "Game Over" do gamer-playerone — markup e classes
// (.error-404-wrapper, .error-code, .error-icon, .btn-respawn) batem 1:1
// com a CSS já documentada em pagina_404_game_over (tema-gamer-playerone-impl.json),
// extraída automaticamente pro <b:skin> por carregarNichoImpl. font-family
// inline em vez da classe 'oswald-font' do documento original — essa classe
// nunca teve regra CSS correspondente em nenhum bloco do nicho.
const ERROR_404_GAMER = `
<b:if cond='data:view.isError'>
<div class='error-404-wrapper animate-up'>
  <div class='error-icon mb-2'>
    <i class='bi bi-controller'/>
  </div>
  <h1 class='fw-bold error-code' style='font-family:var(--font-display);'>404</h1>
  <div class='error-content mt-3'>
    <h2 class='h2 mb-3 text-uppercase' style='font-family:var(--font-display);color:var(--gamer-text);letter-spacing:1px;'>Game Over!</h2>
    <p class='mb-5 mx-auto opacity-75' style='max-width:450px;font-size:1.1rem;'>
      Nível não encontrado. O arquivo que você tentou carregar pode estar corrompido ou foi apagado.
    </p>
    <a class='btn btn-respawn fs-5' expr:href='data:blog.homepageUrl'>
      <i class='bi bi-play-fill me-1'/> Fazer Respawn
    </a>
  </div>
</div>
</b:if>`;
exports.ERROR_404_GAMER = ERROR_404_GAMER;
// Variante temática do appstore-bulma-mobile — classes (.error-icon-wrapper,
// .error-title-404, .error-text-404, .error-search-form, .error-search-input,
// .btn-error-home) batem 1:1 com a CSS já documentada em widget_404_app_store
// (tema-appstore-bulma-mobile-impl.json), extraída automaticamente pro
// <b:skin> por carregarNichoImpl. O documento original detecta 404 via
// heurística JS no cliente (ausência de cards de post no DOM — frágil,
// falha em página de busca/label vazia) e revela um overlay fixed
// (#bulma-404-gadget) com display:none por padrão; aqui, como nos outros 2
// módulos de 404, troca pra <b:if cond='data:view.isError'>, a flag que o
// próprio Blogger já resolve no servidor — sem heurística, sem overlay,
// sem JS extra.
const ERROR_404_APPSTORE = `
<b:if cond='data:view.isError'>
<div class='container text-center py-5'>
  <div class='error-icon-wrapper'><i class='bi bi-search-heart'/></div>
  <h1 class='error-title-404'>App não encontrado</h1>
  <p class='error-text-404 mx-auto'>Desculpe, o conteúdo que você está procurando foi movido ou não está mais disponível nesta loja. Tente pesquisar abaixo:</p>
  <form action='/search' class='error-search-form mx-auto' method='get'>
    <input class='error-search-input' name='q' placeholder='Pesquisar aplicativos...' required='required' type='text'/>
  </form>
  <a class='btn-error-home' expr:href='data:blog.homepageUrl'><i class='bi bi-house-door-fill'/> Voltar ao Início</a>
</div>
</b:if>`;
exports.ERROR_404_APPSTORE = ERROR_404_APPSTORE;
// Variante temática de natureza-bulma-vegan — 100% classes utilitárias do
// Bootstrap (já sempre carregado em todo chassis), sem CSS dedicado, igual
// à referência real de onde foi extraída (o hand-built original também não
// tinha regra própria pra '.error-page' — só utilitários + inline style).
// Tem formulário de busca (action='/search', endpoint nativo do Blogger)
// igual à referência — achado da auditoria hero/paginação: nenhuma outra
// variante tinha essa recuperação além da 'appstore'. .nat-404-element usa
// a animação de flutuar já definida no dossiê do nicho (nat-404-animation)
// — antes desta variante existir, essa CSS nunca era aplicada a nenhum
// elemento (achado morto da mesma auditoria).
const ERROR_404_NATUREZA = `
<b:if cond='data:view.isError'>
<div class='error-page text-center py-5 px-3 bg-white rounded shadow-sm border-0 my-4'>
  <div class='display-1 fw-bold mb-3 nat-404-element' style='color:var(--sl-primary);'>
    <i class='bi bi-signpost-split'/> 404
  </div>
  <h1 class='h3 fw-bold mb-3'>Ops! Você se perdeu na trilha.</h1>
  <p class='text-muted mb-5'>A página que você está procurando não existe, foi movida ou o link está quebrado.</p>
  <form action='/search' class='d-flex justify-content-center mx-auto mb-4' method='get' role='search' style='max-width:450px;'>
    <input aria-label='Pesquisar no site' class='form-control form-control-lg me-2 rounded-pill bg-light border-0 px-4' name='q' placeholder='O que você procura?' type='search'/>
    <button class='btn btn-lg rounded-pill px-4 fw-bold' style='background-color:var(--sl-primary);border:none;' type='submit'>
      <i class='bi bi-search'/> Buscar
    </button>
  </form>
  <a class='btn btn-outline-dark rounded-pill px-4 mt-2 fw-bold' expr:href='data:blog.homepageUrl'>
    <i class='bi bi-house-door me-2'/> Voltar para o Início
  </a>
</div>
</b:if>`;
exports.ERROR_404_NATUREZA = ERROR_404_NATUREZA;
// Variante temática de tecnologia-techwind — mesmo caso de natureza-bulma-
// vegan: só utilitários Bootstrap, sem CSS própria (a referência original
// também não tinha regra dedicada pra '.error-404-wrapper'/'.error-icon'/
// '.error-code' aqui — diferente da versão de gamer-playerone, que usa os
// MESMOS nomes de classe mas com CSS própria, sem conflito real porque
// nunca compilam na mesma página).
const ERROR_404_TECHWIND = `
<b:if cond='data:view.isError'>
<div class='container text-center my-5 py-5 error-404-wrapper animate-up'>
  <div class='error-icon mb-3'>
    <i class='bi bi-robot' style='font-size:5rem;'/>
  </div>
  <h1 class='fw-bold error-code'>404</h1>
  <h2 class='h3 fw-bold mb-3'>Ops! Fim da linha.</h2>
  <p class='text-muted mb-5 mx-auto fs-5' style='max-width:500px;'>
    A página que você tentou acessar pode ter sido removida, mudou de nome ou está temporariamente indisponível.
  </p>
  <a class='btn btn-primary btn-lg rounded-pill px-5 py-3 fw-bold shadow-sm' expr:href='data:blog.homepageUrl'>
    <i class='bi bi-house-door-fill me-2'/> Voltar à Base
  </a>
</div>
</b:if>`;
exports.ERROR_404_TECHWIND = ERROR_404_TECHWIND;
// Variante temática de noticias-mag-news — classes ('.error-404-wrapper',
// '.error-code', '.error-subtitle') com CSS própria vinda do dossiê do
// nicho (peça 'error-404-editorial' em tema-noticias-mag-news-dossie.json),
// tipografia editorial (numeral gigante + subtítulo itálico), igual à
// referência real de onde foi extraída.
const ERROR_404_MAGNEWS = `
<b:if cond='data:view.isError'>
<div class='error-404-wrapper'>
  <h1 class='error-code'>404</h1>
  <h2 class='h3 error-subtitle mb-4'>Página não encontrada</h2>
  <p class='text-muted mb-5 mx-auto' style='max-width:500px;'>A edição que você procura parece ter sido recolhida das bancas. O link pode estar quebrado ou a matéria foi arquivada.</p>
  <a class='btn btn-dark rounded-pill px-5 py-3 fw-bold text-uppercase' expr:href='data:blog.homepageUrl' style='background-color:var(--mag-dark);border:none;'>
    <i class='bi bi-journal-text me-2'/> Voltar à Capa
  </a>
</div>
</b:if>`;
exports.ERROR_404_MAGNEWS = ERROR_404_MAGNEWS;
// Letra capitular (dropcap) — estilo "editorial de luxo" (MAG News). CSS
// puro, sem HTML/JS: aplica na primeira letra do primeiro parágrafo do post.
// [itemprop='articleBody'] é o atributo semântico que todo chassis usa em
// volta de <data:post.body/>, independente do nome de classe (que varia
// entre chassis — post-body, blog-post-body, saas-post-body...), então esse
// seletor funciona em qualquer template sem precisar de placeholder próprio.
const DROPCAP_CSS = `[itemprop='articleBody'] > p:first-of-type::first-letter {
  float: left;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 3.4em;
  line-height: 0.82;
  font-weight: 800;
  padding: 4px 10px 0 0;
  color: var(--sl-primary);
}`;
exports.DROPCAP_CSS = DROPCAP_CSS;
// Menu com submenu via prefixo "_" — mesmo padrão documentado no
// appstore-bulma-mobile e no natureza-bulma-vegan (ambos "família Bulma"):
// como o painel de Páginas do Blogger só permite lista PLANA (sem
// hierarquia), o dono do site convenciona um "_" no início do título da
// página pra marcá-la como filha da página anterior no menu. O script agrupa
// esses itens num <ul> aninhado dentro do <li> anterior — a mesma estrutura
// que a CSS deste chassis já sabe estilizar via hover puro
// (.sl-nav ul ul / .sl-nav ul li:hover > ul, ver <b:skin>), sem depender do
// dropdown JS do Bootstrap (diferente da versão de referência do
// appstore-bulma-mobile, que usa data-bs-toggle='dropdown').
//
// Seletor '#main-nav ul' (b:section fixa em todo chassis) em vez de um id
// próprio tipo 'dynamic-menu': o appstore-bulma-mobile já carrega, via
// carregarNichoImpl, sua PRÓPRIA cópia (documentada) deste mesmo script —
// hoje inerte porque nada no chassis tem esse id. Injetar um id
// compartilhado ativaria as duas versões ao mesmo tempo pra esse nicho.
// Convenção inalterada (página com título prefixado "_" vira submenu da
// página anterior) — só o HTML gerado mudou: antes montava um <ul> solto
// sem nenhuma classe (sem hover, sem clique, sem estilo — invisível até
// alguém escrever CSS pra ele); agora monta markup real de dropdown do
// Bootstrap 5 (.dropdown/.dropdown-toggle/.dropdown-menu/.dropdown-item,
// data-bs-toggle='dropdown') — o Bootstrap já carregado em todo chassis
// (CSS + bundle JS com Popper) reconhece e inicializa esses atributos
// sozinho via data-api, sem JS de abrir/fechar próprio. href='#' no
// toggle é o padrão oficial do Bootstrap pra esse elemento (a página-pai
// vira só um rótulo do menu — o próprio Bootstrap ignora o clique nele e
// sempre abre/fecha o dropdown, então um href real nunca seria seguido
// de qualquer forma).
//
// Escopo deliberadamente igual ao de antes: só transforma '#main-nav ul'
// (nav DESKTOP). A 2ª instância do menu dentro do painel mobile
// (collapse/offcanvas/hambúrguer, [[MOBILE_NAV_WIDGET]]) fica de fora de
// propósito — dropdown com hover/position:absolute dentro de um painel
// estreito de mobile é um padrão de UX ruim; lá o menu continua uma
// lista simples (os títulos "_Filho" aparecem crus se o site usar essa
// convenção — trade-off aceito, documentado, não um bug).
const MENU_DROPDOWN_PREFIXO = `
<script>
//<![CDATA[
(function () {
  function run() {
    var menu = document.querySelector('#main-nav ul');
    if (!menu) return;
    var currentParent = null;
    var currentSubmenu = null;
    Array.prototype.forEach.call(menu.children, function (li) {
      var a = li.querySelector('a');
      if (!a) return;
      var texto = a.textContent.trim();
      if (texto.charAt(0) === '_') {
        a.textContent = texto.substring(1).trim();
        a.classList.remove('nav-link');
        a.classList.add('dropdown-item');
        if (!currentParent && li.previousElementSibling) {
          currentParent = li.previousElementSibling;
          currentParent.classList.add('dropdown');
          var parentA = currentParent.querySelector('a');
          if (parentA) {
            parentA.classList.add('dropdown-toggle');
            parentA.setAttribute('href', '#');
            parentA.setAttribute('role', 'button');
            parentA.setAttribute('data-bs-toggle', 'dropdown');
            parentA.setAttribute('aria-expanded', 'false');
          }
          currentSubmenu = document.createElement('ul');
          currentSubmenu.className = 'dropdown-menu';
          currentParent.appendChild(currentSubmenu);
        }
        li.classList.remove('nav-item');
        if (currentSubmenu) currentSubmenu.appendChild(li);
      } else {
        currentParent = null;
        currentSubmenu = null;
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
//]]>
</script>`;
exports.MENU_DROPDOWN_PREFIXO = MENU_DROPDOWN_PREFIXO;
const SLOT_BEFORE = `<div class='sl-slot-before my-3 text-center'></div>`;
exports.SLOT_BEFORE = SLOT_BEFORE;
const SLOT_AFTER = `<div class='sl-slot-after my-4 text-center'></div>`;
exports.SLOT_AFTER = SLOT_AFTER;
// [[MOBILE_NAV_WIDGET]] — 2ª instância do widget de navegação (id
// 'PageList2', ver gerarNavWidget() em widgets.js), resolvida
// separadamente em compile.js (não em resolverModulos — este arquivo
// não tem acesso a widgets.js). Sem isso a b:section de dentro do painel
// mobile nascia sempre auto-fechada, vazia — o hambúrguer/offcanvas
// abria e não mostrava nada.
const MOBILE_MENU_CLASSICO = `
<!-- Menu Mobile — Clássico (Bootstrap Collapse) -->
<button class='navbar-toggler d-lg-none border-0 p-0 me-2' type='button'
        data-bs-toggle='collapse' data-bs-target='#slMobileNav'
        aria-controls='slMobileNav' aria-expanded='false' aria-label='Menu'>
  <span class='navbar-toggler-icon'></span>
</button>
<div class='collapse navbar-collapse' id='slMobileNav'>
  <b:section id='mobile-nav-collapse' name='Menu Mobile (Clássico)' showaddelement='yes' maxwidgets='1'>[[MOBILE_NAV_WIDGET]]</b:section>
</div>`;
exports.MOBILE_MENU_CLASSICO = MOBILE_MENU_CLASSICO;
const MOBILE_MENU_OFFCANVAS = `
<!-- Menu Mobile — Offcanvas esquerda (Bootstrap 5.3) -->
<button class='btn d-lg-none p-0 me-2 border-0' type='button'
        data-bs-toggle='offcanvas' data-bs-target='#slOffcanvas'
        aria-controls='slOffcanvas' aria-label='Menu'>
  <span class='navbar-toggler-icon'></span>
</button>
<div class='offcanvas offcanvas-start' tabindex='-1' id='slOffcanvas' style='--bs-offcanvas-width:280px;'>
  <div class='offcanvas-header border-bottom'>
    <h5 class='offcanvas-title fw-black'><data:blog.title/></h5>
    <button type='button' class='btn-close' data-bs-dismiss='offcanvas' aria-label='Fechar'></button>
  </div>
  <div class='offcanvas-body'>
    <b:section id='mobile-nav-offcanvas' name='Menu Offcanvas' showaddelement='yes' maxwidgets='1'>[[MOBILE_NAV_WIDGET]]</b:section>
  </div>
</div>`;
exports.MOBILE_MENU_OFFCANVAS = MOBILE_MENU_OFFCANVAS;
// Offcanvas direita — clone exato do offcanvas esquerdo acima, só troca
// 'offcanvas-start' por 'offcanvas-end' (classe real do Bootstrap 5) e
// usa um id de painel/seção própria (nunca reaproveitar 'slOffcanvas' —
// as duas variantes nunca coexistem no mesmo template, mas manter ids
// distintos evita qualquer ambiguidade se o CSS/JS algum dia precisar
// mirar uma variante especificamente).
const MOBILE_MENU_OFFCANVAS_RIGHT = `
<!-- Menu Mobile — Offcanvas direita (Bootstrap 5.3) -->
<button class='btn d-lg-none p-0 me-2 border-0' type='button'
        data-bs-toggle='offcanvas' data-bs-target='#slOffcanvasRight'
        aria-controls='slOffcanvasRight' aria-label='Menu'>
  <span class='navbar-toggler-icon'></span>
</button>
<div class='offcanvas offcanvas-end' tabindex='-1' id='slOffcanvasRight' style='--bs-offcanvas-width:280px;'>
  <div class='offcanvas-header border-bottom'>
    <h5 class='offcanvas-title fw-black'><data:blog.title/></h5>
    <button type='button' class='btn-close' data-bs-dismiss='offcanvas' aria-label='Fechar'></button>
  </div>
  <div class='offcanvas-body'>
    <b:section id='mobile-nav-offcanvas-right' name='Menu Offcanvas Direita' showaddelement='yes' maxwidgets='1'>[[MOBILE_NAV_WIDGET]]</b:section>
  </div>
</div>`;
exports.MOBILE_MENU_OFFCANVAS_RIGHT = MOBILE_MENU_OFFCANVAS_RIGHT;
// Hambúrguer com SVG inline (3 linhas) — markup real extraído de um
// template de referência hand-built (App_Craft.xml), não inventado.
// stroke='currentColor' herda a cor do texto do botão automaticamente
// (nenhuma cor hardcoded) — funciona igual em qualquer colorPreset/dark
// mode sem CSS extra. Mesmo mecanismo de collapse de MOBILE_MENU_CLASSICO,
// só troca o ícone.
const MOBILE_MENU_HAMBURGER_SVG = `
<!-- Menu Mobile — Hambúrguer SVG inline -->
<button aria-controls='slMobileNavSvg' aria-expanded='false' aria-label='Menu'
        class='navbar-toggler border-0 p-0 me-2' data-bs-target='#slMobileNavSvg'
        data-bs-toggle='collapse' type='button'>
  <svg fill='none' height='28' stroke='currentColor' stroke-width='2' viewBox='0 0 24 24' width='28' xmlns='http://www.w3.org/2000/svg'>
    <line x1='3' x2='21' y1='12' y2='12'/>
    <line x1='3' x2='21' y1='6' y2='6'/>
    <line x1='3' x2='21' y1='18' y2='18'/>
  </svg>
</button>
<div class='collapse navbar-collapse' id='slMobileNavSvg'>
  <b:section id='mobile-nav-hamburger-svg' name='Menu Mobile (Hambúrguer SVG)' showaddelement='yes' maxwidgets='1'>[[MOBILE_NAV_WIDGET]]</b:section>
</div>`;
exports.MOBILE_MENU_HAMBURGER_SVG = MOBILE_MENU_HAMBURGER_SVG;
// Hambúrguer com Bootstrap Icons — markup real extraído de um template
// de referência hand-built (portal de notícias), reaproveitando a
// biblioteca de ícones que já carrega em todo chassis (bi-search,
// bi-download etc já usados no projeto). Mesmo mecanismo de collapse.
const MOBILE_MENU_HAMBURGER_ICONS = `
<!-- Menu Mobile — Hambúrguer Bootstrap Icons -->
<button aria-controls='slMobileNavIcons' aria-expanded='false' aria-label='Menu'
        class='navbar-toggler border-0 p-0 me-2' data-bs-target='#slMobileNavIcons'
        data-bs-toggle='collapse' type='button'>
  <i class='bi bi-list fs-2'/>
</button>
<div class='collapse navbar-collapse' id='slMobileNavIcons'>
  <b:section id='mobile-nav-hamburger-icons' name='Menu Mobile (Hambúrguer Icons)' showaddelement='yes' maxwidgets='1'>[[MOBILE_NAV_WIDGET]]</b:section>
</div>`;
exports.MOBILE_MENU_HAMBURGER_ICONS = MOBILE_MENU_HAMBURGER_ICONS;
const COMMENTS_NATIVO = `
<!-- Comentários — Blogger Nativo -->
<div class='sl-comments mt-5 pt-4 border-top'>
  <h4 class='fw-bold mb-4'>Comentários</h4>
  <b:include data='post' name='comments'/>
</div>`;
const COMMENTS_DISQUS = `
<!-- Comentários — Disqus -->
<div class='sl-comments mt-5 pt-4 border-top'>
  <h4 class='fw-bold mb-4'>Comentários</h4>
  <div id='disqus_thread'></div>
</div>
<script>
//<![CDATA[
(function () {
  var d = document, s = d.createElement('script');
  s.src = '//SEU-SHORTNAME.disqus.com/embed.js';
  s.setAttribute('data-timestamp', +new Date());
  (d.head || d.body).appendChild(s);
})();
//]]>
</script>`;
/**
 * Formulário de contato — widget nativo ContactForm do Blogger, sem
 * dependência externa (sem Formspree — decisão explícita: a IA ensina a
 * configurar serviços de terceiros via conversa, não nasce no template).
 * O e-mail preenchido cai direto na caixa de entrada do dono da conta,
 * usando a infraestrutura que o próprio Blogger já processa.
 *
 * Título customizável por nicho (ex: "Suporte a Jogadores" no PlayerOne) —
 * por isso é função, não const como os outros módulos.
 *
 * b:includable id='content' é o fallback interno que o motor do Blogger
 * exige existir no widget ContactForm — sem ele o tipo do widget não é
 * reconhecido corretamente pelo painel de Layout (mesmo padrão observado
 * no template de referência PlayerOne V2.1).
 *
 * SEM b:widget-settings — ContactForm não tem nenhuma setting válida
 * documentada (ver gadgets_essenciais.ContactForm_widget em
 * ia-balcao-blogger-gadgets-parser-xml.json, capturado de XML real do
 * Blogger: widget self-closing, zero settings). Um 'showEmail' inventado
 * aqui quebrava o upload no Blogger com "'showEmail' is not a valid
 * setting name" — Blogger valida nomes de setting contra uma whitelist
 * interna por tipo de widget, não documentada publicamente.
 */
function contactFormWidget(titulo) {
    return `
<b:widget id='ContactForm1' locked='false' title='${titulo}' type='ContactForm' version='2' visible='true'>
  <b:includable id='main'>
    <h4 class='fw-bold mb-3'><data:title/></h4>
    <div class='contact-form-widget'>
      <form name='contact-form'>
        <div class='mb-2'>
          <input class='contact-form-name form-control form-control-sm' expr:id='data:widget.instanceId + "_contact-form-name"' expr:placeholder='data:contactFormNameMsg' name='name' type='text'/>
        </div>
        <div class='mb-2'>
          <input class='contact-form-email form-control form-control-sm' expr:id='data:widget.instanceId + "_contact-form-email"' expr:placeholder='data:contactFormEmailMsg' name='email' type='email'/>
        </div>
        <div class='mb-2'>
          <textarea class='contact-form-email-message form-control form-control-sm' expr:id='data:widget.instanceId + "_contact-form-email-message"' expr:placeholder='data:contactFormMessageMsg' name='email-message' rows='3'/>
        </div>
        <input class='contact-form-button btn btn-primary btn-sm' expr:id='data:widget.instanceId + "_contact-form-submit"' expr:value='data:contactFormSendMsg' type='button'/>
        <p class='contact-form-error-message small text-danger mt-2 mb-0' expr:id='data:widget.instanceId + "_contact-form-error-message"'/>
        <p class='contact-form-success-message small text-success mt-2 mb-0' expr:id='data:widget.instanceId + "_contact-form-success-message"'/>
      </form>
    </div>
  </b:includable>
  <b:includable id='content'>
    <div class='contact-form-widget'>
      <div class='form'>
        <form name='contact-form'>
          <p/>
          <data:contactFormNameMsg/>
          <br/>
          <input class='contact-form-name' expr:id='data:widget.instanceId + "_contact-form-name"' name='name' size='30' type='text' value=''/>
          <p/>
          <data:contactFormEmailMsg/> <span style='font-weight: bolder;'>*</span>
          <br/>
          <input class='contact-form-email' expr:id='data:widget.instanceId + "_contact-form-email"' name='email' size='30' type='text' value=''/>
          <p/>
          <data:contactFormMessageMsg/> <span style='font-weight: bolder;'>*</span>
          <br/>
          <textarea class='contact-form-email-message' cols='25' expr:id='data:widget.instanceId + "_contact-form-email-message"' name='email-message' rows='5'/>
          <p/>
          <input class='contact-form-button contact-form-button-submit' expr:id='data:widget.instanceId + "_contact-form-submit"' expr:value='data:contactFormSendMsg' type='button'/>
          <p/>
          <div style='text-align: center; max-width: 222px; width: 100%'>
            <p class='contact-form-error-message' expr:id='data:widget.instanceId + "_contact-form-error-message"'/>
            <p class='contact-form-success-message' expr:id='data:widget.instanceId + "_contact-form-success-message"'/>
          </div>
        </form>
      </div>
    </div>
  </b:includable>
</b:widget>`;
}
/**
 * Ranking de posts populares — widget nativo PopularPosts do Blogger.
 * As classes que o Blogger gera automaticamente pro wrapper (.PopularPosts,
 * .widget-content, .item-content, .item-thumbnail, .item-title, .item-snippet)
 * batem 1:1 com a CSS já documentada em popular_posts_ranking
 * (tema-appstore-bulma-mobile-impl.json — numeração via counter-increment,
 * pensada como "Top Apps"), extraída automaticamente pro <b:skin> por
 * carregarNichoImpl. Título customizável (ex: "Mais Baixados" no
 * appstore-bulma-mobile) — mesmo motivo de ser função, não const, que
 * contactFormWidget.
 */
function popularPostsRankingWidget(titulo) {
    return `
<b:widget id='PopularPosts1' locked='false' title='${titulo}' type='PopularPosts' version='2' visible='true'>
  <b:widget-settings>
    <b:widget-setting name='numItemsToShow'>5</b:widget-setting>
    <b:widget-setting name='showThumbnails'>true</b:widget-setting>
    <b:widget-setting name='showSnippets'>true</b:widget-setting>
    <b:widget-setting name='timeRange'>ALL_TIME</b:widget-setting>
  </b:widget-settings>
  <b:includable id='main'>
    <b:if cond='data:title != ""'>
      <h2 class='blog-widget-header'><data:title/></h2>
    </b:if>
    <div class='widget-content'>
      <ul>
        <b:loop values='data:posts' var='post'>
          <li>
            <div class='item-content'>
              <b:if cond='data:post.thumbnail'>
                <div class='item-thumbnail'>
                  <a expr:href='data:post.href'><img expr:alt='data:post.title' expr:src='data:post.thumbnail'/></a>
                </div>
              </b:if>
              <div>
                <div class='item-title'><a expr:href='data:post.href'><data:post.title/></a></div>
                <b:if cond='data:post.snippet'>
                  <div class='item-snippet'><data:post.snippet/></div>
                </b:if>
              </div>
            </div>
          </li>
        </b:loop>
      </ul>
    </div>
  </b:includable>
</b:widget>`;
}
// Botão "Baixar" nos cards de post da home — CTA que combina com a leitura
// de "cada post é um app" do appstore-bulma-mobile. Classe btn-baixar-pill
// já documentada em app_list_card (tema-appstore-bulma-mobile-impl.json) e
// extraída automaticamente pro <b:skin> por carregarNichoImpl.
const APP_DOWNLOAD_CTA = `<a class='btn-baixar-pill fw-bold rounded-pill px-3 py-1 ms-2 text-uppercase small flex-shrink-0' expr:href='data:post.url.canonical'><i class='bi bi-download me-1'/>Baixar</a>`;
exports.APP_DOWNLOAD_CTA = APP_DOWNLOAD_CTA;
/**
 * Contador de estatísticas — widget nativo Stats do Blogger (visitas
 * totais, com gráfico + sparkline). Markup do b:includable 'main' é o
 * boilerplate real que o próprio Blogger gera (capturado de um template
 * hand-built de referência — mesma fonte/critério de confiança já usado
 * pra contactFormWidget/popularPostsRankingWidget: XML de produção, não
 * inventado). Título customizável, mesmo motivo de ser função.
 */
function statsWidget(titulo) {
    return `
<b:widget id='Stats1' locked='false' title='${titulo}' type='Stats' version='2' visible='true'>
  <b:widget-settings>
    <b:widget-setting name='showGraphicalCounter'>true</b:widget-setting>
    <b:widget-setting name='showAnimatedCounter'>true</b:widget-setting>
    <b:widget-setting name='showSparkline'>true</b:widget-setting>
    <b:widget-setting name='sparklineStyle'>BLACK_TRANSPARENT</b:widget-setting>
    <b:widget-setting name='timeRange'>ALL_TIME</b:widget-setting>
  </b:widget-settings>
  <b:includable id='main'>
    <b:if cond='data:title != ""'><h2><data:title/></h2></b:if>
    <div class='widget-content'>
      <div expr:id='data:widget.instanceId + "_content"' style='display: none;'>
        <b:if cond='data:showSparkline'>
          <script src='https://www.gstatic.com/charts/loader.js' type='text/javascript'/>
          <span expr:id='data:widget.instanceId + "_sparklinespan"' style='display:inline-block; width:75px; height:30px'/>
        </b:if>
        <span expr:class='"counter-wrapper " + (data:showGraphicalCounter ? "graph-counter-wrapper" : "text-counter-wrapper")' expr:id='data:widget.instanceId + "_totalCount"'>
        </span>
        <b:include name='quickedit'/>
      </div>
    </div>
  </b:includable>
</b:widget>`;
}
/**
 * Arquivo do blog em menu suspenso — widget nativo BlogArchive do
 * Blogger, style MENU (dropdown compacto por mês/ano, não a lista longa
 * expandida). Os 6 includables (main/flat/interval/menu/posts/toggle)
 * são o conjunto completo que o Blogger exige pra esse widget — mesmo
 * boilerplate real de produção que fundamenta statsWidget acima.
 */
function blogArchiveWidget(titulo) {
    return `
<b:widget id='BlogArchive1' locked='false' title='${titulo}' type='BlogArchive' version='2' visible='true'>
  <b:widget-settings>
    <b:widget-setting name='showStyle'>MENU</b:widget-setting>
    <b:widget-setting name='yearPattern'>yyyy</b:widget-setting>
    <b:widget-setting name='showWeekEnd'>true</b:widget-setting>
    <b:widget-setting name='monthPattern'>MMMM</b:widget-setting>
    <b:widget-setting name='dayPattern'>MMM dd</b:widget-setting>
    <b:widget-setting name='weekPattern'>MM/dd</b:widget-setting>
    <b:widget-setting name='chronological'>true</b:widget-setting>
    <b:widget-setting name='showPosts'>false</b:widget-setting>
    <b:widget-setting name='frequency'>DAILY</b:widget-setting>
  </b:widget-settings>
  <b:includable id='main'>
    <b:if cond='data:title != ""'>
      <h2><data:title/></h2>
    </b:if>
    <div class='widget-content'>
    <div id='ArchiveList'>
    <div expr:id='data:widget.instanceId + "_ArchiveList"'>
      <b:include cond='data:style == "HIERARCHY"' data='data' name='interval'/>
      <b:include cond='data:style == "FLAT"' data='data' name='flat'/>
      <b:include cond='data:style == "MENU"' data='data' name='menu'/>
    </div>
    </div>
    <b:include name='quickedit'/>
    </div>
  </b:includable>
  <b:includable id='flat' var='data'>
    <ul class='flat'>
      <b:loop values='data:data' var='i'>
        <li class='archivedate'>
          <a expr:href='data:i.url'><data:i.name/></a> (<data:i.post-count/>)
        </li>
      </b:loop>
    </ul>
  </b:includable>
  <b:includable id='interval' var='intervalData'>
    <b:loop values='data:intervalData' var='interval'>
      <ul class='hierarchy'>
        <li expr:class='"archivedate " + data:interval.expclass'>
          <b:include cond='data:interval.toggleId' data='interval' name='toggle'/>
          <a class='post-count-link' expr:href='data:interval.url'>
            <data:interval.name/>
          </a>
          <span class='post-count' dir='ltr'>(<data:interval.post-count/>)</span>
          <b:include cond='data:interval.data' data='interval.data' name='interval'/>
          <b:include cond='data:interval.posts' data='interval.posts' name='posts'/>
        </li>
      </ul>
    </b:loop>
  </b:includable>
  <b:includable id='menu' var='data'>
    <select expr:id='data:widget.instanceId + "_ArchiveMenu"'>
      <option value=''><data:title/></option>
      <b:loop values='data:data' var='i'>
        <option expr:value='data:i.url'><data:i.name/> (<data:i.post-count/>)</option>
      </b:loop>
    </select>
  </b:includable>
  <b:includable id='posts' var='posts'>
    <ul class='posts'>
      <b:loop values='data:posts' var='post'>
        <li><a expr:href='data:post.url'><data:post.title/></a></li>
      </b:loop>
    </ul>
  </b:includable>
  <b:includable id='toggle' var='interval'>
    <a class='toggle' href='javascript:void(0)'>
      <span expr:class='"zippy" + (data:interval.expclass == "expanded" ? " toggle-open" : "")'>
        <b:if cond='data:interval.expclass == "expanded"'>
          &#9660;&#160;
        <b:elseif cond='data:blog.languageDirection == "rtl"'/>
          &#9668;&#160;
        <b:else/>
          &#9658;&#160;
        </b:if>
      </span>
    </a>
  </b:includable>
</b:widget>`;
}
/**
 * Seletor de idioma — widget nativo Translate do Blogger (Google
 * Translate embutido, sem título por padrão pra ficar discreto na
 * sidebar). Mesma fonte/critério de confiança dos demais geradores
 * nesta seção — boilerplate real, não inventado.
 */
function translateWidget() {
    return `
<b:widget id='Translate1' locked='false' title='' type='Translate' version='2' visible='true'>
  <b:widget-settings>
    <b:widget-setting name='displayMode'>SIMPLE</b:widget-setting>
  </b:widget-settings>
  <b:includable id='main'>
    <b:if cond='data:title != ""'>
      <h2 class='title'><data:title/></h2>
    </b:if>
    <div id='google_translate_element'/>
    <script>
      function googleTranslateElementInit() {
        new google.translate.TranslateElement({
          pageLanguage: '<data:pageLanguage/>',
          autoDisplay: 'true',
          layout: google.translate.TranslateElement.InlineLayout.<data:layout/>
        }, 'google_translate_element');
      }
    </script>
    <script src='//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit'/>
    <b:include name='quickedit'/>
  </b:includable>
</b:widget>`;
}
/**
 * Post fixado/destacado — widget nativo FeaturedPost do Blogger
 * (useMostRecentPost=true: sempre aponta pro post mais recente
 * automaticamente, sem exigir que o dono do site escolha um postId
 * manualmente — evita a viúva "Featured Post" apontando pra nada
 * quando o site é novo). Mesma fonte/critério de confiança dos demais.
 */
function featuredPostWidget(titulo) {
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
    <b:if cond='data:title != ""'>
      <h2 class='title'><data:title/></h2>
    </b:if>
    <b:include name='content'/>
    <b:include name='quickedit'/>
  </b:includable>
  <b:includable id='content'>
    <div class='post-summary'>
      <b:if cond='data:showPostTitle and data:postTitle != ""'>
        <h3><a expr:href='data:postUrl'><data:postTitle/></a></h3>
      </b:if>
      <b:if cond='data:showSnippet and data:postSummary != ""'>
        <p>
          <data:postSummary/>
        </p>
      </b:if>
      <b:if cond='data:showFirstImage and data:postFirstImage != ""'>
        <img class='image' expr:alt='data:postTitle' expr:src='data:postFirstImage'/>
      </b:if>
    </div>
    <style type='text/css'>
      .image {
        width: 100%;
      }
    </style>
  </b:includable>
</b:widget>`;
}
/**
 * Nuvem de marcadores — widget nativo Label do Blogger. Deliberadamente
 * SEM 'selectedLabelsList'/'showType' fixo (diferente da referência, que
 * hardcoda 3 labels específicas dela) — sem esses campos o Blogger usa o
 * default de mostrar TODOS os labels que o blog já tiver, o que é o
 * comportamento correto pra um template genérico que não sabe de
 * antemão quais labels o dono do site vai criar. display=CLOUD (badges
 * de tamanho proporcional à frequência) confirmado como opção
 * documentada em ia-balcao-blogger-gadgets-parser-xml.json.
 */
function labelCloudWidget(titulo) {
    return `
<b:widget id='Label1' locked='false' title='${titulo}' type='Label' version='2' visible='true'>
  <b:widget-settings>
    <b:widget-setting name='sorting'>ALPHA</b:widget-setting>
    <b:widget-setting name='display'>CLOUD</b:widget-setting>
    <b:widget-setting name='showFreqNumbers'>true</b:widget-setting>
  </b:widget-settings>
  <b:includable id='main'>
    <b:if cond='data:title != ""'>
      <h2><data:title/></h2>
    </b:if>
    <div expr:class='"widget-content " + data:display + "-label-widget-content"'>
      <b:if cond='data:display == "list"'>
        <ul>
          <b:loop values='data:labels' var='label'>
            <li>
              <b:if cond='data:blog.url == data:label.url'>
                <span expr:dir='data:blog.languageDirection'><data:label.name/></span>
              <b:else/>
                <a expr:dir='data:blog.languageDirection' expr:href='data:label.url'><data:label.name/></a>
              </b:if>
              <b:if cond='data:showFreqNumbers'>
                <span dir='ltr'>(<data:label.count/>)</span>
              </b:if>
            </li>
          </b:loop>
        </ul>
      <b:else/>
        <b:loop values='data:labels' var='label'>
          <span expr:class='"label-size label-size-" + data:label.cssSize'>
            <b:if cond='data:blog.url == data:label.url'>
              <span expr:dir='data:blog.languageDirection'><data:label.name/></span>
            <b:else/>
              <a expr:dir='data:blog.languageDirection' expr:href='data:label.url'><data:label.name/></a>
            </b:if>
            <b:if cond='data:showFreqNumbers'>
              <span class='label-count' dir='ltr'>(<data:label.count/>)</span>
            </b:if>
          </span>
        </b:loop>
      </b:if>
      <b:include name='quickedit'/>
    </div>
  </b:includable>
</b:widget>`;
}
/**
 * Menu de redes sociais — segundo LinkList do site (o primeiro já é o
 * menu de navegação principal, gerarNavWidget() em widgets.js). Mesmo
 * padrão já usado e comprovado em template_biolink.xml (widget
 * 'LinkList2', 'Redes Sociais (ícones no rodapé)') — reaproveitado aqui
 * tal como está, não inventado do zero. Usa data:links (Blogger popula
 * a lista pelo painel de Layout — o mesmo mecanismo de data:pages que
 * gerarNavWidget() já usa) em vez de href fixo, então nunca nasce com
 * link morto tipo o 'link-5=https://' visto na referência Bulma Vegan.
 */
function socialLinksWidget(titulo) {
    return `
<b:widget id='LinkList2' locked='false' title='${titulo}' type='LinkList' version='2' visible='true'>
  <b:includable id='main'>
    <div class='d-flex justify-content-center gap-2 flex-wrap'>
      <b:loop values='data:links' var='link'>
        <a class='social-icon-btn' expr:href='data:link.target' expr:title='data:link.name' rel='noopener noreferrer' target='_blank'>
          <i class='bi bi-link-45deg'/>
        </a>
      </b:loop>
    </div>
  </b:includable>
</b:widget>`;
}
// ==========================================
// RESOLVEDOR DE MÓDULOS
// ==========================================
/**
 * Resolve todos os módulos baseado nas configurações do usuário.
 * Retorna mapa { placeholder → snippet | '' }.
 * Qualquer módulo não ativado resulta em string vazia — placeholder removido do XML.
 * @param {string} [seed] — siteName+nichoTema, usado pra escolher variante de
 *   ícone (dark mode / back-to-top) de forma determinística por site.
 */
const MOBILE_MENU_VARIANTES = {
    classico: MOBILE_MENU_CLASSICO,
    offcanvas: MOBILE_MENU_OFFCANVAS,
    'offcanvas-right': MOBILE_MENU_OFFCANVAS_RIGHT,
    'hamburger-svg': MOBILE_MENU_HAMBURGER_SVG,
    'hamburger-icons': MOBILE_MENU_HAMBURGER_ICONS,
};
exports.MOBILE_MENU_VARIANTES = MOBILE_MENU_VARIANTES;
function resolverModulos(mods, seed) {
    const mobileMenu = MOBILE_MENU_VARIANTES[mods.mobileMenuType || ''] || '';
    const comments = mods.commentsSystem === 'nativo' ? COMMENTS_NATIVO
        : mods.commentsSystem === 'disqus' ? COMMENTS_DISQUS
            : '';
    const error404Snippet = {
        gamer: ERROR_404_GAMER,
        appstore: ERROR_404_APPSTORE,
        natureza: ERROR_404_NATUREZA,
        techwind: ERROR_404_TECHWIND,
        magnews: ERROR_404_MAGNEWS,
    }[mods.error404Theme || ''] || ERROR_404;
    return {
        // Módulos de cabeçalho
        '[[DARK_MODE_MODULE]]': mods.darkMode ? _escolherPorSeed(seed, 'darkmode', _DARK_MODE_VARIANTES) : '',
        '[[BACK_TO_TOP_MODULE]]': mods.backToTop ? _escolherPorSeed(seed, 'backtotop', _BACK_TO_TOP_VARIANTES) : '',
        '[[READING_PROGRESS]]': mods.readingProgress ? READING_PROGRESS : '',
        // Paginação sempre ativa (não é opt-in como dark mode/back-to-top —
        // é navegação essencial), só a variante visual muda por seed.
        '[[PAGINATION_MODULE]]': _escolherPorSeed(seed, 'pagination', PAGINATION_VARIANTES),
        // Módulos de conteúdo (posts)
        '[[READING_TIME]]': mods.readingTime ? READING_TIME : '',
        '[[SHARE_BUTTONS]]': mods.shareButtons ? SHARE_BUTTONS : '',
        '[[TOC_MODULE]]': mods.toc ? TOC : '',
        '[[REVIEW_ENGINE]]': mods.reviewEngine ? REVIEW_ENGINE : '',
        '[[RELATED_POSTS_JSON]]': mods.relatedPosts ? RELATED_POSTS_JSON : '',
        // Módulos de política / legal
        '[[COOKIE_MODULE]]': mods.cookieBanner ? _escolherPorSeed(seed, 'cookiebanner', _COOKIE_BANNER_VARIANTES) : '',
        '[[ERROR_404_MODULE]]': mods.error404 ? error404Snippet : '',
        // Slots de anúncio
        '[[SLOT_BEFORE_INJECTION]]': mods.slotBefore ? SLOT_BEFORE : '',
        '[[SLOT_AFTER_INJECTION]]': mods.slotAfter ? SLOT_AFTER : '',
        // Slider da home (opcional, homepage/listagem)
        '[[SLIDER_JSON]]': mods.sliderJson ? SLIDER_JSON : '',
        // Navegação mobile e comentários
        '[[MOBILE_MENU_TYPE]]': mobileMenu,
        '[[COMMENTS_SECTION]]': comments,
        // Formulário de contato (rodapé)
        '[[CONTACT_FORM]]': mods.contactForm ? contactFormWidget(mods.contactFormTitle || 'Fale Conosco') : '',
        // Ranking de posts populares (sidebar) e CTA de download nos cards da home
        '[[POPULAR_POSTS_RANKING]]': mods.popularPostsRanking ? popularPostsRankingWidget(mods.popularPostsRankingTitle || 'Populares') : '',
        '[[APP_DOWNLOAD_CTA]]': mods.appDownloadCta ? APP_DOWNLOAD_CTA : '',
        // Menu — submenu via prefixo "_" nos títulos de página
        '[[MENU_DROPDOWN_PREFIXO]]': mods.menuDropdownPrefixo ? MENU_DROPDOWN_PREFIXO : '',
        // "Mobília" nativa do Blogger — widgets de sidebar/rodapé que dão
        // corpo ao site (ver investigação de qualidade: referências
        // hand-built chegam com 12-19 desses widgets, a Engine chegava
        // com 4). Cada um só existe se o nicho ligar por padrão
        // (nichoModuleDefaults.js) ou o usuário pedir explicitamente.
        '[[STATS_WIDGET]]': mods.statsWidget ? statsWidget(mods.statsWidgetTitle || 'Estatísticas') : '',
        '[[BLOG_ARCHIVE_WIDGET]]': mods.blogArchiveWidget ? blogArchiveWidget(mods.blogArchiveWidgetTitle || 'Arquivo') : '',
        '[[TRANSLATE_WIDGET]]': mods.translateWidget ? translateWidget() : '',
        '[[FEATURED_POST_WIDGET]]': mods.featuredPostWidget ? featuredPostWidget(mods.featuredPostWidgetTitle || 'Destaque') : '',
        '[[LABEL_CLOUD_WIDGET]]': mods.labelCloudWidget ? labelCloudWidget(mods.labelCloudWidgetTitle || 'Marcadores') : '',
        '[[SOCIAL_LINKS_WIDGET]]': mods.socialLinksWidget ? socialLinksWidget(mods.socialLinksWidgetTitle || 'Redes Sociais') : '',
    };
}
