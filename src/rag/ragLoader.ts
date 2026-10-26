import * as fs from 'node:fs';
import * as path from 'node:path';
const { criarMatcher } = require('./ragMatcher') as { criarMatcher(query: string): (keyword: string) => boolean };
import { RAG_NAMESPACES } from '../knowledge/ragNamespaces';
export interface RagLoadOptions { metaOnly?: boolean; historico?: string[] }
interface RagIndexFile { arquivo: string; palavras_chave?: string[] }
interface RagIndexGroup { pasta: string; palavras_chave?: string[] }
interface RagIndex {
  grupos?: RagIndexGroup[];
  ficheiros?: RagIndexFile[];
  fases?: { fase_1_intent?: { carrega_sempre?: string[] } };
}
export type RagLoadResult =
  | { rota: string; ficheirosCarregados: string[]; tamanhoTotalKB: string; contextoStr: string; sucesso: true }
  | { rota: 'error'; ficheirosCarregados: string[]; tamanhoTotalKB: 0; contextoStr: ''; erro: string; sucesso?: false };
'use strict';

/**
 * RAG LOADER — Motor dinâmico de seleção de ficheiros para o Gemini
 *
 * Responsabilidades:
 * 1. Rotear pergunta para a pasta correta (suporte ou pipeline)
 * 2. Ler o index.json da pasta
 * 3. Selecionar apenas ficheiros relevantes por palavras-chave
 * 4. Carregar conteúdo dos ficheiros
 * 5. Retornar structure pronto para injetar no system prompt
 *
 * Estrutura de pastas:
 *   rag-ia-suporte/   → Chat IA de suporte (suporte/ + ia-de-balcao/)
 *   rag-ia-compiler/  → Blogger Planner / geração de templates (pipeline/)
 *
 * Uso:
 * const rag = require('./ragLoader');
 * const contexto = rag.loadForGeminiSync(perguntaDoUsuario);
 * // contexto = { rota, ficheirosCarregados, tamanhoKB, contextoStr }
 */





// RAG do Blogger é só filesystem. Não atravessa para coleções vetoriais do Solaris.

const RAG_ROOT = path.resolve(__dirname, '..', '..', RAG_NAMESPACES.blogger.root);

// Prefixos das duas bases de conhecimento
const SUPORTE_ROOT  = 'rag-ia-suporte';
const COMPILER_ROOT = 'rag-ia-compiler';

// ============================================================================
// DETECÇÃO DE ROTA
// ============================================================================
/**
 * @param {string}   pergunta  — mensagem atual do usuário
 * @param {string[]} historico — mensagens ANTERIORES do usuário na conversa
 *   (mais antiga → mais recente). Usado apenas como desempate: quando a
 *   mensagem atual é um refinamento visual sem nenhum pattern próprio
 *   ("prefiro mais escuro", "pode ser em tons vibrantes"), a rota herda o
 *   contexto de criação do histórico em vez de cair no fallback de suporte.
 */
