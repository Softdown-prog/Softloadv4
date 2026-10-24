/** Tipos do agente consultivo Solaris e das suas ferramentas de leitura. */
export interface SolToolArgs {
    pasta?: string;
    caminho?: string;
    termo?: string;
    css?: string;
    html?: string;
    js?: string;
    xml?: string;
    pergunta?: string;
    tokensExternos?: string[];
}
export interface SolConversationMessage { role: string; content: string }
export interface SolProgressEvent { type: 'status'; label: string }
export interface SolAgentOptions {
    budgetTokens?: number;
    temperature?: number;
    maxOutputTokens?: number;
    systemPrompt?: string;
    onProgress?: (evento: SolProgressEvent) => void;
}
export interface SolBudget {
    toolCalls: number;
    used: number;
    max: number;
    filesLoaded: string[];
    track(tokens: number, reason: string): void;
    remaining(): number;
    canLoadFile(): boolean;
    isExhausted(): boolean;
    percentUsed(): number;
    summary(): Record<string, unknown>;
}
export interface SolAgentReply {
    resposta: string;
    budget: Record<string, unknown>;
    iteracoes: number;
    ms: number;
}
export interface SolCodeMatch { arquivo: string; linha: number; trecho: string }
export type SolCodeSearchResult =
    | { erro: string }
    | { termo: string; totalEncontrado: number; truncado: boolean; ocorrencias: SolCodeMatch[] };
export interface SolNichoStatus {
    totalNichos: number;
    migrados: number;
    nichos: { nicho: string; pageType: string | null; chassis: string | null; migradoParaDossie: boolean }[];
}
interface SolModelPart {
    text?: string;
    functionCall?: { name: string; args: SolToolArgs };
}
interface SolModelResponse {
    candidates?: { content?: { parts?: SolModelPart[] } }[];
    usageMetadata?: { totalTokenCount?: number };
}
interface SolModelChat {
    sendMessage(input: {
        message: string | { role: 'user'; parts: { functionResponse: { name: string; response: unknown } }[] }[];
    }): Promise<SolModelResponse>;
}
declare function require(id: string): unknown;
declare const __dirname: string;
declare const process: { env: Record<string, string | undefined> };

// ============================================================
// SOL — agente conversacional da Softload (Gemini + function-calling).
//
// Nome curto, fácil de chamar (vem de "Softload"). NÃO é um modelo
// novo — é o mesmo Gemini já usado em geminiService.js/
// pecaOrchestrator.js, agora com ferramentas de leitura do próprio
// código-fonte da Softload conectadas, pra poder responder pergunta
// sobre a arquitetura e sugerir ideias.
//
// Reaproveita o mecanismo de tool-calling já resolvido em
// src/rag/ragAgent.js (mesmo formato de loop agêntico, mesma classe
// TokenBudget, importada — não duplicada) — mas com ferramentas
// PRÓPRIAS, diferentes: aquele lê arquivos RAG e valida um schema de
// blueprint antigo; este lê o código-fonte de verdade do projeto.
// Módulo separado de propósito (não uma extensão de ragAgent.js) —
// mesma razão de pecaOrchestrator.js não reaproveitar ragAgent.js
// diretamente: são dois contratos diferentes, acoplar arriscaria
// misturá-los.
//
// SOMENTE LEITURA por enquanto — nenhuma ferramenta aqui executa ação
// real no sistema (nada de gravar dossiê, rodar migração, compilar).
// Ferramentas de execução ficam pra quando o nível de autonomia do Sol
// for decidido explicitamente com o dono do produto.
// ============================================================

