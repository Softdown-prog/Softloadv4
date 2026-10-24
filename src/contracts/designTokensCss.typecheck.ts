import {
    gerarDynamicCss, gerarTypographyCss, gerarCategoryBadgesCss, gerarButtonCss,
    gerarGridCardCss, TOKENS_GLOBAIS_CHASSIS,
} from '../core/compilerEngine/designTokensCss';
import type { DynamicDesignTokens, TypographyDesignTokens, CategoryBadgeDesignTokens } from '../core/compilerEngine/designTokensCss';
const design: DynamicDesignTokens = {
    color:{primary:'#123456',bgBody:'#fff',cardBg:'#fff',textMain:'#222',footerBg:'#111'},
    button:{btnRadius:'8px',btnShadow:'none'},
    typography:{label:'Inter',fontFamily:'Inter',headingWeight:700},
};
const badges: CategoryBadgeDesignTokens[]=[{nome:'Notícias',bg:'#112233',text:'#ffffff'}];
const results: string[]=[
    gerarDynamicCss(design),
    gerarTypographyCss(design.typography),
    gerarCategoryBadgesCss(badges),
    gerarButtonCss('neon','#abc'),
    gerarGridCardCss(),
];
const typo: TypographyDesignTokens = design.typography;
const globals: string[] = TOKENS_GLOBAIS_CHASSIS;
void results;void typo;void globals;
// @ts-expect-error o preset de cor precisa da propriedade primary.
const badColor: DynamicDesignTokens = {...design,color:{bgBody:'#fff',cardBg:'#fff',textMain:'#222',footerBg:'#111'}};
void badColor;
// @ts-expect-error retorna string CSS.
const badCss: number = gerarGridCardCss();
void badCss;
