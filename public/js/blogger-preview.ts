// @ts-nocheck — script de navegador clássico; paridade exata conferida pelo contrato.
'use strict';
/*
 * Prévia ilustrativa Blogger no navegador do visitante.
 * Não executa XML/b:widget, não chama servidor, não consome quota nem baixa
 * dependências. O iframe sandbox sem scripts isola HTML/CSS do editor.
 */
(function(root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SoftloadBloggerPreview = api;
})(typeof window !== 'undefined' ? window : null, function() {
  const DEVICES = Object.freeze({desktop:1080,tablet:768,mobile:390});
  const FONT_STACK = Object.freeze({
    inter:'system-ui,Arial,sans-serif',
    'space-grotesk':'Trebuchet MS,Arial,sans-serif',
    playfair:'Georgia,Times New Roman,serif',
    'roboto-slab':'Georgia,Times New Roman,serif',
    oswald:'Impact,Arial Narrow,sans-serif',
    'pt-sans':'Arial,Helvetica,sans-serif'
  });
  const NICHE_COPY = Object.freeze({
    'noticias-mag-news':['Últimas notícias','O essencial do dia','Informação clara para acompanhar o que importa'],
    'viral-magazine':['Em destaque','Histórias para descobrir','Uma seleção de ideias, novidades e tendências'],
    'tecnologia-mag-tech':['Tecnologia','O futuro em pauta','Produtos, análises e novidades digitais'],
    'tecnologia-techwind':['Código e ideias','Tecnologia sem complicação','Tutoriais, dicas e experiências para compartilhar'],
    'gamer-playerone':['Universo gamer','Seu próximo jogo favorito','Análises, novidades e grandes lançamentos'],
    'pop-retro-pixel':['Nostalgia digital','De volta aos clássicos','Jogos, cultura pop e boas lembranças'],
    'culinaria-boutique-gourmet':['Na cozinha','Receitas para inspirar','Sabores, histórias e momentos à mesa'],
    'natureza-bulma-vegan':['Vida natural','Ideias para viver melhor','Natureza, bem-estar e escolhas conscientes'],
    'saas-nexus':['Produto digital','Uma solução feita para você','Ferramentas e recursos para crescer'],
    'brutalista-appcraft':['Criatividade sem limites','Seu próximo projeto começa aqui','Projetos digitais com identidade própria'],
    'portfolio-minimalista':['Trabalhos selecionados','Projetos com identidade','Design, desenvolvimento e novas ideias'],
    aquarela:['Ateliê criativo','Uma coleção de ideias','Arte, inspiração e trabalhos especiais'],
    'biolink-social':['Bem-vindo','Tudo em um só lugar','Encontre meus projetos e redes'],
    'elearning-academy':['Aprendizado','Aprenda no seu ritmo','Conteúdo organizado para ir mais longe'],
    'appstore-bulma-mobile':['Aplicativos','Explore novas ferramentas','Uma seleção de apps e soluções']
  });
  const hex = (value, fallback) => /^#[\da-fA-F]{6}$/.test(String(value || '')) ? String(value) : fallback;
  const escape = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const allowedLayouts = new Set(['lista','dupla','revista','quadrado','mural','coluna-unica','zigzag']);
  const allowedSides = new Set(['left','right','none']);
  const allowedTypes = new Set(['blogger-conteudo','portal-noticias','magazine','landing-page','biolink','documentacao','catalogo-produtos']);

  function normalize(input) {
    const x=input||{};
    return {
      name:String(x.siteName||'Meu Blog').slice(0,60),
      niche:String(x.niche||'').slice(0,60),
      pageType:allowedTypes.has(x.pageType)?x.pageType:'blogger-conteudo',
      accent:hex(x.accent,'#0ea5e9'),
      bg:hex(x.bg,'#f8fafc'),
      surface:hex(x.surface,'#ffffff'),
      text:hex(x.text,'#1e293b'),
      footer:hex(x.footer,'#0f172a'),
      font:FONT_STACK[x.typography]||FONT_STACK.inter,
      layout:allowedLayouts.has(x.layout)?x.layout:'revista',
      side:allowedSides.has(x.side)?x.side:'right'
    };
  }

  function card(label, index) {
    return '<article class="post-card"><div class="post-image img-'+((index%5)+1)+'"><span class="image-symbol" aria-hidden="true"></span></div>'+
      '<div class="post-meta">CATEGORIA · '+String(index+1).padStart(2,'0')+'</div>'+
      '<h3>'+escape(label)+'</h3><p>Uma breve apresentação do conteúdo deste espaço.</p><small>Continue lendo →</small></article>';
  }
  const titles=['Uma nova maneira de ver o mundo','Ideias que merecem destaque','Dicas para o seu dia a dia','Conheça os principais assuntos','Histórias para compartilhar','O que há de novo por aqui'];
  function cards(count) {return Array.from({length:count},(_,i)=>card(titles[i%titles.length],i)).join('');}
  function feed(x, copy) {
    const news=x.pageType==='portal-noticias'||x.pageType==='magazine';
    const head=news?'<div class="breaking"><strong>EM DESTAQUE</strong> &nbsp; Notícias e novidades para acompanhar hoje</div>':'';
    const hero='<section class="hero '+(news?'news-hero':'')+'"><span class="eyebrow">'+escape(copy[0])+'</span>'+
      '<h2>'+escape(copy[1])+'</h2><p>'+escape(copy[2])+'</p><span class="action">Descubra mais →</span></section>';
    const aside=x.side==='none'?'':'<aside class="aside"><div class="aside-title">Sobre este blog</div><div class="aside-avatar"></div><p>Conteúdo criado para quem gosta de boas ideias.</p><div class="aside-title">Categorias</div><ul><li>Novidades</li><li>Destaques</li><li>Mais lidos</li></ul></aside>';
    return head+hero+'<div class="body-grid side-'+x.side+'"><section class="feed"><div class="section-title">Postagens recentes <span>Ver todas →</span></div><div class="post-grid layout-'+x.layout+'">'+cards(6)+'</div></section>'+aside+'</div>';
  }
  function portfolio(x,copy) {
    return '<section class="hero portfolio-hero"><span class="eyebrow">'+escape(copy[0])+'</span><h2>'+escape(copy[1])+'</h2><p>'+escape(copy[2])+'</p><span class="action">Conheça meu trabalho →</span></section>'+
      '<section class="portfolio-content"><div class="section-title">Portfólio em destaque <span>Todos os projetos →</span></div>'+
      '<div class="portfolio-grid"><div class="portfolio-tile p-one"><span>Identidade visual</span></div><div class="portfolio-tile p-two"><span>Experiência digital</span></div><div class="portfolio-tile p-three"><span>Projeto criativo</span></div><div class="portfolio-tile p-four"><span>Design editorial</span></div></div></section>';
  }
  function landing(x,copy) {
    return '<section class="hero landing-hero"><div><span class="eyebrow">'+escape(copy[0])+'</span><h2>'+escape(copy[1])+'</h2><p>'+escape(copy[2])+'</p><span class="action filled">Começar agora →</span><span class="action ghost">Conhecer mais</span></div><div class="landing-visual"><span class="visual-top"></span><div class="visual-chart"></div><div class="visual-bars"><i></i><i></i><i></i></div></div></section>'+
      '<section class="feature-section"><div class="section-title">Por que escolher esta solução?</div><div class="feature-grid">'+
      '<div class="feature"><b>✦</b><h3>Simples de usar</h3><p>Uma experiência feita para facilitar.</p></div>'+
      '<div class="feature"><b>◈</b><h3>Visual moderno</h3><p>Organização e clareza em cada detalhe.</p></div>'+
      '<div class="feature"><b>◎</b><h3>Sempre acessível</h3><p>Conteúdo adaptável a cada tela.</p></div></div></section>';
  }
  function bio(x,copy) {
    return '<div class="bio"><div class="bio-avatar">✦</div><h2>'+escape(x.name)+'</h2><p>'+escape(copy[2])+'</p>'+
      '<div class="bio-link">Meu site <span>↗</span></div><div class="bio-link">Meus projetos <span>↗</span></div>'+
      '<div class="bio-link">Instagram <span>↗</span></div><div class="bio-link">Contato <span>↗</span></div>'+
      '<div class="bio-icons">◉ &nbsp; ◎ &nbsp; ◈ &nbsp; ✦</div></div>';
  }
  function docs(x,copy) {
    return '<section class="hero"><span class="eyebrow">Educação e cursos</span><h2>'+escape(copy[1])+'</h2><p>'+escape(copy[2])+'</p></section>'+
      '<div class="learning-grid"><nav class="learning-nav"><strong>Conteúdo</strong><p>Introdução</p><p>Primeiros passos</p><p>Material de apoio</p><p>Próximas aulas</p></nav><div class="lesson"><div class="lesson-media">▶</div><span class="eyebrow">MÓDULO 01</span><h3>Bem-vindo ao curso</h3><p>Uma introdução organizada e fácil de acompanhar.</p><div class="lesson-progress"><i></i></div></div></div>';
  }
  function apps(x,copy) {
    const names=['Organização','Criatividade','Finanças','Produtividade','Comunicação','Estudos'];
    const items=names.map((name,i)=>'<article class="app-item"><div class="app-icon app-icon-'+i+'">'+escape(name.charAt(0))+'</div><h3>'+escape(name)+'</h3><small>★★★★★</small><p>Uma ferramenta para você explorar.</p><span>Ver detalhes →</span></article>').join('');
    return '<section class="hero"><span class="eyebrow">Catálogo digital</span><h2>'+escape(copy[1])+'</h2><p>'+escape(copy[2])+'</p></section><div class="section-title">Explore o catálogo</div><div class="apps-grid">'+items+'</div>';
  }
  function stylesheet(x) {
    return [
      ':root{--accent:'+x.accent+';--bg:'+x.bg+';--surface:'+x.surface+';--ink:'+x.text+';--footer:'+x.footer+';font-family:'+x.font+';}',
      '*{box-sizing:border-box}html,body{margin:0;min-height:100%;}body{color:var(--ink);background:var(--bg);font-size:15px;line-height:1.6}h1,h2,h3,p{margin-top:0}',
      'header{background:var(--surface);border-bottom:1px solid color-mix(in srgb,var(--ink) 12%,transparent)}.header-inner{max-width:1060px;margin:auto;padding:23px 27px;display:flex;align-items:center;justify-content:space-between;gap:18px}',
      '.brand{font-size:25px;font-weight:850;letter-spacing:-.04em;color:var(--ink);overflow-wrap:anywhere}.brand-dot{color:var(--accent)}.nav{display:flex;gap:25px;color:var(--ink);font-size:12px;font-weight:650}.nav span{opacity:.72}',
      '.canvas{max-width:1060px;margin:auto;padding:0 27px 65px}.hero{border-radius:19px;padding:55px 48px;margin:28px 0 32px;min-height:230px;background:linear-gradient(130deg,color-mix(in srgb,var(--accent) 15%,var(--surface)),var(--surface) 67%);border:1px solid color-mix(in srgb,var(--ink) 9%,transparent)}',
      '.eyebrow{display:block;font-size:12px;color:var(--accent);font-weight:850;text-transform:uppercase;letter-spacing:.16em;margin-bottom:13px}.hero h2{font-size:clamp(29px,4.1vw,52px);letter-spacing:-.035em;line-height:1.13;max-width:700px;margin:0 0 14px}.hero p{max-width:560px;opacity:.75;font-size:17px;margin-bottom:19px}',
      '.action{display:inline-block;font-weight:800;color:var(--accent);font-size:13px;margin-right:16px}.action.filled{background:var(--accent);color:#fff;border-radius:8px;padding:12px 19px}.action.ghost{opacity:.75}',
      '.breaking{background:var(--footer);color:#fff;margin:0 -27px;padding:11px 27px;font-size:12px}.breaking strong{background:var(--accent);padding:6px 9px;margin-right:6px}',
      '.section-title{font-size:19px;font-weight:850;margin-bottom:20px;display:flex;justify-content:space-between;gap:12px;align-items:center}.section-title span{font-size:11px;color:var(--accent)}',
      '.body-grid{display:grid;grid-template-columns:minmax(0,1fr) 242px;gap:25px}.body-grid.side-none{grid-template-columns:1fr}.body-grid.side-left{grid-template-columns:242px minmax(0,1fr)}.body-grid.side-left aside{order:-1}',
      '.post-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.post-grid.layout-dupla{grid-template-columns:repeat(2,minmax(0,1fr))}.post-grid.layout-lista,.post-grid.layout-coluna-unica{grid-template-columns:1fr}.post-grid.layout-mural,.post-grid.layout-quadrado{grid-template-columns:repeat(4,minmax(0,1fr))}.post-grid.layout-zigzag{grid-template-columns:repeat(2,minmax(0,1fr))}.post-grid.layout-zigzag .post-card:nth-child(even){margin-top:24px}',
      '.post-card{overflow:hidden;background:var(--surface);border-radius:11px;min-width:0;border:1px solid color-mix(in srgb,var(--ink) 11%,transparent)}.post-image{height:119px;background:linear-gradient(135deg,var(--accent),color-mix(in srgb,var(--accent) 17%,var(--surface)));display:flex;align-items:center;justify-content:center}.image-symbol{width:70px;height:40px;border:2px solid color-mix(in srgb,var(--surface) 80%,transparent);border-radius:6px;transform:rotate(-8deg)}.img-2{filter:hue-rotate(32deg)}.img-3{filter:hue-rotate(-27deg)}.img-4{filter:saturate(.65)}.img-5{filter:hue-rotate(75deg)}',
      '.post-meta{font-size:9px;letter-spacing:.06em;color:var(--accent);font-weight:800;padding:14px 12px 4px}.post-card h3{font-size:15px;line-height:1.3;padding:0 12px;margin:0 0 6px}.post-card p{font-size:11px;padding:0 12px;margin:0 0 10px;opacity:.67}.post-card small{display:block;color:var(--accent);font-size:10px;font-weight:700;padding:0 12px 14px}',
      '.aside{padding:21px;background:var(--surface);border:1px solid color-mix(in srgb,var(--ink) 10%,transparent);border-radius:12px;font-size:12px}.aside-title{font-weight:850;font-size:14px;margin:5px 0 12px}.aside-avatar{height:85px;background:linear-gradient(135deg,var(--accent),transparent);border-radius:9px;margin-bottom:12px}.aside p{opacity:.7}.aside ul{padding-left:18px;line-height:2.4}',
      '.portfolio-hero{min-height:230px}.portfolio-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}.portfolio-tile{height:225px;border-radius:15px;display:flex;align-items:flex-end;padding:19px;color:#fff;font-weight:750;letter-spacing:-.02em;background:linear-gradient(135deg,var(--accent),var(--footer))}.p-two{filter:hue-rotate(45deg)}.p-three{filter:hue-rotate(-45deg)}.p-four{filter:grayscale(.35)}',
      '.landing-hero{display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:center;min-height:360px}.landing-visual{height:210px;border-radius:16px;border:1px solid color-mix(in srgb,var(--ink) 13%,transparent);background:var(--surface);padding:19px;box-shadow:0 18px 32px #0001}.visual-top{display:block;width:40%;height:12px;background:var(--accent);opacity:.5;border-radius:6px}.visual-chart{height:93px;margin-top:17px;background:linear-gradient(165deg,color-mix(in srgb,var(--accent) 45%,transparent),transparent);clip-path:polygon(0 85%,20% 57%,40% 75%,62% 24%,84% 41%,100% 9%,100% 100%,0 100%)}.visual-bars{display:flex;gap:7px;margin-top:14px}.visual-bars i{width:30%;height:9px;border-radius:10px;background:var(--accent);opacity:.2}.feature-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.feature{background:var(--surface);border-radius:13px;padding:25px;border:1px solid color-mix(in srgb,var(--ink) 11%,transparent)}.feature b{font-size:27px;color:var(--accent)}.feature h3{font-size:16px;margin:8px 0}.feature p{font-size:12px;opacity:.75}',
      '.bio{max-width:460px;margin:50px auto 80px;padding:20px;text-align:center}.bio-avatar{width:96px;height:96px;background:var(--accent);border-radius:50%;margin:0 auto 18px;display:grid;place-items:center;color:#fff;font-size:40px}.bio h2{font-size:28px;margin:0 0 5px}.bio p{font-size:14px;opacity:.75;margin-bottom:26px}.bio-link{display:flex;justify-content:space-between;background:var(--surface);border:1px solid var(--accent);margin:12px 0;border-radius:11px;padding:14px 20px;font-weight:750}.bio-icons{color:var(--accent);font-size:22px;margin-top:30px}',
      '.learning-grid{display:grid;grid-template-columns:230px 1fr;gap:20px}.learning-nav,.lesson{background:var(--surface);border-radius:13px;padding:22px;border:1px solid color-mix(in srgb,var(--ink) 10%,transparent)}.learning-nav p{margin:13px 0;font-size:12px;opacity:.72}.lesson-media{height:185px;background:linear-gradient(145deg,var(--accent),var(--footer));border-radius:12px;color:#fff;font-size:43px;display:grid;place-items:center;margin-bottom:21px}.lesson h3{font-size:24px}.lesson-progress{height:6px;background:var(--bg);border-radius:8px}.lesson-progress i{display:block;width:35%;height:6px;background:var(--accent);border-radius:8px}',
      '.apps-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:15px}.app-item{background:var(--surface);padding:24px;border-radius:15px;border:1px solid color-mix(in srgb,var(--ink) 10%,transparent)}.app-icon{height:60px;width:60px;border-radius:15px;display:grid;place-items:center;background:var(--accent);color:#fff;font-size:27px;font-weight:850}.app-icon-1{filter:hue-rotate(35deg)}.app-icon-2{filter:hue-rotate(-35deg)}.app-icon-3{filter:hue-rotate(75deg)}.app-item h3{font-size:17px;margin:15px 0 1px}.app-item small{color:var(--accent)}.app-item p{font-size:12px;opacity:.7}.app-item span{font-size:12px;color:var(--accent);font-weight:800}',
      'footer{background:var(--footer);color:#fff;text-align:center;padding:27px;font-size:12px;opacity:.94;margin-top:28px}',
      '@media(max-width:820px){.header-inner{padding:18px}.canvas{padding:0 18px 40px}.nav{gap:12px}.hero{padding:36px 28px}.body-grid,.body-grid.side-left{grid-template-columns:1fr}.body-grid aside{display:none}.post-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.breaking{margin:0 -18px}.portfolio-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.landing-hero{grid-template-columns:1fr}.learning-grid{grid-template-columns:1fr}.learning-nav{display:none}}',
      '@media(max-width:520px){.header-inner{padding:15px}.brand{font-size:20px}.nav{display:none}.canvas{padding:0 14px 28px}.hero{padding:27px 20px;margin:15px 0 23px;min-height:175px;border-radius:13px}.hero h2{font-size:28px}.hero p{font-size:13px}.section-title{font-size:17px}.post-grid,.post-grid.layout-dupla,.post-grid.layout-mural,.post-grid.layout-quadrado,.post-grid.layout-zigzag{grid-template-columns:1fr 1fr;gap:9px}.post-grid.layout-lista,.post-grid.layout-coluna-unica{grid-template-columns:1fr}.post-image{height:100px}.post-card h3{font-size:12px}.post-card p{display:none}.post-meta{font-size:8px}.post-card small{font-size:9px}.portfolio-grid{grid-template-columns:1fr}.portfolio-tile{height:150px}.feature-grid,.apps-grid{grid-template-columns:1fr 1fr}.feature,.app-item{padding:14px}.landing-hero{gap:15px}.landing-visual{height:150px}.bio{margin:16px auto}.breaking{margin:0 -14px}.lesson-media{height:140px}}'
    ].join('\n');
  }
  function renderMarkup(config) {
    const x=normalize(config);
    const copy=NICHE_COPY[x.niche] || ['Seu espaço na internet','Bem-vindo ao seu blog','Conteúdo criado com sua identidade'];
    const isPortfolio=x.niche==='portfolio-minimalista'||x.niche==='aquarela';
    const content=x.pageType==='biolink' ? bio(x,copy) :
      x.pageType==='documentacao' ? docs(x,copy) :
      x.pageType==='catalogo-produtos' ? apps(x,copy) :
      isPortfolio ? portfolio(x,copy) :
      x.pageType==='landing-page' ? landing(x,copy) : feed(x,copy);
    return '<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+
      stylesheet(x)+'</style></head><body>'+
      '<header><div class="header-inner"><div class="brand">'+escape(x.name)+'<span class="brand-dot">.</span></div>'+
      '<nav class="nav" aria-label="Menu ilustrativo"><span>Início</span><span>Sobre</span><span>Novidades</span><span>Contato</span></nav></div></header>'+
      '<main class="canvas">'+content+'</main><footer>© '+escape(x.name)+' · Prévia ilustrativa do Blogger</footer></body></html>';
  }

  function mount(iframe, stage) {
    if (!iframe || !stage) return null;
    let device='desktop',last='';
    const height=760;
    function fit() {
      const width=DEVICES[device];
      const available=Math.max(260,stage.clientWidth||width);
      const scale=Math.min(1,available/width);
      iframe.style.width=width+'px';
      iframe.style.height=height+'px';
      iframe.style.transform='translateX(-50%) scale('+scale+')';
      stage.style.height=Math.ceil(height*scale)+'px';
      stage.dataset.device=device;
      stage.dataset.width=String(width);
    }
    function setDevice(next) {
      if (!Object.hasOwn(DEVICES,next)) return;
      device=next;fit();
    }
    function render(settings) {
      const html=renderMarkup(settings);
      if (html!==last) { iframe.srcdoc=html;last=html; }
      fit();
    }
    if(typeof ResizeObserver !== 'undefined') {
      const obs=new ResizeObserver(fit);
      obs.observe(stage);
    } else if(typeof window!=='undefined' && window.addEventListener) {
      window.addEventListener('resize',fit);
    }
    fit();
    return {render,setDevice,getDevice:()=>device};
  }
  return {renderMarkup,normalize,mount,DEVICES};
});
