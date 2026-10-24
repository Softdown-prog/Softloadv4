"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAMPOS_CATALOGO = exports.PASTA_RASCUNHOS = void 0;
exports.triarRascunho = triarRascunho;
exports.triarDiretorio = triarDiretorio;
exports.resumirTriagem = resumirTriagem;
// ============================================================
// SOLARIS RAG DRAFT WORKER — triagem de rag/drafts/
// ============================================================
// Motivo de existir: "por que os arquivos de drafts/ não estão nas
// pastas correspondentes?" Resposta confirmada arquivo por arquivo —
// nenhum dos 31 `.json` de drafts/ tem erro de JSON, mas nenhum tem o
// campo "id" (o critério que ragCatalogLoader/auditarCatalogo usam pra
// decidir catálogo-de-verdade vs rascunho), e o SCHEMA deles diverge
// do formato-alvo (ver ragEntryGenerator.RAG_ENTRY_RESPONSE_SCHEMA:
// id/slug/categoria/descricao/componentes/exemplos/keywords) — alguns
// são artigo/tutorial (`flask2.json`), outros um schema totalmente
// diferente (`select-users.json`: unit-id/code/returns/rules).
//
// Decidir categoria, escrever descricao e extrair keywords que
// representem de verdade o assunto de um texto livre EXIGE entender o
// conteúdo — não é algo que dê pra derivar mecanicamente do nome do
// arquivo ou de heurística de prefixo (CLAUDE.md: "IA só entra onde
// não há alternativa determinística viável" — aqui não há). Por isso
// este Worker NUNCA promove um rascunho pro catálogo sozinho, nunca
// inventa categoria/descricao/keywords, nunca escreve em disco — só
// faz o que É mecânico: valida JSON, detecta quais campos de catálogo
// já existem vs faltam, deriva um id CANDIDATO a partir do nome do
// arquivo (mesma paraKebabCase de sempre) e tenta uma sugestão de
// pasta só quando há sinal estrutural real (id/categoria já presentes
// — via ragOrganizerWorker.determinarPasta). Promover de verdade um
// rascunho continua decisão humana, ou via scripts/ragGenerate.js (o
// pipeline com IA que já existe pra isso) usando o rascunho como fonte.
// ============================================================
const fs = require('fs');
const path = require('path');
const { paraKebabCase, separarNomeExtensao } = require('./ragKebabWorker');
const { determinarPasta } = require('./ragOrganizerWorker');
const RAG_DIR = path.join(__dirname, '..', 'rag');
exports.PASTA_RASCUNHOS = 'drafts';
// Campos do formato-alvo de catálogo (mesmo shape que
// ragEntryGenerator.RAG_ENTRY_RESPONSE_SCHEMA produz) — "keywords"
// aceita tanto esse nome quanto "prompt_keywords" (as duas convenções
// já convivem no catálogo real, ver ragCatalogLoader._keywords).
exports.CAMPOS_CATALOGO = ['id', 'slug', 'categoria', 'descricao', 'componentes', 'exemplos', 'keywords'];
function _naoVazio(valor) {
    return Array.isArray(valor) && valor.length > 0;
}
function _temCampo(entrada, campo) {
    if (campo === 'keywords') {
        return _naoVazio(entrada.keywords) || _naoVazio(entrada.prompt_keywords);
    }
    if (campo === 'componentes' || campo === 'exemplos') {
        return _naoVazio(entrada[campo]);
    }
    return typeof entrada[campo] === 'string' && entrada[campo].trim().length > 0;
}
/**
 * Triagem de UM rascunho já parseado (ou erro de parse) — puro, sem
 * tocar disco. Nunca decide categoria/descricao/keywords sozinho; só
 * reporta o que já existe vs falta, e uma sugestão de id/pasta baseada
 * apenas em sinal estrutural real já presente na entrada.
 *
 * @param {string} nomeArquivo
 * @param {object|null} entrada - já parseado, ou null se falhou o parse
 * @param {string|null} erroParse - mensagem do JSON.parse, se falhou
 * @returns {{ arquivo, jsonValido, erroJson, camposPresentes, camposAusentes,
 *   temAlgumSinalDeCatalogo, idCandidato, pastaSugerida, motivoPasta,
 *   prontoPraCatalogo, motivo }}
 */
