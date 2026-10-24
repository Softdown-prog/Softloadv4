"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buscarNaBiblioteca = buscarNaBiblioteca;
exports.registrarNaBiblioteca = registrarNaBiblioteca;
exports._gerarPalavrasChave = _gerarPalavrasChave;
exports._melhorCandidato = _melhorCandidato;
// ============================================================
// BIBLIOTECA DE PEÇAS — índice RAG cross-nicho de peças (hero/
// widget/modulo) já geradas e aprovadas por pecaOrchestrator.js.
//
// Persistida no Firestore (coleção pecas_biblioteca), não em arquivo
// local — Cloud Run tem filesystem efêmero, e essa biblioteca CRESCE
// em runtime (diferente de sol-model, que é RAG estático versionado
// no git). Um arquivo local escrito em runtime
// nunca sobrevive a um deploy/restart/instância nova — achado real:
// essa era a versão anterior desta função, e a "memoização cross-
// nicho" documentada no propósito original nunca funcionou de fato em
// produção.
//
// Matching por keyword via ragMatcher.js (fronteira de palavra +
// normalização de acento), mesmo mecanismo já usado pelo RAG de chat —
// evita reinventar um segundo motor de busca.
//
// Cresce só por memoização (registrarNaBiblioteca, chamado por
// pecaOrchestrator.js após uma peça passar nos workers determinísticos)
// — nunca editado manualmente.
// ============================================================
const { db, admin } = require('../../services/firebase');
const { criarMatcher, pontuarKeywords } = require('../../rag/ragMatcher');
const COLLECTION = 'pecas_biblioteca';
// Abaixo disso, o keyword-match não é aceito como resposta final — bug
// real: 1 palavra genérica batendo por coincidência com a descrição de
// uma peça de OUTRO nicho já bastava pra "resolver" um pedido
// genuinamente novo (ex: pedir peça de um nicho de futebol e reaproveitar
// algo de tecnologia só por uma palavra em comum como "vivo"), sem
// nunca chegar a gerar via IA. Abaixo do piso, não há match reaproveitável
// — o chamador (pecaOrchestrator.js) segue pra geração via IA.
const MIN_HITS_REAPROVEITAR = 2;
// Mesmo padrão de gerarKeywords() em scripts/generateDesignPackageRag.js.
// NOTA: "tipo" NÃO vira keyword — mesmo motivo de pecaOrchestrator.js
// (_keywordsDePeca): genérico demais, causaria falso-positivo com
// qualquer pedido que só mencione "widget"/"hero"/"modulo".
function _gerarPalavrasChave(descricao, nichoTema, id) {
    const kws = new Set();
    if (nichoTema) {
        nichoTema.split('-').forEach(w => w.length > 3 && kws.add(w));
        kws.add(nichoTema);
    }
    if (descricao) {
        descricao.toLowerCase().split(/\s+/).forEach(w => {
            const limpo = w.replace(/[^\p{L}\p{N}-]/gu, '');
            if (limpo.length > 3)
                kws.add(limpo);
        });
    }
    if (id)
        id.split('-').forEach(w => w.length > 2 && kws.add(w));
    return [...kws].filter(Boolean).slice(0, 20);
}
// ──────────────────────────────────────────────────────────────
// _melhorCandidato — pura, sem I/O. Recebe o pedido e uma lista de
// itens já carregados ({palavras_chave, ...}) e devolve o melhor por
// keyword-match. Separada da leitura do Firestore pra ser testável
// sem rede (ver bibliotecaPecas.test.js).
// ──────────────────────────────────────────────────────────────
function _melhorCandidato(pedido, itens) {
    const matcher = criarMatcher(pedido || '');
    let melhor = null;
    let melhorScore = 0;
    let melhorHits = 0;
    for (const item of itens) {
        const { hits, score } = pontuarKeywords(matcher, item.palavras_chave || []);
        if (score > melhorScore) {
            melhorScore = score;
            melhor = item;
            melhorHits = hits;
        }
    }
    return { melhor, melhorScore, melhorHits };
}
// Remove campos que são só bookkeeping do índice (nunca fizeram parte
// do shape de peça devolvido pelo pecaOrchestrator) — mesmo contrato
// de antes, quando palavras_chave vivia só no index.json separado do
// arquivo da peça em si. `embedding` continua na desestruturação pra
// descartar silenciosamente o campo em docs antigos gravados antes
// desta camada ser removida (Firestore não apaga campo sozinho).
function _somenteCampoDaPeca(doc) {
    const { palavras_chave, embedding, criadoEm, ...peca } = doc;
    return peca;
}
// ──────────────────────────────────────────────────────────────
// buscarNaBiblioteca — procura uma peça reaproveitável por keyword-
// match. Retorna a peça ou null. `excluirNicho` evita devolver uma
// peça que já vem do próprio dossiê do nicho pedinte.
// ──────────────────────────────────────────────────────────────
async function buscarNaBiblioteca(pedido, opts = {}) {
    let snap;
    try {
        snap = await db.collection(COLLECTION).get();
    }
    catch (e) {
        console.warn(`[BIBLIOTECA-PECAS] falha ao ler biblioteca do Firestore: ${e.message}`);
        return null;
    }
    const todas = snap.docs.map(d => d.data());
    const { melhor, melhorHits } = _melhorCandidato(pedido, todas);
    if (!melhor || melhorHits < MIN_HITS_REAPROVEITAR)
        return null;
    if (opts.excluirNicho && melhor.nichoOrigem === opts.excluirNicho)
        return null;
    return _somenteCampoDaPeca(melhor);
}
// ──────────────────────────────────────────────────────────────
// registrarNaBiblioteca — grava uma peça aprovada no Firestore. `peca`
// precisa vir com "id" já atribuído (mesma responsabilidade do chamador
// que em dossieWriter.adicionarPeca). Doc id = peca.id — registrar de
// novo o mesmo id sobrescreve, mesmo comportamento de antes (arquivo
// peca-{id}.json sobrescrito). Retorna { ok, erros }.
// ──────────────────────────────────────────────────────────────
async function registrarNaBiblioteca(peca, nichoTema) {
    if (!peca || typeof peca !== 'object' || !peca.id || typeof peca.id !== 'string') {
        return { ok: false, erros: ['peça inválida: precisa de "id" (string) atribuído pelo chamador antes de registrar na biblioteca.'] };
    }
    const entrada = {
        ...peca,
        nichoOrigem: nichoTema || null,
        palavras_chave: _gerarPalavrasChave(peca.descricao, nichoTema, peca.id),
        criadoEm: admin.firestore.FieldValue.serverTimestamp(),
    };
    try {
        await db.collection(COLLECTION).doc(peca.id).set(entrada);
    }
    catch (e) {
        return { ok: false, erros: [`falha ao gravar no Firestore: ${e.message}`] };
    }
    return { ok: true, erros: [] };
}