const fs = require('fs') as typeof import('node:fs');
const path = require('path') as typeof import('node:path');
const { GoogleGenAI, HarmCategory, HarmBlockThreshold } = require('@google/genai') as {
    GoogleGenAI: new (options: { apiKey: string }) => {
        chats: { create(options: unknown): SolModelChat };
    };
    HarmCategory: Record<string, string>;
    HarmBlockThreshold: Record<string, string>;
};
const { TokenBudget } = require('../rag/ragAgent') as {
    TokenBudget: new (tokens?: number, maxCalls?: number) => SolBudget;
};
const { NICHO_PAGE_TYPE_MAP, NICHO_CHASSIS_MAP } = require('../core/nichoTaxonomy') as {
    NICHO_PAGE_TYPE_MAP: Record<string, string>;
    NICHO_CHASSIS_MAP: Record<string, string>;
};
const { carregarNichoDossie } = require('../core/compilerEngine/dossieLoader') as {
    carregarNichoDossie(nicho: string): unknown;
};
const { consultarTelemetria } = require('../core/telemetria') as {
    consultarTelemetria(): Promise<unknown>;
};
const { buscarConhecimentoTecnico } = require('./solConhecimentoTecnico') as {
    buscarConhecimentoTecnico(pergunta: string | undefined): { aviso?: string; resultados: { arquivo: string; conteudo?: string; erro?: string }[] };
};
const { analisarCss } = require('../core/parser/cssParser') as { analisarCss(code: unknown, options?: {tokensExternos?: readonly string[]}): unknown };
const { analisarHtml } = require('../core/parser/htmlParser') as { analisarHtml(code: unknown): unknown };
const { analisarJs } = require('../core/parser/jsParser') as { analisarJs(code: unknown): unknown };
const { analisarXml } = require('../core/parser/xmlParser') as { analisarXml(code: unknown): unknown };

const PROJETO_ROOT = path.join(__dirname, '../..');
const MODEL_NAME    = process.env.GEMINI_FLASH_MODEL || process.env.GEMINI_MODEL_NAME || 'gemini-2.5-flash';
// Orçamento alinhado à janela de contexto de ~1M tokens do gemini-2.5-flash
// (pedido explícito — investigações longas não devem parar cedo por conta
// de um teto artificial bem menor que o limite real do modelo). O número de
// tool calls sobe junto (senão o loop pararia em 10 iterações bem antes de
// chegar perto do orçamento de tokens, tornando o aumento acima inútil na
// prática) — 40 dá bastante fôlego pra investigação em vários arquivos sem
// abrir mão de um teto que evita loop indefinido.
const MAX_TOOL_CALLS = 40;
const BUDGET_TOKENS  = parseInt(process.env.SOL_AGENT_BUDGET || '1000000', 10);
const TAMANHO_MAX_ARQUIVO = 60 * 1024; // 60KB — arquivo maior que isso, pede trecho específico
const MAX_RESULTADOS_BUSCA = 30;

// Só estas pastas (+ os arquivos de raiz abaixo) são visíveis pro Sol —
// nunca .env, nunca segredo, nunca fora do projeto.
const PASTAS_PERMITIDAS = ['src', 'scripts', 'docs'];
const ARQUIVOS_RAIZ_PERMITIDOS = ['CLAUDE.md', 'README.md', 'package.json', 'Dockerfile'];

const SAFETY_SETTINGS = [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
];

const SOL_SYSTEM_PROMPT = `Você é Sol, o assistente interno da Softload Engine V3.
Ajuda o dono do produto e a equipe a entender e manter o código do projeto — lê o código-fonte sob demanda com as ferramentas disponíveis, busca onde algo está definido, consulta telemetria real de compilações e status de migração dos nichos, explica arquitetura, sugere melhorias.
Antes de listar/ler arquivo às cegas, prefira buscar_no_codigo quando a pergunta for "onde está X definido" — é mais direto.
Pra dúvida sobre biblioteca/framework externo usado no projeto (Node.js, Express, EJS, etc — não sobre o código da própria Softload), use consultar_conhecimento_tecnico antes de responder de memória.
Se o dono do produto colar um trecho de CSS/HTML/JS/XML pra revisar, ou você precisar confirmar se o código é sintaticamente válido antes de sugerir mudança nele, use analisar_css/analisar_html/analisar_js/analisar_xml em vez de inspecionar visualmente — são parsers de verdade, pegam erro que leitura visual erraria.
NUNCA afirme um fato verificável — caminho de arquivo, nome de constante, número de linha, trecho de código, status de migração de nicho (cano novo vs legado), ou número de compilações/telemetria — sem ter confirmado isso NESTA MESMA conversa com a ferramenta certa (ler_arquivo_codigo/buscar_no_codigo pra código, status_nichos pra migração de nicho, consultar_telemetria pra números de produção). Isso vale mesmo que "pareça familiar" de contexto anterior, de treinamento, ou de uma resposta sua em turno passado da MESMA conversa — o estado real pode ter mudado desde então, então nunca reafirme algo só porque você (ou a descrição de uma ferramenta) já mencionou antes; chame a ferramenta de novo. Se não tiver certeza, verifique de novo antes de responder, ou diga explicitamente "não confirmei isso, deixa eu checar" em vez de arriscar por dedução ou memória.
Você é SOMENTE CONSULTIVO: nunca afirme ter executado uma ação real (compilar, migrar nicho, gravar dado) — você só lê e sugere. Se o pedido for pra executar algo, explique que ainda não tem essa capacidade e diga o que a pessoa precisa fazer manualmente.
Responda sempre em português do Brasil, direto e técnico, sem inflar a resposta.`;

