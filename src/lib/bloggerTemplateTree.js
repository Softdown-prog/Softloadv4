'use strict';

// ============================================================
// bloggerTemplateTree.js — parser + renderer de árvore pro
// subconjunto de tags de controle do Blogger (b:if/b:elseif/b:else,
// b:loop, b:with, b:include, b:widget/b:widget-settings,
// b:includable, b:section). Ver bloggerTemplateEngine.js pro
// avaliador de expressão (cond=/values=/expr:attr=) usado aqui.
//
// Desenho: scanner linear de string (não é um parser XML genérico —
// o conteúdo real mistura HTML cru, CDATA de CSS/JS e atributos
// expr:/data: que um parser XML padrão não entende de forma alguma)
// que reconhece só os marcadores de controle listados em MARKERS,
// mantendo tudo o mais (HTML puro, texto, <data:.../> e expr:attr=)
// como nó de texto — a substituição desses últimos acontece na hora
// de RENDERIZAR o texto (renderText), não no parse, porque o valor
// certo depende do contexto (post do loop atual, var do b:with etc.).
//
// Cada marcador termina com espaço (ex.: '<b:widget ') ou é literal
// completo (ex.: '<b:else/>') propositalmente — evita <b:widget
// colidir com <b:widget-settings (só funciona porque, no corpus real,
// toda tag de abertura com atributos SEMPRE tem espaço depois do
// nome; confirmado nos 19 chassis + 13 exemplos reais).
// ============================================================

const MARKERS = [
    '<![CDATA[', '<!--',
    '<b:if ', '<b:elseif ', '<b:else/>', '</b:if>',
    '<b:loop ', '</b:loop>',
    '<b:with ', '</b:with>',
    '<b:include ',
    '<b:widget-settings>', '</b:widget-settings>',
    '<b:widget ', '</b:widget>',
    '<b:includable ', '</b:includable>',
    '<b:section ', '</b:section>',
];

function findNextMarker(str, from) {
    let best = -1, bestMarker = null;
    for (const m of MARKERS) {
        const idx = str.indexOf(m, from);
        if (idx !== -1 && (best === -1 || idx < best)) { best = idx; bestMarker = m; }
    }
    return { idx: best, marker: bestMarker };
}

function tagEnd(str, from) { return str.indexOf('>', from); }

function extractAttr(tagStr, name) {
    const m = tagStr.match(new RegExp(`\\b${name}='([^']*)'`));
    return m ? m[1] : null;
}

