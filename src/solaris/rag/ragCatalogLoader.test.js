'use strict';

/**
 * Testes de ragCatalogLoader.js — lê o catálogo real de src/solaris/rag/
 * (arquivos JSON populados diretamente no repositório), sem mocks.
 *
 * Execute: node src/solaris/rag/ragCatalogLoader.test.js
 */

const { carregarCatalogo, buscarCategoria, resumirParaPrompt } = require('./ragCatalogLoader');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

function run() {
    // A. carregarCatalogo lê os arquivos reais de categoria sem derrubar
    // nada. Sem número fixo — o catálogo é populado diretamente no
    // repositório fora desta sessão, cresce com frequência; trava só num
    // piso conhecido (12 categorias de projeto + 6 de framework/tecnologia
    // já confirmadas nesta suíte, "fkask-1.json" sem campo "id" propositalmente
    // não conta — ver teste J) pra não quebrar a cada arquivo novo.
    {
        const catalogo = carregarCatalogo({ forcarRecarga: true });
        assert('carregarCatalogo retorna array', Array.isArray(catalogo));
        assert('carregarCatalogo encontrou pelo menos as 20 categorias conhecidas', catalogo.length >= 20, `encontrou ${catalogo.length}`);
        assert('toda entrada tem id', catalogo.every((e) => typeof e.id === 'string' && e.id.length > 0));
        assert('.gitkeep foi ignorado (não é json)', !catalogo.some((e) => e._arquivo === '.gitkeep'));

        const idsEsperados = ['agencia-digital', 'blog', 'clinica-medica', 'dashboard-admin', 'documentacao', 'ecommerce', 'escola-online', 'evento', 'landing-page', 'portfolio', 'restaurante', 'saas', 'bootstrap5', 'css3', 'django', 'ejs', 'flask', 'php', 'html5', 'flask-saas-glassmorphism'];
        const idsEncontrados = catalogo.map((e) => e.id);
        for (const id of idsEsperados) {
            assert(`categoria "${id}" está no catálogo`, idsEncontrados.includes(id));
        }
    }

    // B. cache — 2ª chamada sem forcarRecarga não relê o disco (mesma referência).
    {
        const c1 = carregarCatalogo();
        const c2 = carregarCatalogo();
        assert('carregarCatalogo cacheia (mesma referência)', c1 === c2);
    }

    // C. buscarCategoria acha "blog" por keyword derivada do id (Blog não tem
    // prompt_keywords/keywords próprio — só _keywordsDerivadas de id/slug/titulo).
    {
        const r = buscarCategoria('quero criar um blog de culinária pra postar receitas toda semana');
        assert('buscarCategoria acha "blog" via keyword derivada', r && r.id === 'blog', r ? r.id : 'null');
    }

    // D. buscarCategoria acha "landing-page" via prompt_keywords explícito.
    {
        const r = buscarCategoria('preciso de uma landing page de vendas pro meu produto novo, focada em conversão');
        assert('buscarCategoria acha "landing-page" via prompt_keywords', r && r.id === 'landing-page', r ? r.id : 'null');
    }

    // E. buscarCategoria acha "portfolio" via keywords explícito.
    {
        const r = buscarCategoria('sou freelancer designer e quero um portfolio pra mostrar meus trabalhos');
        assert('buscarCategoria acha "portfolio" via keywords', r && r.id === 'portfolio', r ? r.id : 'null');
    }

    // F. buscarCategoria acha "saas" via keyword derivada de categoria/titulo.
    {
        const r = buscarCategoria('quero uma landing page pra um saas de gestão financeira com planos e preços');
        assert('buscarCategoria acha uma categoria plausível (saas ou landing-page)', r && (r.id === 'saas' || r.id === 'landing-page'), r ? r.id : 'null');
    }

    // G. buscarCategoria sem match nenhum retorna null (não força uma categoria errada).
    {
        const r = buscarCategoria('xyzabc123 nada a ver com nenhuma categoria conhecida qwerty');
        assert('buscarCategoria sem match retorna null', r === null);
    }

    // H. buscarCategoria com texto vazio/inválido retorna null sem lançar.
    {
        assert('buscarCategoria("") retorna null', buscarCategoria('') === null);
        assert('buscarCategoria(null) retorna null', buscarCategoria(null) === null);
        assert('buscarCategoria(123) retorna null', buscarCategoria(123) === null);
    }

    // I. resumirParaPrompt remove campos internos do loader e as próprias
    // listas de keyword (já cumpriram o papel delas no match).
    {
        const entrada = buscarCategoria('landing page de vendas conversão');
        const resumo  = resumirParaPrompt(entrada);
        assert('resumirParaPrompt remove _arquivo', !('_arquivo' in resumo));
        assert('resumirParaPrompt remove _keywords', !('_keywords' in resumo));
        assert('resumirParaPrompt remove prompt_keywords', !('prompt_keywords' in resumo));
        assert('resumirParaPrompt preserva componentes', Array.isArray(resumo.componentes) && resumo.componentes.length > 0);
        assert('resumirParaPrompt preserva id', resumo.id === 'landing-page');
    }

    // J. resumirParaPrompt(null) não lança.
    {
        assert('resumirParaPrompt(null) retorna null', resumirParaPrompt(null) === null);
    }

    // K. fkask-1.json (achado real: chegou sem campo "id", formato diferente
    // dos outros arquivos de catálogo) foi normalizado a pedido do usuário —
    // virou flask-saas-glassmorphism.json, com id/slug/titulo/categoria
    // preenchidos, mesmo conteúdo original preservado (framework/nicho/
    // design/cores/componentes/arquivos/validadores).
    {
        const catalogo = carregarCatalogo();
        assert('fkask-1.json não existe mais no catálogo', !catalogo.some((e) => e._arquivo === 'fkask-1.json'));
        const preset = catalogo.find((e) => e.id === 'flask-saas-glassmorphism');
        assert('flask-saas-glassmorphism entrou no catálogo (tinha "id" agora)', !!preset);
        assert('flask-saas-glassmorphism preserva o conteúdo original', preset && preset.framework === 'flask' && preset.nicho === 'saas' && preset.design === 'glassmorphism');
    }

    // L. buscarCategoria acha as novas categorias de framework/tecnologia
    // via keyword derivada de id/slug (nenhuma delas tem prompt_keywords/
    // keywords próprio ainda). "flask" sozinho é ambíguo de propósito —
    // tanto flask.json (referência) quanto flask-saas-glassmorphism.json
    // (preset) derivam a keyword "flask" do próprio id/slug com o mesmo
    // peso; só quando o pedido combina mais de um sinal (ver teste M) o
    // preset se destaca de verdade.
    {
        assert('buscarCategoria acha "bootstrap5"', buscarCategoria('quero usar bootstrap5 no meu projeto').id === 'bootstrap5');
        const rFlask = buscarCategoria('prefiro fazer o backend em flask');
        assert('buscarCategoria acha alguma entrada de flask (referência ou preset)', rFlask && (rFlask.id === 'flask' || rFlask.id === 'flask-saas-glassmorphism'), rFlask ? rFlask.id : 'null');
        assert('buscarCategoria acha "php"', buscarCategoria('meu backend vai ser em php').id === 'php');
        assert('buscarCategoria acha "html5"', buscarCategoria('quero só html5 puro, sem framework nenhum').id === 'html5');
    }

    // M. buscarCategoria prioriza o preset flask-saas-glassmorphism quando o
    // pedido combina os 3 sinais específicos dele (framework + nicho +
    // estilo) — score mais alto que qualquer entrada de sinal único.
    {
        const r = buscarCategoria('quero um saas em flask com visual glassmorphism');
        assert('buscarCategoria prioriza o preset com sinal combinado', r && r.id === 'flask-saas-glassmorphism', r ? r.id : 'null');
    }

    // N. buscarCategoria — desempate de score entre referência de framework
    // e entrada de tópico (achado real ao escalar o catálogo com os 20
    // tópicos gerados de bootstrap5, ver rag/ragTopicMatrix.js). Pedido
    // genérico (só o nome do framework) acha a REFERÊNCIA, nunca um tópico
    // aleatório escolhido por ordem de arquivo; pedido que também cita o
    // tópico específico acha o TÓPICO (score estritamente maior, não empate).
    {
        const rGenerico = buscarCategoria('quero fazer meu site com bootstrap5');
        assert('pedido genérico de bootstrap5 acha a referência do framework', rGenerico && rGenerico.id === 'bootstrap5', rGenerico ? rGenerico.id : 'null');

        const rEspecifico = buscarCategoria('preciso de um accordion de faq em bootstrap5');
        assert('pedido específico de accordion acha o tópico certo', rEspecifico && rEspecifico.id === 'bootstrap5-accordion', rEspecifico ? rEspecifico.id : 'null');
    }

    // N. flask2.json/flask3.json (achado real: chegaram em formato de
    // artigo/tutorial, sem campo "id", estrutura bem diferente do resto
    // do catálogo) foram movidos pra rag/drafts/ — carregarCatalogo lê o
    // diretório sem quebrar (subdiretório é filtrado por
    // listarArquivosDeCatalogo) e o conteúdo deles nunca entra no catálogo.
    {
        const catalogo = carregarCatalogo({ forcarRecarga: true });
        assert('catalogo não inclui nada de drafts/', !catalogo.some((e) => e._arquivo === 'flask2.json' || e._arquivo === 'flask3.json'));
        assert('carregarCatalogo não lança com rag/drafts/ presente', Array.isArray(catalogo));
    }
}

run();
console.log(`\n${failed === 0 ? '✅' : '❌'} ragCatalogLoader: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
