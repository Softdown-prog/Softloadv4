import type { IncludableNode, WidgetSettings } from './bloggerTemplateTree';
export type MockContext = Omit<ReturnType<typeof buildBaseContext>, 'links'> & { links: { name: string; target: string; href?: string; title?: string; isCurrentPage?: boolean }[] } & Record<string, unknown> & { __includables?: Record<string, IncludableNode> };
'use strict';

// ============================================================
// bloggerMockContext.js — dado fictício usado pelo interpretador de
// preview (bloggerTemplateTree.js + bloggerTemplateEngine.js) pra
// resolver caminhos `data:*` sem depender de dado real do Blogger.
// Cobre os campos mais referenciados no levantamento real (ver
// bloggerTemplateEngine.js) — não é exaustivo, mas closesa o
// vocabulário fechado observado nos 19 chassis + 13 exemplos reais.
// ============================================================

const PLACEHOLDER_IMGS = [
    'https://images.unsplash.com/photo-1550751827-4bd374c3f58b?auto=format&fit=crop&q=80&w=1200&h=675',
    'https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&q=80&w=1200&h=675',
    'https://images.unsplash.com/photo-1555066931-4365d14bab8c?auto=format&fit=crop&q=80&w=1200&h=675',
];

const SNIPPET = 'Explorando as novas fronteiras da inteligência artificial e como ela está moldando o futuro das interfaces digitais e do design de experiência.';

const MOCK_AUTHOR = {
    name: 'João Silva',
    aboutMe: 'Especialista em tecnologia e desenvolvimento web. Escreve sobre inovação digital há mais de 8 anos.',
    profileUrl: '#',
    avatarUrl: 'https://ui-avatars.com/api/?name=Jo%C3%A3o+Silva&size=80&background=0ea5e9&color=fff',
    authorPhoto: { url: 'https://ui-avatars.com/api/?name=Jo%C3%A3o+Silva&size=80&background=0ea5e9&color=fff' },
};

const RAW_POSTS = [
    { title: 'A Revolução do Design Generativo em 2026', cat: 'Tecnologia', date: '20 de maio de 2026' },
    { title: 'Como criar paletas de cores magnéticas para seu Blog', cat: 'Web Design', date: '18 de maio de 2026' },
    { title: 'O Guia completo para Bootstrap 5 no Blogger', cat: 'Desenvolvimento', date: '15 de maio de 2026' },
];

function buildMockPosts() {
    return RAW_POSTS.map((p, i) => ({
        title: p.title,
        url: '#',
        snippet: SNIPPET,
        snippets: { short: SNIPPET },
        date: p.date,
        dateHeader: p.date,
        labels: [{ name: p.cat, url: '#' }],
        featuredImage: { isResizable: true, url: PLACEHOLDER_IMGS[i % PLACEHOLDER_IMGS.length] },
        thumbnail: PLACEHOLDER_IMGS[i % PLACEHOLDER_IMGS.length],
        author: MOCK_AUTHOR,
        allowComments: true,
        numberOfComments: 3,
        showAuthor: true, showDateHeader: true, showShareButtons: true, showCommentLink: true,
        showLabels: true, showTimestamp: true, showBacklinks: false, showInlineAds: false, showReactions: true,
        feedLinks: [{ url: '#', name: 'Comentários da Postagem', mimeType: 'application/atom+xml' }],
        emailPostUrl: '#',
        id: `post-${i + 1}`,
        body: `<p>${SNIPPET}</p>`,
        comments: [],
    }));
}

const MOCK_PLATFORMS = [
    { key: 'facebook', shareMessage: 'Compartilhar no Facebook' },
    { key: 'twitter', shareMessage: 'Compartilhar no X' },
    { key: 'pinterest', shareMessage: 'Compartilhar no Pinterest' },
    { key: 'whatsapp', shareMessage: 'Compartilhar no WhatsApp' },
];

