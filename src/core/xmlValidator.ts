/** Contrato estrutural da validação de templates Blogger. */
export interface XmlValidationReport {
    erros: string[];
    avisos: string[];
}
interface BloggerDomNode {
    ':@'?: Record<string, string>;
    [tag: string]: any;
}
interface WidgetForaDeSection {
    id: string;
    tipo: string;
    pai: string | null;
}
interface XmlSyntaxError { err: { line: number; col: number; msg: string } }
declare function require(name: string): unknown;

// ============================================================
// XML VALIDATOR — validação pós-compilação partilhada
// ============================================================
//
// Dois níveis de validação:
//
//   validarXmlCompilado(xml) → string[]
//     Erros bloqueadores: impedem o upload/entrega do template.
//     Callers devem lançar exceção se o array não estiver vazio.
//     Checks:
//       1. Sintaxe XML (fast-xml-parser)
//       1b. Comentários malformados ('--' no conteúdo, aninhamento, não fechado)
//       1c. Entidades inválidas (nomeada fora de amp/lt/gt/quot/apos, ou
//           numérica fora da produção Char da spec XML)
//       2. Tokens residuais [[TOKEN]]
//       3. b:loop="loop" corrompido (SAXParseException no Blogger)
//       4. b:loop sem atributo 'var' ou 'values'
//       5. b:if sem atributo 'cond'
//       6. b:widget sem atributo 'id' ou 'type'
//       7. Tags b:if / b:loop desbalanceadas
//
//   validarXmlEstrutura(xml) → { erros: string[], avisos: string[] }
//     Erros estruturais e avisos não-bloqueadores.
//     Callers devem logar avisos e opcionalmente repassar ao usuário.
//     Checks:
//       A. Widget Blog (type='Blog') ausente → posts nunca chegam
//       B. b:section com HTML direto (sem b:widget filho)
//       C. data:blog.pageType — API depreciada (usar data:view.*)
//       D. Atributo class corrompido (padrão class='x="y"')
//       E. xmlns Blogger ausentes na tag <html>
//       F. b:layoutsVersion ausente
//       G. b:widget cujo pai direto não é b:section (ex: <div> no meio pra
//          grid/layout) — Blogger rejeita o upload com "is not within a
//          section (actual parent element is: X.)"
//
// ============================================================

const { XMLParser, XMLValidator } = require('fast-xml-parser') as {
    XMLParser: new (options: Record<string, string | boolean>) => {
        parse(xml: string): BloggerDomNode[] | Record<string, unknown>;
    };
    XMLValidator: { validate(xml: string, options: { allowBooleanAttributes: boolean }): true | XmlSyntaxError };
};

// ──────────────────────────────────────────────────────────────────────────
// ÁRVORE DOM — base compartilhada das checagens ESTRUTURAIS
//
// Regras que dependem de contenção/ancestralidade (seção dentro de widget,
// settings dentro de widget, includable definido em qualquer lugar) andam
// numa árvore real do fast-xml-parser (preserveOrder) em vez de regex +
// tokenizer de pilha manual. Motivo: duas gerações de bug reais nasceram
// exatamente do tokenizer manual — (1) b:section self-closing engolindo o
// fechamento de uma seção alheia, (2) b:widget self-closing engolindo até
// o próximo </b:widget> do documento e tornando b:section id='main'
// invisível. Numa árvore, ancestralidade é trivial (basta descer com uma
// flag) e essa classe inteira de bug deixa de existir.
//
// processEntities/parseTagValue/parseAttributeValue desligados: análise
// estrutural não precisa decodificar nada, e entidades exóticas não podem
// derrubar o parse. Comentários e CDATA são descartados/viram texto — o que
// também elimina falsos positivos de tags mencionadas em comentários.
//
// Checagens PURAMENTE TEXTUAIS (tokens residuais, corrupções tipo
// b:loop="loop", balanceamento de <script> em fragmento malformado, class
// corrompida) continuam regex de propósito: elas existem justamente pra
// operar sobre texto cru, inclusive quando o XML nem parseia.
// ──────────────────────────────────────────────────────────────────────────

const _domParser = new XMLParser({
    ignoreAttributes:       false,
    attributeNamePrefix:    '@_',
    preserveOrder:          true,
    allowBooleanAttributes: true,
    processEntities:        false,
    parseTagValue:          false,
    parseAttributeValue:    false,
});