// ──────────────────────────────────────────────────────────────
// _caminhoSeguro — resolve um caminho pedido pelo modelo contra o
// root do projeto, garantindo que fica dentro de uma pasta permitida
// (ou é um dos arquivos de raiz liberados) e nunca é segredo/.env.
// Retorna o caminho absoluto seguro, ou null se negado.
// ──────────────────────────────────────────────────────────────
function _caminhoSeguro(relPathPedido: unknown): string | null {
    if (typeof relPathPedido !== 'string') return null;
    const limpo = relPathPedido.trim().replace(/^\/+/, '') || '.';
    const resolvido = path.resolve(PROJETO_ROOT, limpo);

    const relativoAoRoot = path.relative(PROJETO_ROOT, resolvido);
    if (relativoAoRoot.startsWith('..')) return null; // path traversal pra fora do projeto

    if (relativoAoRoot === '') {
        return resolvido; // a própria raiz — só listagem, nunca leitura de arquivo
    }

    const primeiroSegmento = relativoAoRoot.split(path.sep)[0];
    const ehArquivoDeRaizPermitido = ARQUIVOS_RAIZ_PERMITIDOS.includes(relativoAoRoot);
    const ehDentroDePastaPermitida = PASTAS_PERMITIDAS.includes(primeiroSegmento);

    if (!ehArquivoDeRaizPermitido && !ehDentroDePastaPermitida) return null;

    const nomeBase = path.basename(resolvido);
    if (nomeBase === '.env' || nomeBase.startsWith('.env.') || /secret|credential|\.pem$|\.key$/i.test(nomeBase)) {
        return null;
    }

    return resolvido;
}

