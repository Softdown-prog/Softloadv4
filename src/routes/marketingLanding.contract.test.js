'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ejs = require('ejs');

const root = path.resolve(__dirname, '../..');
function read(relative) { return fs.readFileSync(path.join(root, relative), 'utf8'); }
function render(relative, locals) {
  return new Promise((resolve, reject) => ejs.renderFile(path.join(root, relative),
    { gitSha:'design-check', user:null, ...locals }, {},
    (error, html) => error ? reject(error) : resolve(html)));
}

test('landing comercial renderiza com identidade própria e sem React', async () => {
  const html = await render('views/pages/landing-blogger.ejs');
  assert.match(html, /class="sl-blogger-marketing"/);
  assert.match(html, /blogger-marketing\.css\?v=design-check/);
  assert.match(html, /property="og:title"/);
  for (const id of ['conteudo','recursos','como-funciona','planos','duvidas'])
    assert.match(html, new RegExp('id="' + id + '"'));
  assert.match(html, /href="\/criar"/);
  assert.match(html, /Experimentar gratuitamente/);
  assert.match(html, /Prévia ilustrativa/);
  assert.match(html, /R\$ 5,00/);
  assert.match(html, /homologação do checkout/);
  assert.doesNotMatch(html, /id="react-root"|\/dist\/assets\/main\.js|Solaris Code|Workspace/);
});

test('o CSS comercial permanece escopado e responsivo, sem CDN nem assets externos', () => {
  const css = read('public/css/blogger-marketing.css');
  assert.match(css, /body\.sl-blogger-marketing/);
  assert.match(css, /\.sl-market \.hero-grid/);
  assert.match(css, /@media\(max-width:560px\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /@import|url\(https?:/);
});

test('telas internas não recebem o CSS comercial e rodapé mantém acesso público', async () => {
  const login = await render('views/pages/auth-simples.ejs', { authMode:'login' });
  assert.doesNotMatch(login, /blogger-marketing\.css|class="sl-blogger-marketing"/);
  assert.match(login, /Acesse seus templates/);
  const footer = read('views/partials/footer-blogger.ejs');
  assert.match(footer, /href="\/"/);
  assert.match(footer, /href="\/criar"/);
  assert.doesNotMatch(footer, /href="\/dashboard" class="fw-black/);
  const contact = read('views/pages/contato.ejs');
  assert.doesNotMatch(contact, /Solaris Code|Workspace/);
});


test('released landing advertises the authorized single payment without pending-release copy', async () => {
  const html = await render('views/pages/landing-blogger.ejs', {bloggerCheckoutEnabled:true, bloggerFilesEnabled:true});
  assert.match(html, /Contratar Essencial por R\$ 5/);
  assert.match(html, /href="\/dashboard\/plano-essencial"/);
  assert.match(html, /Pagamento único para 30 dias/);
  assert.doesNotMatch(html, /homologação do checkout|depois da homologação técnica/);
});
