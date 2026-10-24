'use strict';

/**
 * Testes para codeValidator.js
 * Execute: node src/core/codeValidator.test.js
 */

const {
    validateCode,
    validateXml,
    validateCss,
    validateJs,
    extractCodeBlocks,
    validateResponseBlocks,
} = require('./codeValidator');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) {
        console.log(`  ✓ ${label}`);
        passed++;
    } else {
        console.error(`  ✗ ${label}${extra ? ' — ' + extra : ''}`);
        failed++;
    }
}

// ─── XML ──────────────────────────────────────────────────────────────────────
console.log('\n[XML]');

assert('void element self-closed — ok',
    validateXml('<img src="x.png"/>').ok);

assert('void element NOT self-closed — erro',
    !validateXml('<div><img src="x.png"></div>').ok);

assert('elemento sem fechar — erro',
    !validateXml('<div><p>texto</div>').ok);

assert('fragmento multi-elemento — ok',
    validateXml('<h1>Título</h1><p>Parágrafo</p>').ok);

assert('XML completo válido — ok',
    validateXml('<section><article><h2>Post</h2><br/></article></section>').ok);

assert('attribute sem aspas (XML inválido) — erro',
    !validateXml('<img src=foto.jpg/>').ok);

// ─── CSS ──────────────────────────────────────────────────────────────────────
console.log('\n[CSS]');

assert('regra simples — ok',
    validateCss('.foo { color: red; }').ok);

assert('múltiplas regras — ok',
    validateCss('.a { color: red; } .b { margin: 0; }').ok);

assert('chave { sem fechar — erro',
    !validateCss('.foo { color: red;').ok);

assert('} sem { correspondente — erro',
    !validateCss('.foo } color: red; }').ok);

assert('aspas duplas não balanceadas — erro',
    !validateCss('.foo { content: "abc; }').ok);

assert('media query válida — ok',
    validateCss('@media (max-width:768px) { .col { width:100%; } }').ok);

assert('comment removido antes de validar — ok',
    validateCss('/* este bloco { não conta */ .foo { color: red; }').ok);

// ─── JS ───────────────────────────────────────────────────────────────────────
console.log('\n[JS]');

assert('função simples — ok',
    validateJs('function foo() { return 1; }').ok);

assert('IIFE válida — ok',
    validateJs("(function(){ 'use strict'; var x = 1; })();").ok);

assert('arrow function — ok',
    validateJs('const fn = (a, b) => a + b;').ok);

assert('parêntese não fechado — erro',
    !validateJs('function foo( { return 1; }').ok);

assert('objeto mal-formado — erro',
    !validateJs('var x = {a: 1, b:;').ok);

assert('template literal válido — ok',
    validateJs('const s = `hello ${name}`;').ok);

// DOM é sintaxe válida (validateJs não executa)
assert('código com document.querySelector — ok (sintaxe válida, não executa)',
    validateJs("document.querySelector('.foo').style.color = 'red';").ok);

// ─── extractCodeBlocks ────────────────────────────────────────────────────────
console.log('\n[extractCodeBlocks]');

const md = `
Aqui está o código:

\`\`\`css
.foo { color: red; }
\`\`\`

E o JavaScript:

\`\`\`js
function bar() { return 42; }
\`\`\`

E XML sem linguagem declarada:

\`\`\`
<div><p>teste</p></div>
\`\`\`
`;

const blocks = extractCodeBlocks(md);
assert('extrai 3 blocos', blocks.length === 3, `extraiu ${blocks.length}`);
assert('primeiro bloco é css', blocks[0].lang === 'css');
assert('segundo bloco é js', blocks[1].lang === 'js');
assert('terceiro bloco sem lang', blocks[2].lang === null);

// ─── validateResponseBlocks ───────────────────────────────────────────────────
console.log('\n[validateResponseBlocks]');

const respOk = `
Aqui o snippet:
\`\`\`js
function soma(a, b) { return a + b; }
\`\`\`
\`\`\`css
.container { max-width: 1200px; margin: 0 auto; }
\`\`\`
`;
const r1 = validateResponseBlocks(respOk);
assert('resposta com dois blocos válidos — allOk true', r1.allOk, JSON.stringify(r1.results));

const respBad = `
Veja o CSS:
\`\`\`css
.foo { color: red;
\`\`\`
`;
const r2 = validateResponseBlocks(respBad);
assert('resposta com CSS inválido — allOk false', !r2.allOk, JSON.stringify(r2.results));
assert('captura o erro de chave', r2.results[0].errors.length > 0);

// ─── validateCode dispatcher ──────────────────────────────────────────────────
console.log('\n[validateCode dispatcher]');

assert('lang=xml roteia para XML', validateCode('<br/>', 'xml').type === 'xml');
assert('lang=html roteia para xml', validateCode('<br/>', 'html').type === 'xml');
assert('lang=css roteia para CSS', validateCode('.a{}', 'css').type === 'css');
assert('lang=js roteia para JS', validateCode('var x=1;', 'js').type === 'js');
assert('lang=javascript roteia para JS', validateCode('var x=1;', 'javascript').type === 'js');
assert('lang desconhecida — skipped true', validateCode('alguma coisa', 'python').skipped === true);
assert('lang null — skipped true', validateCode('alguma coisa', null).skipped === true);

// ─── SUMÁRIO ─────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Resultado: ${passed} passaram, ${failed} falharam`);
if (failed > 0) process.exit(1);