// ──────────────────────────────────────────────────────────────────────────
// DECLARAÇÕES DE FERRAMENTAS
// ──────────────────────────────────────────────────────────────────────────
const SOL_TOOL_DECLARATIONS = {
    functionDeclarations: [
        {
            name: 'listar_arquivos',
            description: [
                'Lista arquivos e subpastas de uma pasta do projeto Softload Engine.',
                'Use ANTES de ler_arquivo_codigo pra descobrir o que existe.',
                'Pastas visíveis: src/, scripts/, docs/. Nunca mostra node_modules, dotfiles nem segredos.',
                'Exemplo: listar_arquivos("src/core/compilerEngine")',
            ].join(' '),
            parameters: {
                type: 'object',
                properties: {
                    pasta: { type: 'string', description: 'Caminho relativo à raiz do projeto (ex: "src/core", ou "." pra raiz).' },
                },
                required: ['pasta'],
            },
        },
        {
            name: 'ler_arquivo_codigo',
            description: [
                'Lê o conteúdo completo de um arquivo de código-fonte do projeto Softload.',
                'Só funciona pra arquivos dentro de src/, scripts/, docs/, ou CLAUDE.md/README.md/package.json/Dockerfile na raiz.',
                'Nunca funciona pra .env ou qualquer coisa que pareça segredo/credencial — acesso negado nesses casos.',
                `Arquivos maiores que ${TAMANHO_MAX_ARQUIVO / 1024}KB são recusados — peça um arquivo mais específico.`,
                'Máximo 8 chamadas de ferramenta por pergunta, pra controlar orçamento de tokens.',
            ].join(' '),
            parameters: {
                type: 'object',
                properties: {
                    caminho: { type: 'string', description: 'Caminho relativo à raiz do projeto (ex: "src/core/compilerEngine/pecaOrchestrator.js").' },
                },
                required: ['caminho'],
            },
        },
        {
            name: 'check_token_budget',
            description: 'Verifica quantos tokens e chamadas de ferramenta restam no orçamento desta pergunta.',
            parameters: { type: 'object', properties: {} },
        },
        {
            name: 'buscar_no_codigo',
            description: [
                'Busca um termo literal (texto ou nome de função/variável) em todos os arquivos de src/, scripts/ e docs/.',
                'Use pra achar ONDE algo está definido/usado, em vez de listar+ler arquivos às cegas.',
                `Retorna no máximo ${MAX_RESULTADOS_BUSCA} ocorrências (arquivo + número da linha + trecho da linha).`,
                'Exemplo: buscar_no_codigo("resolverPeca") acha o orquestrador e todo lugar que o chama.',
            ].join(' '),
            parameters: {
                type: 'object',
                properties: {
                    termo: { type: 'string', description: 'Texto literal a buscar (case-insensitive). Não é regex.' },
                },
                required: ['termo'],
            },
        },
        {
            name: 'consultar_telemetria',
            description: [
                'Lê a telemetria interna de compilações reais (logs/compilacoes.jsonl) e devolve um resumo agregado:',
                'total de compilações, quantas por nicho, quantas usaram peça gerada por IA, quantas falharam em cada validador.',
                'Se ainda não houver nenhuma compilação registrada em produção, avisa isso explicitamente em vez de inventar dado.',
            ].join(' '),
            parameters: { type: 'object', properties: {} },
        },
        {
            name: 'status_nichos',
            description: [
                'Lista todos os nichos conhecidos da Softload e diz, pra cada um, se já foi migrado pro dossiê (cano novo)',
                'ou ainda está no cano legado (heurística antiga), junto com chassis e pageType de cada um.',
            ].join(' '),
            parameters: { type: 'object', properties: {} },
        },
        {
            name: 'analisar_css',
            description: [
                'Analisa um trecho de CSS arbitrário com um parser de verdade (PostCSS, AST — não regex):',
                'erro de sintaxe real com linha/coluna, variável CSS var(--x) usada mas nunca declarada, seletor duplicado, contagem de regras/declarações/at-rules.',
                'Use quando o dono do produto colar CSS pra revisar, ou quando precisar confirmar se um trecho de CSS é sintaticamente válido antes de sugerir mudança nele — não é pra CSS já validado pelos workers do compilador (cssWorker.js), é ferramenta de manutenção geral.',
                'tokensExternos (opcional) evita falso-positivo de variável órfã quando o CSS usa uma variável legitimamente declarada em outro lugar (ex: --sl-primary, global do compilador).',
            ].join(' '),
            parameters: {
                type: 'object',
                properties: {
                    css: { type: 'string', description: 'O código CSS a analisar.' },
                    tokensExternos: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Nomes de variável CSS (ex: "--sl-primary") que são válidas mesmo sem declaração local neste trecho.',
                    },
                },
                required: ['css'],
            },
        },
        {
            name: 'analisar_html',
            description: [
                'Analisa um trecho de HTML arbitrário com um parser de verdade (parse5, o mesmo motor do jsdom — spec HTML5, não regex):',
                'contagem de elementos por tag, atributo "id" duplicado (bug real — quebra getElementById/seletor #id), avisos de recuperação do parser (ex: atributo duplicado).',
                'HTML5 é tolerante por spec — SEMPRE produz uma árvore mesmo com tag não fechada (mesma recuperação que o browser faz); não existe "sintaxe inválida" pra HTML do jeito que existe pra CSS/JS/XML, então o achado mais útil aqui costuma ser id duplicado.',
                'Use quando o dono do produto colar HTML pra revisar.',
            ].join(' '),
            parameters: {
                type: 'object',
                properties: { html: { type: 'string', description: 'O código HTML a analisar.' } },
                required: ['html'],
            },
        },
        {
            name: 'analisar_js',
            description: [
                'Analisa um trecho de JavaScript vanilla arbitrário com um parser de verdade (Acorn, AST — não regex nem vm.Script):',
                'erro de sintaxe real com linha/coluna, identificador possivelmente não declarado (típico de typo de nome de variável/função), chamadas de console.log/warn/error/debug (útil pra achar debug esquecido).',
                'A checagem de identificador não declarado é CONSERVADORA (escopo achatado, não resolução de escopo real) — pode deixar passar bug de escopo errado, mas evita falso-positivo.',
                'Diferente de jsWorker.js do pipeline de compilação (que checa colisão de escopo global entre peças que vão concatenar), esta ferramenta analisa 1 bloco isolado sem saber de outros blocos.',
                'Use quando o dono do produto colar JS pra revisar, antes de sugerir mudança nele.',
            ].join(' '),
            parameters: {
                type: 'object',
                properties: { js: { type: 'string', description: 'O código JavaScript a analisar.' } },
                required: ['js'],
            },
        },
        {
            name: 'analisar_xml',
            description: [
                'Analisa um trecho de XML arbitrário com um parser de verdade (fast-xml-parser, já usado no pipeline de compilação):',
                'validade de sintaxe com linha/coluna do erro real, contagem de tags, atributo "id" duplicado em qualquer lugar do documento.',
                'Diferente de xmlValidator.js (que valida XML de template Blogger já montado, com regras específicas de b:section/b:widget), esta ferramenta é genérica — não sabe nada de Blogger, serve pra XML arbitrário colado num chat.',
                'Use quando o dono do produto colar XML pra revisar.',
            ].join(' '),
            parameters: {
                type: 'object',
                properties: { xml: { type: 'string', description: 'O código XML a analisar.' } },
                required: ['xml'],
            },
        },
        {
            name: 'consultar_conhecimento_tecnico',
            description: [
                'Busca material de referência técnica EXTERNA (Node.js, Express, EJS, e outras bibliotecas/frameworks usados no projeto) —',
                'NÃO é pra código da própria Softload, isso é buscar_no_codigo/ler_arquivo_codigo.',
                'Use quando a dúvida é sobre como o framework/biblioteca em si funciona, não sobre uma decisão específica do projeto.',
                'Essa base cresce por curadoria manual — pode estar vazia ou não ter cobertura pra todo tema; se vier vazia, diga isso e responda com o que você já sabe do framework, deixando claro que não veio de material verificado do projeto.',
            ].join(' '),
            parameters: {
                type: 'object',
                properties: {
                    pergunta: { type: 'string', description: 'A dúvida técnica em si, em texto livre (ex: "como funciona include no EJS").' },
                },
                required: ['pergunta'],
            },
        },
    ],
};