export function rotearPergunta(pergunta: string, historico: string[] = []): string {
  const textoLower = pergunta.toLowerCase();

  const patternsArquitetura = [
    // Layout e estrutura
    /grid|layout|sidebar|condicional/i,
    /imagem.*responsiva|responsiva.*imagem|imagens responsivas/i,
    /breakpoint|lcp|layout.*shift|placeholder/i,
    /col-lg|col-md|col-sm|col-xs/i,
    /sticky|position.*sticky/i,
    /otimizar.*imagem|imagem.*otimizar|performance.*imagem|imagem.*performance/i,
    // UI e componentes Blogger
    /dark.?mode|modo.?escuro|modo.?noturno|toggle.*tema|tema.*toggle/i,
    /ticker|breaking.?news|barra.*notícias|notícias.*barra/i,
    /dropdown|submenu|menu.*dinâmico/i,
    /micro.?inter|scrollbar.*custom|card.?hover|animação.*css/i,
    /toc|sumário.*automático|posts.*relacionados/i,
    // Blogger XML técnico
    /b:widget|b:skin|b:if|b:loop|b:includable/i,
    /gadget.*blogger|widget.*blogger|blogger.*widget/i,
    /\?m=1|parâmetro.*mobile|url.*blogger|permalink.*blogger/i,
    /labels.*blogger|marcadores.*blogger|slider.*blogger/i,
    /parser.*xml|saxparse|auto.?fechamento/i,
    // CSS tokens e badges
    /css.?token|css.?var|--gamer|category.?badge|badge.*cor/i,
    /z-index|scroll.?to.?top|posicionamento.*componente/i,
    // SEO / dados estruturados / GSC (rota para ia-de-balcao com conhecimento avançado)
    /schema\.org|json.?ld|dados.?estruturados|structured.?data/i,
    /\bgsc\b|search.?console|impressões.*gsc|queda.*impressões|ctr.*gsc/i,
    /html.?semântico|semântica.*html|geo.*blogger|generative.?engine/i,
    // Integrações externas via Worker/API (chatbot com IA, etc.) — orientação
    // de arquitetura, não geração de template nem troubleshooting pontual.
    // Checado ANTES de patternsSuporte pra não cair no padrão genérico
    // "como.*integrar" (que também bateria aqui, mas manda pra suporte).
    /chatbot|chat.?bot|assistente.*(virtual|ia)|\bia\b.*\bno\b.*(blog|blogger)/i,
    /api.*(gemini|openai|gpt)|gemini.*api/i,
    /cloudflare.?worker|google.*apps.?script|apps.?script/i,
    // Automações via Worker além do chatbot — entrega digital, banco de
    // dados, webhooks. Checado antes de patternsSuporte pelo mesmo motivo
    // do chatbot: "conectar banco de dados no blogger" bateria no padrão
    // genérico "conectar.*blogger" e cairia em suporte por engano.
    /\bwebhook\b/i,
    /entrega.*(autom[aá]tica|digital)|item.*digital|produto.*digital/i,
    /banco.*de.*dados|cloudflare.?d1|cloudflare.?kv/i,
    /automa[cç][aã]o.*(blog|blogger)|blog(ger)?.*automa[cç][aã]o/i,
    /public(a[cç][aã]o|ar).*autom[aá]tic|post.*autom[aá]tico|automa[cç][aã]o.*(post|publica[cç][aã]o)/i,
    /cron.?trigger|worker.*agendad|agendamento.*worker/i,
    /api.*do.*blogger|blogger.*api|api.*blogger/i,
  ];

  const patternsSuporte = [
    /dominio|domínio/i,
    /https|ssl/i,
    /dns/i,
    /cloudflare/i,
    /(mobile|celular|telemóvel)/i,
    /(problema|erro|não funciona)/i,
    /fantasma|mobile.*custom|\?m=1/i,
    // Coisas quebradas — "meu template quebrou" é suporte, não pedido de criação
    /quebr(ou|ado|ada|a)\b|parou de funcionar|deu erro|bugou|bugado|estragou|corromp/i,
    // Criar/editar POST é suporte de uso do Blogger, não geração de template
    /(criar|escrever|publicar|agendar|editar)\s+(um\s+|uma\s+)?(post|postagem|artigo)/i,
    // Monetização e publicidade
    /adsense|adense|anúncio|anuncio|monetiz|ads\.txt|publicidade/i,
    // Analytics e rastreamento
    /analytics|search.?console|gtag|ga4|pixel.*facebook|tag.*google/i,
    // SEO e indexação
    /\bseo\b|metatag|meta.?tag|indexaç|indexac|indexar|ranque|sitemap|robots\.txt/i,
    // Performance e velocidade
    /(lento|velocidade|carregamento|pagespeed|desempenho).*blog|blog.*(lento|velocidade|carregamento)/i,
    /(não aparece|nao aparece|sumiu|desapareceu|não carrega|nao carrega|não abre|nao abre)/i,
    // Configuração de recursos do Blogger
    /(ativar|desativar|habilitar|conectar|integrar).*(blogger|blog)|como.*(ativar|configurar|conectar|integrar)/i,
    // Gadgets e labels nativos
    /(gadget|legenda|labels|arquivos|arquivo.*blog|feed.*rss)/i,
    // Formatação e editor
    /(formatação|formatacao|copy.?paste|word.*blog|editor.*blogger|html.*blogger)/i,
  ];

  const patternsCriacao = [
    /\btemplate\b/i,
    /\btema\b/i,
    /\bdesign\b/i,
    /(quero um|criar um|gerar um|prefiro um|me fa[zç]|faz\s+pra|cria\s+pra)/i,
    /(moderno|profissional|luxo|minimalista|brutal)/i,
    /(receita|culinária|gastronomia|roxo|rosa)/i,
    // Detecção de nicho/blog sem a palavra "template"
    /(blog\s+de|site\s+de|blog\s+sobre|site\s+sobre)/i,
    /(nicho\s+de|para\s+(meu\s+)?blog|para\s+(meu\s+)?site)/i,
    /(games?|gamer|tecnologia|culin[aá]ria|moda|finan[cç]as?|portf[oó]lio|not[ií]cia)/i,
  ];

  const temArquitetura = patternsArquitetura.some(p => p.test(textoLower));
  const temSuporte = patternsSuporte.some(p => p.test(textoLower));
  const temCriacao = patternsCriacao.some(p => p.test(textoLower));

  // Pedidos educacionais/estruturais têm prioridade máxima — nunca vão para o compiler.
  // "esqueleto xml", "sem css", "sem javascript", "só a estrutura", "exemplo de código"
  const temEducacional = [
    /esqueleto.*xml|xml.*esqueleto/i,
    /apenas.*xml|só.*xml|somente.*xml/i,
    /sem.*css|sem.*javascript|sem.*\bjs\b/i,
    /estrutura.*xml|xml.*estrutura|estrutura.*template/i,
    /exemplo.*código|exemplo.*xml|exemplo.*html|exemplo.*blogger/i,
    /como.*é.*xml|como.*funciona.*xml|como.*é.*estrutura/i,
  ].some(p => p.test(textoLower));

  if (temEducacional)               return `${SUPORTE_ROOT}/ia-de-balcao`;
  if (temArquitetura)               return `${SUPORTE_ROOT}/ia-de-balcao`;
  if (temSuporte && !temCriacao)    return `${SUPORTE_ROOT}/suporte`;
  if (temCriacao && !temSuporte)    return `${COMPILER_ROOT}/pipeline`;
  if (temSuporte && temCriacao)     return `${SUPORTE_ROOT}/suporte`;
  // Fallback: se menciona nicho específico de blog, vai para pipeline
  const nomeNichos = /games?|gamer|culin[aá]ria|gastronomia|moda|fashion|tecnologia|not[ií]cia|jornal|portf[oó]lio|saas|startup|biolink|natureza|vegano|educa[cç][aã]o|curso/i;
  if (nomeNichos.test(textoLower)) return `${COMPILER_ROOT}/pipeline`;

  // Nenhum pattern casou na mensagem atual. Se ela parece um REFINAMENTO
  // visual ("prefiro mais escuro", "muda pra tons vibrantes") e o histórico
  // recente era uma conversa de criação, herda a rota de pipeline — sem isso
  // o refinamento perdia o contexto do tema no meio da geração.
  // Smalltalk ("obrigado, ficou ótimo!") não passa no teste de refinamento
  // e continua caindo no fallback barato de suporte.
  if (historico.length > 0 && ehRefinamentoVisual(pergunta)) {
    const recentes = historico.slice(-3).join(' \n ').toLowerCase();
    const criacaoNoHistorico = patternsCriacao.some(p => p.test(recentes)) || nomeNichos.test(recentes);
    if (criacaoNoHistorico) return `${COMPILER_ROOT}/pipeline`;
  }
  return `${SUPORTE_ROOT}/suporte`;
}

