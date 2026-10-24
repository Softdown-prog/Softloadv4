'use strict';

// ============================================================
// bloggerTemplateRenderer.js — percorre a árvore produzida por
// bloggerTemplateTree.js e resolve cada nó contra um contexto mock
// (bloggerMockContext.js), usando o avaliador de expressão de
// bloggerTemplateEngine.js pra cond=/values=/expr:attr=/data:*.
// ============================================================

const { parseTemplateTree, parseWidgetSettings } = require('./bloggerTemplateTree');
const { evalCond, evalValueExpr, evalIncludeDataAttr, resolveLoopSource, resolvePath, stringifyValue } = require('./bloggerTemplateEngine');
const { buildWidgetContext } = require('./bloggerMockContext');

// Achado real (Header1/pop-retro-pixel): `<b:include name='responsiveImage'
// data='{ image: data:image, altText: ... }'/>` — 'responsiveImage' é um
// includable da PLATAFORMA Blogger (o backend do Blogger o injeta pra
// todo tema, redimensionando a imagem de verdade) que nenhum tema jamais
// declara no próprio XML — não tem como aparecer na árvore parseada.
// Fallback mínimo pro preview: renderiza um <img> simples com o que foi
// passado em data=, em vez de deixar a área vazia.
const BUILTIN_INCLUDABLES = {
    responsiveImage(dataValue) {
        const img = dataValue && dataValue.image;
        const src = (img && typeof img === 'object' ? img.url : img) || 'https://placehold.co/400x200/1e293b/64748b?text=Logo';
        const alt = stringifyValue(dataValue && dataValue.altText).replace(/'/g, '&apos;');
        return `<img alt='${alt}' src='${src}' loading='lazy'/>`;
    },
};

function renderText(text, ctx) {
    let out = text;
    // expr:attr='EXPRESSÃO' → attr='valor resolvido' (ex.: expr:href='data:post.url')
    out = out.replace(/\bexpr:([a-zA-Z-]+)='([^']*)'/g, (m, attr, expr) => {
        const val = evalValueExpr(expr, ctx);
        return `${attr}='${stringifyValue(val).replace(/'/g, '&apos;')}'`;
    });
    // <data:a.b.c/> ou <data:a.b.c.escaped/>
    out = out.replace(/<data:([A-Za-z0-9_.-]+)\/>/g, (m, path) => stringifyValue(resolvePath(path, ctx)));
    return out;
}

function findChild(children, type) { return children.find(c => c.type === type); }

function renderNodes(nodes, ctx) {
    return nodes.map(n => renderNode(n, ctx)).join('');
}

function renderNode(node, ctx) {
    switch (node.type) {
        case 'text':
            return renderText(node.text, ctx);
        case 'if': {
            for (const b of node.branches) {
                if (b.cond === null || evalCond(b.cond, ctx)) return renderNodes(b.children, ctx);
            }
            return '';
        }
        case 'loop': {
            if (!node.var) return '';
            const arr = resolveLoopSource(node.values, ctx);
            return arr.map((item, i) => {
                const childCtx = Object.create(ctx);
                childCtx[node.var] = item;
                if (node.index) childCtx[node.index] = i;
                return renderNodes(node.children, childCtx);
            }).join('');
        }
        case 'with': {
            const val = evalValueExpr(node.value, ctx);
            const childCtx = Object.create(ctx);
            if (node.var) childCtx[node.var] = val;
            return renderNodes(node.children, childCtx);
        }
        case 'include': {
            if (node.cond && !evalCond(node.cond, ctx)) return '';
            const inc = ctx.__includables && ctx.__includables[node.name];
            // achado real: data= tanto é um caminho SOLTO sem prefixo
            // (BlogArchive1: data='data') quanto uma expressão completa com
            // seus próprios data: internos (Header1: data='{ image: data:image,
            // ... }') — evalIncludeDataAttr decide qual dos dois casos é.
            const dataValue = node.data ? evalIncludeDataAttr(node.data, ctx) : undefined;
            if (!inc) {
                const builtin = BUILTIN_INCLUDABLES[node.name];
                return builtin ? builtin(dataValue, ctx) : '';
            }
            let childCtx = ctx;
            if (node.data && inc.var) {
                childCtx = Object.create(ctx);
                childCtx[inc.var] = dataValue;
            }
            return renderNodes(inc.children, childCtx);
        }
        case 'widgetSettings':
        case 'includable':
            // 'includable' só é renderizado via 'include' explícito, ou como
            // entrypoint 'main' tratado abaixo em 'widget' — nunca inline direto.
            return '';
        case 'widget': {
            const settings = parseWidgetSettings(findChild(node.children, 'widgetSettings'));
            const includables = {};
            for (const c of node.children) if (c.type === 'includable') includables[c.id] = c;
            const mainInc = includables.main || node.children.find(c => c.type === 'includable' && c.main);
            if (!mainInc) return '';
            const widgetCtx = buildWidgetContext(ctx, node.widgetType, settings, node.id, node.title);
            widgetCtx.__includables = includables;
            return renderNodes(mainInc.children, widgetCtx);
        }
        case 'section': {
            const inner = renderNodes(node.children, ctx);
            const attrs = [node.id ? `id='${node.id}'` : '', node.class ? `class='${node.class}'` : ''].filter(Boolean).join(' ');
            return `<${node.tag}${attrs ? ' ' + attrs : ''}>${inner}</${node.tag}>`;
        }
        default:
            return '';
    }
}

function renderBloggerTree(xmlFragment, baseCtx) {
    const tree = parseTemplateTree(xmlFragment);
    return renderNodes(tree, baseCtx);
}

module.exports = { renderBloggerTree };
