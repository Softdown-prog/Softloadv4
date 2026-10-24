"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DESCRICAO_MIN_CHARS = exports.CAMPOS_RECOMENDADOS = void 0;
exports.ehArquivoDeCatalogo = ehArquivoDeCatalogo;
exports.listarArquivosDeCatalogo = listarArquivosDeCatalogo;
exports.separarNomeExtensao = separarNomeExtensao;
exports.paraKebabCase = paraKebabCase;
exports.ehKebabCase = ehKebabCase;
exports.validarNomeArquivo = validarNomeArquivo;
exports.normalizarDiretorioRag = normalizarDiretorioRag;
exports.auditarCatalogo = auditarCatalogo;
exports.validarEntradaGerada = validarEntradaGerada;
// ============================================================
// SOLARIS RAG KEBAB WORKER (Fase 2 + Fase 2.1 — auditoria de catálogo)
// ============================================================
// Worker determinístico (puro Node/fs — zero chamada a IA, zero custo
// de token) que analisa, valida e corrige o nome físico dos arquivos
// de catálogo em src/solaris/rag/: garante kebab-case (sem acento,
// sem maiúscula, sem espaço) e garante a extensão .json em arquivo
// enviado sem extensão. Mesmo princípio dos demais Workers do Solaris
// (htmlWorker/cssWorker/jsWorker): análise/correção mecânica nunca
// delegada a um modelo — aqui não haveria nem "alternativa
// determinística viável" pra avaliar, é puro parsing de string.
//
// Fase 2.1 evolui o escopo de "só nome de arquivo" pra "consistência
// do catálogo" (pedido explícito de revisão): `auditarCatalogo()`
// cruza nome físico ↔ id interno, confere campos recomendados e
// detecta id duplicado entre arquivos — mesma régua de "verificação
// mecânica em vez de confiar que a extração deu certo" do resto do
// projeto (dossieIntegrityChecker, CLAUDE.md). Continua puro/sem
// side-effect — só lê disco, nunca escreve.
//
// Responsabilidade dividida: este Worker ANALISA/VALIDA/CORRIGE nome
// de arquivo E consistência de conteúdo (puro, sem side-effect) e —
// só quando pedido explicitamente — aplica a correção de NOME em
// disco (nunca corrige conteúdo automaticamente: um id divergente ou
// campo faltando é decisão de quem edita o JSON, não algo que o
// Worker deva reescrever sozinho). Orquestração (listar o diretório
// real, montar o índice buscável) continua em ragCatalogLoader.js —
// ver `ehArquivoDeCatalogo`/`listarArquivosDeCatalogo` importados
// daqui, não duplicados lá.
// ============================================================
const fs = require('fs');
const path = require('path');
const { normalizar } = require('../../rag/ragMatcher');
const RAG_DIR = path.join(__dirname, '..', 'rag');
const EXTENSAO_PADRAO = '.json';
// Campos recomendados pra toda entrada de catálogo (fora "id", que já
// é o critério mínimo do loader pra considerar o arquivo "carregável").
// Ausência vira AVISO, nunca erro — parte do catálogo real já existe
// sem "descricao"/"slug" hoje; convergir é objetivo incremental, não
// quebra de arquivo existente.
exports.CAMPOS_RECOMENDADOS = ['id', 'slug', 'categoria', 'descricao'];
// Arquivo que é catálogo — mesmo filtro usado por
// ragCatalogLoader.carregarCatalogo(), centralizado aqui pra não
// duplicar a regra em dois lugares.
//
// Allowlist (não blocklist): só entra arquivo SEM extensão (candidato
// legítimo a virar catálogo — validarNomeArquivo/normalizarDiretorioRag
// já tratam esse caso, sugerindo o nome kebab-case + .json) ou já com
// extensão .json. Qualquer outra extensão é conteúdo de outra natureza
// (código-fonte, texto solto, o que for) — nunca um candidato a entrada
// de catálogo, e por isso nunca deveria virar tentativa de JSON.parse
// nem gerar aviso de "extensão errada". Achado real: um blocklist
// (`.js`/`.md`/dotfile) deixava passar QUALQUER outra extensão — um
// dump de arquivos .py/.php/.txt caído na pasta virou ~500 linhas de
// aviso de "JSON inválido" no console, um por arquivo, afogando os
// avisos de curadoria de verdade.
function ehArquivoDeCatalogo(nomeArquivo) {
    if (nomeArquivo.startsWith('.'))
        return false;
    const ext = path.extname(nomeArquivo).toLowerCase();
    return ext === '' || ext === EXTENSAO_PADRAO;
}
// Pasta que nunca entra no catálogo buscável (rascunho sem "id" ainda,
// ver README) — a única exceção ao "toda subpasta é um grupo real",
// nomeada explicitamente porque tem semântica própria (não é uma
// tecnologia, é um estado de curadoria).
const PASTA_RASCUNHOS = 'drafts';
// Lista os nomes de arquivo de catálogo de um diretório — recursivo
// em UM nível: arquivo solto no topo entra como está; subpasta (exceto
// PASTA_RASCUNHOS) é tratada como GRUPO/nicho (ver ragOrganizerWorker.js)
// e seu conteúdo entra como "grupo/arquivo.json" (path relativo a
// `dir`); PASTA_RASCUNHOS nunca é percorrida. Sem recursão além de 1
// nível — não há caso de uso hoje pra grupo-dentro-de-grupo, e permitir
// isso sem necessidade é abstração sem propósito. Fonte única desse
// filtro — usada por normalizarDiretorioRag, auditarCatalogo,
// ragOrganizerWorker e ragCatalogLoader.carregarCatalogo, nenhum
// reimplementa.
function listarArquivosDeCatalogo(dir) {
    const nomes = [];
    for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entrada.isFile()) {
            if (ehArquivoDeCatalogo(entrada.name))
                nomes.push(entrada.name);
            continue;
        }
        if (!entrada.isDirectory() || entrada.name === PASTA_RASCUNHOS)
            continue;
        const subDir = path.join(dir, entrada.name);
        for (const subEntrada of fs.readdirSync(subDir, { withFileTypes: true })) {
            if (subEntrada.isFile() && ehArquivoDeCatalogo(subEntrada.name)) {
                nomes.push(path.join(entrada.name, subEntrada.name));
            }
        }
    }
    return nomes;
}
// Separa nome-base e extensão. Sem extensão reconhecida, tudo vira
// nome-base (ex.: "Agência" → base "Agência", ext ""). Opera sobre o
// BASENAME — se `nomeArquivo` vier com prefixo de pasta (ex.:
// "bootstrap5/navbar.json", ver listarArquivosDeCatalogo), o prefixo é
// preservado à parte e devolvido em `pastaPrefixo`, nunca tratado como
// parte do nome a kebab-casear.
function separarNomeExtensao(nomeArquivo) {
    const pastaPrefixo = path.dirname(nomeArquivo);
    const base = path.basename(nomeArquivo);
    const ext = path.extname(base);
    const nomeBase = ext ? base.slice(0, -ext.length) : base;
    return { base: nomeBase, ext, pastaPrefixo: pastaPrefixo === '.' ? '' : pastaPrefixo };
}
// Converte um nome-base pra kebab-case: separa limites camelCase antes
// de baixar a caixa (senão "LandingPage" viraria "landingpage" grudado
// em vez de "landing-page"), remove acento/normaliza via ragMatcher
// (reuso — não duplica a lógica de NFD já usada pelo RAG do Blogger
// Engine), troca qualquer sequência não-alfanumérica por hífen único.
function paraKebabCase(nomeBase) {
    const comLimitesDeHifen = String(nomeBase || '').replace(/([a-z0-9])([A-Z])/g, '$1-$2');
    const semAcentoMinusculo = normalizar(comLimitesDeHifen);
    return semAcentoMinusculo
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
function ehKebabCase(nomeBase) {
    return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(nomeBase);
}
/**
 * Analisa um nome de arquivo do catálogo — puro, sem tocar disco.
 * @returns {{ ok: boolean, erros: string[], avisos: string[], nomeSugerido: string }}
 */
function validarNomeArquivo(nomeArquivo) {
    if (!nomeArquivo || typeof nomeArquivo !== 'string' || !nomeArquivo.trim()) {
        return { ok: false, erros: ['nome de arquivo vazio.'], avisos: [], nomeSugerido: null };
    }
    const { base, ext, pastaPrefixo } = separarNomeExtensao(nomeArquivo);
    const kebab = paraKebabCase(base);
    if (!kebab) {
        return { ok: false, erros: [`"${nomeArquivo}" não produz nenhum nome kebab-case válido.`], avisos: [], nomeSugerido: null };
    }
    const avisos = [];
    if (!ext) {
        avisos.push(`"${nomeArquivo}" sem extensão — ${EXTENSAO_PADRAO} será adicionada.`);
    }
    else if (ext.toLowerCase() !== EXTENSAO_PADRAO) {
        avisos.push(`"${nomeArquivo}" tem extensão "${ext}", esperada "${EXTENSAO_PADRAO}".`);
    }
    if (!ehKebabCase(base)) {
        avisos.push(`"${base}" não está em kebab-case (esperado: "${kebab}").`);
    }
    const extensaoFinal = (ext && ext.toLowerCase() === EXTENSAO_PADRAO) ? ext : EXTENSAO_PADRAO;
    // Preserva o prefixo de pasta (ex.: "bootstrap5/") — renomear o
    // arquivo nunca deve movê-lo pra fora do grupo que já está.
    const nomeSugerido = pastaPrefixo ? path.join(pastaPrefixo, `${kebab}${extensaoFinal}`) : `${kebab}${extensaoFinal}`;
    return { ok: true, erros: [], avisos, nomeSugerido };
}
/**
 * Varre o diretório de catálogo, valida cada arquivo e — só se
 * `aplicar: true` — renomeia de verdade em disco (fs.renameSync).
 * Nunca sobrescreve um arquivo já existente com o nome sugerido (vira
 * erro no relatório daquele arquivo, não aplica).
 *
 * @returns {Array<{arquivoOriginal, nomeSugerido, aplicado, ok, erros, avisos}>}
 */
function normalizarDiretorioRag({ dir = RAG_DIR, aplicar = false } = {}) {
    const arquivos = listarArquivosDeCatalogo(dir);
    const relatorio = [];
    for (const arquivoOriginal of arquivos) {
        const { ok, erros, avisos, nomeSugerido } = validarNomeArquivo(arquivoOriginal);
        const item = { arquivoOriginal, nomeSugerido, aplicado: false, ok, erros: [...erros], avisos };
        const precisaMudar = ok && nomeSugerido && nomeSugerido !== arquivoOriginal;
        if (precisaMudar && aplicar) {
            const destino = path.join(dir, nomeSugerido);
            if (fs.existsSync(destino)) {
                item.ok = false;
                item.erros.push(`conflito: "${nomeSugerido}" já existe — renomeação de "${arquivoOriginal}" não aplicada.`);
            }
            else {
                fs.renameSync(path.join(dir, arquivoOriginal), destino);
                item.aplicado = true;
            }
        }
        relatorio.push(item);
    }
    return relatorio;
}
/**
 * Audita CONTEÚDO do catálogo (além do nome — ver validarNomeArquivo):
 * coerência nome-do-arquivo ↔ id interno, presença dos campos
 * recomendados e id duplicado entre arquivos diferentes. Puro, só lê
 * disco (nunca escreve) — decisão de corrigir o conteúdo é de quem
 * edita o JSON, não deste Worker.
 *
 * Arquivo sem "id" é tratado como RASCUNHO (mesmo critério do loader:
 * `ragCatalogLoader.carregarCatalogo` já ignora essas entradas) — vira
 * aviso informativo, não erro, e não participa da checagem de id
 * duplicado nem da coerência nome↔id (não tem id pra comparar).
 *
 * @returns {{ arquivos: Array<{arquivo, id, ok, erros: string[], avisos: string[]}>, duplicados: Array<{id, arquivos: string[]}> }}
 */
function auditarCatalogo({ dir = RAG_DIR } = {}) {
    const arquivos = listarArquivosDeCatalogo(dir);
    const porId = new Map(); // id -> [arquivos que declaram esse id]
    const relatorioArquivos = [];
    for (const nomeArquivo of arquivos) {
        const erros = [];
        const avisos = [];
        let entrada = null;
        try {
            entrada = JSON.parse(fs.readFileSync(path.join(dir, nomeArquivo), 'utf8'));
        }
        catch (err) {
            erros.push(`JSON inválido: ${err.message}`);
            relatorioArquivos.push({ arquivo: nomeArquivo, id: null, ok: false, erros, avisos });
            continue;
        }
        if (!entrada || typeof entrada !== 'object' || !entrada.id) {
            avisos.push('sem campo "id" — tratado como rascunho, ignorado pelo loader do catálogo.');
            relatorioArquivos.push({ arquivo: nomeArquivo, id: null, ok: true, erros, avisos });
            continue;
        }
        const { id, slug } = entrada;
        const { base } = separarNomeExtensao(nomeArquivo);
        const baseKebab = paraKebabCase(base);
        if (baseKebab !== id && baseKebab !== slug) {
            avisos.push(`nome do arquivo ("${baseKebab}") diverge do id interno ("${id}"${slug && slug !== id ? ` / slug "${slug}"` : ''}).`);
        }
        for (const campo of exports.CAMPOS_RECOMENDADOS) {
            if (typeof entrada[campo] !== 'string' || !entrada[campo].trim()) {
                avisos.push(`campo recomendado "${campo}" ausente ou vazio.`);
            }
        }
        if (!porId.has(id))
            porId.set(id, []);
        porId.get(id).push(nomeArquivo);
        relatorioArquivos.push({ arquivo: nomeArquivo, id, ok: true, erros, avisos });
    }
    const duplicados = [];
    for (const [id, arquivosComEsseId] of porId) {
        if (arquivosComEsseId.length > 1) {
            duplicados.push({ id, arquivos: arquivosComEsseId });
            for (const item of relatorioArquivos) {
                if (item.id === id) {
                    item.ok = false;
                    item.erros.push(`id "${id}" duplicado — também declarado em: ${arquivosComEsseId.filter((a) => a !== item.arquivo).join(', ')}.`);
                }
            }
        }
    }
    return { arquivos: relatorioArquivos, duplicados };
}
// Tamanho mínimo de "descricao" pra uma entrada GERADA (Etapa 4 do
// pipeline de geração) — abaixo disso é sintoma de resposta vazia/
// truncada do modelo, não conteúdo técnico de verdade. Não se aplica
// a `auditarCatalogo` (catálogo já existente, curado à mão, onde
// "descricao" ausente é só aviso) — só ao portão de entrada de
// conteúdo novo gerado por IA, que precisa de barra mais alta.
exports.DESCRICAO_MIN_CHARS = 30;
/**
 * Valida uma entrada RECÉM-GERADA (ainda não salva em disco) antes de
 * ela entrar no catálogo — Etapa 4 (Validador) do pipeline de geração
 * em `scripts/ragGenerate.js`. Mais rígido que `auditarCatalogo`
 * (aquele audita o catálogo já curado; este é o portão de entrada de
 * conteúdo novo gerado por IA, que nunca deveria entrar sem passar
 * por aqui). Puro — não grava nada, não decide sozinho, só reporta.
 *
 * @param {object} entrada - objeto devolvido por ragEntryGenerator.gerarEntradaCatalogo
 * @param {{ idsExistentes?: string[] }} opcoes - ids já no catálogo, pra checar unicidade
 * @returns {{ ok: boolean, erros: string[], avisos: string[] }}
 */
function validarEntradaGerada(entrada, { idsExistentes = [] } = {}) {
    const erros = [];
    const avisos = [];
    if (!entrada || typeof entrada !== 'object') {
        return { ok: false, erros: ['entrada não é um objeto.'], avisos };
    }
    if (!entrada.id || typeof entrada.id !== 'string' || !ehKebabCase(entrada.id)) {
        erros.push(`"id" ausente ou não está em kebab-case: ${JSON.stringify(entrada.id)}.`);
    }
    if (entrada.slug !== entrada.id) {
        erros.push(`"slug" (${JSON.stringify(entrada.slug)}) diverge de "id" (${JSON.stringify(entrada.id)}) — devem ser idênticos.`);
    }
    if (!entrada.categoria || typeof entrada.categoria !== 'string' || !entrada.categoria.trim()) {
        erros.push('"categoria" ausente ou vazia.');
    }
    if (!entrada.descricao || typeof entrada.descricao !== 'string' || entrada.descricao.trim().length < exports.DESCRICAO_MIN_CHARS) {
        erros.push(`"descricao" ausente ou curta demais (mínimo ${exports.DESCRICAO_MIN_CHARS} caracteres) — sintoma de resposta vazia/truncada do modelo.`);
    }
    const componentes = Array.isArray(entrada.componentes) ? entrada.componentes : [];
    const exemplos = Array.isArray(entrada.exemplos) ? entrada.exemplos : [];
    const keywords = Array.isArray(entrada.keywords) ? entrada.keywords : [];
    if (componentes.length === 0 && exemplos.length === 0) {
        erros.push('nem "componentes" nem "exemplos" têm conteúdo — entrada sem substância técnica pra ser útil no RAG.');
    }
    if (keywords.length === 0) {
        avisos.push('"keywords" vazio — busca vai depender só das keywords derivadas de id/slug/titulo/categoria.');
    }
    if (entrada.id && idsExistentes.includes(entrada.id)) {
        erros.push(`id "${entrada.id}" já existe no catálogo — geração pulada pra não duplicar.`);
    }
    return { ok: erros.length === 0, erros, avisos };
}
