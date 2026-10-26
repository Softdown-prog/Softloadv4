'use strict';

// Renderer determinístico do Blogger: a fonte TypeScript tipa a árvore do
// interpretador. O JS CommonJS gerado continua como entrada para Node.
interface WidgetSettingsNode { type: 'widgetSettings'; raw: string }
interface IncludableNode { type: 'includable'; id: string | null; var: string | null; main: boolean; children: TemplateNode[] }
type TemplateNode =
    | { type: 'text'; text: string }
    | { type: 'if'; branches: Array<{ cond: string | null; children: TemplateNode[] }> }
    | { type: 'loop'; var: string | null; values: string | null; index: string | null; children: TemplateNode[] }
    | { type: 'with'; var: string | null; value: string | null; children: TemplateNode[] }
    | { type: 'include'; cond: string | null; name: string | null; data: string | null }
    | WidgetSettingsNode | IncludableNode
    | { type: 'widget'; id: string | null; widgetType: string | null; title: string | null; children: TemplateNode[] }
    | { type: 'section'; tag: string; id: string | null; class: string | null; children: TemplateNode[] };
type PreviewContext = Record<string, unknown> & { __includables?: Record<string, IncludableNode> };
interface RendererTreeDependency { parseTemplateTree(xml: string): TemplateNode[]; parseWidgetSettings(node?: WidgetSettingsNode): Record<string, unknown> }
interface RendererEngineDependency {
    evalCond(expr: string | null, ctx: PreviewContext): boolean;
    evalValueExpr(expr: string | null, ctx: PreviewContext): unknown;
    evalIncludeDataAttr(expr: string, ctx: PreviewContext): unknown;
    resolveLoopSource(expr: string | null, ctx: PreviewContext): unknown[];
    resolvePath(path: string, ctx: PreviewContext): unknown;
    stringifyValue(value: unknown): string;
}
interface MockContextDependency { buildWidgetContext(ctx: PreviewContext, widgetType: string | null, settings: Record<string, unknown>, id: string | null, title: string | null): PreviewContext }
declare const require: (id: string) => unknown;
declare const module: { exports: unknown };

const { parseTemplateTree, parseWidgetSettings } = require('./bloggerTemplateTree') as RendererTreeDependency;
const { evalCond, evalValueExpr, evalIncludeDataAttr, resolveLoopSource, resolvePath, stringifyValue } = require('./bloggerTemplateEngine') as RendererEngineDependency;
const { buildWidgetContext } = require('./bloggerMockContext') as MockContextDependency;

// Includable 'responsiveImage' da plataforma Blogger (não está no XML do tema).
const BUILTIN_INCLUDABLES: Record<string, (data: unknown, ctx: PreviewContext) => string> = {
    responsiveImage(dataValue: unknown): string {
        const img = dataValue && (dataValue as { image?: unknown }).image;
        const src = (img && typeof img === 'object' ? (img as { url?: string }).url : img) || 'https://placehold.co/400x200/1e293b/64748b?text=Logo';
        const alt = stringifyValue(dataValue && (dataValue as { altText?: unknown }).altText).replace(/'/g, '&apos;');
        return `<img alt='${alt}' src='${src}' loading='lazy'/>`;
    },
};

function renderText(text: string, ctx: PreviewContext): string {
    let out = text;
    out = out.replace(/\bexpr:([a-zA-Z-]+)='([^']*)'/g, (m, attr, expr) => {
        const val = evalValueExpr(expr, ctx);
        return `${attr}='${stringifyValue(val).replace(/'/g, '&apos;')}'`;
    });
    out = out.replace(/<data:([A-Za-z0-9_.-]+)\/>/g, (m, path) => stringifyValue(resolvePath(path, ctx)));
    return out;
}
function findChild(children: TemplateNode[], type: 'widgetSettings'): WidgetSettingsNode | undefined {
    return children.find((c): c is WidgetSettingsNode => c.type === type);
}
function renderNodes(nodes: TemplateNode[], ctx: PreviewContext): string {
    return nodes.map(n => renderNode(n, ctx)).join('');
}
function renderNode(node: TemplateNode, ctx: PreviewContext): string {
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
                const childCtx: PreviewContext = Object.create(ctx);
                childCtx[node.var!] = item;
                if (node.index) childCtx[node.index] = i;
                return renderNodes(node.children, childCtx);
            }).join('');
        }
        case 'with': {
            const val = evalValueExpr(node.value, ctx);
            const childCtx: PreviewContext = Object.create(ctx);
            if (node.var) childCtx[node.var] = val;
            return renderNodes(node.children, childCtx);
        }
        case 'include': {
            if (node.cond && !evalCond(node.cond, ctx)) return '';
            const inc = ctx.__includables && ctx.__includables[node.name || ''];
            const dataValue = node.data ? evalIncludeDataAttr(node.data, ctx) : undefined;
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
            const settings = parseWidgetSettings(findChild(node.children, 'widgetSettings'));
            const includables: Record<string, IncludableNode> = {};
            for (const c of node.children) if (c.type === 'includable') includables[String(c.id)] = c;
            const mainInc = includables.main || node.children.find((c): c is IncludableNode => c.type === 'includable' && c.main);
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
function renderBloggerTree(xmlFragment: string, baseCtx: PreviewContext): string {
    const tree = parseTemplateTree(xmlFragment);
    return renderNodes(tree, baseCtx);
}
module.exports = { renderBloggerTree };
export {};