// Extensões tratadas como texto pesquisável — o resto (imagens, binários) é ignorado.
const EXTENSOES_BUSCAVEIS = new Set([
    '.js', '.json', '.md', '.ejs', '.xml', '.css', '.html', '.txt', '.yml', '.yaml',
]);

// ──────────────────────────────────────────────────────────────
// _arquivosBuscaveis — anda recursivamente pelas pastas permitidas
// (mais os arquivos de raiz liberados) e devolve os caminhos
// relativos de todo arquivo com extensão pesquisável. Usado só por
// buscar_no_codigo — respeita o mesmo escopo de _caminhoSeguro.
// ──────────────────────────────────────────────────────────────
function _arquivosBuscaveis(): string[] {
    const resultado: string[] = [];

    function andar(absDir: string, relDir: string): void {
        let entradas;
        try {
            entradas = fs.readdirSync(absDir, { withFileTypes: true });
        } catch (e) {
            return;
        }
        for (const entrada of entradas) {
            if (entrada.name === 'node_modules' || entrada.name.startsWith('.')) continue;
            const relCaminho = relDir ? `${relDir}/${entrada.name}` : entrada.name;
            const absCaminho = path.join(absDir, entrada.name);
            if (entrada.isDirectory()) {
                andar(absCaminho, relCaminho);
            } else if (EXTENSOES_BUSCAVEIS.has(path.extname(entrada.name))) {
                resultado.push(relCaminho);
            }
        }
    }

    for (const pasta of PASTAS_PERMITIDAS) {
        andar(path.join(PROJETO_ROOT, pasta), pasta);
    }
    for (const arquivoRaiz of ARQUIVOS_RAIZ_PERMITIDOS) {
        if (EXTENSOES_BUSCAVEIS.has(path.extname(arquivoRaiz))) resultado.push(arquivoRaiz);
    }

    return resultado;
}