/** Parse tolerante → árvore preserveOrder, ou null se o XML nem parseia
 *  (aí as checagens estruturais são puladas — o malformado já é reportado
 *  como erro bloqueador pela checagem de sintaxe estrita). */
function _parseDom(xml: string): BloggerDomNode[] | null {
    try {
        const arvore = _domParser.parse(xml);
        return Array.isArray(arvore) ? arvore : null;
    } catch (_) {
        return null;
    }
}

/** Nome da tag de um nó preserveOrder ('#text' para nós de texto). */
function _tagDe(node: BloggerDomNode): string | null {
    for (const k of Object.keys(node)) if (k !== ':@') return k;
    return null;
}

function _attrsDe(node: BloggerDomNode): Record<string, string> { return node[':@'] || {}; }

/** Linha/coluna (1-based) do índice `idx` dentro da string `xml` — usado
 *  pra anexar localização às mensagens de erro que vêm da árvore (sem
 *  posição nativa) ou de scans textuais dedicados. */
function _linhaColunaDoIndice(xml: string, idx: number): { linha: number; coluna: number } {
    const ate = xml.slice(0, idx);
    const linha = (ate.match(/\n/g) || []).length + 1;
    const coluna = idx - ate.lastIndexOf('\n');
    return { linha, coluna };
}

/**
 * Comentários XML malformados — detecção textual dedicada porque
 * XMLValidator.validate() não cobre isso (confirmado empiricamente: aceita
 * silenciosamente). Duas checagens, ambas do texto entre '<!--' e '-->':
 *   - '--' dentro do conteúdo: proibido pela spec XML (Comment ::= '<!--'
 *     ((Char - '-') | ('-' (Char - '-')))* '-->'). Cobre tanto comentário
 *     aninhado (<!-- fora <!-- dentro --> -->, onde o '-->' interno cria um
 *     '--' remanescente) quanto qualquer outro '--' solto no conteúdo.
 *   - abertura '<!--' sem '-->' correspondente: hoje isso já vira um erro
 *     de sintaxe (tag não fechada) via XMLValidator, mas com mensagem
 *     enganosa ("Unclosed tag 'root'") — aqui reportamos a causa real.
 */
function _comentariosInvalidos(xml: string): string[] {
    const problemas = [];
    const regexAbertura = /<!--/g;
    let m;
    while ((m = regexAbertura.exec(xml))) {
        const inicio = m.index;
        const fechamento = xml.indexOf('-->', inicio + 4);
        const { linha, coluna } = _linhaColunaDoIndice(xml, inicio);
        if (fechamento === -1) {
            problemas.push(`Linha ${linha}, col ${coluna}: comentário '<!--' aberto e nunca fechado com '-->'.`);
            break; // resto do documento é conteúdo do comentário aberto
        }
        const conteudo = xml.slice(inicio + 4, fechamento);
        if (conteudo.includes('--')) {
            problemas.push(`Linha ${linha}, col ${coluna}: comentário contém '--' em seu conteúdo — proibido pela especificação XML (geralmente sinal de comentário aninhado, ex: '<!-- ... <!-- ... --> ... -->').`);
        }
        regexAbertura.lastIndex = fechamento + 3;
    }
    return problemas;
}

// As 5 únicas entidades nomeadas que o XML pré-define sem DTD. Qualquer
// outra entidade nomeada (as HTML-only tipo &nbsp;/&copy;/&mdash;) é
// inválida em XML puro — Blogger/fast-xml-parser não têm DTD carregada pra
// resolvê-las.
const _XML_ENTIDADES_PREDEFINIDAS = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);

/** Produção Char da spec XML 1.0 — intervalos de code point válidos.
 *  Exclui controles (exceto tab/LF/CR), surrogates UTF-16 (0xD800-0xDFFF) e
 *  qualquer coisa além de 0x10FFFF. */
function _charXmlValido(cp: number): boolean {
    return (
        cp === 0x9 || cp === 0xA || cp === 0xD ||
        (cp >= 0x20 && cp <= 0xD7FF) ||
        (cp >= 0xE000 && cp <= 0xFFFD) ||
        (cp >= 0x10000 && cp <= 0x10FFFF)
    );
}

/** Substitui o conteúdo de um trecho casado por espaços, preservando as
 *  quebras de linha — usado pra "apagar" CDATA/comentários antes do scan de
 *  entidades sem desalinhar os índices de linha/coluna do restante. */
function _apagarPreservandoLinhas(trecho: string): string {
    return trecho.replace(/[^\n]/g, ' ');
}

