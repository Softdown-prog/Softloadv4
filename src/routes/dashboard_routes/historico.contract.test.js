'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function fixture() {
    const routes = new Map(), calls = [], timers = [];
    const state = { exists: true, failDb: false, used: 1, data: {
        gcPath: 'users/owner/compilations/template.zip', xmlPath: 'users/owner/compilations/template.xml',
        arquivo: 'template.zip', siteName: 'Fixture', tamanhoBytes: 1024, colorPreset: 'tech-blue',
        typography: 'inter', gridLayout: 'lista', geradoPorIA: true,
        criadoEm: { toDate: () => new Date('2026-10-26T12:00:00Z') },
    } };
    const login = () => {};
    function document(location) { return {
        collection(name) { return collection(location + '/' + name); },
        async get() {
            if (state.failDb) throw Error('fake offline');
            calls.push({ kind: 'doc-read', location });
            return { exists: state.exists, id: 'fixture', data: () => location.includes('/compilacoes/') ? state.data : { storage_usado_mb: state.used } };
        },
        async delete() { calls.push({ kind: 'doc-delete', location }); },
    }; }
    function collection(location) { return {
        doc(id) { return document(location + '/' + id); },
        orderBy(field, order) { calls.push({ kind: 'order', field, order }); return this; },
        limit(n) { assert.equal(n, 30); return this; },
        async get() {
            if (state.failDb) throw Error('fake offline');
            calls.push({ kind: 'list', location });
            return { docs: [{ id: 'fixture', data: () => state.data }] };
        },
    }; }
    const db = { collection,
        async runTransaction(callback) { return callback({ get: ref => ref.get(), update(ref, data) { calls.push({ kind: 'update', data }); } }); },
    };
    const bucket = { file(location) { return {
        async download() { calls.push({ kind: 'download', location }); return [Buffer.from('<html>fixture</html>')]; },
        async delete() { calls.push({ kind: 'gcs-delete', location }); },
        createReadStream() {
            calls.push({ kind: 'stream', location });
            return { on(event, callback) { state.streamError = callback; return this; }, pipe(res) { calls.push({ kind: 'pipe', res }); } };
        },
    }; } };
    const router = { get(route, middleware, handler) { assert.equal(middleware, login); routes.set('GET ' + route, handler); },
        delete(route, middleware, handler) { assert.equal(middleware, login); routes.set('DELETE ' + route, handler); } };
    const mod = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'historico.js'), 'utf8'), {
        module: mod, exports: mod.exports, console: { log() {}, warn() {}, error() {} },
        setTimeout(callback, ms) { timers.push(ms); callback(); },
        require(id) {
            if (id === 'express') return { Router: () => router };
            if (id === '../../middlewares/authGuard') return { exigirLogin: login };
            if (id === '../../services/firebase') return { db, bucket, admin: { firestore: { FieldValue: {} } } };
            if (id === '../../lib/bloggerPreviewRenderer') return { parseBloggerXMLToHTML: (xml, title) => 'rendered:' + title + ':' + xml };
            if (id === '../../core/presets') return { COLOR_PRESETS: { 'tech-blue': { label: 'Tech', primary: '#0000ff' } }, TYPOGRAPHY_PRESETS: { inter: { label: 'Inter (Readable)' } } };
            if (id === '../../services/storageService') return { STORAGE_LIMITS_MB: { free: 5, studio: 500 } };
            throw Error('Production dependency forbidden: ' + id);
        },
    });
    function req() { return { session: { user: { uid: 'owner', email: 'Owner@Example.test', plano: 'free' } }, params: { id: 'fixture' }, query: {} }; }
    function response() { return { code: 200, headersSent: false, headers: {}, status(code) { this.code = code; return this; },
        json(body) { this.body = body; return this; }, send(text) { this.text = text; return this; },
        setHeader(name, value) { this.headers[name] = value; }, render(view, data) { this.view = view; this.data = data; } }; }
    async function call(route, request = req()) { const res = response(); await routes.get(route)(request, res); return res; }
    return { routes, state, calls, timers, req, call };
}

