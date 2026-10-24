'use strict';

/**
 * Testes de pythonWorker.js — bate no python3 real (via shell-out), não
 * mocka o processo. Se python3 não estiver instalado neste ambiente, o
 * Worker degrada pra ok:true com aviso explícito (ver comentário do
 * Worker) — os testes cobrem os dois caminhos.
 *
 * Execute: node src/solaris/workers/pythonWorker.test.js
 */

const { validarPy } = require('./pythonWorker');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// A. Python válido (Flask) — sem erro.
{
    const r = validarPy('from flask import Flask\napp = Flask(__name__)\n\n@app.route("/")\ndef home():\n    return "oi"\n');
    assert('Python válido: ok true', r.ok === true, JSON.stringify(r));
    assert('Python válido: zero erros', r.erros.length === 0);
}

// B. Python vazio/não-string vira erro (não lança).
{
    const r = validarPy('');
    assert('Python vazio: ok false, sem lançar', r.ok === false && r.erros.length > 0);
}
{
    const r = validarPy(null);
    assert('Python não-string: ok false, sem lançar', r.ok === false);
}
{
    const r = validarPy('   \n  ');
    assert('Python só espaço em branco: ok false', r.ok === false);
}

// C. sintaxe quebrada vira erro (SyntaxError do próprio Python na mensagem).
{
    const r = validarPy('def foo(\n    return 1\n');
    assert('sintaxe quebrada: ok false', r.ok === false, JSON.stringify(r));
    assert('erro cita SyntaxError', /SyntaxError/.test(r.erros[0]), JSON.stringify(r.erros));
}

// D. indentação inconsistente (erro comum e específico de Python) também é pego.
{
    const r = validarPy('def foo():\nreturn 1\n');
    assert('indentação quebrada: ok false', r.ok === false, JSON.stringify(r));
}

// E. nunca lança, mesmo com entrada estranha (objeto em vez de string).
{
    let erro = null;
    let r = null;
    try { r = validarPy({}); } catch (e) { erro = e; }
    assert('entrada não-string nunca lança', erro === null);
    assert('entrada não-string vira ok:false', r && r.ok === false);
}

// F. python3 ausente do ambiente (ENOENT) degrada pra ok:true com aviso
// explícito — nunca finge que validou, nunca bloqueia a geração por causa
// de uma lacuna de ambiente que não tem a ver com o código em si (mesmo
// padrão de "sem Worker pro tipo ainda" do orchestrator.js).
{
    const pathOriginal = process.env.PATH;
    process.env.PATH = '/caminho-que-nao-existe-de-verdade';
    let r = null;
    let erro = null;
    try { r = validarPy('x = 1'); } catch (e) { erro = e; }
    process.env.PATH = pathOriginal;
    assert('python3 ausente: nunca lança', erro === null);
    assert('python3 ausente: degrada pra ok:true com aviso explícito', r && r.ok === true && /não encontrado/.test(r.avisos[0]), JSON.stringify(r));
}

// G. código muito grande é rejeitado antes mesmo de chegar no shell-out —
// defesa em profundidade contra payloads grandes de propósito malicioso
// (nenhum arquivo Python real gerado pelo Solaris chega perto desse
// tamanho).
{
    const codigoGrande = 'x = 1\n'.repeat(40000); // 6 bytes * 40000 = 240KB, acima do limite de 200KB
    const r = validarPy(codigoGrande);
    assert('código muito grande: ok false', r.ok === false, JSON.stringify(r).slice(0, 200));
    assert('código muito grande: erro cita tamanho máximo', r.erros.length > 0 && /tamanho máximo/.test(r.erros[0]), JSON.stringify(r.erros));
}

// H. timeout é distinguido de erro de sintaxe. Um teto de tempo
// artificialmente baixo (1ms) força o estouro, já que nem o spawn do
// processo python3 termina nesse intervalo — confirma que o Worker não
// confunde "estourou o tempo" com "erro de sintaxe" (branch dedicado,
// mensagem específica). Depende de python3 estar instalado no ambiente
// de teste, igual aos testes C e D acima.
{
    const r = validarPy('x = 1', 1);
    assert('timeout: ok false', r.ok === false, JSON.stringify(r));
    assert('timeout: erro cita tempo limite', r.erros.length > 0 && /tempo limite/.test(r.erros[0]), JSON.stringify(r.erros));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} pythonWorker: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
