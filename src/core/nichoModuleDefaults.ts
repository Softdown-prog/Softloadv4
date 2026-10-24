/** Módulos ativados por padrão em cada nicho, sem alterar os defaults legados. */
export type NichoModuleConfig = Record<string, boolean | string>;

// ──────────────────────────────────────────────────────────────────────────
// Defaults de módulos de acabamento por nicho (dark mode, reading time,
// cookie banner, dropcap, etc. — ver src/core/modules.js pros módulos em si).
//
// Fonte única de verdade — antes só o fluxo de chat/IA aplicava esses
// defaults (tabela local em chatTemplateCompiler.js). O fluxo determinístico
// do Workspace (compilerWorker.js) nunca ligava nenhum módulo, porque o
// Workspace não envia body.modules — resultado: todo template gerado pelo
// botão rápido saía sem dark mode, sem reading time, sem nada, independente
// do nicho escolhido, mesmo quando o RAG já documentava essas features como
// parte da identidade do nicho.
//
// gridLayout segue a mesma lógica, mas é campo de nível superior do
// manifesto (não um module) — por isso é lido separadamente em
// compilerWorker.js (não passa por modulosAtivos/comDefault). Valores
// espelham 1:1 a tabela "gridLayout ideal" de chatSystemPrompt.js (fonte
// única, já usada pelo fluxo de chat/IA); nichos com pageType
// blogger-conteudo (gridLayout "qualquer, user choice") ou landing-page/
// biolink (gridLayout "irrelevante — ignorado pelo compilador") ficam
// deliberadamente SEM entrada aqui — a tabela não recomenda um valor
// único pra eles, então caem no fallback genérico 'revista' em
// compilerWorker.js, igual seria antes desta mudança.
//
// "Mobília" nativa do Blogger (statsWidget/blogArchiveWidget/
// translateWidget/featuredPostWidget/labelCloudWidget/socialLinksWidget —
// ver src/core/modules.js) — achado da investigação de qualidade dos
// templates: comparado a referências hand-built (Bulma Vegan, Tech Wind),
// a Engine deixava toda seção de sidebar/rodapé do chassis vazia (o dono
// do site abria o painel de Layout do Blogger e via 8-11 caixas "Adicionar
// um Gadget", sem nada dentro). Os 6 módulos novos só têm placeholder
// wired nos chassis 'blog'/'magazine' (sidebar completa) e
// 'saas'/'portfolio' (só rodapé — sem sidebar de lista/post real nesses
// dois). 'biolink' não tem nenhum — chassis de 1 seção só (hero-area),
// mesmo motivo já documentado abaixo pro resto dos módulos genéricos.
// error404 sobe pra default-ON em todo nicho não-biolink (chassis
// biolink não tem o placeholder [[ERROR_404_MODULE]] — ligar seria
// inerte) — módulo genérico, sem custo de manutenção, mesma lógica do
// fallback global que já resolveu o gridLayout.
// ──────────────────────────────────────────────────────────────────────────

