'use strict';

/**
 * Testes de manifestSchema.js.
 * Execute: node src/solaris/manifest/manifestSchema.test.js
 */

const { validarManifesto, FRAMEWORKS_VALIDOS, TIPOS_ARQUIVO_VALIDOS } = require('./manifestSchema');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// A. manifesto válido passa e normaliza campos ausentes pra default seguro.
{
    const { ok, erros, manifesto } = validarManifesto({
        framework: 'bootstrap5',
        objetivo: 'Landing page pra academia online',
        arquivos: [{ caminho: 'index.html', tipo: 'html', descricao: 'Página inicial' }],
    });
    assert('manifesto mínimo válido passa', ok === true, erros.join(' | '));
    assert('paginas normalizado pra array vazio', Array.isArray(manifesto.paginas) && manifesto.paginas.length === 0);
    assert('dependencias normalizado pra array vazio', Array.isArray(manifesto.dependencias) && manifesto.dependencias.length === 0);
}

// B. framework inválido é bloqueante.
{
    const { ok, erros } = validarManifesto({ framework: 'wordpress', arquivos: [{ caminho: 'a.html', tipo: 'html', descricao: 'x' }] });
    assert('framework inválido bloqueia', ok === false);
    assert('erro menciona framework', erros.some((e) => e.includes('framework')));
}

// C. arquivos vazio/ausente é bloqueante.
{
    const { ok: ok1 } = validarManifesto({ framework: 'html5', arquivos: [] });
    assert('arquivos vazio bloqueia', ok1 === false);
    const { ok: ok2 } = validarManifesto({ framework: 'html5' });
    assert('arquivos ausente bloqueia', ok2 === false);
}

// D. arquivo individual sem caminho é descartado (aviso), não derruba o manifesto inteiro.
{
    const { ok, avisos, manifesto } = validarManifesto({
        framework: 'html5',
        arquivos: [
            { caminho: 'index.html', tipo: 'html', descricao: 'ok' },
            { tipo: 'css', descricao: 'sem caminho' },
        ],
    });
    assert('manifesto ainda válido com 1 arquivo bom', ok === true);
    assert('arquivo sem caminho descartado', manifesto.arquivos.length === 1);
    assert('aviso reporta o descarte', avisos.some((a) => a.includes('descartado')));
}

// E. tipo de arquivo inválido cai pra "outro" com aviso, não derruba nada.
{
    const { ok, avisos, manifesto } = validarManifesto({
        framework: 'html5',
        arquivos: [{ caminho: 'x.xyz', tipo: 'binario-esquisito', descricao: '' }],
    });
    assert('tipo inválido não bloqueia', ok === true);
    assert('tipo forçado pra outro', manifesto.arquivos[0].tipo === 'outro');
    assert('aviso reporta o tipo inválido', avisos.some((a) => a.includes('tipo inválido')));
}

// F. manifesto não-objeto é rejeitado sem lançar exceção.
{
    const { ok, erros } = validarManifesto(null);
    assert('null não lança, retorna ok:false', ok === false && erros.length > 0);
}

// G. enums exportados batem com o schema Gemini.
assert('FRAMEWORKS_VALIDOS não vazio', FRAMEWORKS_VALIDOS.length > 0);
assert('TIPOS_ARQUIVO_VALIDOS não vazio', TIPOS_ARQUIVO_VALIDOS.length > 0);

console.log(`\n${failed === 0 ? '✅' : '❌'} manifestSchema: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