// ──────────────────────────────────────────────────────────────
// _buscarNoCodigo — grep case-insensitive por termo literal sobre
// _arquivosBuscaveis(), limitado a MAX_RESULTADOS_BUSCA ocorrências.
// ──────────────────────────────────────────────────────────────
function _buscarNoCodigo(termo: unknown): SolCodeSearchResult {
    if (!termo || typeof termo !== 'string' || !termo.trim()) {
        return { erro: 'Termo de busca vazio.' };
    }
    const alvo = termo.trim().toLowerCase();
    const ocorrencias: SolCodeMatch[] = [];

    for (const relCaminho of _arquivosBuscaveis()) {
        if (ocorrencias.length >= MAX_RESULTADOS_BUSCA) break;
        const absCaminho = path.join(PROJETO_ROOT, relCaminho);
        let conteudo;
        try {
            const stat = fs.statSync(absCaminho);
            if (stat.size > TAMANHO_MAX_ARQUIVO) continue; // arquivo gigante — pula, mesmo limite de ler_arquivo_codigo
            conteudo = fs.readFileSync(absCaminho, 'utf-8');
        } catch (e) {
            continue;
        }
        const linhas = conteudo.split('\n');
        for (let i = 0; i < linhas.length; i++) {
            if (linhas[i].toLowerCase().includes(alvo)) {
                ocorrencias.push({ arquivo: relCaminho, linha: i + 1, trecho: linhas[i].trim().slice(0, 200) });
                if (ocorrencias.length >= MAX_RESULTADOS_BUSCA) break;
            }
        }
    }

    return {
        termo,
        totalEncontrado: ocorrencias.length,
        truncado: ocorrencias.length >= MAX_RESULTADOS_BUSCA,
        ocorrencias,
    };
}

// ──────────────────────────────────────────────────────────────
// _consultarTelemetria — delega pra telemetria.consultarTelemetria()
// (Firestore-backed). Mantido como wrapper fino aqui só pra preservar
// o nome já usado pelo dispatcher/testes — a agregação em si vive em
// core/telemetria.js. Async, diferente das outras ferramentas do Sol
// (única que depende de rede além de buscar_no_codigo/ler_arquivo_codigo,
// que são locais).
// ──────────────────────────────────────────────────────────────
async function _consultarTelemetria(): Promise<unknown> {
    return consultarTelemetria();
}

// ──────────────────────────────────────────────────────────────
// _statusNichos — une as chaves dos dois mapas de nichoTaxonomy.js
// e diz, pra cada um, se já tem dossiê (cano novo) ou não (cano legado).
// ──────────────────────────────────────────────────────────────
function _statusNichos(): SolNichoStatus {
    const nichos = new Set([...Object.keys(NICHO_PAGE_TYPE_MAP), ...Object.keys(NICHO_CHASSIS_MAP)]);
    const lista = [...nichos].sort().map(nicho => ({
        nicho,
        pageType: NICHO_PAGE_TYPE_MAP[nicho] || null,
        chassis: NICHO_CHASSIS_MAP[nicho] || null,
        migradoParaDossie: carregarNichoDossie(nicho) !== null,
    }));
    return {
        totalNichos: lista.length,
        migrados: lista.filter(n => n.migradoParaDossie).length,
        nichos: lista,
    };
}

