'use strict';
/**
 * Galeria curada de combinações REAIS do compilador procedural Blogger.
 * Nenhum XML estático/IA. Cada cartão prepara somente campos já aceitos por
 * normalizar() em dashboard_routes/compiler e gera o XML no mesmo endpoint.
 */
const { COLOR_PRESETS, TYPOGRAPHY_PRESETS } = require('../core/presets');
const { NICHO_PAGE_TYPE_MAP, PAGE_TYPES_SEM_CHASSIS_DEDICADO } = require('../core/nichoTaxonomy');

const ENTRIES = [
  {
    "id": "noticias-elegante",
    "nome": "Jornal Horizonte",
    "descricao": "Editorial com títulos clássicos, três colunas e leitura confortável.",
    "categoria": "Editorial",
    "nichoTema": "noticias-mag-news",
    "colorPreset": "clean-white-graphite",
    "typography": "playfair",
    "gridLayout": "revista",
    "sidebarPosition": "right"
  },
  {
    "id": "noticias-urbano",
    "nome": "Pulso da Cidade",
    "descricao": "Notícias atuais com visual marcante e feed compacto.",
    "categoria": "Editorial",
    "nichoTema": "noticias-mag-news",
    "colorPreset": "neon-orange-fire",
    "typography": "oswald",
    "gridLayout": "mural",
    "sidebarPosition": "right"
  },
  {
    "id": "magazine-aurora",
    "nome": "Revista Aurora",
    "descricao": "Revista de tendências com tons suaves e cartões editoriais.",
    "categoria": "Editorial",
    "nichoTema": "viral-magazine",
    "colorPreset": "rose-gold-blush",
    "typography": "playfair",
    "gridLayout": "dupla",
    "sidebarPosition": "right"
  },
  {
    "id": "magazine-noturno",
    "nome": "Radar Noturno",
    "descricao": "Curadoria de cultura e tendências em visual escuro.",
    "categoria": "Editorial",
    "nichoTema": "viral-magazine",
    "colorPreset": "carbon-dark-electric",
    "typography": "space-grotesk",
    "gridLayout": "revista",
    "sidebarPosition": "none"
  },
  {
    "id": "tecnologia-cobalto",
    "nome": "Circuito Digital",
    "descricao": "Portal de análises tecnológicas com destaque azul profundo.",
    "categoria": "Tecnologia",
    "nichoTema": "tecnologia-mag-tech",
    "colorPreset": "tech-blue-cobalt",
    "typography": "space-grotesk",
    "gridLayout": "revista",
    "sidebarPosition": "right"
  },
  {
    "id": "tech-minimal",
    "nome": "Código Aberto",
    "descricao": "Tutoriais e programação em layout sem distrações.",
    "categoria": "Tecnologia",
    "nichoTema": "tecnologia-techwind",
    "colorPreset": "clean-white-slate",
    "typography": "inter",
    "gridLayout": "lista",
    "sidebarPosition": "none"
  },
  {
    "id": "dev-terminal",
    "nome": "Terminal Verde",
    "descricao": "Blog de desenvolvimento com linguagem visual escura.",
    "categoria": "Tecnologia",
    "nichoTema": "tecnologia-techwind",
    "colorPreset": "gamer-dark-toxic",
    "typography": "space-grotesk",
    "gridLayout": "dupla",
    "sidebarPosition": "none"
  },
  {
    "id": "gamer-neon",
    "nome": "Arena Gamer",
    "descricao": "Reviews e notícias de games com contraste neon.",
    "categoria": "Tecnologia",
    "nichoTema": "gamer-playerone",
    "colorPreset": "gamer-dark-magenta",
    "typography": "oswald",
    "gridLayout": "revista",
    "sidebarPosition": "right"
  },
  {
    "id": "gamer-retro",
    "nome": "Arcade 1998",
    "descricao": "Cultura pop e jogos retrô em laranja vibrante.",
    "categoria": "Tecnologia",
    "nichoTema": "pop-retro-pixel",
    "colorPreset": "neon-orange-ember",
    "typography": "oswald",
    "gridLayout": "quadrado",
    "sidebarPosition": "none"
  },
  {
    "id": "portfolio-editorial",
    "nome": "Estúdio Linha",
    "descricao": "Portfólio autoral minimalista com tipografia editorial.",
    "categoria": "Criativos",
    "nichoTema": "portfolio-minimalista",
    "colorPreset": "clean-white-onyx",
    "typography": "playfair",
    "gridLayout": "dupla",
    "sidebarPosition": "none"
  },
  {
    "id": "portfolio-ciano",
    "nome": "Criar & Código",
    "descricao": "Projetos digitais com personalidade ciano e preto.",
    "categoria": "Criativos",
    "nichoTema": "portfolio-minimalista",
    "colorPreset": "carbon-dark-teal",
    "typography": "space-grotesk",
    "gridLayout": "dupla",
    "sidebarPosition": "none"
  },
  {
    "id": "portfolio-aquarela",
    "nome": "Ateliê Aquarela",
    "descricao": "Galeria de trabalhos com cores delicadas e ar artesanal.",
    "categoria": "Criativos",
    "nichoTema": "aquarela",
    "colorPreset": "rose-gold-blush",
    "typography": "playfair",
    "gridLayout": "quadrado",
    "sidebarPosition": "none"
  },
  {
    "id": "receitas-sabores",
    "nome": "Mesa & Afeto",
    "descricao": "Receitas e gastronomia com cores quentes e elegantes.",
    "categoria": "Blogs",
    "nichoTema": "culinaria-boutique-gourmet",
    "colorPreset": "warm-amber-copper",
    "typography": "playfair",
    "gridLayout": "revista",
    "sidebarPosition": "right"
  },
  {
    "id": "receitas-doce",
    "nome": "Caderno de Receitas",
    "descricao": "Culinária caseira com tons de rosa e visual acolhedor.",
    "categoria": "Blogs",
    "nichoTema": "culinaria-boutique-gourmet",
    "colorPreset": "rose-gold-fuchsia",
    "typography": "pt-sans",
    "gridLayout": "dupla",
    "sidebarPosition": "right"
  },
  {
    "id": "eco-natureza",
    "nome": "Raízes Verdes",
    "descricao": "Vida sustentável e natureza com paleta orgânica.",
    "categoria": "Blogs",
    "nichoTema": "natureza-bulma-vegan",
    "colorPreset": "forest-green-sage",
    "typography": "pt-sans",
    "gridLayout": "revista",
    "sidebarPosition": "right"
  },
  {
    "id": "eco-minimal",
    "nome": "Vida Simples",
    "descricao": "Bem-estar e consumo consciente em estilo limpo.",
    "categoria": "Blogs",
    "nichoTema": "natureza-bulma-vegan",
    "colorPreset": "forest-green-mint",
    "typography": "inter",
    "gridLayout": "lista",
    "sidebarPosition": "none"
  },
  {
    "id": "saas-corporativo",
    "nome": "Nexo Produtos",
    "descricao": "Apresentação de software com identidade corporativa.",
    "categoria": "Negócios",
    "nichoTema": "saas-nexus",
    "colorPreset": "tech-blue-royal",
    "typography": "space-grotesk",
    "gridLayout": "dupla",
    "sidebarPosition": "none"
  },
  {
    "id": "saas-premium",
    "nome": "Nuvem Studio",
    "descricao": "Landing de produto com contraste escuro e detalhes violetas.",
    "categoria": "Negócios",
    "nichoTema": "saas-nexus",
    "colorPreset": "midnight-purple-indigo",
    "typography": "inter",
    "gridLayout": "dupla",
    "sidebarPosition": "none"
  },
  {
    "id": "startup-brutal",
    "nome": "Fábrica de Ideias",
    "descricao": "Visual ousado com contraste e linguagem de startup.",
    "categoria": "Negócios",
    "nichoTema": "brutalista-appcraft",
    "colorPreset": "warm-amber-mustard",
    "typography": "oswald",
    "gridLayout": "quadrado",
    "sidebarPosition": "none"
  },
  {
    "id": "apps-catalogo",
    "nome": "App Radar",
    "descricao": "Vitrine de aplicativos com cards compactos.",
    "categoria": "Negócios",
    "nichoTema": "appstore-bulma-mobile",
    "colorPreset": "tech-blue-ice",
    "typography": "inter",
    "gridLayout": "mural",
    "sidebarPosition": "none"
  },
  {
    "id": "cursos-academia",
    "nome": "Academia Online",
    "descricao": "Conteúdo educativo organizado para cursos e aulas.",
    "categoria": "Negócios",
    "nichoTema": "elearning-academy",
    "colorPreset": "forest-green-emerald",
    "typography": "roboto-slab",
    "gridLayout": "lista",
    "sidebarPosition": "right"
  },
  {
    "id": "biolink-social",
    "nome": "Minha Página",
    "descricao": "Links pessoais com visual ciano e navegação simples.",
    "categoria": "Criativos",
    "nichoTema": "biolink-social",
    "colorPreset": "tech-blue-midnight",
    "typography": "inter",
    "gridLayout": "coluna-unica",
    "sidebarPosition": "none"
  }
];

const GALLERY = Object.freeze(ENTRIES.map((entry) => {
  if (!Object.hasOwn(NICHO_PAGE_TYPE_MAP, entry.nichoTema) ||
      !Object.hasOwn(COLOR_PRESETS, entry.colorPreset) ||
      !Object.hasOwn(TYPOGRAPHY_PRESETS, entry.typography) ||
      !['lista','dupla','revista','quadrado','mural','coluna-unica','zigzag'].includes(entry.gridLayout) ||
      !['left','right','none'].includes(entry.sidebarPosition)) {
    throw new Error('Exemplo Blogger com opção não suportada: ' + entry.id);
  }
  const colors = COLOR_PRESETS[entry.colorPreset];
  return Object.freeze({
    ...entry,
    accent: colors.primary,
    surface: colors.cardBg,
    background: colors.bgBody,
    contrast: colors.textMain,
    fallback: PAGE_TYPES_SEM_CHASSIS_DEDICADO.has(NICHO_PAGE_TYPE_MAP[entry.nichoTema]),
  });
}));
function listarExemplos() { return GALLERY; }
function encontrarExemplo(id) { return GALLERY.find((p) => p.id === id) || null; }
module.exports = { listarExemplos, encontrarExemplo };