// Refinamento visual: verbo de preferência/mudança + termo visual na mesma
// mensagem. Critério deliberadamente estreito — falso negativo aqui só custa
// o fallback de suporte (3KB); falso positivo injetaria 17KB+ de pipeline.
function ehRefinamentoVisual(msg: string): boolean {
  const temVerbo  = /(prefiro|prefere|melhor|mais|menos|troca|mud[ae]|deixa|quero|gostei|pode ser|em vez|ao inv[eé]s|tira|coloca|bota)/i.test(msg);
  const temVisual = /(escur[oa]|clar[oa]|cor(es)?\b|tom\b|tons\b|estilo|visual|fonte|letra|tipografia|menu|layout|grid|hero|categoria|badge|dark|light|vibrante|s[oó]bri[oa]|minimalis|paleta|fundo|bot[aã]o)/i.test(msg);
  return temVerbo && temVisual;
}

// Detecta se a mensagem é uma confirmação explícita para gerar o template agora.
// Quando true → carrega também o arquivo -impl.json do tema (código completo).
function isGerandoAgora(pergunta: string): boolean {
  return /\b(gerar?\s+o?\s*template|cri[ae]r?\s+o?\s*template|montar?\s+o?\s*template|pode\s+(gerar|criar|montar)|gera\s+agora|faz\s+agora|envia\s+o?\s*template|confirmo|quero\s+ver\s+o\s*template)\b/i.test(pergunta);
}

