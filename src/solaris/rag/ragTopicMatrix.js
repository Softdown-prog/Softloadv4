"use strict";
// ============================================================
// SOLARIS RAG TOPIC MATRIX — Etapa 1+2 do pipeline de geração
// (Coletor + Fragmentador, versão determinística)
// ============================================================
// Decisão de arquitetura (pedida em revisão de roadmap): em vez de um
// crawler ao vivo contra sites de documentação oficiais — frágil
// (estrutura de HTML muda, cada site pede parser próprio) e que ainda
// assim provavelmente precisaria de IA no meio pra estruturar o HTML
// raspado (não elimina o uso de IA, só adiciona uma etapa que pode
// quebrar) — a matéria-prima "bruta" é esta matriz de tópicos: uma
// lista estática, editada por humano, sem rede nenhuma. Zero
// ambiguidade, zero dependência externa. O Gemini (`ragEntryGenerator.js`)
// só entra depois, gerando UM arquivo de catálogo por tópico — exatamente
// onde a IA agrega valor (não há forma determinística de saber "quais
// classes o Accordion do Bootstrap 5 usa" sem ou raspar a doc real ou
// perguntar a um modelo treinado nela).
//
// Cada grupo aqui corresponde a um `id` de referência já existente ou
// esperado no catálogo (bootstrap5, html5, css3, javascript, php,
// flask, django) — os tópicos listados são a semente real fornecida
// na revisão que motivou este pipeline, não um catálogo completo
// inventado: estender a lista é decisão de quem cura o catálogo,
// nunca fabricada aqui sem pedido.
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOPICOS = void 0;
exports.listarGrupos = listarGrupos;
exports.listarTopicos = listarTopicos;
exports.idParaTopico = idParaTopico;
exports.TOPICOS = {
    bootstrap5: [
        'navbar', 'dropdown', 'offcanvas', 'accordion', 'cards', 'grid',
        'forms', 'validation', 'alerts', 'toast', 'carousel', 'pagination',
        'badge', 'modal', 'tooltip', 'popover', 'scrollspy', 'utilities',
        'icons', 'dark-mode',
    ],
    html5: [
        'semantica', 'forms', 'accessibility', 'seo', 'meta', 'open-graph',
        'tables', 'lists', 'canvas', 'svg', 'video', 'audio',
        'drag-and-drop', 'storage', 'web-components',
    ],
    css3: [
        'flexbox', 'grid', 'variables', 'animations', 'transitions',
        'filters', 'media-queries', 'clamp', 'container-queries',
        'aspect-ratio',
    ],
    javascript: [
        'dom', 'events', 'fetch', 'async', 'promise', 'modules', 'classes',
        'storage', 'clipboard', 'history-api',
    ],
    php: [
        'mvc', 'sessions', 'cookies', 'pdo', 'routing', 'upload', 'login',
        'middleware',
    ],
    flask: [
        'blueprints', 'jinja2', 'routes', 'forms', 'sqlalchemy',
        'authentication', 'upload', 'api',
    ],
    django: [
        'models', 'views', 'templates', 'urls', 'admin', 'forms', 'orm',
        'middleware',
    ],
};
function listarGrupos() {
    return Object.keys(exports.TOPICOS);
}
function listarTopicos(grupo) {
    return exports.TOPICOS[grupo] ? [...exports.TOPICOS[grupo]] : [];
}
// Id/slug/nome de arquivo convencionados como "<grupo>-<topico>" (ex.:
// "bootstrap5-navbar") — flat em src/solaris/rag/, mesma pasta dos
// arquivos de catálogo já existentes, sem precisar de subpasta por
// grupo nem de o loader aprender a percorrer diretório recursivamente
// (ragCatalogLoader.carregarCatalogo continua um único fs.readdirSync
// não-recursivo — menos abstração, nenhum modo de falha novo).
function idParaTopico(grupo, topico) {
    return `${grupo}-${topico}`;
}
