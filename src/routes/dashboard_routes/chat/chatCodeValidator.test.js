'use strict';

/**
 * Testes para chatCodeValidator.js — reparo determinístico antes do retry IA
 * Execute: node src/routes/dashboard_routes/chat/chatCodeValidator.test.js
 *
 * IMPORTANTE: só exercita caminhos que resolvem SEM chamada de rede (o
 * reparo determinístico, ou o "sem erro"/"sem reparo aplicável"). O caminho
 * de retry por IA (gerarChatStream/gerarChatGptStream) não é testado aqui —
 * exigiria credenciais de API reais; ver o comentário no fim do arquivo.
 */

const { _validarECorrigir, _tentarReparoDeterministico } = require('./chatCodeValidator');
const { validateCode } = require('../../../core/codeValidator');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

(async () => {
    // ── _tentarReparoDeterministico — CSS ───────────────────────────────────
    {
        const quebrado = '.a{color:red;';
        const v = validateCode(quebrado, 'css');
        const reparado = _tentarReparoDeterministico(quebrado, v.type, v.errors);
        assert('CSS com 1 chave sem fechar é reparado', reparado !== null);
        assert('CSS reparado valida limpo', reparado && validateCode(reparado, 'css').ok);
    }
    {
        // Aspas desbalanceadas junto com chave aberta — corrupção mais profunda,
        // reparo automático deliberadamente NÃO tenta (arriscaria CSS errado).
        const quebrado = ".a{color:'red;";
        const v = validateCode(quebrado, 'css');
        const reparado = _tentarReparoDeterministico(quebrado, v.type, v.errors);
        assert('CSS com aspas desbalanceadas NÃO é reparado automaticamente', reparado === null);
    }
    {
        const ok = '.a{color:red;}';
        const v = validateCode(ok, 'css');
        assert('CSS válido não reporta erro (sanity check)', v.ok);
    }

    // ── _tentarReparoDeterministico — XML/HTML ──────────────────────────────
    {
        // Corrupção histórica documentada no repairEngine (Regra 0): um bug já
        // corrigido no motor de compilação, mas que a IA às vezes ainda produz
        // ao "lembrar" de um padrão antigo em snippets soltos do chat.
        const quebrado = "<b:loop=\"loop\" var='p' values='data:posts'><span>x</span></b:loop>";
        const v = validateCode(quebrado, 'html');
        assert('b:loop="loop" corrompido é detectado como erro (sanity check)', !v.ok);
        const reparado = _tentarReparoDeterministico(quebrado, v.type, v.errors);
        assert('b:loop="loop" é reparado para <b:loop', reparado !== null && reparado.startsWith("<b:loop var="));
        assert('HTML reparado valida limpo', reparado && validateCode(reparado, 'html').ok);
    }
    {
        // XML genuinamente malformado (tag nunca fechada) — nenhuma das 8
        // regras do repairEngine cobre isso; reparo não resolve (total=0 ou
        // recheck continua falhando) e o caller deve cair pro retry IA.
        const quebrado = '<div><span>texto sem fechar';
        const v = validateCode(quebrado, 'html');
        assert('tag não fechada é detectada como erro (sanity check)', !v.ok);
        const reparado = _tentarReparoDeterministico(quebrado, v.type, v.errors);
        if (reparado !== null) {
            assert('se repairEngine mexeu no XML irreparável, ainda falha a revalidação', !validateCode(reparado, 'html').ok);
        } else {
            assert('XML irreparável retorna null (nenhuma das 8 regras se aplica)', true);
        }
    }

    // ── _tentarReparoDeterministico — JS não tem reparo determinístico ──────
    {
        const quebrado = 'function f( { return 1; }';
        const v = validateCode(quebrado, 'js');
        const reparado = _tentarReparoDeterministico(quebrado, v.type, v.errors);
        assert('JS nunca tenta reparo determinístico (retorna null)', reparado === null);
    }

    // ── _validarECorrigir — fim a fim, só caminhos sem chamada de rede ──────
    {
        const sendEvents = [];
        const sendEvent = e => sendEvents.push(e);
        const fullText = 'Aqui está o CSS:\n```css\n.sl-hero{color:red;\n```\nPronto!';
        const { finalText, validation } = await _validarECorrigir(fullText, 'gera um css', false, {}, sendEvent);

        assert('validation.fixApplied true no reparo determinístico', validation.fixApplied === true);
        assert('validation.fixMethod é "deterministico"', validation.fixMethod === 'deterministico');
        assert('validation.retried permanece false (não gastou chamada de IA)', validation.retried === false);
        assert('finalText contém o CSS corrigido (chave fechada)', finalText.includes('}'));
        assert('evento code_patch foi emitido com method deterministico',
            sendEvents.some(e => e.type === 'code_patch' && e.method === 'deterministico'));
        assert('NÃO emitiu o status "Corrigindo código..." (pulou o caminho de IA)',
            !sendEvents.some(e => e.type === 'status' && e.label === 'Corrigindo código...'));
    }
    {
        const fullText = 'Sem nenhum bloco de código aqui.';
        const { finalText, validation } = await _validarECorrigir(fullText, 'oi', false, {}, () => {});
        assert('texto sem blocos de código não é alterado', finalText === fullText);
        assert('validation.checked é 0', validation.checked === 0);
    }
    {
        const fullText = 'Código ok:\n```css\n.a{color:red;}\n```\n';
        const { finalText, validation } = await _validarECorrigir(fullText, 'gera um css', false, {}, () => {});
        assert('bloco válido não é tocado', finalText === fullText);
        assert('validation.ok true quando não há erro', validation.ok === true);
    }

    console.log(`\n${failed === 0 ? '✅' : '❌'} chatCodeValidator: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
})();

// NOTA: o caminho de retry por IA (quando o reparo determinístico não
// resolve — ex.: erro de sintaxe JS, ou XML irreparável pelas 8 regras do
// repairEngine) não é coberto aqui porque chama gerarChatStream/
// gerarChatGptStream de verdade, exigindo GEMINI_API_KEY/OPENAI_API_KEY.
// Esse caminho é o comportamento PRÉ-EXISTENTE (inalterado por esta
// mudança) — a superfície nova é inteiramente a função
// _tentarReparoDeterministico, testada acima em isolamento.
