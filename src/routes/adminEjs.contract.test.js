'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');
const root = path.resolve(__dirname, '../..');

function source(name) { return fs.readFileSync(path.join(root, name), 'utf8'); }
function render(adminSection) {
  return new Promise((resolve, reject) => {
    ejs.renderFile(path.join(root, 'views/pages/admin-simples.ejs'), {
      adminSection, activePage: 'admin', gitSha: 'test-sha',
      user: { uid: 'admin-fixture', is_super_admin: true, email: 'admin@example.test' }
    }, {}, (error, html) => error ? reject(error) : resolve(html));
  });
}

test('admin continua protegido pelo mesmo guard e entrega EJS nativo em todas as páginas', () => {
  for (const pathName of ['src/routes/adminRoutes.ts', 'src/routes/adminRoutes.js']) {
    const code = source(pathName);
    for (const [route, section] of [
      ['/eu', 'inicio'], ['/eu/usuarios', 'usuarios']
    ]) {
      assert.ok(code.includes("router.get('" + route + "', exigirSuperAdmin"), route + ' requer super-admin');
      assert.ok(code.includes("res.render('pages/admin-simples', { adminSection: '" + section + "'"),
        'Render administrativo EJS: ' + section);
    }
    assert.doesNotMatch(code, /res\.render\('pages\/react-admin'\)/);
    assert.match(code, /router\.post\('\/eu\/api\/usuario\/:email\/premium'/);
    assert.doesNotMatch(code, /creditService|billingRecoveryMonitor|router\.get\('\/eu\/sol'/);
  }
  assert.equal(fs.existsSync(path.join(root, 'views/pages/react-admin.ejs')), false);
});

test('painel EJS oferece resumo, contas, analytics e aviso do chat aposentado sem bundle React', async () => {
  const checks = [
    ['inicio', /Resumo de operação/],
    ['usuarios', /Contas cadastradas/]
  ];
  for (const [section, expected] of checks) {
    const html = await render(section);
    assert.match(html, expected);
    assert.match(html, /\/js\/admin-simples\.js\?v=test-sha/);
    assert.match(html, /noindex, follow/);
    assert.doesNotMatch(html, /\/dist\/assets\/main\.js|id="react-root"/);
  }
  const injection = await render('<script>alert(1)</script>');
  assert.doesNotMatch(injection, /data-admin-section="<script>/);
  assert.match(injection, /&lt;script&gt;/);
});

test('carregamento de dados administrativos é só leitura e escreve texto sem HTML arbitrário', () => {
  const browser = source('public/js/admin-simples.js');
  assert.match(browser, /credentials:\s*'same-origin'/);
  assert.match(browser, /textContent/);
  assert.match(browser, /replaceChildren\(\)/);
  assert.doesNotMatch(browser, /innerHTML|document\.write|method:\s*'(?:POST|PUT|PATCH|DELETE)'/);
  for (const endpoint of [
    '/eu/api/kpis', '/eu/api/usuarios?limit=50'
  ]) assert.ok(browser.includes(endpoint), 'Endpoint ausente: ' + endpoint);
});
