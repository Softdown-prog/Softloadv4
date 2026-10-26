"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderBloggerTree = renderBloggerTree;
const bloggerTemplateTree_1 = require("./bloggerTemplateTree");
const bloggerTemplateEngine_1 = require("./bloggerTemplateEngine");
const bloggerMockContext_1 = require("./bloggerMockContext");
// Includable 'responsiveImage' da plataforma Blogger (não está no XML do tema).
const BUILTIN_INCLUDABLES = {
    responsiveImage(dataValue) {
        const img = dataValue && dataValue.image;
        const src = (img && typeof img === 'object' ? img.url : img) || 'https://placehold.co/400x200/1e293b/64748b?text=Logo';
        const alt = (0, bloggerTemplateEngine_1.stringifyValue)(dataValue && dataValue.altText).replace(/'/g, '&apos;');
        return `<img alt='${alt}' src='${src}' loading='lazy'/>`;
    },
};
function renderText(text, ctx) {
    let out = text;
    out = out.replace(/\bexpr:([a-zA-Z-]+)='([^']*)'/g, (m, attr, expr) => {
        const val = (0, bloggerTemplateEngine_1.evalValueExpr)(expr, ctx);
        return `${attr}='${(0, bloggerTemplateEngine_1.stringifyValue)(val).replace(/'/g, '&apos;')}'`;
    });
    out = out.replace(/<data:([A-Za-z0-9_.-]+)\/>/g, (m, path) => (0, bloggerTemplateEngine_1.stringifyValue)((0, bloggerTemplateEngine_1.resolvePath)(path, ctx)));
    return out;
}
function findChild(children, type) {
    return children.find((c) => c.type === type);
}
function renderNodes(nodes, ctx) {
    return nodes.map(n => renderNode(n, ctx)).join('');
}
function renderNode(node, ctx) {
    switch (node.type) {
        case 'text':
            return renderText(node.text, ctx);
        case 'if': {
            for (const b of node.branches) {
                if (b.cond === null || (0, bloggerTemplateEngine_1.evalCond)(b.cond, ctx))
                    return renderNodes(b.children, ctx);
            }
            return '';
        }
        case 'loop': {
            if (!node.var)
                return '';
            const arr = (0, bloggerTemplateEngine_1.resolveLoopSource)(node.values, ctx);
            return arr.map((item, i) => {
                const childCtx = Object.create(ctx);
                childCtx[node.var] = item;
                if (node.index)
                    childCtx[node.index] = i;
                return renderNodes(node.children, childCtx);
            }).join('');
        }
        case 'with': {
            const val = (0, bloggerTemplateEngine_1.evalValueExpr)(node.value, ctx);
            const childCtx = Object.create(ctx);
            if (node.var)
                childCtx[node.var] = val;
            return renderNodes(node.children, childCtx);
        }
        case 'include': {
            if (node.cond && !(0, bloggerTemplateEngine_1.evalCond)(node.cond, ctx))
                return '';
            const inc = ctx.__includables && ctx.__includables[node.name || ''];
            const dataValue = node.data ? (0, bloggerTemplateEngine_1.evalIncludeDataAttr)(node.data, ctx) : undefined;
            if (!inc) {
                const builtin = BUILTIN_INCLUDABLES[node.name || ''];
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
            return '';
        case 'widget': {
            const settings = (0, bloggerTemplateTree_1.parseWidgetSettings)(findChild(node.children, 'widgetSettings'));
            const includables = {};
            for (const c of node.children)
                if (c.type === 'includable')
                    includables[String(c.id)] = c;
            const mainInc = includables.main || node.children.find((c) => c.type === 'includable' && c.main);
            if (!mainInc)
                return '';
            const widgetCtx = (0, bloggerMockContext_1.buildWidgetContext)(ctx, node.widgetType, settings, node.id, node.title);
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
    const tree = (0, bloggerTemplateTree_1.parseTemplateTree)(xmlFragment);
    return renderNodes(tree, baseCtx);
}
