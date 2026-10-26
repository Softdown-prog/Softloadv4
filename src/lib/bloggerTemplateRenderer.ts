import type { TemplateNode, IncludableNode } from './bloggerTemplateTree';
import type { MockContext } from './bloggerMockContext';
import { parseTemplateTree, parseWidgetSettings } from './bloggerTemplateTree';
import { evalCond, evalValueExpr, evalIncludeDataAttr, resolveLoopSource, resolvePath, stringifyValue } from './bloggerTemplateEngine';
import { buildWidgetContext } from './bloggerMockContext';

// The renderer already migrated on main now shares its AST and context
// contracts with the newly typed parser and mock data, without duplicate types.
type PreviewContext = MockContext;
type WidgetSettingsNode = Extract<TemplateNode, { type: 'widgetSettings' }>;

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
export function renderBloggerTree(xmlFragment: string, baseCtx: PreviewContext): string {
    const tree = parseTemplateTree(xmlFragment);
    return renderNodes(tree, baseCtx);
}