/**
 * Entidades XML inválidas — detecção textual dedicada (XMLValidator.validate()
 * não cobre isso, confirmado empiricamente). Duas checagens sobre toda
 * referência `&nome;` / `&#N;` / `&#xHEX;` bem-formada (uma referência com
 * sintaxe quebrada, ex: '&' solto, já é pega pela checagem de sintaxe do
 * fast-xml-parser):
 *   - Entidade NOMEADA fora das 5 pré-definidas do XML (amp/lt/gt/quot/apos)
 *     — entidades HTML como &nbsp; ou &copy; não existem sem DTD.
 *   - Entidade NUMÉRICA (decimal ou hex) fora da produção Char da spec XML
 *     — inclui surrogates soltos e valores além de 0x10FFFF.
 * CDATA e comentários são apagados antes do scan: entidades não são
 * expandidas ali, então '&nbsp;' dentro de um <![CDATA[...]]> é texto
 * literal válido, não uma referência de entidade.
 */
function _entidadesInvalidas(xml: string): string[] {
    const semRuido = xml
        .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, _apagarPreservandoLinhas)
        .replace(/<!--[\s\S]*?-->/g, _apagarPreservandoLinhas);

    const problemas = [];
    const re = /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z_][\w.-]*);/g;
    let m;
    while ((m = re.exec(semRuido))) {
        const corpo = m[1];
        const { linha, coluna } = _linhaColunaDoIndice(xml, m.index);
        if (corpo[0] === '#') {
            const hex = corpo[1] === 'x' || corpo[1] === 'X';
            const cp = parseInt(hex ? corpo.slice(2) : corpo.slice(1), hex ? 16 : 10);
            if (!Number.isFinite(cp) || !_charXmlValido(cp)) {
                problemas.push(`Linha ${linha}, col ${coluna}: entidade numérica '&${corpo};' referencia um code point inválido/fora do intervalo permitido pela especificação XML (U+${cp.toString(16).toUpperCase()}).`);
            }
        } else if (!_XML_ENTIDADES_PREDEFINIDAS.has(corpo)) {
            problemas.push(`Linha ${linha}, col ${coluna}: entidade nomeada '&${corpo};' não é uma das 5 entidades pré-definidas do XML (amp, lt, gt, quot, apos) — sem DTD, entidades HTML como '&nbsp;' ou '&copy;' são inválidas. Use o caractere Unicode direto ou a forma numérica (ex: '&#160;' para nbsp).`);
        }
    }
    return problemas;
}

/**
 * Localiza linha/coluna do primeiro `<tag ... attrNome='attrValor' ...>` a
 * partir do índice `apartirDe` — anexa posição às mensagens das Regras
 * B/H/K, que vêm da árvore preserveOrder (sem posição nativa por nó).
 * Aproximado por natureza: se o mesmo atributo/valor se repetir no
 * documento, aponta a primeira ocorrência a partir do ponto de busca —
 * suficiente pra guiar até o trecho certo, não é garantia de ser a
 * ocorrência exata que a árvore visitou. Retorna '' se não achar (nunca
 * quebra a mensagem por falta de posição).
 */
function _indiceAtributo(xml: string, tag: string, attrNome: string, attrValor: string | null, apartirDe = 0): number {
    if (!attrValor) return -1;
    const escapar = (s: string): string => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`<${escapar(tag)}\\b[^>]*\\b${escapar(attrNome)}=['"]${escapar(attrValor)}['"]`);
    const m = re.exec(xml.slice(apartirDe));
    return m ? apartirDe + m.index : -1;
}

function _localizarAtributo(xml: string, tag: string, attrNome: string, attrValor: string | null, apartirDe = 0): string {
    const idx = _indiceAtributo(xml, tag, attrNome, attrValor, apartirDe);
    if (idx === -1) return '';
    const { linha, coluna } = _linhaColunaDoIndice(xml, idx);
    return ` (linha ${linha}, col ${coluna})`;
}

/**
 * Percorre todos os ELEMENTOS da árvore chamando
 * visit(tag, node, dentroDeWidget). dentroDeWidget = true para qualquer nó
 * descendente de um b:widget — a informação de ancestralidade que o
 * tokenizer manual tentava (e falhava em) reconstruir.
 */
