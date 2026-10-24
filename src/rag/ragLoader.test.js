'use strict';

/**
 * Testes para ragLoader.js — roteamento e seleção com contexto de histórico
 * Execute: node src/rag/ragLoader.test.js
 */

const { rotearPergunta, loadForGeminiSync } = require('./ragLoader');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

const PIPELINE   = 'rag-ia-compiler/pipeline';
const SUPORTE    = 'rag-ia-suporte/suporte';
const IA_BALCAO  = 'rag-ia-suporte/ia-de-balcao';

// ── Roteamento sem histórico (comportamento existente preservado) ──────────
assert('criação clara → pipeline', rotearPergunta('quero criar um blog de receitas') === PIPELINE);
assert('suporte claro → suporte', rotearPergunta('meu adsense não aparece') === SUPORTE);
assert('template quebrou → suporte', rotearPergunta('meu template quebrou depois que editei') === SUPORTE);
assert('criar post → suporte', rotearPergunta('como criar um post no blogger?') === SUPORTE);
assert('smalltalk → suporte', rotearPergunta('oi, tudo bem?') === SUPORTE);

// ── Roteamento com histórico: refinamento herda pipeline ───────────────────
// Nome do site deliberadamente neutro — um nome como "PixelPlay" casaria o
// regex do tema pop-retro-pixel via fallback de histórico (recency-first).
const HIST_CRIACAO = ['quero criar um blog de games', 'o nome é Arena Bota BR'];
assert('refinamento "mais escuro" + histórico de criação → pipeline',
    rotearPergunta('prefiro mais escuro, tom vibrante', HIST_CRIACAO) === PIPELINE);
assert('refinamento "pode ser em tons claros" + histórico → pipeline',
    rotearPergunta('pode ser em tons mais claros', HIST_CRIACAO) === PIPELINE);
// Smalltalk NÃO herda a rota mesmo com histórico de criação
assert('smalltalk + histórico de criação → suporte (não herda)',
    rotearPergunta('obrigado, ficou ótimo!', HIST_CRIACAO) === SUPORTE);
// Refinamento sem histórico de criação não vira pipeline
assert('refinamento sem histórico → suporte',
    rotearPergunta('prefiro mais escuro, tom vibrante', ['meu adsense sumiu']) === SUPORTE);
assert('refinamento com histórico vazio → suporte',
    rotearPergunta('prefiro mais escuro, tom vibrante') === SUPORTE);
// Suporte explícito na mensagem atual SEMPRE ganha do histórico
assert('pergunta de suporte + histórico de criação → suporte',
    rotearPergunta('meu adsense não aparece', HIST_CRIACAO) === SUPORTE);

// ── Seleção de tema com fallback de histórico ──────────────────────────────
{
    // Confirmação sem nicho na mensagem atual: tema vem do histórico
    const r = loadForGeminiSync('pode gerar o template agora', { historico: HIST_CRIACAO });
    assert('confirmação carrega meta do tema via histórico',
        r.ficheirosCarregados.some(f => f.includes('tema-gamer-playerone-meta')),
        r.ficheirosCarregados.join(', '));
    assert('confirmação carrega impl do tema via histórico',
        r.ficheirosCarregados.some(f => f.includes('tema-gamer-playerone-impl')),
        r.ficheirosCarregados.join(', '));
}
{
    // Mensagem atual COM nicho ganha do histórico (mais recente manda)
    const r = loadForGeminiSync('na verdade quero um blog de culinária', {
        metaOnly: true, historico: HIST_CRIACAO,
    });
    assert('nicho na mensagem atual tem prioridade sobre o histórico',
        r.ficheirosCarregados.some(f => f.includes('tema-culinaria-boutique-gourmet-meta')),
        r.ficheirosCarregados.join(', '));
}
{
    // Histórico com dois nichos: o mais RECENTE ganha
    const r = loadForGeminiSync('pode gerar o template', {
        historico: ['quero um blog de games', 'mudei de ideia, prefiro um blog de culinária'],
    });
    assert('nicho mais recente do histórico ganha',
        r.ficheirosCarregados.some(f => f.includes('tema-culinaria-boutique-gourmet')),
        r.ficheirosCarregados.join(', '));
}
{
    // Sem histórico: comportamento antigo (sem tema) preservado
    const r = loadForGeminiSync('pode gerar o template agora');
    assert('sem histórico não carrega tema nenhum',
        !r.ficheirosCarregados.some(f => f.includes('/temas/')),
        r.ficheirosCarregados.join(', '));
}

