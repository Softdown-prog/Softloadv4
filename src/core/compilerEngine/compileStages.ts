import type { CompilerTraceSlot } from '../../contracts/compiler';
import { SLOT_MANIFEST } from './slotManifest';

// Em produção o Node 20 usa Buffer. Tipamos só a API usada aqui, sem
// introduzir dependências globais de @types/node na fase incremental.
declare const Buffer: {
    byteLength(input: string, encoding: 'utf8'): number;
};

/**
 * Valores dos placeholders já resolvidos pelo compile.js.
 * O mapa continua montado no motor legado para preservar as escolhas do DNA.
 */
export type ResolvedSlots = Readonly<Record<string, string>> & Readonly<{
    NICHO_CSS: string;
    NICHO_HERO: string;
}>;

/**
 * Preserva rigorosamente a ordem do split/join do compile.js original:
 * 1. valores base, 2. módulos, 3. nichos/DP, 4. imagens, 5. layout/widgets.
 * NÃO trocar por uma passagem global: os placeholders gerados por injeções
 * anteriores dependem desta ordem (em particular PLACEHOLDER_IMG no nicho).
 * A remoção de órfãos continua sendo feita pelo compile.js, fora daqui.
 */
export function injetarSlotsXml(
    templateBase: string,
    resolvedMap: ResolvedSlots,
    modSnippets: Readonly<Record<string, string>>,
): string {
    let xml = templateBase;

    xml = xml.split('[[THEME_COLOR]]').join(resolvedMap.THEME_COLOR);
    xml = xml.split('[[SEO_MODULE]]').join(resolvedMap.SEO_MODULE);
    xml = xml.split('[[FONT_MODULE]]').join(resolvedMap.FONT_MODULE);
    xml = xml.split('[[DYNAMIC_CSS]]').join(resolvedMap.DYNAMIC_CSS);
    xml = xml.split('[[GRID_CLASS]]').join(resolvedMap.GRID_CLASS);
    xml = xml.split('[[LAZY_LOAD_TOGGLE]]').join(resolvedMap.LAZY_LOAD_TOGGLE);

    for (const [placeholder, snippet] of Object.entries(modSnippets)) {
        xml = xml.split(placeholder).join(snippet);
    }

    // Os marcadores DP tornam as regiões de nicho reextraíveis pelo
    // templateExtractor. Não emitir marcadores para conteúdo vazio.
    const nichoCssComMarcador = resolvedMap.NICHO_CSS
        ? '\n<!-- DP:CSS:START -->\n' + resolvedMap.NICHO_CSS + '\n<!-- DP:CSS:END -->\n'
        : resolvedMap.NICHO_CSS;
    const nichoHeroComMarcador = resolvedMap.NICHO_HERO
        ? '\n<!-- DP:HERO:START -->\n' + resolvedMap.NICHO_HERO + '\n<!-- DP:HERO:END -->\n'
        : resolvedMap.NICHO_HERO;

    xml = xml.split('[[NICHO_CSS]]').join(nichoCssComMarcador);
    xml = xml.split('[[NICHO_JS]]').join(resolvedMap.NICHO_JS);
    xml = xml.split('[[NICHO_HERO]]').join(nichoHeroComMarcador);
    xml = xml.split('[[NICHO_WIDGETS_HTML]]').join(resolvedMap.NICHO_WIDGETS_HTML);
    xml = xml.split('[[NICHO_EXTRA_SECTIONS]]').join(resolvedMap.NICHO_EXTRA_SECTIONS);
    // Precisa ficar depois dos quatro nichos: JS/HTML injetados podem
    // introduzir o placeholder de imagem somente neste estágio.
    xml = xml.split('[[PLACEHOLDER_IMG]]').join(resolvedMap.PLACEHOLDER_IMG);
    xml = xml.split('[[BREAKING_NEWS_BAR]]').join(resolvedMap.BREAKING_NEWS_BAR);
    xml = xml.split('[[BODY_LAYOUT_CLASS]]').join(resolvedMap.BODY_LAYOUT_CLASS);
    xml = xml.split('[[FOOTER_NEWSLETTER]]').join(resolvedMap.FOOTER_NEWSLETTER);
    xml = xml.split('[[HEADER_WIDGET]]').join(resolvedMap.HEADER_WIDGET);
    xml = xml.split('[[NAV_WIDGET]]').join(resolvedMap.NAV_WIDGET);
    xml = xml.split('[[MOBILE_NAV_WIDGET]]').join(resolvedMap.MOBILE_NAV_WIDGET);
    xml = xml.split('[[ICON_AUTHOR]]').join(resolvedMap.ICON_AUTHOR);
    return xml;
}

/**
 * Mesmo trace ASTNode-like antes produzido no final de compile.js.
 * Não copia `sources`: a identidade da referência do SLOT_MANIFEST importa
 * para o grafo de dependências e permanece compatível com o código legado.
 */
export function construirTraceCompilacao(resolvedMap: Readonly<Record<string, string>>): CompilerTraceSlot[] {
    return SLOT_MANIFEST.map(def => {
        const val = resolvedMap[def.slot] || '';
        return {
            slot:       def.slot,
            type:       def.type,
            valueBytes: Buffer.byteLength(val, 'utf8'),
            active:     val.length > 0,
            sources:    def.sources,
        };
    });
}
