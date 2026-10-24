'use strict';

/**
 * Testes de ragTopicMatrix.js — matriz estática, sem I/O nem rede.
 *
 * Execute: node src/solaris/rag/ragTopicMatrix.test.js
 */

const { TOPICOS, listarGrupos, listarTopicos, idParaTopico } = require('./ragTopicMatrix');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

function run() {
    // A. listarGrupos retorna os 7 grupos esperados.
    {
        const grupos = listarGrupos();
        const esperados = ['bootstrap5', 'html5', 'css3', 'javascript', 'php', 'flask', 'django'];
        for (const g of esperados) {
            assert(`listarGrupos inclui "${g}"`, grupos.includes(g));
        }
        assert('listarGrupos: só os grupos esperados (nenhum extra)', grupos.length === esperados.length);
    }

    // B. listarTopicos retorna array não-vazio pra cada grupo válido,
    // e não deixa nenhum tópico repetido dentro do mesmo grupo.
    {
        for (const grupo of listarGrupos()) {
            const topicos = listarTopicos(grupo);
            assert(`listarTopicos("${grupo}") não é vazio`, Array.isArray(topicos) && topicos.length > 0);
            assert(`listarTopicos("${grupo}") sem duplicata`, new Set(topicos).size === topicos.length);
        }
    }

    // C. listarTopicos de grupo desconhecido retorna array vazio, não lança.
    {
        assert('listarTopicos("inexistente") retorna []', Array.isArray(listarTopicos('inexistente')) && listarTopicos('inexistente').length === 0);
    }

    // D. listarTopicos devolve cópia — mutar o retorno não afeta TOPICOS.
    {
        const t1 = listarTopicos('bootstrap5');
        t1.push('topico-fake');
        const t2 = listarTopicos('bootstrap5');
        assert('listarTopicos devolve cópia (não referência mutável)', !t2.includes('topico-fake'));
    }

    // E. idParaTopico monta "<grupo>-<topico>".
    {
        assert('idParaTopico("bootstrap5","accordion")', idParaTopico('bootstrap5', 'accordion') === 'bootstrap5-accordion');
        assert('idParaTopico("html5","web-components")', idParaTopico('html5', 'web-components') === 'html5-web-components');
    }

    // F. todo tópico de todo grupo já está em kebab-case (sem maiúscula/
    // acento/espaço) — a matriz em si tem que respeitar a mesma convenção
    // que ela vai exigir do resto do catálogo.
    {
        const kebabRegex = /^[a-z0-9]+(-[a-z0-9]+)*$/;
        for (const grupo of listarGrupos()) {
            for (const topico of listarTopicos(grupo)) {
                assert(`tópico "${grupo}/${topico}" está em kebab-case`, kebabRegex.test(topico));
            }
        }
    }

    // G. TOPICOS exportado bate com listarTopicos (fonte única).
    {
        assert('TOPICOS.django === listarTopicos("django")', JSON.stringify(TOPICOS.django) === JSON.stringify(listarTopicos('django')));
    }
}

run();
console.log(`\n${failed === 0 ? '✅' : '❌'} ragTopicMatrix: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
