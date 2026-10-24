/** Contratos do parser XML genérico, separados da validação Blogger. */
export interface XmlParserError {
    mensagem: string;
    linha: number | null;
    coluna: number | null;
}
export type XmlParseResult =
    | { ok: true; arvore: Record<string, unknown> }
    | { ok: false; erro: XmlParserError };
export type XmlAnalysisResult =
    | { ok: true; estrutura: { tags: Record<string, number> }; idsDuplicados: { id: string; tag: string }[] }
    | { ok: false; erro: XmlParserError };

type XmlValidation = true | { err: { msg: string; line?: number; col?: number } };
declare function require(name: string): unknown;
// ============================================================
// XML PARSER — Fase 2 do projeto de parsers "fora do pipeline de
// compilação" (src/core/parser/, ver cssParser.js pra Fase 1 e o
// racional completo). Usa fast-xml-parser — já é dependência do
// projeto (xmlValidator.js/repairEngine.js/codeValidator.js), reaproveitada
// aqui em vez de instalar uma segunda lib de XML à toa.
//
// Diferença de xmlValidator.js: aquele valida especificamente XML de
// TEMPLATE BLOGGER já montado pelo compilador (regras de b:section/
// b:widget, entidade, estrutura semântica Blogger) — continua sendo o
// gate certo pro pipeline. Este analisa XML ARBITRÁRIO colado num
// chat, sem conhecer nada de Blogger — só sintaxe válida + estrutura
// genérica (contagem de tag, atributo "id" duplicado — mesma classe de
// bug de htmlParser.js/cssParser.js: silenciosa, sem erro visível).
//
// Limitação honesta: fast-xml-parser não expõe linha/coluna por nó na
// árvore resultante (só no validador de sintaxe) — os achados
// estruturais (ex: id duplicado) não vêm com número de linha, só o
// nome da tag mais próxima como contexto. Não vale escrever um
// tokenizer XML próprio só pra isso.
// ============================================================

const { XMLParser, XMLValidator } = require('fast-xml-parser') as {
    XMLParser: new (options: { ignoreAttributes: boolean; attributeNamePrefix: string; textNodeName: string }) => {
        parse(xml: string): Record<string, unknown>;
    };
    XMLValidator: { validate(xml: string): XmlValidation };
};

const _parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text' });

// ──────────────────────────────────────────────────────────────
// parseXml — valida sintaxe (XMLValidator) antes de tentar montar a
// árvore — evita XMLParser.parse() produzir algo parcial/enganoso
// sobre XML malformado. Nunca lança.
// ──────────────────────────────────────────────────────────────
export function parseXml(xml: unknown): XmlParseResult {
    if (typeof xml !== 'string' || !xml.trim()) {
        return { ok: false, erro: { mensagem: 'XML vazio ou não é string.', linha: null, coluna: null } };
    }
    const validacao = XMLValidator.validate(xml);
    if (validacao !== true) {
        const { msg, line, col } = validacao.err;
        return { ok: false, erro: { mensagem: msg, linha: line ?? null, coluna: col ?? null } };
    }
    try {
        const arvore = _parser.parse(xml);
        return { ok: true, arvore };
    } catch (e) {
        return { ok: false, erro: { mensagem: (e as Error).message, linha: null, coluna: null } };
    }
}

const MAX_ITENS_LISTA = 30;

// Anda pela árvore que o fast-xml-parser produz (objeto JS aninhado —
// tag repetida vira array, atributo vem prefixado "@_", texto vira
// "#text"). Achado ao testar: tag sem atributo e só com texto (ou
// vazia/self-closing) colapsa pra uma STRING PRIMITIVA, não um objeto
// ({"item":"a"}, não {"item":{"#text":"a"}}) — por isso a visita
// acontece a partir do PAI (que sempre é objeto), uma vez por tag
// encontrada em cada chave, e só recursa se o valor for objeto de
// verdade (senão é folha, nada a explorar por dentro).
function _andarArvore(no: Record<string, unknown> | null, visitor: (tag: string, item: unknown) => void): void {
    if (no === null || typeof no !== 'object' || Array.isArray(no)) return;
    for (const chave of Object.keys(no)) {
        if (chave.startsWith('@_') || chave === '#text') continue;
        const valor = no[chave];
        const itens = Array.isArray(valor) ? valor : [valor];
        for (const item of itens) {
            visitor(chave, item);
            if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
                _andarArvore(item as Record<string, unknown>, visitor);
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────
// analisarXml — relatório estruturado: contagem de tags, id duplicado
// (atributo "id", valor repetido em qualquer lugar do documento).
// ──────────────────────────────────────────────────────────────
export function analisarXml(xml: unknown): XmlAnalysisResult {
    const parse = parseXml(xml);
    if (!parse.ok) return { ok: false, erro: parse.erro };

    const contagemTags: Record<string, number> = {};
    const idsVistos = new Map<string, number>();
    const idsDuplicados: { id: string; tag: string }[] = [];

    _andarArvore(parse.arvore, (tag, item) => {
        contagemTags[tag] = (contagemTags[tag] || 0) + 1;
        const id = item !== null && typeof item === 'object' ? (item as Record<string, unknown>)['@_id'] : undefined;
        if (id === undefined || id === null || id === '') return;
        const valor = String(id);
        const contagem = (idsVistos.get(valor) || 0) + 1;
        idsVistos.set(valor, contagem);
        if (contagem === 2) idsDuplicados.push({ id: valor, tag });
    });

    return {
        ok: true,
        estrutura: { tags: contagemTags },
        idsDuplicados: idsDuplicados.slice(0, MAX_ITENS_LISTA),
    };
}