// ── Integrações externas (chatbot/Worker) → ia-de-balcao ───────────────────
// Regressão: "ia.*no.*blog" sem \b explodia em falso positivo com "criar"
// (contém "ia" como substring) — "como criar um post no blogger?" caía
// aqui em vez de suporte.
assert('chatbot com IA → ia-de-balcao', rotearPergunta('como faço um chatbot com IA no meu blogger?') === IA_BALCAO);
assert('integrar Gemini via API → ia-de-balcao', rotearPergunta('quero integrar o Gemini no meu blog via API') === IA_BALCAO);
assert('cloudflare workers → ia-de-balcao', rotearPergunta('como usar cloudflare workers com blogger') === IA_BALCAO);
assert('criar post NÃO cai em ia-de-balcao (falso positivo do "ia" em "criar")',
    rotearPergunta('como criar um post no blogger?') === SUPORTE);
{
    const r = loadForGeminiSync('como faço um chatbot com IA no meu blogger?');
    assert('chatbot carrega o arquivo de integrações externas',
        r.ficheirosCarregados.some(f => f.includes('integracoes-externas/chatbot-gemini-worker.md')),
        r.ficheirosCarregados.join(', '));
}

// ── Automações via Worker (entrega digital, banco de dados, webhook) →
// ia-de-balcao, e seleciona o arquivo NOVO (workers-automacao-blogger.md),
// não o de chatbot — regressão pro roteamento de grupo/arquivo do RAG
// hierárquico não confundir os dois arquivos do mesmo grupo.
assert('entrega de item digital → ia-de-balcao',
    rotearPergunta('como fazer entrega automática de itens digitais no blogger') === IA_BALCAO);
assert('banco de dados → ia-de-balcao (não cai no "conectar.*blogger" genérico de suporte)',
    rotearPergunta('como conectar um banco de dados ao blogger') === IA_BALCAO);
assert('webhook → ia-de-balcao',
    rotearPergunta('como receber um webhook de pagamento no blogger') === IA_BALCAO);
{
    const r1 = loadForGeminiSync('como fazer entrega automática de itens digitais no blogger');
    assert('entrega digital carrega workers-automacao-blogger.md (não o de chatbot)',
        r1.ficheirosCarregados.some(f => f.includes('integracoes-externas/workers-automacao-blogger.md')),
        r1.ficheirosCarregados.join(', '));

    const r2 = loadForGeminiSync('como conectar um banco de dados ao blogger');
    assert('banco de dados carrega workers-automacao-blogger.md',
        r2.ficheirosCarregados.some(f => f.includes('integracoes-externas/workers-automacao-blogger.md')),
        r2.ficheirosCarregados.join(', '));

    const r3 = loadForGeminiSync('como receber um webhook de pagamento no blogger');
    assert('webhook carrega workers-automacao-blogger.md',
        r3.ficheirosCarregados.some(f => f.includes('integracoes-externas/workers-automacao-blogger.md')),
        r3.ficheirosCarregados.join(', '));

    // Chatbot continua indo pro arquivo certo mesmo com o novo arquivo no grupo
    const r4 = loadForGeminiSync('quero criar um chatbot de suporte com IA no meu blogger');
    assert('chatbot ainda carrega chatbot-gemini-worker.md (não o novo arquivo de automação)',
        r4.ficheirosCarregados.some(f => f.includes('integracoes-externas/chatbot-gemini-worker.md')),
        r4.ficheirosCarregados.join(', '));
}

// ── Publicação automática agendada (Cron Trigger + API do Blogger) →
// ia-de-balcao, mesmo arquivo workers-automacao-blogger.md (Adaptação 4).
// Regressão: sem keyword de grupo cobrindo "publicar...automaticamente" em
// frase solta (não "publicação automática" nem "post automático" literal),
// o lookup de 2 níveis não achava nenhum grupo e caía no fallback (primeiro
// grupo do index, errado) — mesmo com o ROTEAMENTO acertando ia-de-balcao.
assert('publicar posts automaticamente → ia-de-balcao',
    rotearPergunta('como publicar posts automaticamente no blogger usando IA') === IA_BALCAO);
assert('cron trigger → ia-de-balcao',
    rotearPergunta('quero um cron trigger pra publicar no blogger todo dia') === IA_BALCAO);
assert('api do blogger → ia-de-balcao',
    rotearPergunta('como usar a api do blogger pra publicar posts') === IA_BALCAO);
{
    const r5 = loadForGeminiSync('como publicar posts automaticamente no blogger usando IA');
    assert('publicação automática carrega workers-automacao-blogger.md (não cai no fallback errado do grupo)',
        r5.ficheirosCarregados.some(f => f.includes('integracoes-externas/workers-automacao-blogger.md')),
        r5.ficheirosCarregados.join(', '));

    const r6 = loadForGeminiSync('quero um cron trigger pra publicar no blogger todo dia');
    assert('cron trigger carrega workers-automacao-blogger.md',
        r6.ficheirosCarregados.some(f => f.includes('integracoes-externas/workers-automacao-blogger.md')),
        r6.ficheirosCarregados.join(', '));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} ragLoader: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