// ──────────────────────────────────────────────────────────────────────────
// EXECUTOR DE FERRAMENTAS
// ──────────────────────────────────────────────────────────────────────────
async function executeSolTool(name: string, args: SolToolArgs, budget: SolBudget): Promise<unknown> {
    budget.toolCalls++;

    switch (name) {
        case 'listar_arquivos': {
            const alvo = _caminhoSeguro(args.pasta || '.');
            if (!alvo) {
                return { erro: `Acesso negado: "${args.pasta}" está fora do escopo permitido (src/, scripts/, docs/) ou é um caminho inválido.` };
            }
            try {
                const entradas = fs.readdirSync(alvo, { withFileTypes: true });
                const arquivos = entradas
                    .filter(e => e.name !== 'node_modules' && !e.name.startsWith('.'))
                    .map(e => (e.isDirectory() ? `${e.name}/` : e.name))
                    .sort();
                return { pasta: args.pasta, arquivos };
            } catch (e) {
                return { erro: `Falha ao listar "${args.pasta}": ${(e as Error).message}` };
            }
        }

        case 'ler_arquivo_codigo': {
            const alvo = _caminhoSeguro(args.caminho || '');
            if (!alvo) {
                return { erro: `Acesso negado: "${args.caminho}" está fora do escopo permitido ou é um caminho inválido.` };
            }
            if (!budget.canLoadFile()) {
                return { erro: 'Orçamento de tokens insuficiente para carregar mais um arquivo.', orcamentoRestante: budget.remaining() };
            }
            try {
                const stat = fs.statSync(alvo);
                if (stat.isDirectory()) {
                    return { erro: `"${args.caminho}" é uma pasta — use listar_arquivos.` };
                }
                if (stat.size > TAMANHO_MAX_ARQUIVO) {
                    return { erro: `"${args.caminho}" tem ${(stat.size / 1024).toFixed(0)}KB, maior que o limite de ${TAMANHO_MAX_ARQUIVO / 1024}KB.` };
                }
                const conteudo = fs.readFileSync(alvo, 'utf-8');
                const tokens = Math.ceil(conteudo.length / 4);
                budget.track(tokens, `arquivo:${args.caminho}`);
                budget.filesLoaded.push(args.caminho as string);
                return { caminho: args.caminho, conteudo, tokensUsados: tokens, orcamentoRestante: budget.remaining() };
            } catch (e) {
                return { erro: `Falha ao ler "${args.caminho}": ${(e as Error).message}` };
            }
        }

        case 'check_token_budget':
            return budget.summary();

        case 'buscar_no_codigo':
            return _buscarNoCodigo(args.termo);

        case 'consultar_telemetria':
            return await _consultarTelemetria();

        case 'status_nichos':
            return _statusNichos();

        case 'analisar_css':
            return analisarCss(args.css, { tokensExternos: args.tokensExternos });

        case 'analisar_html':
            return analisarHtml(args.html);

        case 'analisar_js':
            return analisarJs(args.js);

        case 'analisar_xml':
            return analisarXml(args.xml);

        case 'consultar_conhecimento_tecnico': {
            const resultado = buscarConhecimentoTecnico(args.pergunta);
            const tamanhoTotal = (resultado.resultados || []).reduce((soma, r) => soma + (r.conteudo ? r.conteudo.length : 0), 0);
            if (tamanhoTotal > 0) {
                budget.track(Math.ceil(tamanhoTotal / 4), `conhecimento-tecnico:${args.pergunta}`);
            }
            return resultado;
        }

        default:
            return { erro: `Ferramenta desconhecida: ${name}` };
    }
}

