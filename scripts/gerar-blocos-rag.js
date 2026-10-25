"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BLOCOS = void 0;
exports.validar = validar;
exports.gerarBloco = gerarBloco;
exports.main = main;
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { gerarChat } = require('../src/services/geminiService');
const DEST = path.join(__dirname, '../src/rag/ia-de-balcao/blogger-ui');
// ─── SYSTEM PROMPT ────────────────────────────────────────────────────────────
const SYSTEM = `Você é um especialista em Blogger V3, Bootstrap 5.3.3 e componentes UI para blogs.
Sua única tarefa é gerar blocos de conhecimento técnico no formato JSON da biblioteca RAG do projeto.

REGRAS ABSOLUTAS (qualquer violação invalida a resposta):
1. Retorne APENAS JSON válido — sem markdown, sem \`\`\`json, sem texto antes ou depois.
2. NUNCA use tags Blogger (b:, data:, expr:) em campos html/css/js — esses campos são HTML/CSS/JS puros.
3. NUNCA escreva comentários HTML com CSS custom property dentro: proibido <!-- Use var(--algo) -->.
   Se precisar comentar algo sobre CSS vars, use texto FORA de comentários HTML ou omita.
4. Use Bootstrap 5.3.3 e variáveis --sl-primary, --sl-accent, --sl-text-main, --sl-bg-body,
   --sl-primary-rgb, --sl-header-bg, --sl-footer-bg, --sl-footer-text, --sl-card-bg, --sl-border.
5. HTML com conteúdo mockado e estático (sem URLs reais, sem chamadas de API inline).
6. JS como string no campo "js" — sem event listeners em atributos HTML (onclick= nos botões de
   scroll são aceitáveis como one-liner, mas prefira addEventListener no campo js).
7. Estrutura obrigatória do JSON:
{
  "id": "ia-balcao-NOME-DO-BLOCO",
  "categoria": "categoria-kebab-case",
  "conceito": "Descrição técnica em uma frase do que este bloco cobre.",
  "variante_1": {
    "descricao": "O que esta variante faz e quando usar.",
    "html": "...",
    "css": "...",
    "js": "..."
  },
  "variante_2": { ... },
  "notas_tecnicas": ["nota 1", "nota 2", "nota 3"]
}
Os campos css e js são opcionais por variante. Inclua pelo menos 3 variantes por bloco.`;
// ─── BLOCOS A GERAR ───────────────────────────────────────────────────────────
exports.BLOCOS = [
    {
        id: 'ia-balcao-cards-com-imagem',
        prompt: 'Gere o bloco RAG "ia-balcao-cards-com-imagem" para cards de postagem COM imagem destacada para Blogger Bootstrap 5.3. Inclua: card horizontal (imagem esquerda + texto direita), card vertical padrão com aspect-ratio 16/9 na imagem, card com overlay de categoria sobre a imagem, e card magazine (imagem grande + múltiplos mini-links abaixo). Use img com aspect-ratio no CSS (não height fixo). Sem tags b: ou data:.',
    },
    {
        id: 'ia-balcao-paginacao',
        prompt: 'Gere o bloco RAG "ia-balcao-paginacao" para paginação de posts no Blogger Bootstrap 5.3. Inclua: paginação Bootstrap numerada estática, botão "Carregar Mais" com AJAX via JSON Feed do Blogger (JS completo com fetch), paginação infinita com IntersectionObserver, e indicador de progresso de scroll de lista. JS deve ser autônomo sem dependências externas.',
    },
    {
        id: 'ia-balcao-post-single-layout',
        prompt: 'Gere o bloco RAG "ia-balcao-post-single-layout" para layout de artigo/post único no Blogger Bootstrap 5.3. Inclua: cabeçalho do artigo (breadcrumb + título h1 + meta bar com autor/data/tempo de leitura), imagem hero com caption, corpo do artigo com estilos de tipografia (blockquote, code, listas), e rodapé do post (tags + autor box + navegação anterior/próximo). Sem tags b: ou data:.',
    },
    {
        id: 'ia-balcao-sidebar-widgets',
        prompt: 'Gere o bloco RAG "ia-balcao-sidebar-widgets" para widgets de sidebar no Blogger Bootstrap 5.3. Inclua: widget de autor (avatar circular SVG placeholder + bio + links sociais), nuvem de tags (tag cloud com tamanhos variados por relevância), posts populares com numeração, e widget de anúncio placeholder 300x250. CSS com hover e transições.',
    },
    {
        id: 'ia-balcao-share-social',
        prompt: 'Gere o bloco RAG "ia-balcao-share-social" para compartilhamento social inline em posts no Blogger Bootstrap 5.3. Inclua: barra de share horizontal com ícones SVG e contagem mockada, botões floating vertical (fixed na lateral esquerda em desktop), share via Web Share API com fallback para clipboard, e share nativo mobile com navigator.share(). JS completo para cada variante.',
    },
    {
        id: 'ia-balcao-tabelas-estilizadas',
        prompt: 'Gere o bloco RAG "ia-balcao-tabelas-estilizadas" para tabelas estilizadas no Blogger Bootstrap 5.3. Inclua: tabela de especificações técnicas (2 colunas: feature + valor), tabela de comparação de apps/produtos (sim/não com checkmarks e X), tabela responsiva com scroll horizontal em mobile, e tabela de preços simples. CSS com striped rows, hover e bordas coloridas com --sl-primary.',
    },
    {
        id: 'ia-balcao-toasts-alertas',
        prompt: 'Gere o bloco RAG "ia-balcao-toasts-alertas" para toasts e alertas no Blogger Bootstrap 5.3. Inclua: toast de notificação (Bootstrap Toast com posição bottom-end, auto-dismiss 5s), alerta inline informativo (4 variantes: info/success/warning/danger com ícone Bootstrap Icons), alerta dismissível que salva estado no sessionStorage, e banner de atualização disponível com botão de reload. JS completo.',
    },
    {
        id: 'ia-balcao-ratings-avaliacoes',
        prompt: 'Gere o bloco RAG "ia-balcao-ratings-avaliacoes" para ratings e avaliações de apps/produtos no Blogger Bootstrap 5.3. Inclua: display de nota com estrelas SVG (ex: 4.5/5), barra de distribuição de notas (5 estrelas→1 estrela com percentuais), badge de rating estilo app store (nota grande + texto "Excelente"), e sistema de voto simples (útil/não útil) com localStorage. Sem dependências externas.',
    },
    {
        id: 'ia-balcao-galeria-midia',
        prompt: 'Gere o bloco RAG "ia-balcao-galeria-midia" para galerias de screenshots e imagens no Blogger Bootstrap 5.3. Inclua: grid de screenshots com lightbox CSS puro (sem biblioteca), galeria de screenshots de app com scroll horizontal snap, carrossel de antes/depois com CSS slider (clip-path), e grid masonry de screenshots 2 colunas. Lightbox deve fechar com Escape via JS.',
    },
    {
        id: 'ia-balcao-posts-relacionados',
        prompt: 'Gere o bloco RAG "ia-balcao-posts-relacionados" para widget de posts relacionados no Blogger Bootstrap 5.3. Inclua: skeleton placeholder enquanto carrega (IIFE), fetch via JSON Feed por label do post atual (URL construída por JS a partir de document.querySelector), grid 3 colunas de mini-cards com imagem 16:9, e fallback se fetch falhar (mensagem amigável). JS completo e autônomo.',
    },
    {
        id: 'ia-balcao-formulario-contato',
        prompt: 'Gere o bloco RAG "ia-balcao-formulario-contato" para formulários de contato e newsletter no Blogger Bootstrap 5.3. Inclua: formulário de contato completo (nome, email, assunto, mensagem) com validação HTML5 + CSS visual, formulário de newsletter single-field com confirmação visual inline, formulário multi-step 2 etapas (dados → mensagem) com progress indicator, e formulário de avaliação de post (estrelas clicáveis + comentário opcional). Sem backend — apenas UI/UX.',
    },
    {
        id: 'ia-balcao-toc-sumario',
        prompt: 'Gere o bloco RAG "ia-balcao-toc-sumario" para Table of Contents automático em artigos do Blogger Bootstrap 5.3. Inclua: TOC gerado por JS a partir dos h2/h3 do .entry-content (ou .sl-post-content), com anchors automáticos, spy de scroll que marca o item ativo conforme rolagem, TOC colapsável em mobile com botão toggle, e numeração automática de seções. JS completo com IntersectionObserver para spy.',
    },
    {
        id: 'ia-balcao-pricing-table',
        prompt: 'Gere o bloco RAG "ia-balcao-pricing-table" para tabelas de preços de apps/serviços no Blogger Bootstrap 5.3. Inclua: pricing 3 colunas (Free, Pro, Premium) com destaque na coluna central, pricing anual/mensal com toggle switch Bootstrap, pricing de app store (badge gratuito vs preço), e pricing simples 2 colunas. Badge "Mais Popular" na coluna destacada. Usar --sl-primary para highlights.',
    },
    {
        id: 'ia-balcao-fab-scroll-top',
        prompt: 'Gere o bloco RAG "ia-balcao-fab-scroll-top" para Floating Action Button e scroll-to-top no Blogger Bootstrap 5.3. Inclua: botão scroll-to-top simples (SVG seta, aparece após 300px de scroll), FAB com speed dial (botão central + sub-ações em leque no hover), FAB de compartilhar (abre mini painel com redes sociais), e indicador circular de progresso de leitura no canto com botão de topo embutido. JS leve e performático.',
    },
    {
        id: 'ia-balcao-timeline',
        prompt: 'Gere o bloco RAG "ia-balcao-timeline" para linhas do tempo no Blogger Bootstrap 5.3. Inclua: timeline vertical centralizada com pontos e linhas (alternando esquerda/direita em desktop, só direita em mobile), timeline de atualizações de app (versão + data + changelog), timeline compacta lateral para sidebar, e timeline horizontal scroll para histórico. CSS puro, sem JS exceto reveal on scroll opcional.',
    },
];
// ─── VALIDAÇÃO ────────────────────────────────────────────────────────────────
const COMMENT_DOUBLE_DASH = /<!--([\s\S]*?)-->/g;
const BLOGGER_TAG = /\b(b:|data:|expr:)/;
function validar(json, id) {
    const erros = [];
    // 1. id correto
    if (json.id !== id)
        erros.push(`id incorreto: esperado "${id}", recebido "${json.id}"`);
    // 2. categoria e conceito presentes
    if (!json.categoria)
        erros.push('campo "categoria" ausente');
    if (!json.conceito)
        erros.push('campo "conceito" ausente');
    // 3. pelo menos 2 variantes (campos com html)
    const variantes = Object.entries(json).filter(([k, v]) => !['id', 'categoria', 'conceito', 'notas_tecnicas'].includes(k) && v && typeof v === 'object' && v.html);
    if (variantes.length < 2)
        erros.push(`menos de 2 variantes com html (encontrei ${variantes.length})`);
    // 4. sem -- em comentários HTML
    const textoCompleto = JSON.stringify(json);
    let m;
    COMMENT_DOUBLE_DASH.lastIndex = 0;
    while ((m = COMMENT_DOUBLE_DASH.exec(textoCompleto)) !== null) {
        if (m[1].includes('--'))
            erros.push(`comentário XML com "--" encontrado: ${m[0].slice(0, 60)}`);
    }
    // 5. sem tags Blogger
    variantes.forEach(([k, v]) => {
        ['html', 'css', 'js'].forEach(campo => {
            if (v[campo] && BLOGGER_TAG.test(v[campo])) {
                erros.push(`tag Blogger (b:/data:/expr:) em ${k}.${campo}`);
            }
        });
    });
    return erros;
}
// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function gerarBloco(bloco) {
    const { id, prompt } = bloco;
    const arquivo = path.join(DEST, `${id}.json`);
    if (fs.existsSync(arquivo)) {
        console.log(`  SKIP  ${id} (já existe)`);
        return { id, status: 'skip' };
    }
    console.log(`\n>>> Gerando: ${id}`);
    let tentativa = 0;
    let ultimoErro = null;
    while (tentativa < 3) {
        tentativa++;
        const promptFinal = tentativa === 1
            ? prompt
            : `${prompt}\n\nTentativa ${tentativa}: corrija os erros da tentativa anterior: ${ultimoErro}`;
        let texto;
        try {
            texto = await gerarChat([], promptFinal, SYSTEM, { maxTokens: 4000, temperature: 0.4 });
        }
        catch (err) {
            console.error(`  ERRO Gemini tentativa ${tentativa}:`, err.message);
            ultimoErro = err.message;
            continue;
        }
        // Extrai JSON da resposta (remove possível markdown)
        const jsonStr = texto.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
        let parsed;
        try {
            parsed = JSON.parse(jsonStr);
        }
        catch (parseErr) {
            ultimoErro = `JSON inválido: ${parseErr.message}`;
            console.warn(`  tentativa ${tentativa}: JSON inválido — ${parseErr.message}`);
            continue;
        }
        const erros = validar(parsed, id);
        if (erros.length > 0) {
            ultimoErro = erros.join('; ');
            console.warn(`  tentativa ${tentativa}: validação falhou — ${ultimoErro}`);
            continue;
        }
        // Salva
        fs.writeFileSync(arquivo, JSON.stringify(parsed, null, 2), 'utf-8');
        console.log(`  OK    ${id} (tentativa ${tentativa})`);
        return { id, status: 'ok', tentativas: tentativa };
    }
    console.error(`  FALHA ${id} após 3 tentativas: ${ultimoErro}`);
    return { id, status: 'fail', erro: ultimoErro };
}
async function main() {
    console.log(`Gerando ${exports.BLOCOS.length} blocos RAG via Gemini...\n`);
    const resultados = [];
    for (const bloco of exports.BLOCOS) {
        const r = await gerarBloco(bloco);
        resultados.push(r);
        // Pausa 1s entre chamadas para não estourar quota
        await new Promise(res => setTimeout(res, 1000));
    }
    console.log('\n══════════════════════════════');
    console.log('RESUMO:');
    resultados.forEach(r => {
        const icon = r.status === 'ok' ? '✓' : r.status === 'skip' ? '~' : '✗';
        console.log(`  ${icon} ${r.id} [${r.status}]`);
    });
    const ok = resultados.filter(r => r.status === 'ok').length;
    const skip = resultados.filter(r => r.status === 'skip').length;
    const fail = resultados.filter(r => r.status === 'fail').length;
    console.log(`\n  ${ok} gerados, ${skip} pulados, ${fail} falharam`);
}
if (require.main === module)
    main().catch(console.error);
