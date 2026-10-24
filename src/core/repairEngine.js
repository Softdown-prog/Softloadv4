"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.repararXml = repararXml;
exports.repararCssTruncado = repararCssTruncado;
// ============================================================
// REPAIR ENGINE — M9
// Opera sobre os achados do validador e do compilador para
// produzir reparos dirigidos sem reinventar o template.
//
// Dois níveis de operação (Level 1 — reparo de blueprint pré-compilação —
// e o Orchestrator que combinava os dois foram removidos: só existiam
// para servir compilarTemplateIA()/bloggerAiCompiler.js, o compilador
// legado M4 baseado em AST, que não tem mais nenhum chamador vivo desde
// que compile.js + o dossiê por nicho assumiram o pipeline real):
//
//   Level 2 — XML (pós-compilação)
//     Corrige o XML compilado antes do upload ao GCS:
//       • Tokens residuais [[SLOT]] → ''
//       • IDs de b:widget duplicados → renumerados (offset 900+)
//     Idempotente: XML sem problemas devolvido inalterado.
//
//   Level 2b — CSS (repararCssTruncado)
//     Fecha chaves '{' sem '}' até o fim do bloco — reaproveitado fora do
//     pipeline de compilação pelo validador de código do chat (ver
//     chatCodeValidator.js) para corrigir snippets CSS truncados sem
//     precisar de uma chamada de IA.
//
// Cada reparo é um objecto:
//   { campo, acção, antes?, depois?, detalhes? }
// ============================================================
// ──────────────────────────────────────────────────────────────────────────
// LEVEL 2 — repararXml
// Corrige o XML compilado antes do upload.
// Regras aplicadas em sequência, cada uma idempotente.
// ──────────────────────────────────────────────────────────────────────────
function repararXml(xml) {
    const reparos = [];
    let reparado = xml;
    // ── Regra 0: b:loop="loop" corrompido → b:loop ────────────────────────
    // Bug histórico: Regra 4 antiga usava \b sem lookbehind e expandia
    // o 'loop' dentro de 'b:loop' para b:loop="loop", causando
    // SAXParseException no parser Java do Blogger.
    {
        const antes = reparado;
        reparado = reparado.replace(/<b:loop="loop"/g, '<b:loop');
        reparado = reparado.replace(/<\/b:loop="loop">/g, '</b:loop>');
        if (reparado !== antes) {
            reparos.push({
                acção: 'bloop_corruption_corrigido',
                detalhes: 'b:loop="loop" restaurado para b:loop (bug da Regra 4 anterior)',
            });
        }
    }
    // ── Regra 1: tokens residuais [[SLOT]] → '' ───────────────────────────
    const orfaos = reparado.match(/\[\[[A-Z0-9_]+\]\]/g);
    if (orfaos) {
        const unicos = [...new Set(orfaos)];
        reparado = reparado.replace(/\[\[[A-Z0-9_]+\]\]/g, '');
        reparos.push({
            acção: 'orphan_tokens_removidos',
            detalhes: `${unicos.length} token(s) residual(ais): ${unicos.join(', ')}`,
        });
    }
    // ── Regra 2: IDs de b:widget duplicados → renumerados ─────────────────
    // Padrão: id='HTML301' ou id="HTML301"
    const widgetIdRe = /(<b:widget\b[^>]*?\bid=)(['"])([A-Za-z]+)(\d+)\2/g;
    const seenIds = new Map(); // id → índice da primeira ocorrência
    const duplicadosId = new Set();
    // Primeira passagem: identificar duplicados
    let m;
    while ((m = widgetIdRe.exec(reparado)) !== null) {
        const id = m[3] + m[4];
        if (seenIds.has(id)) {
            duplicadosId.add(id);
        }
        else {
            seenIds.set(id, m.index);
        }
    }
    if (duplicadosId.size > 0) {
        // Alocador com offset alto para evitar colisão com os IDs já presentes
        const maxExistente = Math.max(0, ...[...seenIds.keys()].map(id => parseInt(id.replace(/\D/g, '')) || 0));
        const startOffset = Math.max(900, maxExistente + 100);
        const typeCounters = {};
        const primeiraOcorrencia = new Set();
        reparado = reparado.replace(widgetIdRe, (match, prefix, quote, tipo, num) => {
            const id = tipo + num;
            const chave = id;
            if (duplicadosId.has(chave) && primeiraOcorrencia.has(chave)) {
                // É duplicado — atribuir novo ID
                if (!typeCounters[tipo])
                    typeCounters[tipo] = startOffset;
                typeCounters[tipo]++;
                const novoId = tipo + typeCounters[tipo];
                reparos.push({
                    acção: 'widget_id_renumerado',
                    detalhes: `${id} → ${novoId}`,
                });
                return `${prefix}${quote}${novoId}${quote}`;
            }
            primeiraOcorrencia.add(chave);
            return match;
        });
    }
    // ── Regra 3: & não escapado em atributos href/src (fora de CDATA) ────────
    // Causa do erro: org.xml.sax.SAXParseException "The reference to entity
    // 'display' must end with the ';' delimiter" — aparece quando uma URL do
    // Google Fonts (ex: &display=swap) é injetada num atributo XML sem escapar.
    // CDATA é ignorado: dentro de <![CDATA[...]]> o & é literal e não precisa escape.
    {
        // Separa segmentos CDATA (não tocar) dos segmentos XML (corrigir)
        const CDATA_RE = /<!\[CDATA\[[\s\S]*?\]\]>/g;
        const segs = [];
        let last = 0;
        let mc;
        CDATA_RE.lastIndex = 0;
        while ((mc = CDATA_RE.exec(reparado)) !== null) {
            if (mc.index > last)
                segs.push({ cdata: false, txt: reparado.slice(last, mc.index) });
            segs.push({ cdata: true, txt: mc[0] });
            last = mc.index + mc[0].length;
        }
        if (last < reparado.length)
            segs.push({ cdata: false, txt: reparado.slice(last) });
        // Regex da entidade XML válida — não tocar nestas
        const ENTIDADE_OK = /&(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/;
        const AMP_BARE = /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g;
        let totalAmp = 0;
        const reparadoSegs = segs.map(seg => {
            if (seg.cdata)
                return seg.txt;
            // Escapa & solto dentro de atributos href, src, action (aspas simples ou duplas)
            const fixed = seg.txt
                .replace(/(href|src|action)='([^']*)'/g, (m, attr, val) => {
                const f = val.replace(AMP_BARE, '&amp;');
                if (f !== val)
                    totalAmp++;
                return `${attr}='${f}'`;
            })
                .replace(/(href|src|action)="([^"]*)"/g, (m, attr, val) => {
                const f = val.replace(AMP_BARE, '&amp;');
                if (f !== val)
                    totalAmp++;
                return `${attr}="${f}"`;
            });
            return fixed;
        }).join('');
        if (totalAmp > 0) {
            reparado = reparadoSegs;
            reparos.push({
                acção: 'amp_escapado_em_atributos',
                detalhes: `${totalAmp} ocorrência(s) de & não escapado em href/src corrigida(s) (ex: &display= → &amp;display=)`,
            });
        }
    }
    // ── Regra 4: atributos booleanos HTML5 sem valor → XML-válidos ──────────
    // SAXParseException: Attribute "allowfullscreen" must be followed by '='
    // Em HTML5 são válidos sem valor, mas Blogger/XML exige attr="attr".
    // Cobre os mais comuns em templates: allowfullscreen, autoplay, controls,
    // loop, muted — fora de CDATA (dentro de CDATA são apenas texto).
    {
        const BOOL_ATTRS = ['allowfullscreen', 'autoplay', 'controls', 'loop', 'muted', 'novalidate'];
        // (?<=[\s"']) garante que o attr está em posição de atributo (precedido de
        // espaço ou aspas) — impede match em nomes de tag como b:loop ou b:loop>.
        const boolRe = new RegExp(`(?<=[\\s"'])(${BOOL_ATTRS.join('|')})(?!=)(?=[\\s>/])`, 'g');
        const antes = reparado;
        reparado = reparado.replace(boolRe, (_, attr) => `${attr}="${attr}"`);
        if (reparado !== antes) {
            reparos.push({
                acção: 'boolean_attrs_normalizados',
                detalhes: `Atributos booleanos HTML5 expandidos para attr="attr" (compatibilidade XML/Blogger)`,
            });
        }
    }
    // ── Regra 5: whitespace não-ASCII dentro de tags → espaço comum ──────────
    // SAXParseException: Element type "b:loop" must be followed by either
    // attribute specifications, ">" or "/>".
    // XML 1.0 só aceita 0x20 0x09 0x0D 0x0A como whitespace em tags.
    // U+00A0 (non-breaking space) e outros Unicode whitespace gerados por IA
    // causam erro fatal porque o SAX parser não os reconhece como separadores.
    {
        const antes = reparado;
        // U+00A0 non-breaking, U+2009 thin, U+2002 en, U+2003 em, U+3000 ideographic
        reparado = reparado.replace(/[\u00A0\u2009\u2002\u2003\u3000]/g, ' ');
        // Zero-width (U+200B, U+200C, U+200D, U+2060) e BOM (U+FEFF) — invisíveis, removidos
        reparado = reparado.replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, '');
        if (reparado !== antes) {
            reparos.push({
                acao: 'unicode_whitespace_normalizado',
                detalhes: 'Whitespace nao-ASCII substituido por espaco ASCII (SAXParseException b:loop/b:widget)',
            });
        }
    }
    // ── Regra 6: b:widget type='HTML' sem <b:includable id='main'> ──────────
    // Em Blogger V3 todo conteúdo (HTML, b:loop, b:if) deve morar dentro de
    // <b:includable id='main'>. Conteúdo diretamente no b:widget é ignorado
    // pelo engine de layout moderno.
    // Só corrige widgets type='HTML' — outros tipos (PageList, Blog, Profile)
    // têm seus próprios includables gerenciados pelo Blogger.
    {
        const antes = reparado;
        // Captura <b:widget type='HTML' ...>CONTEÚDO</b:widget> sem b:includable
        reparado = reparado.replace(/(<b:widget\b(?=[^>]*type='HTML')[^>]*>)([\s\S]*?)<\/b:widget>/g, (match, openTag, content) => {
            if (/<b:includable\b/.test(content))
                return match;
            // Separa o bloco de settings (filho legítimo direto) do restante.
            // Padrão moderno: wrapper plural <b:widget-settings> envolvendo um ou
            // mais <b:widget-setting>. Testar o wrapper PRIMEIRO evita que a regex
            // do singular capture só o filho e deixe o wrapper vazio como "rest"
            // (rest não-vazio → Regra 6 dispara e aninha o wrapper vazio dentro do
            // includable novo, produzindo XML inválido).
            const wrapperMatch = content.match(/<b:widget-settings>[\s\S]*?<\/b:widget-settings>/);
            let settings, rest;
            if (wrapperMatch) {
                settings = wrapperMatch[0];
                rest = content.replace(wrapperMatch[0], '').trim();
            }
            else {
                settings = [...content.matchAll(/<b:widget-setting\b[\s\S]*?<\/b:widget-setting>/g)]
                    .map(m => m[0]).join('\n');
                rest = content.replace(/<b:widget-setting\b[\s\S]*?<\/b:widget-setting>/g, '').trim();
            }
            if (!rest)
                return match;
            const sep = settings ? `\n${settings}\n` : '\n';
            return `${openTag}${sep}<b:includable id='main'>\n${rest}\n</b:includable>\n</b:widget>`;
        });
        if (reparado !== antes) {
            reparos.push({
                acção: 'includable_main_inserido',
                detalhes: "Conteúdo de b:widget type='HTML' sem b:includable id='main' — envolvido automaticamente (estrutura V3)",
            });
        }
    }
    // ── Regra 7: comentários XML com "--" → removidos ────────────────────────
    // SAXParseException: "The string '--' is not permitted within comments"
    // CSS custom properties (--sl-primary) e JS decrement (i--) dentro de
    // comentários <!-- --> são válidos em HTML5 mas proibidos em XML/Blogger.
    // Estratégia: remover o comentário inteiro (são anotações dev, nunca
    // visíveis ao usuário). Segmenta CDATA primeiro — lá o -- é texto literal.
    {
        const CDATA_RE2 = /<!\[CDATA\[[\s\S]*?\]\]>/g;
        const segs2 = [];
        let last2 = 0;
        let mc2;
        CDATA_RE2.lastIndex = 0;
        while ((mc2 = CDATA_RE2.exec(reparado)) !== null) {
            if (mc2.index > last2)
                segs2.push({ cdata: false, txt: reparado.slice(last2, mc2.index) });
            segs2.push({ cdata: true, txt: mc2[0] });
            last2 = mc2.index + mc2[0].length;
        }
        if (last2 < reparado.length)
            segs2.push({ cdata: false, txt: reparado.slice(last2) });
        let totalFixed = 0;
        const reparadoSegs2 = segs2.map(seg => {
            if (seg.cdata)
                return seg.txt;
            return seg.txt.replace(/\s*<!--[\s\S]*?-->/g, (match) => {
                // Extrai apenas o corpo do comentário (sem <!-- e -->)
                const body = match.replace(/^\s*<!--/, '').replace(/-->$/, '');
                if (!body.includes('--'))
                    return match;
                totalFixed++;
                return ''; // Remove o comentário inteiro — mais seguro que patch
            });
        }).join('');
        if (totalFixed > 0) {
            reparado = reparadoSegs2;
            reparos.push({
                acção: 'double_dash_em_comentario_removido',
                detalhes: `${totalFixed} comentário(s) XML com "--" removido(s) (SAXParseException: string "--" not permitted within comments)`,
            });
        }
    }
    return {
        xml: reparado,
        reparos,
        total: reparos.length,
    };
}
function repararCssTruncado(css) {
    if (typeof css !== 'string')
        return { css, reparado: false };
    const semComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '');
    let depth = 0;
    for (const ch of semComentarios) {
        if (ch === '{')
            depth++;
        else if (ch === '}')
            depth = Math.max(0, depth - 1);
    }
    if (depth <= 0)
        return { css, reparado: false };
    return { css: css.replace(/\s*$/, '') + '\n' + '}'.repeat(depth), reparado: true };
}
