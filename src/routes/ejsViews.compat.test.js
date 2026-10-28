'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const views = path.resolve(__dirname, '../../views');

function listEjs(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? listEjs(full) : full.endsWith('.ejs') ? [full] : [];
  });
}
function render(file, locals) {
  return new Promise((resolve, reject) => ejs.renderFile(file, locals, {}, (error, html) => error ? reject(error) : resolve(html)));
}

test('EJS v7 compiles all production views and partials', () => {
  const templates = listEjs(views);
  assert.ok(templates.length >= 17);
  for (const file of templates) {
    assert.doesNotThrow(() => ejs.compile(fs.readFileSync(file, 'utf8'), { filename: file }), file);
  }
});

test('EJS v7 renders React entry HTML and escapes user-controlled input', async () => {
  const html = await render(path.join(views, 'pages/react-public.ejs'), { gitSha: 'safe-sha' });
  assert.match(html, /id="react-root"/);
  assert.match(html, /main\.js\?v=safe-sha/);
  const safe = ejs.render('<%= content %>', { content: '<img src=x onerror=alert(1)>' });
  assert.doesNotMatch(safe, /<img/);
  assert.match(safe, /&lt;img/);
});

test('EJS v7 resolves production nested includes for 404 page', async () => {
  const html = await render(path.join(views, 'pages/404.ejs'), { gitSha: 'safe-sha', user: null });
  assert.match(html, /Página não encontrada/);
  assert.match(html, /Softload V4/);
  assert.match(html, /cookie-engine/);
  assert.match(html, /bootstrap\.bundle\.min\.js\?v=safe-sha/);
});