function _visitarElementos(nodes: BloggerDomNode[] | undefined | null, visit: (tag: string, node: BloggerDomNode, dentroDeWidget: boolean) => void, dentroDeWidget = false): void {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
        const tag = _tagDe(node);
        if (!tag || tag === '#text') continue;
        visit(tag, node, dentroDeWidget);
        _visitarElementos(node[tag], visit, dentroDeWidget || tag === 'b:widget');
    }
}

// ──────────────────────────────────────────────────────────────────────────
// NÍVEL 1 — Erros bloqueadores
// ──────────────────────────────────────────────────────────────────────────
export function validarXmlCompilado(xml: string): string[] {
    const erros = [];

    // 1. Sintaxe XML — XMLValidator.validate(), não XMLParser.parse().
    // Achado real: parse() é tolerante e NÃO lança em tag cruzando fronteira
    // de elemento (ex: <div> aberta dentro de <b:includable> e fechada
    // depois de </b:widget> — malformado de verdade, mas parse() engolia
    // silenciosamente enquanto validate() aponta o erro certo). validate()
    // é o mesmo usado em codeValidator.js pra código gerado pela IA.
    const xmlCheck = XMLValidator.validate(xml, { allowBooleanAttributes: true });
    if (xmlCheck !== true) {
        const msg = xmlCheck.err
            ? `Linha ${xmlCheck.err.line}, col ${xmlCheck.err.col}: ${xmlCheck.err.msg}`
            : 'XML malformado';
        erros.push(`XML malformado: ${msg}`);
    }

    // 1b. Comentários malformados (XMLValidator.validate() não cobre isso —
    // ver _comentariosInvalidos acima).
    for (const problema of _comentariosInvalidos(xml)) {
        erros.push(`XML malformado: ${problema}`);
    }

    // 1c. Entidades inválidas — nomeadas fora das 5 pré-definidas do XML, ou
    // numéricas fora da produção Char (ver _entidadesInvalidas acima).
    for (const problema of _entidadesInvalidas(xml)) {
        erros.push(`XML malformado: ${problema}`);
    }

    // 2. Tokens residuais
    const residuais = xml.match(/\[\[[A-Z0-9_]+\]\]/g);
    if (residuais) {
        erros.push(`Tokens não substituídos: ${[...new Set(residuais)].join(', ')}`);
    }

    // 3. b:loop="loop" — corrupção SAXParseException
    // fast-xml-parser pode aceitar mas o parser Java do Blogger rejeita.
    if (/<b:loop="loop"/.test(xml)) {
        erros.push('b:loop="loop" detectado — corrupção que causa SAXParseException no Blogger. Execute repararXml() antes de validar.');
    }

    // 4. b:loop sem var ou values
    const loopTags = [...xml.matchAll(/<b:loop\b([^>]*)>/g)];
    for (const m of loopTags) {
        const attrs = m[1];
        if (!/\bvar\s*=/.test(attrs))    erros.push(`b:loop sem atributo 'var': ${m[0].slice(0, 80)}`);
        if (!/\bvalues\s*=/.test(attrs)) erros.push(`b:loop sem atributo 'values': ${m[0].slice(0, 80)}`);
    }

    // 5. b:if sem cond
    const ifTags = [...xml.matchAll(/<b:if\b([^>]*)>/g)];
    for (const m of ifTags) {
        if (!/\bcond\s*=/.test(m[1])) {
            erros.push(`b:if sem atributo 'cond': ${m[0].slice(0, 80)}`);
        }
    }

    // 6. b:widget sem id ou type
    // (?!-) evita casar <b:widget-settings> / <b:widget-setting> — o \b sozinho
    // trata o hífen como fronteira de palavra e geraria falsos positivos.
    const widgetTags = [...xml.matchAll(/<b:widget(?!-)\b([^>]*)>/g)];
    for (const m of widgetTags) {
        const attrs = m[1];
        if (!/\bid\s*=/.test(attrs))   erros.push(`b:widget sem atributo 'id': ${m[0].slice(0, 80)}`);
        if (!/\btype\s*=/.test(attrs)) erros.push(`b:widget sem atributo 'type': ${m[0].slice(0, 80)}`);
    }

    // 7. Tags b:if / b:loop desbalanceadas
    const openIf   = (xml.match(/<b:if\b/g)    || []).length;
    const closeIf  = (xml.match(/<\/b:if>/g)   || []).length;
    if (openIf !== closeIf) {
        erros.push(`b:if desbalanceado: ${openIf} abertura(s) × ${closeIf} fechamento(s)`);
    }

    const openLoop  = (xml.match(/<b:loop\b/g)   || []).length;
    const closeLoop = (xml.match(/<\/b:loop>/g)  || []).length;
    if (openLoop !== closeLoop) {
        erros.push(`b:loop desbalanceado: ${openLoop} abertura(s) × ${closeLoop} fechamento(s)`);
    }

    return erros;
}