function triarRascunho(nomeArquivo, entrada, erroParse = null) {
    const { base } = separarNomeExtensao(nomeArquivo);
    const idCandidato = paraKebabCase(base);
    if (erroParse || !entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
        return {
            arquivo: nomeArquivo, jsonValido: false, erroJson: erroParse || 'entrada vazia/não é objeto.',
            camposPresentes: [], camposAusentes: [...exports.CAMPOS_CATALOGO],
            temAlgumSinalDeCatalogo: false, idCandidato, pastaSugerida: null, motivoPasta: null,
            prontoPraCatalogo: false, motivo: 'JSON inválido ou vazio — não dá pra triar conteúdo.',
        };
    }
    const camposPresentes = exports.CAMPOS_CATALOGO.filter((c) => _temCampo(entrada, c));
    const camposAusentes = exports.CAMPOS_CATALOGO.filter((c) => !camposPresentes.includes(c));
    const temAlgumSinalDeCatalogo = camposPresentes.length > 0;
    // Sugestão de pasta só com sinal REAL (id/categoria já presentes na
    // entrada) — o idCandidato derivado do nome do arquivo é só
    // conveniência de nomenclatura, nunca usado pra classificar.
    const temSinalDeClassificacao = Boolean(entrada.id || entrada.categoria);
    const { pasta: pastaSugerida, motivo: motivoPasta } = temSinalDeClassificacao
        ? determinarPasta({ id: entrada.id, categoria: entrada.categoria })
        : { pasta: null, motivo: null };
    const prontoPraCatalogo = ['id', 'categoria', 'descricao'].every((c) => camposPresentes.includes(c))
        && (camposPresentes.includes('componentes') || camposPresentes.includes('exemplos'))
        && camposPresentes.includes('keywords');
    let motivo;
    if (prontoPraCatalogo) {
        motivo = 'tem os campos mínimos de catálogo — só falta mover pra pasta sugerida.';
    }
    else if (!temAlgumSinalDeCatalogo) {
        motivo = `schema totalmente divergente do catálogo (nenhum de ${exports.CAMPOS_CATALOGO.join('/')} presente) — precisa de curadoria manual, ou virar fonte pra scripts/ragGenerate.js; não dá pra promover automaticamente.`;
    }
    else {
        motivo = `schema parcial — faltam: ${camposAusentes.join(', ')}. Precisa de curadoria manual antes de virar entrada de catálogo.`;
    }
    return {
        arquivo: nomeArquivo, jsonValido: true, erroJson: null,
        camposPresentes, camposAusentes, temAlgumSinalDeCatalogo,
        idCandidato, pastaSugerida, motivoPasta,
        prontoPraCatalogo, motivo,
    };
}
/**
 * Varre `rag/drafts/` (ou `dir` alternativo, pra teste) e devolve a
 * triagem de cada arquivo — nunca escreve em disco, nunca move nada.
 * Arquivo com extensão diferente de `.json` (ex.: o `.md` real que já
 * existe hoje em drafts/) entra no relatório como fora de escopo, não
 * é descartado silenciosamente.
 *
 * @returns {Array<ReturnType<typeof triarRascunho> | {arquivo, foraDeEscopo: true, motivo}>}
 */
function triarDiretorio({ dir = path.join(RAG_DIR, exports.PASTA_RASCUNHOS) } = {}) {
    const relatorio = [];
    if (!fs.existsSync(dir))
        return relatorio;
    const entradas = fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && !e.name.startsWith('.'));
    for (const { name: arquivo } of entradas) {
        // Mesma allowlist de ehArquivoDeCatalogo: sem extensão (candidato
        // legítimo, só falta o nome ser corrigido) ou .json entram; qualquer
        // outra extensão (ex.: o .md real que existe hoje em drafts/) fica
        // fora de escopo — achado real: rascunhos chegam sem extensão com
        // frequência (5 arquivos numa única leva), não dava pra tratar isso
        // como "não é candidato".
        const ext = path.extname(arquivo).toLowerCase();
        if (ext !== '' && ext !== '.json') {
            relatorio.push({ arquivo, foraDeEscopo: true, motivo: `extensão "${ext}" — não é candidato a entrada de catálogo JSON.` });
            continue;
        }
        try {
            const entrada = JSON.parse(fs.readFileSync(path.join(dir, arquivo), 'utf8'));
            relatorio.push(triarRascunho(arquivo, entrada));
        }
        catch (err) {
            relatorio.push(triarRascunho(arquivo, null, err.message));
        }
    }
    return relatorio;
}
/**
 * Resumo agregado da triagem — contagens pra relatório de CLI/README,
 * puro (recebe o array de `triarDiretorio`, não toca disco).
 */
function resumirTriagem(relatorio) {
    const validos = relatorio.filter((r) => !r.foraDeEscopo);
    return {
        total: relatorio.length,
        foraDeEscopo: relatorio.filter((r) => r.foraDeEscopo).length,
        jsonInvalido: validos.filter((r) => !r.jsonValido).length,
        prontosPraCatalogo: validos.filter((r) => r.prontoPraCatalogo).length,
        semSinalNenhum: validos.filter((r) => r.jsonValido && !r.temAlgumSinalDeCatalogo).length,
        sinalParcial: validos.filter((r) => r.jsonValido && r.temAlgumSinalDeCatalogo && !r.prontoPraCatalogo).length,
    };
}