function parseNodes(state, stopMarkers) {
    const nodes = [];
    for (;;) {
        const { idx, marker } = findNextMarker(state.str, state.i);
        if (idx === -1) {
            nodes.push({ type: 'text', text: state.str.slice(state.i) });
            state.i = state.str.length;
            return nodes;
        }
        if (stopMarkers.includes(marker)) {
            if (idx > state.i) nodes.push({ type: 'text', text: state.str.slice(state.i, idx) });
            return nodes; // não consome o marcador de fechamento — o caller consome
        }
        if (idx > state.i) nodes.push({ type: 'text', text: state.str.slice(state.i, idx) });

        if (marker === '<![CDATA[') {
            const end = state.str.indexOf(']]>', idx);
            const stop = end === -1 ? state.str.length : end + 3;
            nodes.push({ type: 'text', text: state.str.slice(idx, stop) }); // opaco — nunca interpretado
            state.i = stop;
            continue;
        }

        if (marker === '<!--') {
            // Achado real (tecnologia-techwind): os doc-comments de achado no
            // topo dos templates citam nomes de tag como prosa dentro do
            // próprio comentário (ex.: "o <b:includable id='main'> customizado
            // nunca referencia <data:content/>") — sem tratar <!-- --> como
            // região opaca, o scanner interpretava esse texto como tag real e
            // "engolia" o resto do documento procurando um fechamento que
            // nunca vem no lugar certo.
            const end = state.str.indexOf('-->', idx);
            const stop = end === -1 ? state.str.length : end + 3;
            nodes.push({ type: 'text', text: state.str.slice(idx, stop) });
            state.i = stop;
            continue;
        }

        if (marker === '<b:if ') {
            const tEnd = tagEnd(state.str, idx);
            const condRaw = extractAttr(state.str.slice(idx, tEnd + 1), 'cond');
            state.i = tEnd + 1;
            const branches = [];
            let curCond = condRaw;
            for (;;) {
                const children = parseNodes(state, ['<b:elseif ', '<b:else/>', '</b:if>']);
                branches.push({ cond: curCond, children });
                const nextMark = findNextMarker(state.str, state.i);
                if (nextMark.marker === '<b:elseif ') {
                    const bEnd = tagEnd(state.str, nextMark.idx);
                    curCond = extractAttr(state.str.slice(nextMark.idx, bEnd + 1), 'cond');
                    state.i = bEnd + 1;
                    continue;
                }
                if (nextMark.marker === '<b:else/>') {
                    state.i = nextMark.idx + '<b:else/>'.length;
                    const elseChildren = parseNodes(state, ['</b:if>']);
                    branches.push({ cond: null, children: elseChildren });
                    const closeIdx = state.str.indexOf('</b:if>', state.i);
                    state.i = closeIdx === -1 ? state.str.length : closeIdx + '</b:if>'.length;
                    break;
                }
                // '</b:if>' ou fim do documento (malformado — tolerante)
                const closeIdx = state.str.indexOf('</b:if>', state.i);
                state.i = closeIdx === -1 ? state.str.length : closeIdx + '</b:if>'.length;
                break;
            }
            nodes.push({ type: 'if', branches });
            continue;
        }

        if (marker === '<b:loop ') {
            const tEnd = tagEnd(state.str, idx);
            const tag = state.str.slice(idx, tEnd + 1);
            const values = extractAttr(tag, 'values');
            const varName = extractAttr(tag, 'var');
            // Achado real: <b:loop index='i' values='data:posts' var='post'>
            // nomeia explicitamente a variável de posição via atributo index=
            // (não é sempre 'i' — e pode colidir com var= do próprio loop,
            // ex.: BlogArchive usa var='i' SEM index=, então data:i ali é o
            // item da iteração, não a posição).
            const indexName = extractAttr(tag, 'index');
            state.i = tEnd + 1;
            if (tag.endsWith('/>')) { nodes.push({ type: 'loop', values, var: varName, index: indexName, children: [] }); continue; }
            const children = parseNodes(state, ['</b:loop>']);
            const closeIdx = state.str.indexOf('</b:loop>', state.i);
            state.i = closeIdx === -1 ? state.str.length : closeIdx + '</b:loop>'.length;
            nodes.push({ type: 'loop', values, var: varName, index: indexName, children });
            continue;
        }

        if (marker === '<b:with ') {
            const tEnd = tagEnd(state.str, idx);
            const tag = state.str.slice(idx, tEnd + 1);
            const value = extractAttr(tag, 'value');
            const varName = extractAttr(tag, 'var');
            state.i = tEnd + 1;
            if (tag.endsWith('/>')) { nodes.push({ type: 'with', value, var: varName, children: [] }); continue; }
            const children = parseNodes(state, ['</b:with>']);
            const closeIdx = state.str.indexOf('</b:with>', state.i);
            state.i = closeIdx === -1 ? state.str.length : closeIdx + '</b:with>'.length;
            nodes.push({ type: 'with', value, var: varName, children });
            continue;
        }

        if (marker === '<b:include ') {
            const tEnd = tagEnd(state.str, idx);
            const tag = state.str.slice(idx, tEnd + 1);
            // achado real (BlogArchive1): <b:include data='data' name='interval'/>
            // passa data:<dataAttr> (caminho SEM prefixo 'data:' — o próprio nome do
            // atributo já implica isso) do escopo do chamador pra dentro do var=
            // declarado no <b:includable id='interval' var='intervalData'> alvo.
            nodes.push({
                type: 'include',
                name: extractAttr(tag, 'name'),
                cond: extractAttr(tag, 'cond'),
                data: extractAttr(tag, 'data'),
            });
            state.i = tEnd + 1;
            continue;
        }

        if (marker === '<b:widget-settings>') {
            const closeIdx = state.str.indexOf('</b:widget-settings>', idx);
            const stop = closeIdx === -1 ? state.str.length : closeIdx + '</b:widget-settings>'.length;
            nodes.push({ type: 'widgetSettings', raw: state.str.slice(idx, stop) });
            state.i = stop;
            continue;
        }

        if (marker === '<b:widget ') {
            const tEnd = tagEnd(state.str, idx);
            const tag = state.str.slice(idx, tEnd + 1);
            const wid = extractAttr(tag, 'id');
            const wtype = extractAttr(tag, 'type');
            // achado real: <data:title/> dentro do 'main' de widgets sem
            // widget-setting 'title' explícito (PageList/PopularPosts/
            // BlogArchive/Labels...) vem do atributo title= da própria tag
            // <b:widget>, não de widget-settings.
            const wtitle = extractAttr(tag, 'title');
            state.i = tEnd + 1;
            if (tag.endsWith('/>')) { nodes.push({ type: 'widget', id: wid, widgetType: wtype, title: wtitle, children: [] }); continue; }
            const children = parseNodes(state, ['</b:widget>']);
            const closeIdx = state.str.indexOf('</b:widget>', state.i);
            state.i = closeIdx === -1 ? state.str.length : closeIdx + '</b:widget>'.length;
            nodes.push({ type: 'widget', id: wid, widgetType: wtype, title: wtitle, children });
            continue;
        }

        if (marker === '<b:includable ') {
            const tEnd = tagEnd(state.str, idx);
            const tag = state.str.slice(idx, tEnd + 1);
            const iid = extractAttr(tag, 'id');
            const ivar = extractAttr(tag, 'var');
            const isMain = /\bmain=['"]true['"]/.test(tag) || iid === 'main';
            state.i = tEnd + 1;
            // Achado real (tecnologia-mag-tech): includables nativos podem ser
            // self-closing quando não têm corpo (ex.: <b:includable id='backlinks'
            // var='post'/>) — sem essa checagem o parser procura um </b:includable>
            // que nunca chega e "engole" o resto do documento inteiro como filho.
            if (tag.endsWith('/>')) {
                nodes.push({ type: 'includable', id: iid, var: ivar, main: isMain, children: [] });
                continue;
            }
            const children = parseNodes(state, ['</b:includable>']);
            const closeIdx = state.str.indexOf('</b:includable>', state.i);
            state.i = closeIdx === -1 ? state.str.length : closeIdx + '</b:includable>'.length;
            nodes.push({ type: 'includable', id: iid, var: ivar, main: isMain, children });
            continue;
        }

        if (marker === '<b:section ') {
            const tEnd = tagEnd(state.str, idx);
            const tag = state.str.slice(idx, tEnd + 1);
            const sid = extractAttr(tag, 'id');
            const sclass = extractAttr(tag, 'class');
            const stag = extractAttr(tag, 'tag') || 'div';
            state.i = tEnd + 1;
            if (tag.endsWith('/>')) { nodes.push({ type: 'section', id: sid, class: sclass, tag: stag, children: [] }); continue; }
            const children = parseNodes(state, ['</b:section>']);
            const closeIdx = state.str.indexOf('</b:section>', state.i);
            state.i = closeIdx === -1 ? state.str.length : closeIdx + '</b:section>'.length;
            nodes.push({ type: 'section', id: sid, class: sclass, tag: stag, children });
            continue;
        }

        // marcador reconhecido mas sem handler — nunca deveria acontecer
        // dado MARKERS acima; tolerante, avança 1 char pra não travar.
        nodes.push({ type: 'text', text: state.str[idx] });
        state.i = idx + 1;
    }
}

function parseTemplateTree(str) {
    const state = { str, i: 0 };
    return parseNodes(state, []);
}

function parseWidgetSettings(node) {
    const settings = {};
    if (!node) return settings;
    const re = /<b:widget-setting\s+name='([^']+)'>([\s\S]*?)<\/b:widget-setting>/g;
    let m;
    while ((m = re.exec(node.raw)) !== null) {
        const val = m[2].trim();
        settings[m[1]] = val === 'true' ? true : val === 'false' ? false : val;
    }
    return settings;
}

module.exports = { parseTemplateTree, parseWidgetSettings, extractAttr };