// ============================================================================
// SELEÇÃO DE FICHEIROS
// ============================================================================
function selecionarFicheiros(index: RagIndex, pergunta: string, rota: string, opts?: RagLoadOptions): string[] {
  const textoLower = pergunta.toLowerCase();
  const matcher    = criarMatcher(pergunta);
  const metaOnly   = (opts && opts.metaOnly) || false;
  const selecionados: string[] = [];

  const isSuporteRota  = rota === `${SUPORTE_ROOT}/suporte` || rota === `${SUPORTE_ROOT}/ia-de-balcao`;
  const isPipelineRota = rota === `${COMPILER_ROOT}/pipeline`;

  if (isSuporteRota && index.grupos) {
    // BALCÃO HIERÁRQUICO — lookup de 2 níveis: grupo → arquivo
    // Nível 1: encontra o grupo com mais keywords que batem na query
    let melhorGrupo = null;
    let melhorScore = 0;
    for (const grupo of index.grupos) {
      const score = (grupo.palavras_chave || []).filter(p => matcher(p)).length;
      if (score > melhorScore) { melhorScore = score; melhorGrupo = grupo; }
    }
    if (!melhorGrupo) melhorGrupo = index.grupos[0]; // fallback: primeiro grupo

    // Nível 2: dentro do grupo, encontra o(s) arquivo(s) com mais keywords
    const subIndexPath = path.join(RAG_ROOT, rota, melhorGrupo.pasta, 'index.json');
    let subIndex: RagIndex;
    try { subIndex = JSON.parse(fs.readFileSync(subIndexPath, 'utf-8')); } catch (e) { subIndex = { ficheiros: [] }; }

    let melhorArquivo: RagIndexFile | null = null;
    let melhorArqScore = 0;
    for (const item of (subIndex.ficheiros || [])) {
      const score = (item.palavras_chave || []).filter(p => matcher(p)).length;
      if (score > melhorArqScore) { melhorArqScore = score; melhorArquivo = item; }
    }
    if (!melhorArquivo && subIndex.ficheiros && subIndex.ficheiros.length > 0) {
      melhorArquivo = subIndex.ficheiros[0]; // fallback: primeiro arquivo do grupo
    }
    if (melhorArquivo) {
      selecionados.push(`${rota}/${melhorGrupo.pasta}/${melhorArquivo.arquivo}`);
    }

    // Limita a máx 2
    selecionados.splice(2);

  } else if (isSuporteRota && index.ficheiros) {
    // SUPORTE PLANO — match por palavras-chave (mantido para compatibilidade)
    for (const item of index.ficheiros) {
      if ((item.palavras_chave || []).some(p => matcher(p))) {
        selecionados.push(`${rota}/${item.arquivo}`);
      }
    }

    // Fallback para suporte: carrega sempre o tópicos (router principal)
    if (selecionados.length === 0 && rota === `${SUPORTE_ROOT}/suporte`) {
      const topicos = index.ficheiros.find(f => f.arquivo.includes('topicos'));
      if (topicos) selecionados.push(`${rota}/${topicos.arquivo}`);
    }

    // Limita a máx 2
    selecionados.splice(2);

  } else if (isPipelineRota && index.fases) {
    // Instrucoes essenciais — 3 ficheiros base (era 6, reduzido para economizar contexto)
    const sempreCarregar = (index.fases.fase_1_intent || {}).carrega_sempre || [
      'instrucoes/ia-balcao-expectativa-vs-realidade.json',
    ];
    for (const rel of sempreCarregar) {
      selecionados.push(`${rota}/${rel}`);
    }

    // Instrucoes por relevância: perguntas-guiadas, personas, refinamento
    const temIntencaoVaga = /(quero|gostaria|preciso|seria possível|pode me|me ajuda|como|qual)/i.test(pergunta) && pergunta.length < 120;
    if (temIntencaoVaga) {
      selecionados.push(`${rota}/instrucoes/ia-balcao-perguntas-guiadas.json`);
    }

    // Detecta tema do nicho — cobre todos os 14 temas (agora usando arquivos -meta)
    const matches = [
      { regex: /games|gamer|gaming|esport|e-sport|videogame|jogo|\brpg\b|\bfps\b|\bmmo\b/i,              base: 'tema-gamer-playerone' },
      { regex: /pop|anime|nerd|geek|cultura pop|mangá|otaku|cosplay|retr[oô]|pixel/i,                     base: 'tema-pop-retro-pixel' },
      { regex: /natureza|vegano|sustent[aá]vel|ecologia|ambiental|org[aâ]nico|verde|planeta/i,             base: 'tema-natureza-bulma-vegan' },
      { regex: /educa[cç][aã]o|curso|aula|ensino|treinamento|escola|aprendizado|professor|e-?learning/i,   base: 'tema-elearning-academy' },
      { regex: /bio\s?link|biolink|link\s?na\s?bio|influencer|instagram|criador de conte[uú]do/i,          base: 'tema-biolink-social' },
      { regex: /app\b|aplicativo|mobile|android|\bios\b|download|software m[oó]vel/i,                     base: 'tema-appstore-bulma-mobile' },
      { regex: /brutal|brutalismo|indie|experimental|vanguarda|alternativo/i,                              base: 'tema-brutalista-appcraft' },
      { regex: /culin[aá]ria|gastronomia|receita|comida|cozinha|gourmet|restaurante/i,                    base: 'tema-culinaria-boutique-gourmet' },
      { regex: /not[ií]cia|jornal|jornalismo|manchete|\bnews\b/i,                                         base: 'tema-noticias-mag-news' },
      { regex: /viral|editorial|magazine|revista|trending|conte[uú]do/i,                                  base: 'tema-viral-magazine' },
      { regex: /saas|startup|produto digital|landing|convers[aã]o|neg[oó]cio/i,                           base: 'tema-saas-nexus' },
      { regex: /portfolio|portf[oó]lio|freelancer|design pessoal|minimalista/i,                           base: 'tema-portfolio-minimalista' },
      { regex: /tecnologia|tech|coding|programa[cç][aã]o|software|intelig[eê]ncia artificial/i,           base: 'tema-tecnologia-mag-tech' },
      { regex: /tech blog|tend[eê]ncias|futuro|inova[cç][aã]o|tecnologia emergente/i,                    base: 'tema-tecnologia-techwind' },
    ];

    // Tema pela mensagem atual; se ela não menciona o nicho (refinamento tipo
    // "deixa mais escuro" ou confirmação "pode gerar agora"), procura no
    // histórico do usuário, da mensagem mais recente para a mais antiga —
    // sem isso o -impl.json nunca carregava na hora exata da confirmação.
    let match = matches.find(m => m.regex.test(textoLower));
    if (!match) {
      const historico = (opts && opts.historico) || [];
      for (let i = historico.length - 1; i >= 0 && !match; i--) {
        const antiga = String(historico[i] || '').toLowerCase();
        match = matches.find(m => m.regex.test(antiga));
      }
    }
    if (match) {
      // Engenharia: 2 ficheiros técnicos essenciais
      selecionados.push(
        `${rota}/engenharia/ia-balcao-blindagem-anti-injecao-blogger.json`,
        `${rota}/engenharia/ia-balcao-imagens-responsivas-blogger.json`
      );

      // Tema: meta sempre + impl só quando o utilizador confirma geração
      selecionados.push(`${rota}/temas/${match.base}-meta.json`);
      if (!metaOnly && isGerandoAgora(pergunta)) {
        selecionados.push(`${rota}/temas/${match.base}-impl.json`);
      }
    }
  }

  return selecionados;
}

