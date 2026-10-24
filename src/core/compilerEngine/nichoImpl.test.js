'use strict';

/**
 * Testes para o extrator de CSS/JS/hero do impl.json — nichoImpl.js.
 * Execute: node src/core/compilerEngine/nichoImpl.test.js
 *
 * Usa um impl.json de fixture real, escrito/removido no diretório de temas
 * (mesmo padrão de leitura que carregarNichoImpl usa em produção — não há
 * injeção/mock, é a mesma função lendo do disco).
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const TEMAS_DIR   = path.join(__dirname, '../../../src/rag/rag-ia-compiler/pipeline/temas');
const FIXTURE_NOME = 'tema-__fixture-teste-nichoimpl__-impl.json';
const FIXTURE_PATH = path.join(TEMAS_DIR, FIXTURE_NOME);

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

function comFixture(impl, fn) {
    fs.writeFileSync(FIXTURE_PATH, JSON.stringify(impl), 'utf-8');
    delete require.cache[require.resolve('./nichoImpl')];
    const { carregarNichoImpl } = require('./nichoImpl');
    try {
        return fn(carregarNichoImpl('__fixture-teste-nichoimpl__'));
    } finally {
        fs.unlinkSync(FIXTURE_PATH);
    }
}

const FIXTURE_META_PATH = path.join(TEMAS_DIR, 'tema-__fixture-teste-nichoimpl__-meta.json');

function comFixtureEMeta(impl, meta, fn) {
    fs.writeFileSync(FIXTURE_PATH, JSON.stringify(impl), 'utf-8');
    fs.writeFileSync(FIXTURE_META_PATH, JSON.stringify(meta), 'utf-8');
    delete require.cache[require.resolve('./nichoImpl')];
    const { carregarNichoImpl } = require('./nichoImpl');
    try {
        return fn(carregarNichoImpl('__fixture-teste-nichoimpl__'));
    } finally {
        fs.unlinkSync(FIXTURE_PATH);
        fs.unlinkSync(FIXTURE_META_PATH);
    }
}

// A. Regressão viral-magazine — CSS irmão de css_base (sem "css" no nome)
// não pode mais ser descartado.
comFixture({
    mag_card_sistema: {
        descricao: 'Sistema completo de cards de revista, sem chaves.',
        css_base: '.mag-card { border-radius: 8px; }',
        overlay: '.mag-overlay { position: absolute; }',
        titulo_com_sublinhado_magico: '.mag-title a { background-size: 0 100%; }',
        nota_sublinhado: 'O sublinhado preenche o título ao passar o mouse, sem chaves.',
    },
}, (r) => {
    assert('css_base (chave exata) extraído', r.css.includes('.mag-card'));
    assert('overlay (irmão sem "css" no nome) extraído', r.css.includes('.mag-overlay'), r.css);
    assert('sublinhado mágico (irmão sem "css" no nome) extraído', r.css.includes('background-size'), r.css);
    assert('descricao (prosa, sem chaves) NÃO extraída', !r.css.includes('Sistema completo'));
    assert('nota_sublinhado (prosa, sem chaves) NÃO extraída', !r.css.includes('preenche o título'));
});

// B. Regressão viral-magazine — JS dentro de seção "hero" sem "js" na chave.
comFixture({
    hero_grid_json_feed: {
        descricao: 'Hero grid de 3 posts via feed JSON.',
        container_html: '<div class="col-12 mb-4" id="js-hero-grid"></div>',
        inicializador: "if (window.location.pathname === '/') {\n  fetchMagazinePosts('js-hero-grid', 3, 'hero');\n}",
        funcao_fetch_central: "const fetchMagazinePosts = async (containerId) => {\n  const c = document.getElementById(containerId);\n};",
        dados_feed: "post.title.$t — título\npost.link.find(l => l.rel === 'alternate').href — URL",
        snippet_strip_html: "post.summary.$t.replace(/<[^>]*>?/gm, '').substring(0, 120) + '...'",
    },
}, (r) => {
    assert('container_html (HTML real) extraído pro hero', r.heroHtml.includes('js-hero-grid'));
    assert('inicializador (JS real, começa com if() extraído', r.js.includes('fetchMagazinePosts'));
    assert('funcao_fetch_central (JS real, começa com const) extraído', r.js.includes('fetchMagazinePosts = async'));
    assert('dados_feed (documentação com fragmento JS citado) NÃO extraído', !r.js.includes('post.title.$t'), r.js);
    assert('snippet_strip_html (documentação, começa com "post.") NÃO extraído', !r.js.includes('post.summary.$t'), r.js);
    // Regressão real (viral-magazine, achada ao investigar console errors no
    // preview renderizado): funcao_fetch_central batia TANTO no bloco
    // isHeroSection (linha "JS real dentro de uma secção hero") QUANTO,
    // depois, no walk() recursivo que roda em seguida sobre os mesmos
    // filhos — extraída 2x, virava 2 <script> tags separadas declarando
    // "const fetchMagazinePosts" cada uma. Cada tag é sintaticamente válida
    // sozinha (por isso nunca pegava no syntax-check por bloco), mas
    // colidem no MESMO escopo global da página real: "Identifier
    // 'fetchMagazinePosts' has already been declared".
    const ocorrencias = (r.js.match(/const fetchMagazinePosts = async/g) || []).length;
    assert('funcao_fetch_central NÃO duplicada (extraída só 1x apesar de bater em 2 caminhos do walker)',
        ocorrencias === 1, `apareceu ${ocorrencias}x`);
});

// C. Regressão dos 3 nichos com JS quebrado em produção — nota de
// documentação em português vazando por herdar isJs de um ancestral.
comFixture({
    algum_widget: {
        javascript: {
            nota_padrao: "Mesmo padrao do Bulma Vegan/NAT: itens com prefixo '_' viram filhos dropdown do item anterior no navbar.",
            codigo_real: "document.addEventListener('DOMContentLoaded', function() {\n  console.log('ok');\n});",
        },
    },
}, (r) => {
    assert('nota de documentação sob chave "javascript" NÃO extraída (sem looksLikeJs)', !r.js.includes('Mesmo padrao'), r.js);
    assert('código real sob chave "javascript" continua extraído', r.js.includes("DOMContentLoaded"));
});

// D. Comentário de cabeçalho ("// [n] caminho: arquivo.js") continua aceito.
comFixture({
    css_componentes: {
        animate_up: {
            js_intersection_observer: "// [8] caminho: animate_up.js\nconst observer = new IntersectionObserver(() => {});",
        },
    },
}, (r) => {
    assert('JS com comentário de cabeçalho // continua extraído', r.js.includes('IntersectionObserver'));
});

// E. Todo JS extraído de um impl.json real (14 nichos) é sintaticamente
// válido — a checagem de regressão mais importante: nenhum <script> quebrado
// injetado numa página ao vivo.
{
    const { carregarNichoImpl } = require('./nichoImpl');
    const dir = TEMAS_DIR;
    const nichos = fs.readdirSync(dir)
        .filter(f => f.endsWith('-impl.json'))
        .map(f => f.replace('-impl.json', '').replace(/^tema-/, ''));

    for (const nicho of nichos) {
        const r = carregarNichoImpl(nicho);
        const blocos = [...r.js.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)].map(m => m[1]);
        let ok = true, erro = '';
        for (const codigo of blocos) {
            try { new vm.Script(codigo); } catch (e) { ok = false; erro = e.message; break; }
        }
        assert(`JS extraído de ${nicho} é sintaticamente válido`, ok, erro);

        // E2. Cada <script> é válido SOZINHO, mas um identificador
        // const/let/function de nível global declarado 2x em <script> tags
        // SEPARADAS colide em runtime (mesmo escopo léxico global da
        // página) mesmo sem colidir no parse isolado de cada bloco — é
        // exatamente o que o loop acima não pega. Achado real
        // (viral-magazine): funcao_fetch_central/funcao_sniper_imagem
        // extraídas 2x pelo walker (bug já corrigido, ver dedup em
        // nichoImpl.js) só apareciam como "Identifier ... has already been
        // declared" quando os blocos rodavam juntos, nunca no syntax-check
        // isolado por bloco.
        let semColisao = true, erroColisao = '';
        try {
            new vm.Script(blocos.join('\n;\n'));
        } catch (e) {
            semColisao = false; erroColisao = e.message;
        }
        assert(`JS de ${nicho} não colide em escopo global quando todos os <script> rodam juntos`, semColisao, erroColisao);
    }
}

// F. Injeção de tokens_css (meta.json) — normalização pro formato canônico
// light_mode/dark_mode. Cobre a auditoria de variáveis --* órfãs em 10+
// nichos (viral-magazine, tecnologia-mag-tech, tecnologia-techwind, etc.):
// cada -meta.json documenta os valores padrão, mas nada os injetava no
// :root do template compilado.
comFixtureEMeta({}, {
    tokens_css: {
        light_mode: {
            '--x-primary': '#e74c3c',
            '--x-primary-hover': '#c0392b',
            '--x-bg': '#ffffff',
            '--x-footer-bg': '#212529',
            '--x-surface': '#f8f9fa',
            '--x-text': '#333333',
            '--font-body': "'Roboto', sans-serif",
        },
        dark_mode: {
            '--x-bg': '#0f172a',
            '--x-text': '#e2e8f0',
        },
    },
}, (r) => {
    assert('--x-primary aliasado a --sl-primary (respeita preset do usuário)',
        r.css.includes('--x-primary: var(--sl-primary);'), r.css);
    assert('--x-primary-hover NÃO aliasado (manteria hover idêntico ao normal)',
        r.css.includes('--x-primary-hover: #c0392b;'), r.css);
    assert('--x-bg (light) aliasado a --sl-bg-body',
        r.css.includes('--x-bg: var(--sl-bg-body);'), r.css);
    assert('--x-footer-bg aliasado a --sl-footer-bg (não a --sl-bg-body)',
        r.css.includes('--x-footer-bg: var(--sl-footer-bg);'), r.css);
    assert('--x-surface aliasado a --sl-card-bg',
        r.css.includes('--x-surface: var(--sl-card-bg);'), r.css);
    assert('--x-text aliasado a --sl-text-main',
        r.css.includes('--x-text: var(--sl-text-main);'), r.css);
    assert('--font-body NÃO aliasado (colisão com regex "-body$" de --sl-bg-body)',
        r.css.includes("--font-body: 'Roboto', sans-serif;"), r.css);
    assert('dark_mode usa valor LITERAL, não o alias --sl-* (senão dark mode vira no-op)',
        r.css.includes('--x-bg: #0f172a;') && r.css.includes('--x-text: #e2e8f0;'), r.css);
    assert("seletor padrão [data-bs-theme='dark'] presente", r.css.includes("[data-bs-theme='dark']"));
});

// G. Nicho sem tokens_css no meta.json (ou sem meta.json) não gera bloco
// :root vazio nem quebra a compilação.
comFixture({ css_x: '.a { color: red; }' }, (r) => {
    assert('sem tokens_css → nenhum :root injetado', !r.css.includes(':root'), r.css);
});

console.log(`\n${failed === 0 ? '✅' : '❌'} nichoImpl: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