export const NICHO_MODULE_DEFAULTS: Record<string, NichoModuleConfig> = {
    // reviewEngine: true — motor de análises [review titulo="..." nota="9.5"
    // grafico="9" som="10" gameplay="9"], feature de destaque documentada no
    // template de referência (PlayerOne V2.1). contactForm com título
    // customizado — "Suporte a Jogadores" documentado no mesmo template
    // (formulário nativo do Blogger, sem Formspree — ver modules.js).
    // error404Theme: 'gamer' — página "Game Over" temática (ERROR_404_GAMER
    // em modules.js), batendo com a CSS pagina_404_game_over já documentada
    // pro nicho.
    'gamer-playerone':           { menuType: 'offcanvas', toc: true,  readingProgress: true, shareButtons: true, error404: true, error404Theme: 'gamer', reviewEngine: true, contactForm: true, contactFormTitle: 'Suporte a Jogadores', statsWidget: true, blogArchiveWidget: true, translateWidget: true, featuredPostWidget: true, labelCloudWidget: true, socialLinksWidget: true },
    // Esqueleto próprio (Fase 2, 10/11 — ver plano "esqueleto por nicho"):
    // contactForm=true NOVO (ContactForm1 real → token CONTACT_FORM na
    // sidebar). menuType='offcanvas' é flag não-usada (arquivo real não
    // tem menu de navegação nenhum, mesmo trade-off aceito noutros
    // nichos). statsWidget/translateWidget cobertos por Stats1/Translate1
    // nativos embutidos à mão, não pelo token — flags documentadas como
    // não-usadas aqui (mesmo padrão de gamer-playerone).
    'pop-retro-pixel':           { menuType: 'offcanvas', toc: true,  readingProgress: true, shareButtons: true, error404: true, contactForm: true, statsWidget: true, blogArchiveWidget: true, translateWidget: true, featuredPostWidget: true, labelCloudWidget: true, socialLinksWidget: true },
    // dropcap: true — os 4 nichos de imprensa/portal ("editorial de luxo",
    // ver tema documentado do MAG News) ganham letra capitular por padrão.
    // sliderJson: true — "Slider Premium" documentado no MAG News (widget-slider-editorial).
    // gridLayout: 'mural' — portal-noticias prefere mural ("muitos posts
    // visíveis") ou revista, segundo chatSystemPrompt.js; mural escolhido
    // como o 1º recomendado pra esses 3 nichos de portal.
    // Reauditado na migração pro esqueleto próprio (template_noticias-mag-news.xml,
    // ver plano "esqueleto por nicho"): main/post do Blog1 extraído
    // verbatim de exemplos/noticias-mag-news.xml — o arquivo real já tem
    // sua PRÓPRIA view de 404 (dentro do main includable, data:view.isError),
    // tempo de leitura (#read-time-calc) e compartilhar (twitter/whatsapp)
    // inline, então error404/readingTime/shareButtons REMOVIDOS (duplicariam
    // o que já vem embutido no main/post real). sliderJson removido — sem
    // token [[SLIDER_JSON]] no esqueleto novo (hero real já é um widget
    // nativo via hero-mosaico-noticias). backToTop mantido, mas a peça
    // modulo-botao-voltar-ao-topo foi retargetada pro id real do módulo
    // genérico (#sl-back-top). statsWidget/translateWidget/labelCloudWidget
    // removidos — sem seção real correspondente (sidebar real tem slider+
    // newsletter+cookie+FeaturedPost1, footer real tem social+arquivo+
    // contactForm). cookieBanner:true adicionado (arquivo real tem banner
    // de cookie custom, não extraído nesta migração — módulo genérico cobre
    // o consentimento). contactForm:true adicionado (ContactForm1 nativo
    // real em footer-3).
    'noticias-mag-news':         { menuType: 'classico',  backToTop: true, dropcap: true, gridLayout: 'mural', cookieBanner: true, blogArchiveWidget: true, featuredPostWidget: true, socialLinksWidget: true, popularPostsRanking: true, popularPostsRankingTitle: 'Mais Lidas', contactForm: true },
    // gridLayout: 'revista' — magazine prefere revista ou mural (tabela);
    // já é o valor global-default, mas explícito aqui pra não depender
    // do fallback caso o default genérico mude no futuro.
    // Reauditado na migração pro esqueleto próprio (template_viral-magazine.xml,
    // ver plano "esqueleto por nicho"): a sidebar/rodapé REAIS de
    // exemplos/viral-magazine.xml só têm Translate1+Stats1+PopularPosts1
    // (sidebar-right) e Label1+FeaturedPost1+ContactForm1 (footer-1/2/3) —
    // sem Archive nem Social Links em lugar nenhum (blogArchiveWidget/
    // socialLinksWidget removidos, popularPostsRankingTitle bate com o
    // título real do widget, "Mais Lidos"). darkMode:true — o arquivo real
    // já tem toggle + FOUC-prevention + overrides [data-bs-theme="dark"]
    // dedicados (peça 'dark-mode-fouc-e-overrides' do dossiê); só faltava
    // ligar o módulo genérico que dá o botão de fato.
    'viral-magazine':            { menuType: 'classico',  readingTime: true, shareButtons: true, backToTop: true, dropcap: true, darkMode: true, gridLayout: 'revista', error404: true, statsWidget: true, translateWidget: true, featuredPostWidget: true, labelCloudWidget: true, contactForm: true, popularPostsRanking: true, popularPostsRankingTitle: 'Mais Lidos' },
    'tecnologia-mag-tech':       { menuType: 'classico',  readingTime: true, shareButtons: true, toc: true,       dropcap: true, gridLayout: 'mural', error404: true, statsWidget: true, blogArchiveWidget: true, translateWidget: true, featuredPostWidget: true, labelCloudWidget: true, socialLinksWidget: true },
    // Reauditado na migração "esqueleto por nicho" (Fase 2, 2/11) — ver
    // template_tecnologia-techwind.xml. readingTime/shareButtons/toc/
    // error404/error404Theme removidos: 404 agora embutido no b:includable
    // 'main' real (data:view.isError); share buttons e tempo de leitura já
    // vêm das próprias peças do dossiê (não dos módulos genéricos SHARE_
    // BUTTONS/READING_TIME, não injetados em lugar nenhum deste esqueleto);
    // toc nunca teve seção real correspondente ([[TOC_MODULE]] também não
    // é injetado aqui). contactForm/popularPostsRanking adicionados
    // (existiam no arquivo real — ContactForm1/PopularPosts1 em
    // 'footer-contact' — sem flag correspondente). cookieBanner
    // adicionado (arquivo real não tinha consentimento de cookies; módulo
    // genérico cobre). menuType: 'classico' — navbar-collapse real, não
    // offcanvas (nunca existiu no arquivo real).
    'tecnologia-techwind':       { menuType: 'classico', dropcap: true, gridLayout: 'mural', statsWidget: true, blogArchiveWidget: true, translateWidget: true, featuredPostWidget: true, labelCloudWidget: true, socialLinksWidget: true, contactForm: true, popularPostsRanking: true, cookieBanner: true },
    // gridLayout: 'lista' — documentacao: "posts como módulos de curso em
    // sequência" (chatSystemPrompt.js), sem ambiguidade na tabela.
    // Migração pro esqueleto próprio (template_elearning-academy.xml):
    // toc/readingProgress ficaram órfãos — o arquivo real já tem TOC
    // autoral (auto-toc/.toc-box, JS próprio) e barra de progresso
    // (#read-progress) construídas junto com o usuário (refinamento via
    // Códigos.txt), tokens genéricos correspondentes nunca entram no
    // esqueleto. blogArchiveWidget/translateWidget/labelCloudWidget/
    // socialLinksWidget também ficaram órfãos — a única sidebar real é
    // uma seção única (sem sub-divisão sidebar-top/sidebar/sidebar-bottom
    // do chassis genérico) e já recebe [[STATS_WIDGET]][[FEATURED_POST_WIDGET]];
    // Label2 nativo (footer-col-2) já cobre navegação por categoria e o
    // rodapé já tem links sociais reais estáticos — evita empilhar 6
    // widgets genéricos numa sidebar só (mesmo trade-off "flag não-usada
    // documentada" aceito em natureza-bulma-vegan). readingTime — token
    // novo, ativado inline no meta do post (sem equivalente real antes).
    // error404 — token novo, arquivo real não tinha tratamento de 404.
    // cookieBanner — adicionado nesta migração: arquivo real não tinha
    // nenhum aviso de cookies (LGPD).
    'elearning-academy':         { menuType: 'classico', readingTime: true, gridLayout: 'lista', error404: true, statsWidget: true, blogArchiveWidget: true, translateWidget: true, featuredPostWidget: true, labelCloudWidget: true, socialLinksWidget: true, toc: true, readingProgress: true, cookieBanner: true },
    // contactForm adicionado nesta migração (esqueleto próprio): footer-contact
    // real tem ContactForm1 nativo, mapeado pro token genérico — sem o flag
    // o token resolvia pra string vazia e a seção saía auto-fechada.
    'culinaria-boutique-gourmet':{ menuType: 'classico',  shareButtons: true, readingTime: true, error404: true, statsWidget: true, blogArchiveWidget: true, translateWidget: true, featuredPostWidget: true, labelCloudWidget: true, socialLinksWidget: true, contactForm: true },
    // sliderJson + relatedPosts — widget-slider-carousel e
    // widget-relacionados-json-feed documentados (ambos via Blogger JSON Feed).
    // menuDropdownPrefixo: true — widget-menu-dropdown-prefixo (páginas com
    // título prefixado "_" viram submenu da anterior, ver
    // MENU_DROPDOWN_PREFIXO em modules.js — descrito no doc de referência
    // como "mesmo padrão do Bulma Vegan/NAT").
    // error404Theme: 'natureza' — 404 com form de busca nativo (/search)
    // ajudando o visitante a se recuperar (ver ERROR_404_NATUREZA em
    // modules.js), extraída da referência real do nicho (auditoria
    // paginação/404/busca).
    // readingTime/contactForm: novos, ligados na migração pro esqueleto
    // próprio (template_natureza-bulma-vegan.xml) — [[READING_TIME]] e
    // [[CONTACT_FORM]] genéricos substituindo widgets reais equivalentes
    // (badge de tempo de leitura customizado; ContactForm1 real). Os
    // demais flags de mobília (sliderJson/relatedPosts/statsWidget/
    // blogArchiveWidget/translateWidget/featuredPostWidget/
    // labelCloudWidget/socialLinksWidget) ficaram órfãos nessa mesma
    // migração: o esqueleto próprio embute os widgets NATIVOS REAIS
    // verbatim (hero slider Bootstrap, Stats1, Translate1, FeaturedPost1,
    // Label1, BlogArchive1) em vez dos tokens genéricos correspondentes —
    // mesmo trade-off "flag não-usada documentada" já aceito noutras
    // migrações (ver template_gamer-playerone.xml/reviewEngine).
    'natureza-bulma-vegan':      { menuType: 'classico',  shareButtons: true, readingTime: true, contactForm: true, sliderJson: true, relatedPosts: true, menuDropdownPrefixo: true, error404: true, error404Theme: 'natureza', statsWidget: true, blogArchiveWidget: true, translateWidget: true, featuredPostWidget: true, labelCloudWidget: true, socialLinksWidget: true },
    // socialLinksWidget/blogArchiveWidget/contactForm/featuredPostWidget —
    // únicos 4 placeholders que template_saas.xml de fato tem (footer-brand/
    // footer-1/footer-2/post-sidebar) — chassis landing-page não tem sidebar
    // de lista real, então statsWidget/translateWidget/labelCloudWidget
    // ficam de fora aqui (sem seção pra entrar).
    // Reauditado na migração "esqueleto por nicho" (Fase 2, 4/11) — ver
    // template_saas-nexus.xml. statsWidget adicionado: 'pre-footer' real
    // tinha Stats1 nativo (Total de visualizações de página), sem flag
    // correspondente. menuType: 'offcanvas' mantido de propósito — não
    // usado neste esqueleto (navbar-collapse real, não offcanvas), sem
    // efeito, mesmo trade-off documentado em outras migrações.
    'saas-nexus':                { menuType: 'offcanvas', cookieBanner: true, error404: true, backToTop: true, socialLinksWidget: true, blogArchiveWidget: true, contactForm: true, featuredPostWidget: true, statsWidget: true },
    // menuType: 'offcanvas' mantido de propósito — não usado neste
    // esqueleto (navbar-collapse real, não offcanvas), mesmo trade-off
    // documentado em saas-nexus acima. statsWidget/labelCloudWidget
    // adicionados (achado da migração pro esqueleto próprio): footer-info
    // real usa Stats1+Label1+FeaturedPost1 juntos; sem os 2 primeiros
    // flags os tokens resolviam pra string vazia (modules.js), a seção só
    // não ficava auto-fechada por causa do FeaturedPost1 sozinho.
    // translateWidget: sidebar-right real usa Translate1 (não coberto por
    // SECOES_MOBILIA_ESPERADAS, sem flag ficaria com a caixa da sidebar
    // vazia no painel de Layout do Blogger).
    'brutalista-appcraft':       { menuType: 'offcanvas', cookieBanner: true, error404: true, socialLinksWidget: true, blogArchiveWidget: true, contactForm: true, featuredPostWidget: true, statsWidget: true, labelCloudWidget: true, translateWidget: true },
    // darkMode: true — "Dark mode completo via Bootstrap data-bs-theme" é a
    // identidade central documentada do nicho (tema-portfolio-minimalista-meta.json);
    // o chassis (template_portfolio.xml) já embute o script anti-FOUC e todo
    // o CSS responsivo a data-bs-theme, só faltava o flag ligando o botão.
    // socialLinksWidget/contactForm — únicos 2 placeholders que
    // template_portfolio.xml tem (footer-contact/footer-extra).
    'portfolio-minimalista':     { menuType: 'classico',  shareButtons: true, error404: true, darkMode: true, socialLinksWidget: true, contactForm: true },
    // Mesmo chassis 'portfolio' de portfolio-minimalista — mesmos 2
    // placeholders de mobília disponíveis.
    'aquarela':                  { error404: true, socialLinksWidget: true, contactForm: true },
    // sliderJson: true — widget-slider-carousel documentado (últimos apps em destaque).
    // popularPostsRanking + appDownloadCta — widget-ranking-apps (PopularPosts
    // nativo, numerado, ver popular_posts_ranking) e widget-app-post-snippets
    // (botão "Baixar" nos cards da home, ver app_list_card) documentados no
    // mesmo nicho. error404Theme: 'appstore' — página "App não encontrado"
    // com busca (ver widget_404_app_store, ERROR_404_APPSTORE em modules.js).
    // menuDropdownPrefixo: true — tema-appstore-bulma-mobile-impl.json
    // documenta esse mesmo recurso via JS próprio (procura '#dynamic-menu',
    // id que não existe em lugar nenhum do chassis — sempre inerte);
    // ligado aqui usa o módulo global (mesmo mecanismo do natureza-bulma-vegan),
    // que já teria o alvo real '#main-nav ul' presente no chassis blog.
    // gridLayout: 'quadrado' — catalogo-produtos: "cards compactos
    // ícone+título+preço" (chatSystemPrompt.js) bate com o thumb 1:1 de
    // 'quadrado', preferido a 'mural' na tabela.
    // Reauditado na migração pro esqueleto próprio
    // (template_appstore-bulma-mobile.xml, ver plano "esqueleto por
    // nicho"): a sidebar/rodapé REAIS de exemplos/appstore-bulma-mobile.xml
    // só têm FeaturedPost1 (sidebar) e PopularPosts1+Stats1 (footer-1) +
    // Label1 (footer-2) + Translate1+ContactForm1 (footer-3) — sem
    // Archive nem Social Links em lugar nenhum (blogArchiveWidget/
    // socialLinksWidget removidos). contactForm:true adicionado (existia
    // no arquivo real, ContactForm1 em footer-3, sem flag correspondente
    // antes).
    // Reauditado de novo na correção do achado 8 (extração real do
    // main/post do Blog1, mesma correção já aplicada em viral-magazine):
    // readingTime/shareButtons REMOVIDOS. readingTime tinha ficado ligado
    // achando que substituía um widget "tempo de leitura" hand-rolled e
    // morto do arquivo real — mas nunca teve token de fato no esqueleto
    // pra consumir a flag (dead flag desde sempre). shareButtons nunca
    // teve onde renderizar: a view de post único real
    // (exemplos/appstore-bulma-mobile.xml) é h1 (só em Page) + corpo, sem
    // nenhuma seção de compartilhar/comentário/relacionados — settings do
    // widget Blog1 ligam comentário, mas o includable real nunca chama
    // nada que os renderize (configuração morta no arquivo original).
    // gridLayout: 'quadrado' mantido mas sem efeito visual (mesmo
    // trade-off já documentado em viral-magazine) — a listagem real é
    // uma lista chata (.app-list-card), nunca usa grid.
    'appstore-bulma-mobile':     { menuType: 'offcanvas', error404: true, error404Theme: 'appstore', backToTop: true, sliderJson: true, popularPostsRanking: true, popularPostsRankingTitle: 'Mais Baixados', appDownloadCta: true, menuDropdownPrefixo: true, gridLayout: 'quadrado', statsWidget: true, translateWidget: true, featuredPostWidget: true, labelCloudWidget: true, contactForm: true },
    // biolink-social: SEM menuType nem backToTop — template_biolink.xml não
    // tem navbar tradicional pra converter em offcanvas (o "menu" é só o par
    // de botões tema/partilhar no topo) e já tem seu próprio scroll-to-top
    // (#btnScrollToTop) e dark mode toggle bespoke, com localStorage próprio
    // ('biolink-theme'). Ligar os módulos genéricos aqui duplicaria UI que já
    // existe. shareButtons continua — esse era um gap real: a view de post
    // individual (Blog1) não tinha nenhum botão de compartilhar.
    'biolink-social':            { shareButtons: true },
};

export function modulosPadraoDoNicho(nichoTema: string | null | undefined): NichoModuleConfig {
    return NICHO_MODULE_DEFAULTS[nichoTema as string] || {};
}