// ============================================================================
// CARREGAR CONTEÚDO
// ============================================================================
function carregarFicheiro(relPath: string): string | null {
  const fullPath = path.join(RAG_ROOT, relPath);
  try {
    return fs.readFileSync(fullPath, 'utf-8');
  } catch (e) {
    console.error(`[RAG] Falha ao ler ${relPath}: ${(e as Error).message}`);
    return null;
  }
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Versão síncrona para rotas Express
 * @param {string} pergunta
 * @param {object} [opts] — { metaOnly: boolean, historico: string[] }
 */
export function loadForGeminiSync(pergunta: unknown, opts?: RagLoadOptions): RagLoadResult {
  if (!pergunta || typeof pergunta !== 'string') {
    return {
      rota: 'error',
      ficheirosCarregados: [],
      tamanhoTotalKB: 0,
      contextoStr: '',
      erro: 'Pergunta inválida',
    };
  }

  try {
    const rota = rotearPergunta(pergunta);
    const indexPath = path.join(RAG_ROOT, rota, 'index.json');
    const index: RagIndex = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));

    const ficheirosParaCarregar = selecionarFicheiros(index, pergunta, rota, opts);

    const conteudos: { arquivo: string; conteudo: string }[] = [];
    let tamanhoTotal = 0;

    for (const relPath of ficheirosParaCarregar) {
      const conteudo = carregarFicheiro(relPath);
      if (conteudo) {
        conteudos.push({ arquivo: relPath, conteudo });
        tamanhoTotal += Buffer.byteLength(conteudo, 'utf-8') / 1024;
      }
    }

    const contextoStr = conteudos
      .map(({ arquivo, conteudo }) =>
        `\n<!-- RAG: ${arquivo} -->\n${conteudo}`
      )
      .join('\n');

    return {
      rota,
      ficheirosCarregados: conteudos.map(c => c.arquivo),
      tamanhoTotalKB: tamanhoTotal.toFixed(2),
      contextoStr,
      sucesso: true,
    };

  } catch (e) {
    return {
      rota: 'error',
      ficheirosCarregados: [],
      tamanhoTotalKB: 0,
      contextoStr: '',
      erro: (e as Error).message,
      sucesso: false,
    };
  }
}
