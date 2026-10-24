"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PASTA_PADRAO = exports.PASTA_PRESETS = exports.PASTA_RASCUNHOS = void 0;
exports.determinarPasta = determinarPasta;
exports.organizarDiretorio = organizarDiretorio;
// ============================================================
// SOLARIS RAG ORGANIZER WORKER
// ============================================================
// Pedido direto: "cria um worker que organiza os arquivos em pastas
// separadas por nicho (banco, PHP, flask, python etc), você só passa
// o JSON pro Worker ele faz". Puro/determinístico (zero IA, zero
// heurística de conteúdo livre) — decide a pasta de destino só a
// partir de campos ESTRUTURADOS já existentes na entrada (nunca
// "adivinha" lendo texto livre pra achar palavra-chave; isso seria
// regex sobre conteúdo, o tipo de gambiarra que os parsers de
// src/core/parser/ substituíram em outro lugar do projeto).
//
// Prioridade de decisão (determinística, primeira que bater vence):
//   1. entrada.pasta — override explícito, quem escreveu o JSON decide.
//   2. entrada.categoria === 'preset' → pasta "presets" — mesmo que o
//      id comece com o prefixo de um grupo (ex.: flask-saas-
//      glassmorphism), preset fica agrupado com os outros presets, não
//      espalhado pelas pastas de tecnologia individual.
//   3. grupo derivado do prefixo do id (convenção "<grupo>-<topico>" já
//      usada por ragTopicMatrix.js/ragEntryGenerator.js — ex.:
//      "bootstrap5-navbar" → pasta "bootstrap5"), OU id igual a um
//      grupo conhecido (ex.: "bootstrap5" → pasta "bootstrap5",
//      mantém a referência do framework junto dos próprios tópicos).
//   4. entrada.categoria (framework/backend/linguagem/topico) sem
//      grupo reconhecido → usa a própria categoria como pasta (ex.:
//      "banco" — quando uma entrada real vier com categoria "banco",
//      cai aqui automaticamente, sem precisar hardcodar o nome).
//   5. Sem id nem categoria → pasta "outros" — nunca falha, nunca
//      perde arquivo, mas também nunca finge saber classificar algo
//      que não tem sinal nenhum.
//
// Só reorganiza o catálogo de topo (arquivo solto, sem estar já numa
// subpasta) — nunca mexe em rag/drafts/ (fora do catálogo buscável de
// propósito) nem reclassifica algo que já está numa pasta.
// ============================================================
const fs = require('fs');
const path = require('path');
const { listarGrupos } = require('../rag/ragTopicMatrix');
const { paraKebabCase } = require('./ragKebabWorker');
exports.PASTA_RASCUNHOS = 'drafts';
exports.PASTA_PRESETS = 'presets';
exports.PASTA_PADRAO = 'outros';
/**
 * Decide a pasta de destino de uma entrada já parseada — puro, sem
 * tocar disco. Nunca lança; entrada inválida cai em PASTA_PADRAO.
 * @returns {{ pasta: string, motivo: string }}
 */
function determinarPasta(entrada) {
    if (!entrada || typeof entrada !== 'object') {
        return { pasta: exports.PASTA_PADRAO, motivo: 'entrada inválida/vazia.' };
    }
    if (typeof entrada.pasta === 'string' && entrada.pasta.trim()) {
        return { pasta: paraKebabCase(entrada.pasta.trim()), motivo: 'campo "pasta" explícito na entrada.' };
    }
    // Preset (combinação curada de framework+nicho+estilo, ver
    // flask-saas-glassmorphism.json) checa ANTES do prefixo de grupo —
    // mesmo que o id comece com "flask-", um preset fica agrupado com
    // os outros presets (útil pra navegar "quais combos prontos
    // existem"), não espalhado pelas pastas de tecnologia individual.
    if (entrada.categoria === 'preset') {
        return { pasta: exports.PASTA_PRESETS, motivo: 'categoria "preset".' };
    }
    const grupos = listarGrupos();
    const id = typeof entrada.id === 'string' ? entrada.id : '';
    if (grupos.includes(id)) {
        return { pasta: id, motivo: `id ("${id}") é a própria referência do grupo.` };
    }
    for (const grupo of grupos) {
        if (id.startsWith(`${grupo}-`)) {
            return { pasta: grupo, motivo: `id ("${id}") segue a convenção "${grupo}-<topico>".` };
        }
    }
    if (typeof entrada.categoria === 'string' && entrada.categoria.trim()) {
        return { pasta: paraKebabCase(entrada.categoria.trim()), motivo: `sem grupo reconhecido — usa a própria categoria ("${entrada.categoria}").` };
    }
    return { pasta: exports.PASTA_PADRAO, motivo: 'sem id nem categoria pra classificar.' };
}
/**
 * Varre o TOPO do diretório de catálogo (arquivo solto, não dentro de
 * subpasta nenhuma — inclusive `drafts/`, sempre ignorada) e — só se
 * `aplicar: true` — move de verdade cada um pra `dir/<pasta>/<arquivo>`
 * (fs.mkdirSync recursive + fs.renameSync). Nunca sobrescreve destino
 * já existente (vira erro no relatório daquele arquivo, não aplica).
 *
 * @returns {Array<{arquivo, pasta, motivo, aplicado, ok, erros: string[]}>}
 */
function organizarDiretorio({ dir, aplicar = false }) {
    const relatorio = [];
    const entradasTopo = fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && !e.name.startsWith('.') && !e.name.endsWith('.js') && !e.name.endsWith('.md'));
    for (const { name: arquivo } of entradasTopo) {
        const caminhoOrigem = path.join(dir, arquivo);
        const erros = [];
        let entrada = null;
        try {
            entrada = JSON.parse(fs.readFileSync(caminhoOrigem, 'utf8'));
        }
        catch (err) {
            relatorio.push({ arquivo, pasta: null, motivo: null, aplicado: false, ok: false, erros: [`JSON inválido: ${err.message}`] });
            continue;
        }
        const { pasta, motivo } = determinarPasta(entrada);
        const item = { arquivo, pasta, motivo, aplicado: false, ok: true, erros };
        if (aplicar) {
            const destinoDir = path.join(dir, pasta);
            const destino = path.join(destinoDir, arquivo);
            if (fs.existsSync(destino)) {
                item.ok = false;
                item.erros.push(`conflito: "${pasta}/${arquivo}" já existe — não aplicado.`);
            }
            else {
                fs.mkdirSync(destinoDir, { recursive: true });
                fs.renameSync(caminhoOrigem, destino);
                item.aplicado = true;
            }
        }
        relatorio.push(item);
    }
    return relatorio;
}
