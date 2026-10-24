'use strict';

/**
 * Testes de ragEntryGenerator.js — modelRouter é um fake injetado
 * (nunca bate na API real do Gemini), mesmo padrão de
 * llm/modelRouter.test.js.
 *
 * Execute: node src/solaris/rag/ragEntryGenerator.test.js
 */

const { gerarEntradaCatalogo } = require('./ragEntryGenerator');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

function fakeModelRouter(respostaJson) {
    return {
        async executarTriagem({ prompt, responseSchema }) {
            fakeModelRouter.ultimoPrompt = prompt;
            fakeModelRouter.ultimoSchema = responseSchema;
            return typeof respostaJson === 'string' ? respostaJson : JSON.stringify(respostaJson);
        },
    };
}

async function run() {
    // A. gerarEntradaCatalogo monta id/slug corretos e preserva o resto
    // do que o modelo devolveu.
    {
        const modelRouter = fakeModelRouter({
            categoria: 'topico',
            descricao: 'O componente Accordion do Bootstrap 5 organiza conteúdo em painéis expansíveis.',
            componentes: ['accordion-item', 'accordion-button', 'data-bs-toggle'],
            keywords: ['sanfona', 'collapse', 'faq'],
        });
        const entrada = await gerarEntradaCatalogo({ grupo: 'bootstrap5', topico: 'accordion', modelRouter });

        assert('id computado corretamente', entrada.id === 'bootstrap5-accordion');
        assert('slug igual ao id', entrada.slug === 'bootstrap5-accordion');
        assert('categoria preservada', entrada.categoria === 'topico');
        assert('descricao preservada', entrada.descricao.includes('Accordion'));
        assert('componentes preservados', Array.isArray(entrada.componentes) && entrada.componentes.length === 3);
        assert('titulo default presente', typeof entrada.titulo === 'string' && entrada.titulo.length > 0);
    }

    // B. id/slug do prompt são forçados mesmo se o modelo devolver algo
    // divergente (nunca confia cegamente no "slug" da resposta).
    {
        const modelRouter = fakeModelRouter({
            slug: 'algo-totalmente-diferente',
            categoria: 'topico',
            descricao: 'Descrição qualquer com mais de trinta caracteres pra passar no mínimo.',
            componentes: ['x'],
            keywords: [],
        });
        const entrada = await gerarEntradaCatalogo({ grupo: 'html5', topico: 'canvas', modelRouter });
        assert('id forçado ignora "slug" divergente da resposta', entrada.id === 'html5-canvas');
        assert('slug forçado ignora "slug" divergente da resposta', entrada.slug === 'html5-canvas');
    }

    // C. prompt enviado ao modelo cita o grupo e o tópico específicos.
    {
        const modelRouter = fakeModelRouter({ categoria: 'topico', descricao: 'x'.repeat(40), componentes: ['a'], keywords: [] });
        await gerarEntradaCatalogo({ grupo: 'django', topico: 'middleware', modelRouter });
        assert('prompt cita o grupo', fakeModelRouter.ultimoPrompt.includes('django'));
        assert('prompt cita o tópico', fakeModelRouter.ultimoPrompt.includes('middleware'));
        assert('schema de resposta foi passado (JSON mode)', !!fakeModelRouter.ultimoSchema);
    }

    // D. resposta com JSON inválido lança erro explícito (não retorna
    // objeto quebrado silenciosamente).
    {
        const modelRouter = fakeModelRouter('isso não é json{{{');
        let lancou = false;
        try {
            await gerarEntradaCatalogo({ grupo: 'php', topico: 'routing', modelRouter });
        } catch (err) {
            lancou = true;
            assert('erro menciona o id do tópico', err.message.includes('php-routing'));
        }
        assert('JSON inválido do modelo lança erro', lancou);
    }

    // E. parâmetros obrigatórios ausentes lançam erro cedo, sem chamar o modelo.
    {
        let chamouModelo = false;
        const modelRouter = { async executarTriagem() { chamouModelo = true; return '{}'; } };

        let lancouGrupo = false;
        try { await gerarEntradaCatalogo({ topico: 'x', modelRouter }); } catch (_) { lancouGrupo = true; }
        assert('sem grupo: lança antes de chamar o modelo', lancouGrupo && !chamouModelo);

        let lancouTopico = false;
        try { await gerarEntradaCatalogo({ grupo: 'php', modelRouter }); } catch (_) { lancouTopico = true; }
        assert('sem topico: lança antes de chamar o modelo', lancouTopico && !chamouModelo);

        let lancouRouter = false;
        try { await gerarEntradaCatalogo({ grupo: 'php', topico: 'x' }); } catch (_) { lancouRouter = true; }
        assert('sem modelRouter: lança', lancouRouter);
    }

    console.log(`\n${failed === 0 ? '✅' : '❌'} ragEntryGenerator: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
}

run();
