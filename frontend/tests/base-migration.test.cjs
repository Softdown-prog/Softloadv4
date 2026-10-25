'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadFrontendTs(relative, globals = {}, imports = {}) {
    const file = path.resolve(__dirname, '..', relative);
    const source = fs.readFileSync(file, 'utf8');
    const js = ts.transpileModule(source, {
        fileName: file,
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            newLine: ts.NewLineKind.LineFeed,
        },
        reportDiagnostics: true,
    });
    assert.equal(js.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
    const mod = { exports: {} };
    const sandbox = {
        module: mod,
        exports: mod.exports,
        require(id) {
            if (Object.prototype.hasOwnProperty.call(imports, id)) return imports[id];
            throw new Error('Unexpected runtime dependency: ' + id);
        },
        console: { error() {}, log() {} },
        ...globals,
    };
    vm.runInNewContext(js.outputText, sandbox, { filename: file, timeout: 2000 });
    return mod.exports;
}

test('api.ts preserva URL, cabeçalho e a configuração retornada', async () => {
    const calls = [];
    const api = loadFrontendTs('services/api.ts', {
        fetch: async (url, options) => {
            calls.push({ url, options });
            return { ok: true, json: async () => ({ user: { nome: 'Teste' } }) };
        },
    });
    const config = await api.fetchAppConfig();
    assert.equal(config.user.nome, 'Teste');
    assert.equal(calls[0].url, '/api/app-config');
    assert.equal(calls[0].options.headers.Accept, 'application/json');
});

test('api.ts retorna null quando rede/HTTP falham', async () => {
    const badStatus = loadFrontendTs('services/api.ts', {
        fetch: async () => ({ ok: false, status: 500 }),
    });
    assert.equal(await badStatus.fetchAppConfig(), null);
    const badNetwork = loadFrontendTs('services/api.ts', {
        fetch: async () => { throw new Error('offline'); },
    });
    assert.equal(await badNetwork.fetchAppConfig(), null);
});

test('preferências de acessibilidade aceitam somente valores válidos e aplicam atributos', () => {
    const values = new Map();
    const attributes = new Map();
    const prefs = loadFrontendTs('utils/accessibilityPrefs.ts', {
        localStorage: {
            getItem: key => values.get(key) ?? null,
            setItem: (key, value) => values.set(key, value),
        },
        document: {
            documentElement: { setAttribute: (key, value) => attributes.set(key, value) },
        },
    });
    prefs.applyAccessibilityPrefs();
    assert.equal(attributes.get('data-font-scale'), '100');
    assert.equal(attributes.get('data-font-family'), 'padrao');
    prefs.setFontScale('130');
    prefs.setFontFamily('legivel');
    assert.equal(prefs.getFontScale(), '130');
    assert.equal(prefs.getFontFamily(), 'legivel');
    prefs.setFontScale('400');
    prefs.setFontFamily('invalida');
    assert.equal(prefs.getFontScale(), '130');
    assert.equal(prefs.getFontFamily(), 'legivel');
    values.set('sl-a11y-font-scale', 'valor-inválido');
    assert.equal(prefs.getFontScale(), '100');
});

test('useFocusTrap.ts prende Tab, fecha no Escape e devolve o foco no cleanup', () => {
    const listeners = new Map();
    const previous = { focused: false, focus() { this.focused = true; } };
    const first = { offsetParent: {}, focused: false, focus() { this.focused = true; } };
    const last = { offsetParent: {}, focused: false, focus() { this.focused = true; } };
    const document = {
        activeElement: previous,
        addEventListener: (type, cb) => listeners.set(type, cb),
        removeEventListener: type => listeners.delete(type),
    };
    const react = {
        useEffect(callback) { react.cleanup = callback(); },
        cleanup: undefined,
    };
    const hook = loadFrontendTs('hooks/useFocusTrap.ts', { document }, { react }).default;
    const ref = { current: { querySelectorAll: () => [first, last], focus() {} } };
    let closed = 0;
    hook(ref, true, () => { closed++; });
    assert.equal(first.focused, true);
    const keydown = listeners.get('keydown');
    assert.equal(typeof keydown, 'function');
    document.activeElement = first;
    let prevented = false;
    keydown({ key: 'Tab', shiftKey: true, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(last.focused, true);
    keydown({ key: 'Escape' });
    assert.equal(closed, 1);
    react.cleanup();
    assert.equal(previous.focused, true);
    assert.equal(listeners.has('keydown'), false);
});

test('useHeroEntrance.ts respeita redução de movimento sem baixar GSAP', () => {
    const classes = [];
    let done = 0;
    const react = {
        useRef(initial) { return { current: initial }; },
        useEffect(callback) { callback(); },
    };
    const hook = loadFrontendTs('hooks/useHeroEntrance.ts', {
        document: {
            documentElement: { classList: { remove: value => classes.push(value) } },
        },
        window: {
            matchMedia: () => ({ matches: true }),
        },
    }, { react }).default;
    hook(() => { done++; });
    assert.equal(done, 1);
    assert.deepEqual(classes, ['js-anim']);
});