// ──────────────────────────────────────────────────────────────
// _labelParaFerramenta — rótulo curto em PT-BR pra mostrar em tempo
// real qual ferramenta o Sol está executando (usado só pelo
// streaming — opcoes.onProgress). Puramente cosmético, não afeta
// o resultado.
// ──────────────────────────────────────────────────────────────
function _labelParaFerramenta(name: string, args: SolToolArgs | null | undefined): string {
    switch (name) {
        case 'listar_arquivos':    return `Listando arquivos em ${(args && args.pasta) || '.'}...`;
        case 'ler_arquivo_codigo': return `Lendo ${(args && args.caminho) || 'arquivo'}...`;
        case 'buscar_no_codigo':   return `Buscando "${(args && args.termo) || ''}" no código...`;
        case 'consultar_telemetria': return 'Consultando telemetria de compilações...';
        case 'status_nichos':      return 'Verificando status de migração dos nichos...';
        case 'analisar_css':       return 'Analisando CSS com o parser...';
        case 'analisar_html':      return 'Analisando HTML com o parser...';
        case 'analisar_js':        return 'Analisando JavaScript com o parser...';
        case 'analisar_xml':       return 'Analisando XML com o parser...';
        case 'consultar_conhecimento_tecnico': return `Consultando material técnico sobre "${(args && args.pergunta) || ''}"...`;
        case 'check_token_budget': return 'Checando orçamento de tokens...';
        default:                   return `Executando ${name}...`;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// perguntarAoSol — loop agêntico principal. Mesmo formato de
// ragAgent.agenticChat() (TokenBudget, MAX_TOOL_CALLS), ferramentas
// próprias do Sol. Retorna { resposta, budget, iteracoes, ms }.
//
// opcoes.onProgress(evento), se passado, é chamado em tempo real com
// { type: 'status', label } antes de cada chamada de ferramenta —
// usado pela rota de streaming pra mostrar progresso ao vivo. Nunca
// afeta o resultado final; se onProgress lançar, o erro é ignorado
// (progresso é cosmético, não pode derrubar a pergunta).
// ──────────────────────────────────────────────────────────────────────────
async function perguntarAoSol(historico: SolConversationMessage[] | null | undefined, mensagem: string, opcoes: SolAgentOptions = {}): Promise<SolAgentReply> {
    const t0 = Date.now();
    const hist = historico || [];
    const budget = new TokenBudget(opcoes.budgetTokens || BUDGET_TOKENS, MAX_TOOL_CALLS);
    const onProgress = typeof opcoes.onProgress === 'function'
        ? (evento: SolProgressEvent) => { try { opcoes.onProgress!(evento); } catch (e) { /* progresso é cosmético */ } }
        : (_evento: SolProgressEvent) => {};

    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error('[SOL] GEMINI_API_KEY não configurada.');

    const genAI = new GoogleGenAI({ apiKey: key });

    const chat = genAI.chats.create({
        model: MODEL_NAME,
        config: {
            tools: [SOL_TOOL_DECLARATIONS],
            temperature: opcoes.temperature ?? 0.3,
            maxOutputTokens: opcoes.maxOutputTokens ?? 2000,
            safetySettings: SAFETY_SETTINGS,
            systemInstruction: opcoes.systemPrompt || SOL_SYSTEM_PROMPT,
        },
        history: hist.map(m => ({
            role: m.role === 'assistant' ? 'model' : m.role,
            parts: [{ text: m.content }],
        })),
    });

    let iteracoes = 0;
    let respostaFinal: string | null = null;

    onProgress({ type: 'status', label: 'Sol está pensando...' });

    while (iteracoes <= MAX_TOOL_CALLS) {
        iteracoes++;

        const msgParaEnviar = iteracoes === 1
            ? mensagem
            : '[sistema] Continue com base nos resultados das ferramentas.';

        const response = await chat.sendMessage({ message: msgParaEnviar });
        const candidate = response.candidates?.[0];

        if (!candidate) {
            respostaFinal = '[SOL] Sem resposta do modelo.';
            break;
        }

        const parts = candidate.content?.parts || [];
        const toolCallParts = parts.filter(p => p.functionCall);
        const textParts = parts.filter(p => p.text);

        if (toolCallParts.length === 0) {
            respostaFinal = textParts.map(p => p.text).join('');
            budget.track(response.usageMetadata?.totalTokenCount ?? 0, 'resposta-final');
            break;
        }

        if (budget.isExhausted()) {
            respostaFinal = '[SOL] Orçamento de tokens esgotado nesta pergunta. Tente ser mais específico.';
            break;
        }

        toolCallParts.forEach(part => {
            onProgress({ type: 'status', label: _labelParaFerramenta(part.functionCall!.name, part.functionCall!.args) });
        });

        const toolResults = await Promise.all(toolCallParts.map(async part => ({
            functionResponse: {
                name: part.functionCall!.name,
                response: await executeSolTool(part.functionCall!.name, part.functionCall!.args, budget),
            },
        })));

        // Achado real (migração @google/genai): a SDK nova recusa um array
        // cru de parts functionResponse — precisa vir envolvido num Content
        // explícito ({role,parts}); a SDK antiga aceitava o array cru.
        const toolResult = await chat.sendMessage({ message: [{ role: 'user', parts: toolResults }] });
        budget.track(toolResult.usageMetadata?.totalTokenCount ?? 0, `tool-response-${iteracoes}`);

        const toolResponseParts = toolResult.candidates?.[0]?.content?.parts || [];
        const finalTextParts = toolResponseParts.filter(p => p.text && !p.functionCall);

        if (finalTextParts.length > 0) {
            respostaFinal = finalTextParts.map(p => p.text).join('');
            break;
        }

        const maisToolCalls = toolResponseParts.filter(p => p.functionCall);
        if (maisToolCalls.length === 0) {
            respostaFinal = toolResponseParts.map(p => p.text || '').join('') || '[SOL] Processamento concluído.';
            break;
        }
    }

    const ms = Date.now() - t0;
    console.warn(
        `[SOL] OK | ${ms}ms | iteracoes=${iteracoes} | tokens=${budget.used}/${budget.max} (${budget.percentUsed()}%) | arquivos=${budget.filesLoaded.length}`
    );

    return { resposta: respostaFinal || '[SOL] Sem resposta.', budget: budget.summary(), iteracoes, ms };
}

export {
    perguntarAoSol, executeSolTool, SOL_TOOL_DECLARATIONS,
    _caminhoSeguro, _buscarNoCodigo, _consultarTelemetria, _statusNichos,
};