// Tags HTML "de conteúdo" que, diretamente dentro de uma b:section (fora de
// qualquer b:widget), disparam o aviso da Regra B.
const _HTML_ALERTA = new Set([
    'div', 'p', 'a', 'span', 'ul', 'ol', 'table',
    'section', 'article', 'header', 'nav', 'footer',
]);

/**
 * Regra B (núcleo): true se a subárvore de uma b:section contém alguma tag
 * HTML de conteúdo no "território próprio" da seção — parando em b:widget
 * (HTML lá dentro é sempre legítimo) e em b:section filha (avaliada no seu
 * próprio turno pelo caminhador, não vaza pro pai).
 */
function _temHtmlProprio(children: BloggerDomNode[] | undefined | null): boolean {
    if (!Array.isArray(children)) return false;
    for (const node of children) {
        const tag = _tagDe(node);
        if (!tag || tag === '#text') continue;
        if (tag === 'b:widget' || tag === 'b:section') continue;
        if (_HTML_ALERTA.has(tag.toLowerCase())) return true;
        if (_temHtmlProprio(node[tag])) return true;
    }
    return false;
}

/**
 * Regra G (núcleo): coleta todo b:widget cujo pai DIRETO não é b:section.
 * Bug real: <div class='col-lg-8'> (ou qualquer outro elemento) entre a
 * b:section e o b:widget é XML bem-formado e passa despercebido por checagens
 * de presença simples (Regra A), mas o Blogger rejeita o upload/salvamento
 * inteiro com "The widget with id X is not within a section (actual parent
 * element is: Y.)". A árvore torna isso trivial: basta olhar a tag do nó pai
 * imediato, sem precisar reconstruir ancestralidade via regex.
 */