const MOCK_LABELS = [{ name: 'Tecnologia', url: '#' }, { name: 'Web Design', url: '#' }, { name: 'Tutoriais', url: '#' }];
// Achado real: `data:links` é referenciado tanto por LinkList1 (campos
// .name/.target) quanto pelo PageList1 nativo real (campos .href/.title/
// .isCurrentPage, ver template_tecnologia-mag-tech.xml) — expõe os dois
// formatos no mesmo objeto em vez de mapear por widget.
const MOCK_LINKS = [
    { name: 'Início', target: '#', href: '#', title: 'Início', isCurrentPage: false },
    { name: 'Sobre', target: '#', href: '#', title: 'Sobre', isCurrentPage: false },
    { name: 'Contato', target: '#', href: '#', title: 'Contato', isCurrentPage: false },
];
// Dados APENAS para a prévia determinística do BioLink: não entram no XML
// compilado nem nas configurações reais dos widgets no Blogger.
const MOCK_BIOLINK_LINKS = [
    { name: 'Meu portfólio', target: '#portfolio' },
    { name: 'Projetos recentes', target: '#projetos' },
    { name: 'Fale comigo', target: '#contato' },
];
const MOCK_BIOLINK_SOCIAL = [
    { name: 'Instagram', target: '#instagram.com' },
    { name: 'YouTube', target: '#youtube.com' },
    { name: 'GitHub', target: '#github.com' },
    { name: 'LinkedIn', target: '#linkedin.com' },
];
const MOCK_PAGES = [
    { title: 'Início', url: '#', href: '#', isCurrentPage: false },
    { title: 'Sobre', url: '#', href: '#', isCurrentPage: false },
    { title: 'Contato', url: '#', href: '#', isCurrentPage: false },
];
const MOCK_ARCHIVE = [
    { name: '2026', url: '#', 'post-count': 12, expclass: 'expanded', data: [{ name: 'Julho', url: '#', 'post-count': 4, expclass: 'collapsed' }] },
    { name: '2025', url: '#', 'post-count': 30, expclass: 'collapsed', data: [] },
];

export function buildBaseContext(blogTitle: string, previewNiche: string | null = null) {
    const posts = buildMockPosts();
    return {
        __previewNiche: previewNiche,
        view: {
            isHomepage: true, isPost: false, isPage: false, isMultipleItems: true, isSingleItem: false,
            isSearch: false, isLabelSearch: false, isArchive: false, isError: false, isPreview: false,
            postId: 'post-1',
            title: { escaped: `${blogTitle} — Prévia` },
            // achado real: `data:view.search.query` é referenciado DIRETO (sem
            // sufixo .escaped) como guard de truthiness em templates reais —
            // como objeto teria Object.keys().length>0 (sempre truthy), tem
            // que ser string vazia primitiva pra "sem busca ativa" resolver
            // corretamente (o fallback tolerante de resolvePath ainda cobre
            // o sufixo .escaped quando usado em outro lugar).
            search: { query: '', updated: '' },
            url: '#',
        },
        blog: {
            title: blogTitle, homepageUrl: '#', url: '#', pageType: 'index',
            metaDescription: 'Prévia gerada automaticamente pelo Softload Engine.',
            feedLinks: [{ url: '#', name: 'Posts', mimeType: 'application/atom+xml' }],
            sharing: { platforms: MOCK_PLATFORMS },
        },
        posts,
        post: posts[0],
        labels: MOCK_LABELS,
        links: MOCK_LINKS,
        pages: MOCK_PAGES,
        comments: [],
        platforms: MOCK_PLATFORMS,
        data: MOCK_ARCHIVE,
        intervalData: MOCK_ARCHIVE,
        newerPageUrl: '#', olderPageUrl: '#',
        originalUrl: '#',
        top: { showAuthor: true },
        widgets: { Blog: { first: { headerByline: { items: [] }, footerBylines: { items: [] } } } },
        widget: { instanceId: 'widget1' },
        i: 0, j: 0,
    };
}

