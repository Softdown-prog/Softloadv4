'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { setPublicStaticHeaders } = require('../../scripts/vendorCachePolicy');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'softload-vendor-http-'));
let server;
const write = (name, content) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
};
const get = (port, url, method = 'GET') => new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path: url, method }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
        }));
    });
    request.on('error', reject);
    request.end();
});

(async () => {
    try {
        const css = Buffer.from('body { color: #fff }\n');
        const bootstrap = Buffer.from('window.bootstrap = true;\n');
        const chart = Buffer.from('window.Chart = function() {};\n');
        write('vendor/bootstrap/css/bootstrap.min.css', css);
        write('vendor/bootstrap/js/bootstrap.bundle.min.js', bootstrap);
        write('vendor/chart.js/chart.umd.min.js', chart);
        write('dist/assets/main.js', 'window.app = true;');
        write('dist/assets/chunk-abc123.js', 'window.chunk = true;');
        write('vendor-other/file.js', 'window.other = true;');

        // O mesmo middleware e a mesma politica de cache importada por server.js.
        const app = express();
        app.use(express.static(root, {
            maxAge: '1y', immutable: true,
            setHeaders(res, filePath) { setPublicStaticHeaders(res, filePath, root); },
        }));
        server = http.createServer(app);
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', resolve);
        });
        const address = server.address();
        assert.ok(address && typeof address !== 'string');
        const port = address.port;

        for (const [url, expected, mime] of [
            ['/vendor/bootstrap/css/bootstrap.min.css?v=commit-2', css, 'text/css'],
            ['/vendor/bootstrap/js/bootstrap.bundle.min.js?v=commit-2', bootstrap, 'javascript'],
            ['/vendor/chart.js/chart.umd.min.js?v=commit-2', chart, 'javascript'],
        ]) {
            const response = await get(port, url);
            assert.equal(response.status, 200, url + ' deve estar disponivel');
            assert.deepEqual(response.body, expected, url + ' deve entregar os bytes originais');
            assert.ok(response.headers['content-type'].includes(mime), url + ' tipo MIME correto');
            assert.equal(response.headers['cache-control'], 'no-store, max-age=0',
                url + ' nao pode manter versoes antigas por um ano');
            assert.ok(response.headers.etag, 'arquivos estaticos devem manter ETag');
        }

        const head = await get(port, '/vendor/bootstrap/css/bootstrap.min.css', 'HEAD');
        assert.equal(head.status, 200);
        assert.equal(head.body.length, 0, 'HEAD nao devolve corpo');
        assert.equal(head.headers['cache-control'], 'no-store, max-age=0');

        const main = await get(port, '/dist/assets/main.js');
        assert.equal(main.status, 200);
        assert.equal(main.headers['cache-control'], 'no-store, max-age=0',
            'main.js preserva politica anterior');
        const chunk = await get(port, '/dist/assets/chunk-abc123.js');
        assert.equal(chunk.status, 200);
        assert.ok(Number(/max-age=(\d+)/.exec(chunk.headers['cache-control'])?.[1]) > 30000000,
            'chunks com hash mantem cache longo');
        assert.match(chunk.headers['cache-control'], /immutable/);
        const other = await get(port, '/vendor-other/file.js');
        assert.match(other.headers['cache-control'], /immutable/,
            'apenas /vendor/ e nao diretorios com nomes parecidos');

        const notFound = await get(port, '/vendor/chart.js/nao-existe.js');
        assert.equal(notFound.status, 404, 'biblioteca inexistente nao pode aparentar sucesso');
        console.log('✅ Vendor HTTP: Bootstrap/Chart servidos, MIME, bytes, cache e 404 corretos');
    } catch (error) {
        console.error('❌ Falha no smoke HTTP de vendor:', error);
        process.exitCode = 1;
    } finally {
        if (server && server.listening) {
            await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
        }
        fs.rmSync(root, { recursive: true, force: true });
    }
})();