test('history list preserves account scoping, display metadata, timestamps and quota', async () => {
    const f = fixture(); const res = await f.call('GET /api/historico');
    assert.equal(res.code, 200); assert.equal(res.body.totalIA, 1); assert.equal(res.body.storageLimitMb, 5);
    const row = res.body.compilacoes[0];
    assert.equal(row.typographyLabel, 'Inter'); assert.equal(row.gridLabel, 'Lista');
    assert.equal(row.criadoEmISO, '2026-10-26T12:00:00.000Z');
    assert.ok(f.calls.some(x => x.kind === 'list' && x.location === 'clientes_premium/owner@example.test/compilacoes'));
});

test('foreign files are rejected before GCS access in preview, download and deletion', async () => {
    const f = fixture(); f.state.data.gcPath = 'users/foreign/a.zip'; f.state.data.xmlPath = 'users/foreign/a.xml';
    for (const [route, status] of [
        ['GET /api/preview/:id', 404], ['GET /dashboard/compilacao/:id/download', 403], ['DELETE /dashboard/compilacao/:id', 403],
    ]) assert.equal((await f.call(route)).code, status);
    assert.equal(f.calls.filter(x => ['download', 'stream', 'gcs-delete', 'doc-delete', 'update'].includes(x.kind)).length, 0);
    assert.ok(f.timers.length >= 2);
});

test('session and saved previews preserve workspace payload and legacy XML fallback', async () => {
    const f = fixture(); const request = f.req();
    assert.equal((await f.call('GET /api/preview/session', request)).code, 404);
    request.session.wsPreview = { xmlPath: 'users/owner/preview.xml', siteName: 'Session' };
    const session = await f.call('GET /api/preview/session', request);
    assert.equal(session.body.from, 'workspace'); assert.match(session.body.previewHtml, /^rendered:Session:/);
    delete f.state.data.xmlPath; request.query.from = 'workspace';
    const saved = await f.call('GET /api/preview/:id', request);
    assert.equal(saved.body.from, 'workspace'); assert.equal(saved.body.compilacaoId, 'fixture');
    assert.ok(f.calls.some(x => x.kind === 'download' && x.location === 'users/owner/compilations/template.xml'));
});

test('download streams owned file and handles failures before headers are sent', async () => {
    const f = fixture(); const res = await f.call('GET /dashboard/compilacao/:id/download');
    assert.equal(res.headers['Content-Type'], 'application/zip');
    assert.match(res.headers['Content-Disposition'], /template.zip/);
    assert.ok(f.calls.some(x => x.kind === 'pipe' && x.res === res));
    f.state.streamError(Error('fake broken stream'));
    assert.equal(res.code, 500); assert.match(res.text, /Falha ao baixar/);
});

test('owned deletion removes zip/XML and clamps account quota without touching foreign XML', async () => {
    const f = fixture(); f.state.used = 0.00001;
    const res = await f.call('DELETE /dashboard/compilacao/:id');
    assert.equal(res.body.sucesso, true);
    assert.equal(f.calls.filter(x => x.kind === 'gcs-delete').length, 2);
    assert.equal(f.calls.find(x => x.kind === 'update').data.storage_usado_mb, 0);
    const other = fixture(); other.state.data.xmlPath = 'users/foreign/private.xml';
    await other.call('DELETE /dashboard/compilacao/:id');
    assert.equal(other.calls.filter(x => x.kind === 'gcs-delete').length, 1);
});

test('missing records and database failures preserve HTTP errors', async () => {
    const f = fixture(); f.state.exists = false;
    assert.equal((await f.call('GET /api/preview/:id')).code, 404);
    assert.equal((await f.call('GET /dashboard/compilacao/:id/download')).code, 404);
    assert.equal((await f.call('DELETE /dashboard/compilacao/:id')).code, 404);
    f.state.failDb = true;
    const res = await f.call('GET /api/historico');
    assert.equal(res.code, 500); assert.equal(res.body.compilacoes.length, 0);
});