// Settings de widget-instance viram parte do escopo — achado real: a
// mesma configuração aparece referenciada tanto como `data:X` solta
// (ex.: HTML1 usa `data:title`/`data:content`, PopularPosts usa
// `data:display`) quanto sob `data:post.X` (Blog1 usa
// `data:post.showAuthor` etc.) — expor nos dois lugares é tolerante e
// evita ter que mapear manualmente qual widget usa qual convenção.
// Achado real (BlogArchive1): o widget-setting 'showStyle' é referenciado
// no includable nativo como `data:style` (nome ambiente diferente do nome
// bruto da setting — quirk documentado do próprio Blogger, não erro nosso).
// Mapa pequeno e fechado — só entra aqui o que foi confirmado em corpus real.
const SETTING_ALIAS_BY_WIDGET_TYPE: Record<string, Record<string, string>> = {
    BlogArchive: { showStyle: 'style' },
};

export function buildWidgetContext(baseCtx: MockContext, widgetType: string | null, settings: WidgetSettings, widgetId: string | null, widgetTitle: string | null): MockContext {
    const ctx: MockContext = Object.create(baseCtx);
    // Achado real: <data:title/> dentro do 'main' de widgets sem
    // widget-setting 'title' explícito (PageList/PopularPosts/BlogArchive/
    // Labels...) vem do atributo title= da própria tag <b:widget> — seedado
    // ANTES das settings pra que widgets tipo HTML (que TÊM um setting
    // 'title' de verdade) continuem podendo sobrescrever.
    ctx.title = widgetTitle || '';
    // Um HTML widget sem content não exibe CTA no Blogger real. No
    // preview, undefined != '' era avaliado como true e criava links
    // fantasma (WhatsApp com href='https://wa.me/' sem número).
    Object.assign(ctx, widgetType === 'HTML' ? { content: '' } : {}, settings);
    if (baseCtx.__previewNiche === 'biolink-social' && widgetType === 'LinkList') {
        if (widgetId === 'LinkList1') ctx.links = MOCK_BIOLINK_LINKS;
        if (widgetId === 'LinkList2') ctx.links = MOCK_BIOLINK_SOCIAL;
    }
    const aliases = SETTING_ALIAS_BY_WIDGET_TYPE[widgetType || ''];
    if (aliases) for (const [from, to] of Object.entries(aliases)) if (from in settings) ctx[to] = settings[from];
    ctx.post = Object.assign({}, baseCtx.post, settings);
    ctx.widget = Object.assign({}, baseCtx.widget, { instanceId: widgetId || baseCtx.widget.instanceId });

    if (widgetType === 'FeaturedPost') {
        const p = baseCtx.posts[0];
        Object.assign(ctx, {
            postFirstImage: p.featuredImage.url,
            postUrl: p.url,
            postTitle: p.title,
            postSnippet: p.snippet,
        });
    }

    // Achado real (gamer-playerone/culinaria-boutique-gourmet, reproduzido
    // via Chromium): `data:pageLanguage`/`data:layout` no includable nativo
    // do widget Translate NÃO são widget-setting declarada no template —
    // são dado computado pela própria plataforma Blogger (não aparecem em
    // <b:widget-settings>). Sem mock, resolvem pro fallback genérico
    // "desconhecido → vazio" (passo 3 de bloggerPreviewRenderer.js), o que é
    // inofensivo dentro de string ('' continua JS válido) mas QUEBRA quando
    // usado como sufixo de identificador sem aspas:
    // `google.translate.TranslateElement.InlineLayout.<data:layout/>` vira
    // `InlineLayout.` seguido de nada — `Unexpected token '}'`.
    // `layout` no Blogger real reflete o valor já configurado em
    // `displayMode` (widget-setting real, ex.: 'SIMPLE' — também um membro
    // válido do enum InlineLayout); `pageLanguage` não tem setting
    // correspondente no template, usa o idioma do mock (pt, mesmo de todo o
    // resto do conteúdo fictício deste arquivo).
    if (widgetType === 'Translate') {
        Object.assign(ctx, {
            pageLanguage: ctx.pageLanguage || 'pt',
            layout: ctx.displayMode || 'HORIZONTAL',
        });
    }

    return ctx;
}
