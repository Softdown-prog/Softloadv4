/** Contratos de compilação: não mudam XML, API, saldo ou schemas persistidos. */
export type CompilerSlotKind =
  | 'theme_value' | 'conditional' | 'font_import' | 'css_block'
  | 'class_str' | 'component' | 'widget' | 'menu_fragment' | 'js_block';

export interface CompilerSlotDefinition {
  slot: string;
  type: CompilerSlotKind;
  sources: readonly string[];
}

export interface CompilerTraceSlot extends CompilerSlotDefinition {
  valueBytes: number;
  active: boolean;
}

/** Chamada interna do compilarTemplate, após normalizarManifesto() no worker. */
export interface CompilerTemplateOptions {
  siteName: string;
  description?: string | null;
  enableSeo: boolean;
  gridLayout: string;
  colorPreset: string;
  buttonStyle: string;
  typography: string;
  modules?: Record<string, unknown>;
  categoryBadges?: ReadonlyArray<{ nome: string; bg: string; text: string }>;
  lazyLoad: boolean;
  nichoTema?: string | null;
  footerStyle?: string;
  sidebarPosition?: string;
  heroTitle?: string | null;
  heroSubtitle?: string | null;
  designVoice?: string;
  temHeroDesignPackage?: boolean;
}

/** Saída bruta: o worker ainda acrescenta reparos, metadados e XML final. */
export interface CompilerTemplateResult {
  xml: string;
  trace: CompilerTraceSlot[];
}

export interface CompilerMetadata {
  linhas: number;
  tamanhoKb: string;
  siteName: string;
  seo: boolean;
  modulos: string[];
  badges: number;
  grafo: {
    totalSlots: number;
    slotsAtivos: number;
    camposInfluentes: Array<{
      campo: string;
      qtdSlots: number;
      slots: string[];
    }>;
  };
}

export interface CompiledBloggerTheme {
  xmlFinal: string;
  avisos: string[];
  reparosXml: unknown[];
  injecoesPackage: string[];
  slug: string;
  siteNameSanitizado: string;
  modulosAtivos: Record<string, unknown>;
  badgesProcessados: unknown[];
  meta: CompilerMetadata;
}

export interface SavedCompilation {
  downloadUrl: string;
  xmlPath: string;
  gcPath: string;
}