function _widgetsForaDeSection(nodes: BloggerDomNode[] | undefined | null, parentTag: string | null, achados: WidgetForaDeSection[]): void {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
        const tag = _tagDe(node);
        if (!tag || tag === '#text') continue;
        if (tag === 'b:widget' && parentTag !== 'b:section') {
            const attrs = _attrsDe(node);
            achados.push({ id: attrs['@_id'] || '?', tipo: attrs['@_type'] || '?', pai: parentTag });
        }
        _widgetsForaDeSection(node[tag], tag, achados);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// NÍVEL 2 — Erros estruturais + Avisos
// ──────────────────────────────────────────────────────────────────────────
export function validarXmlEstrutura(xml: string): XmlValidationReport {
    const erros  = [];
    const avisos = [];

    const arvore = _parseDom(xml);

    // A. Widget Blog (type='Blog') ausente — posts nunca renderizam
    let temBlogWidget = false;
    if (arvore) {
        _visitarElementos(arvore, (tag, node) => {
            if (tag === 'b:widget' && _attrsDe(node)['@_type'] === 'Blog') temBlogWidget = true;
        });
    } else {
        // fallback textual quando o XML nem parseia
        temBlogWidget = /<b:widget\b[^>]*type=['"]Blog['"]/.test(xml);
    }
    if (!temBlogWidget) {
        erros.push("Widget type='Blog' ausente — sem ele as postagens do Blogger nunca são entregues ao template.");
    }

    // B. b:section com HTML direto no seu território próprio (fora de
    // b:widget e fora de b:section filha). Seções declaradas DENTRO do corpo
    // de um widget são ignoradas (dentroDeWidget) — checar sub-estrutura
    // interna de um widget está fora do escopo desta regra.
    if (arvore) {
        _visitarElementos(arvore, (tag, node, dentroDeWidget) => {
            if (tag !== 'b:section' || dentroDeWidget) return;
            if (_temHtmlProprio(node[tag])) {
                const id = _attrsDe(node)['@_id'] || '?';
                const local = _localizarAtributo(xml, 'b:section', 'id', id);
                avisos.push(`b:section id='${id}' contém HTML diretamente (fora de b:widget) — ignorado pelo engine de layout V3.${local}`);
            }
        });
    }

    // G. b:widget cujo pai direto não é b:section — erro bloqueador, igual
    // ao Blogger real (upload rejeitado, não só um aviso de qualidade).
    if (arvore) {
        const foraDeSection: WidgetForaDeSection[] = [];
        _widgetsForaDeSection(arvore, null, foraDeSection);
        for (const w of foraDeSection) {
            const local = _localizarAtributo(xml, 'b:widget', 'id', w.id !== '?' ? w.id : null);
            erros.push(`Widget ${w.id} (type='${w.tipo}') não é filho direto de b:section — pai real: <${w.pai}>. Blogger rejeita o upload com "is not within a section".${local}`);
        }
    }

    // C. API depreciada data:blog.pageType → usar data:view.*
    if (/data:blog\.pageType/.test(xml)) {
        avisos.push("data:blog.pageType detectado — API depreciada em V3. Usar data:view.isPost, data:view.isHomepage, etc.");
    }

    // D. Atributo class corrompido pela Regra 4 antiga (padrão: class='x="y"')
    const classCorruption = [...xml.matchAll(/class='[^']*\w+="[^"]*"[^']*'/g)];
    if (classCorruption.length > 0) {
        avisos.push(`Atributo 'class' corrompido detectado (${classCorruption.length} ocorrência(s)) — padrão x="y" dentro de class='...'. Provável efeito do bug da Regra 4 anterior.`);
    }

    // E. xmlns Blogger ausentes na tag <html>
    const htmlTag = (xml.match(/<html\b[^>]*>/) || [''])[0];
    if (htmlTag && !htmlTag.includes('xmlns:b=')) {
        avisos.push("xmlns:b ausente na tag <html> — o engine Blogger não reconhecerá as tags b:* sem o namespace declarado.");
    }

    // F. b:layoutsVersion ausente
    if (!/<html\b[^>]*b:layoutsVersion/.test(xml)) {
        avisos.push("b:layoutsVersion ausente na tag <html> — template opera em modo legado (layouts v1/v2).");
    }

    return { erros, avisos };
}

// ──────────────────────────────────────────────────────────────────────────
// NÍVEL 3 — Semântica de runtime do Blogger
//
// Cobre a classe de bug do "Blog1 aceito no import mas quebrado ao
// renderizar" (fix ff7b011): o XML é bem-formado, o import passa, mas a
// máquina de runtime do Blogger falha ao expandir includables. Nada disso
// é detectável por parser XML puro — precisa de análise semântica:
//
//   G. Widget Blog1 sem <b:widget-settings> — o Blogger aplica defaults
//      'true' do painel e aciona a cadeia interna de bylines/share icons,
//      que os temas customizados não definem → SAXParseException em runtime.
//   H. <b:include name='X'/> estático referenciando includable inexistente
//      (refs órfãs) — quebra a expansão do widget na renderização.
//   I. <script> aninhado dentro de outro <script> (fora de CDATA/comentário)
//      — fecha o CDATA externo prematuramente e vaza JS como texto solto.
//   J. Cadeia dinâmica de share icons ativa sem os stubs de ícone definidos
//      (aviso — defesa em profundidade; só quebra se (G) também falhar).
//   K. <b:widget-setting name='X'> com X fora da whitelist conhecida pro
//      tipo do widget — Blogger rejeita o upload/salvamento inteiro com
//      "'X' is not a valid setting name" (bug real: 'showEmail' inventado
//      pro ContactForm1, nunca existiu na plataforma).
// ──────────────────────────────────────────────────────────────────────────

// Includables definidos pela PLATAFORMA Blogger — nunca são órfãos.
// 'widget-title'/'responsiveImage'/'responsiveImageStyle' confirmados via
// exemplos/pop-retro-pixel.xml (tema real, comercializado como pronto —
// usa os 3 sem jamais definir localmente, e renderiza normalmente no
// Blogger de verdade): includables internos do motor de widgets/imagem
// responsiva da plataforma, não algo que o autor do tema precise declarar.
// Achado real da migração pop-retro-pixel (Fase 2, 10/11) — gamer-playerone
// tinha contornado o mesmo gap removendo a referência em vez de corrigir a
// whitelist na raiz (ver template_gamer-playerone.xml, achado 14).
const INCLUDABLES_BUILTIN = new Set([
    'all-head-content', 'quickedit', 'google-analytics',
    'widget-title', 'responsiveImage', 'responsiveImageStyle',
]);

// Nomes de b:widget-setting confirmados como válidos por tipo de widget —
// fonte: gadgets_essenciais em
// rag-ia-suporte/ia-de-balcao/blogger-xml/ia-balcao-blogger-gadgets-parser-xml.json,
// capturado de XML real exportado do Blogger (não é documentação pública —
// a Google nunca publicou essa whitelist). ContactForm: [] é intencional —
// o XML de referência é um widget self-closing, sem nenhuma setting válida
// conhecida; qualquer b:widget-setting ali é suspeito até prova em contrário.
// Tipos de widget ausentes daqui (LinkList, Profile, Text, Header...) não
// são checados — evita falso positivo sobre schema que não confirmamos.
const WIDGET_SETTINGS_VALIDOS: Record<string, string[]> = {
    ContactForm:  [],
    PopularPosts: ['numItemsToShow', 'showThumbnails', 'showSnippets', 'timeRange'],
    // 'showFreqNumbers' confirmado por uma 2ª fonte independente de XML real
    // exportado do Blogger (Bulma_Vegan.xml, template hand-built de
    // referência usado na investigação de qualidade dos templates da
    // Engine) — mesmo padrão de evidência do resto desta whitelist.
    Label:        ['display', 'sorting', 'showFreqNumbers'],
    // 'pageListJson' confirmado por uma 3ª fonte independente de XML real
    // exportado do Blogger (exemplos/tecnologia-mag-tech.xml) — guarda a
    // lista de páginas/ordem customizada do widget, mesmo padrão de
    // evidência do resto desta whitelist.
    PageList:     ['homeTitle', 'pageListJson'],
    HTML:         ['content'],
    Blog: [
        'showDateHeader', 'showShareButtons', 'showCommentLink', 'showAuthor',
        'showLabels', 'showTimestamp', 'showBacklinks', 'showInlineAds', 'showReactions',
    ],
    // Stats/BlogArchive/Translate/FeaturedPost — novos tipos checados a
    // partir desta rodada, mesma fonte (Bulma_Vegan.xml).
    Stats:        ['showGraphicalCounter', 'showAnimatedCounter', 'showSparkline', 'sparklineStyle', 'timeRange'],
    BlogArchive:  ['showStyle', 'yearPattern', 'showWeekEnd', 'monthPattern', 'dayPattern', 'weekPattern', 'chronological', 'showPosts', 'frequency'],
    Translate:    ['displayMode'],
    FeaturedPost: ['showSnippet', 'showPostTitle', 'postId', 'showFirstImage', 'useMostRecentPost'],
};

export function validarSemanticaBlogger(xml: string): XmlValidationReport {
    const erros  = [];
    const avisos = [];

    const arvore = _parseDom(xml);

    // Conteúdo de CDATA e comentários é texto para o parser — removido antes
    // de qualquer análise de tags para não gerar falsos positivos (ex: um
    // comentário explicativo que menciona "<script>").
    const xmlLimpo = xml
        .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '[CDATA]')
        .replace(/<!--[\s\S]*?-->/g, '');

    // G. Blog1 precisa declarar widget-settings — via árvore: filho direto
    // do próprio nó do widget, sem o risco do regex de par não-guloso parar
    // no </b:widget> errado quando houver widget aninhado.
    // H (coleta). Includables definidos e includes ESTÁTICOS (name= sem
    // expr:name — expr:name é dinâmico, resolvido em runtime) — via árvore:
    // ignora automaticamente CDATA e comentários.
    const definidos = new Set<string>();
    const includesEstaticos = new Set<string>();

    if (arvore) {
        _visitarElementos(arvore, (tag, node) => {
            if (tag === 'b:widget' && _attrsDe(node)['@_id'] === 'Blog1') {
                const temSettings = (node[tag] || []).some((f: BloggerDomNode) => _tagDe(f) === 'b:widget-settings');
                if (!temSettings) {
                    erros.push("Widget Blog1 sem <b:widget-settings> — o Blogger aplica defaults 'true' (bylines/share) e aciona includables internos que os temas customizados não definem. Causa raiz do bug de renderização do Blog1 (fix ff7b011).");
                }
            } else if (tag === 'b:includable') {
                const id = _attrsDe(node)['@_id'];
                if (id) definidos.add(id);
            } else if (tag === 'b:include') {
                const a = _attrsDe(node);
                if (a['@_name'] && !a['@_expr:name']) includesEstaticos.add(a['@_name']);
            }
        });
    } else {
        // XML nem parseia (o malformado já é erro bloqueador na checagem de
        // sintaxe) — fallback textual só pra coleta, pro J abaixo não cegar.
        for (const m of xml.matchAll(/<b:includable[^>]*\bid=['"]([^'"]+)['"]/g)) definidos.add(m[1]);
        for (const m of xml.matchAll(/<b:include\b(?![^>]*expr:name)[^>]*\bname=['"]([^'"]+)['"]/g)) includesEstaticos.add(m[1]);
    }

    // H (veredito). Refs órfãs
    const orfas = [...includesEstaticos].filter(n => !definidos.has(n) && !INCLUDABLES_BUILTIN.has(n));
    if (orfas.length > 0) {
        const listaComLocal = orfas.slice(0, 6)
            .map(n => `${n}${_localizarAtributo(xml, 'b:include', 'name', n)}`)
            .join(', ');
        erros.push(`b:include referenciando includable(s) inexistente(s): ${listaComLocal} — quebra a expansão do widget na renderização.`);
    }

    // I. Scripts aninhados / desbalanceados (fora de CDATA e comentários).
    // <script .../> auto-fechado é válido em XML e não abre bloco.
    let depth = 0, aninhados = 0;
    for (const m of xmlLimpo.matchAll(/<\/?script\b[^>]*?(\/?)>/g)) {
        if (m[0].startsWith('</'))      depth = Math.max(0, depth - 1);
        else if (m[1] !== '/') {
            if (depth > 0) aninhados++;
            depth++;
        }
    }
    if (aninhados > 0) {
        erros.push(`${aninhados} <script> aninhado(s) dentro de outro <script> — fecha o CDATA externo prematuramente e vaza JS como texto (SAXParseException em runtime).`);
    }
    if (depth !== 0) {
        erros.push(`Tags <script> desbalanceadas (${depth > 0 ? depth + ' sem fechamento' : 'fechamento(s) extra(s)'}).`);
    }

    // J. Cadeia dinâmica de ícones de share sem stubs (aviso)
    const usaIconChain = /expr:name='data:platform\.key/.test(xml) || /expr:name="data:platform\.key/.test(xml);
    if (usaIconChain) {
        const stubs = ['shareIcon', 'emailIcon', 'facebookIcon', 'twitterIcon'];
        const faltando = stubs.filter(id => !definidos.has(id));
        if (faltando.length > 0) {
            avisos.push(`Cadeia dinâmica de share icons ativa mas stub(s) ausente(s): ${faltando.join(', ')} — risco de includable órfão em runtime se widget-settings for removido.`);
        }
    }

    // K. b:widget-setting com nome fora da whitelist conhecida pro tipo do
    // widget — via árvore: settings são filhos DIRETOS do próprio widget,
    // sem o par não-guloso do regex antigo (que atribuiria as settings do
    // widget errado se houvesse aninhamento).
    if (arvore) {
        _visitarElementos(arvore, (tag, node) => {
            if (tag !== 'b:widget') return;
            const attrs   = _attrsDe(node);
            const tipo    = attrs['@_type'];
            const validos = WIDGET_SETTINGS_VALIDOS[tipo];
            if (!validos) return; // tipo sem whitelist confirmada — não checa (evita falso positivo)

            const invalidos = new Set<string>();
            for (const filho of node[tag] || []) {
                if (_tagDe(filho) !== 'b:widget-settings') continue;
                for (const setting of filho['b:widget-settings'] || []) {
                    if (_tagDe(setting) !== 'b:widget-setting') continue;
                    const nome = _attrsDe(setting)['@_name'];
                    if (nome && !validos.includes(nome)) invalidos.add(nome);
                }
            }
            if (invalidos.size > 0) {
                // Ancora a busca de linha/coluna no próprio widget (via id, quando
                // presente) pra não confundir settings de mesmo nome inválido em
                // widgets diferentes com a mesma posição.
                const widgetId = attrs['@_id'];
                const apartirDe = widgetId ? Math.max(0, _indiceAtributo(xml, 'b:widget', 'id', widgetId)) : 0;
                const listaComLocal = [...invalidos]
                    .map(nome => `${nome}${_localizarAtributo(xml, 'b:widget-setting', 'name', nome, apartirDe)}`)
                    .join(', ');
                erros.push(`Widget ${attrs['@_id'] || tipo} (type='${tipo}'): setting(s) inválido(s) ${listaComLocal} — Blogger rejeita o upload com "is not a valid setting name". Válidos para ${tipo}: ${validos.length ? validos.join(', ') : 'nenhum (widget não aceita widget-settings)'}.`);
            }
        });
    }

    return { erros, avisos };
}

