'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { auditarBranding } = require('../../scripts/check-frontend-branding');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'softload-branding-'));
const write = (name, content) => {
    const absolute = path.join(root, name);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
};
try {
    const initial = auditarBranding(root);
    assert.equal(initial.scanned, 0);
    assert.deepEqual(initial.violations, [], 'diretorios opcionais ausentes nao falham');
    write('views/partials/hero.ejs', 'Bem-vindo à Softload Engine');
    write('views/pages/home.ejs', '<h1>Bem-vindo</h1>');
    write('public/css/style.css', '.button { display: block; }');
    write('public/js/telemetry.js', 'const model = "gemini";');
    const clean = auditarBranding(root);
    assert.equal(clean.scanned, 4, 'RAG .js nao entra na varredura e diretórios são opcionais');
    assert.deepEqual(clean.violations, []);

    write('views/partials/hero.ejs', 'Bem-vindo\nPlataforma GPT\nModelo IA Avançada');
    write('views/pages/home.ejs', 'Antes\n<script>const brand="Chat GPT";</script>');
    write('public/js/demo.js', 'const model="gpt-5.4"');
    write('src/routes/adminRoutes.js', 'const internal = "ChatGPT";');
    const blocked = auditarBranding(root);
    assert.ok(blocked.violations.some(v => v.includes('hero.ejs:2: rótulo antigo GPT')));
    assert.ok(blocked.violations.some(v => v.includes('hero.ejs:3: modelo indisponível')));
    assert.ok(blocked.violations.some(v => v.includes('home.ejs:2: Chat GPT')));
    assert.ok(blocked.violations.some(v => v.includes('public/js/demo.js:1: modelo indisponível')));
    assert.ok(blocked.violations.some(v => v.includes('src/routes/adminRoutes.js:1: ChatGPT')));
    const again = auditarBranding(root);
    assert.deepEqual(again.violations, blocked.violations, 'regex global reiniciada entre varreduras');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
console.log('✅ branding TypeScript: scan recursivo, UI, bundle, RAG JSON e linhas de erro');
