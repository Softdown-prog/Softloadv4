/** Contratos tipados da preparação assíncrona de peças, sem alterar o compilador síncrono. */
export interface PecaCandidata {
    id?: string;
    descricao?: string;
    css?: string;
    html?: string;
    js?: string;
    domIds?: string[];
    nichoOrigem?: unknown;
    [chave: string]: unknown;
}
export interface TokensCssPeca {
    light_mode?: Record<string, unknown> | null;
    dark_mode?: Record<string, unknown> | null;
}
export interface DossiePecas {
    pecas: PecaCandidata[];
    tokensCss?: TokensCssPeca | null;
}
export interface EspecificacaoPeca { pedido?: unknown }
export interface ValidacaoPeca { ok: boolean; erros: string[] }
export type OrigemResolucaoPeca = 'dossie' | 'biblioteca' | 'ia-gerada' | null;
export interface ResultadoResolucaoPeca {
    ok: boolean;
    origem: OrigemResolucaoPeca;
    peca: PecaCandidata | null;
    erros: string[];
}
declare function require(name: string): unknown;
declare const console: { warn(message: string): void };

// ============================================================
// PEÇA ORCHESTRATOR — RAG Agent de peças.
//
// resolverPeca(nichoTema, especificacao) decide, na ordem certa, se
// já temos a peça pedida ou se precisa gerar:
//   1. jaExisteNoDossie()          — procura no dossiê do próprio nicho
//   2. buscarNaBibliotecaRag()     — procura na biblioteca cross-nicho
//                                    memoizada no Firestore (peças já
//                                    geradas por IA em resoluções
//                                    anteriores)
//   3. solicitarGeracaoIA()        — só se 1 e 2 falharem
//   4. validarPecaGerada()         — workers determinísticos (cssWorker/
//                                    jsWorker/htmlWorker); reprovado → 1
//                                    retry com o erro no prompt; 2ª
//                                    falha → aborta, NÃO persiste nada
//   5. persistirPeca()             — só se aprovada
//
// (Nível antigo "RAG estático de exemplos/*.xml" removido — design-packages/
// foi esvaziado por decisão do produto, ver designPackagesPecas.js removido.)
//
// ASSÍNCRONO POR NECESSIDADE (chama a API do Gemini em solicitarGeracaoIA),
// diferente de todo o resto do compilerEngine — que é 100% síncrono.
// Por isso NÃO é chamado de dentro de montarNichoDeDossie()/
// carregarNichoImplComBlocos() (caminho quente de compilação, síncrono,
// usado em toda compilação de usuário). resolverPeca() roda ANTES da
// compilação, como um passo de preparação: resolve e PERSISTE a peça no
// dossiê; a compilação síncrona que roda depois já lê o dossiê atualizado
// do disco (dossieLoader.limparCache() é chamado por dossieWriter). Zero
// mudança assíncrona no caminho quente.
// ============================================================

const { carregarNichoDossie } = require('./dossieLoader') as typeof import('./dossieLoader');
const { adicionarPeca } = require('./dossieWriter') as typeof import('./dossieWriter');
const { buscarNaBiblioteca, registrarNaBiblioteca } = require('./bibliotecaPecas') as {
    buscarNaBiblioteca(pedido: string, opts: { excluirNicho: string }): Promise<PecaCandidata | null>;
    registrarNaBiblioteca(peca: PecaCandidata, nicho: string): Promise<ValidacaoPeca>;
};
const { validarTokensCss } = require('./workers/cssWorker') as typeof import('./workers/cssWorker');
const { validarEscopoGlobal } = require('./workers/jsWorker') as typeof import('./workers/jsWorker');
const { validarDomIds } = require('./workers/htmlWorker') as typeof import('./workers/htmlWorker');
const { TOKENS_GLOBAIS_CHASSIS } = require('./designTokensCss') as typeof import('./designTokensCss');
const { criarMatcher, pontuarKeywords } = require('../../rag/ragMatcher') as {
    criarMatcher(pedido: string): (keyword: string) => boolean;
    pontuarKeywords(matcher: (keyword: string) => boolean, keywords: string[]): { hits: number; score: number };
};
const { gerarPeca } = require('../../services/geminiService') as {
    gerarPeca(input: { pedido: string; nichoTema: string; tokensCss?: TokensCssPeca | null },
        options: { erroAnterior?: string }): Promise<{
        valido?: boolean; erros?: string[]; peca?: PecaCandidata;
    } | null | undefined>;
};

const MAX_TENTATIVAS_IA = 2;

// Gera um id de peça a partir do texto do pedido — determinístico, sem IA.
function _gerarId(texto: unknown): string {
    const slug = String(texto || 'peca')
        .toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48);
    return slug || 'peca';
}

function _idDisponivel(dossie: DossiePecas, id: string): boolean {
    return !dossie.pecas.some(p => p.id === id);
}

function _idUnicoParaDossie(dossie: DossiePecas, base: string): string {
    if (_idDisponivel(dossie, base)) return base;
    for (let i = 2; i <= 20; i++) {
        const candidato = `${base}-${i}`;
        if (_idDisponivel(dossie, candidato)) return candidato;
    }
    return `${base}-${Date.now()}`;
}

// Tokens externos (var(--x) legítimos vindos de fora da própria peça) —
// tokensCss.light_mode + dark_mode do dossiê do nicho, + os tokens globais
// do chassis (--sl-primary-rgb, --sl-card-bg etc. — sempre disponíveis
// sitewide, TODO nicho, não fazem parte do tokensCss específico do nicho).
// Achado real: sem os globais aqui, uma peça nova usando var(--sl-primary-rgb)
// — padrão idiomático usado na maioria dos nichos — era acusada de
// "variável CSS órfã" só porque tokensCss não lista o que já vem de fora.
function _tokensExternos(tokensCss: TokensCssPeca | null | undefined): string[] {
    const nomes = [...TOKENS_GLOBAIS_CHASSIS];
    if (!tokensCss) return nomes;
    for (const bloco of [tokensCss.light_mode, tokensCss.dark_mode]) {
        if (bloco && typeof bloco === 'object') {
            for (const chave of Object.keys(bloco)) {
                if (chave.startsWith('--')) nomes.push(chave);
            }
        }
    }
    return nomes;
}

// Quebra id/descrição em palavras individuais >3 chars — pontuarKeywords
// espera uma LISTA de keywords curtas, não uma frase inteira (uma frase
// inteira só bate se aparecer CONTÍGUA e IDÊNTICA no texto pesquisado).
// NOTA: "tipo" (hero/widget/modulo) NÃO vira keyword — é genérico demais
// (qualquer pedido mencionando "widget" bateria com a primeira peça desse
// tipo no dossiê, não necessariamente a certa) — mesmo cuidado já tomado
// em scripts/generateDesignPackageRag.js com nomes de CSS vars/hex.
function _keywordsDePeca(peca: PecaCandidata): string[] {
    const kws = new Set<string>();
    if (peca.id) peca.id.split('-').forEach(w => w.length > 2 && kws.add(w));
    if (peca.descricao) {
        peca.descricao.toLowerCase().split(/\s+/).forEach(w => {
            const limpo = w.replace(/[^\p{L}\p{N}-]/gu, '');
            if (limpo.length > 3) kws.add(limpo);
        });
    }
    return [...kws];
}

// Abaixo disso, uma única palavra-chave batendo por coincidência não é
// evidência suficiente de que a peça pedida já existe — bug real: um
// pedido genuinamente novo podia "encontrar" uma peça só por
// compartilhar 1 palavra genérica com a descrição dela (ex: "vivo"),
// e a resolução parava aí, sem nunca chegar a gerar algo de verdade
// via IA. Exige pelo menos 2 palavras-chave distintas batendo.
const MIN_HITS_REAPROVEITAR = 2;

// ──────────────────────────────────────────────────────────────
// jaExisteNoDossie — busca por keyword-match contra id/descrição
// das peças já no dossiê do próprio nicho.
// ──────────────────────────────────────────────────────────────
function jaExisteNoDossie(dossie: DossiePecas | null | undefined, pedido: string): PecaCandidata | null {
    if (!dossie || !Array.isArray(dossie.pecas)) return null;

    const matcher = criarMatcher(pedido || '');
    let melhor: PecaCandidata | null = null;
    let melhorScore = 0;
    let melhorHits = 0;

    for (const peca of dossie.pecas) {
        const { hits, score } = pontuarKeywords(matcher, _keywordsDePeca(peca));
        if (score > melhorScore) { melhorScore = score; melhor = peca; melhorHits = hits; }
    }

    return melhorHits >= MIN_HITS_REAPROVEITAR ? melhor : null;
}

// ──────────────────────────────────────────────────────────────
// validarPecaGerada — roda os 3 workers determinísticos sobre uma
// peça candidata (gerada por IA ou vinda da biblioteca). Retorna
// { ok, erros: string[] }.
// ──────────────────────────────────────────────────────────────
function validarPecaGerada(peca: PecaCandidata, dossie: DossiePecas): ValidacaoPeca {
    const erros: string[] = [];

    const tokensExternos = _tokensExternos(dossie.tokensCss);
    const css1 = validarTokensCss(peca.css, { tokensExternos });
    if (!css1.ok) erros.push(...css1.erros);

    const html1 = validarDomIds(peca.html, peca.domIds);
    if (!html1.ok) erros.push(...html1.erros);

    const jsExistente = dossie.pecas.map(p => p.js).filter(Boolean);
    const js1 = validarEscopoGlobal([...jsExistente, peca.js]);
    if (!js1.ok) erros.push(`colisão de escopo JS: ${js1.erro}`);

    return { ok: erros.length === 0, erros };
}

// ──────────────────────────────────────────────────────────────
// resolverPeca — ponto de entrada único. `especificacao` = { pedido }.
// Retorna { ok, origem: 'dossie'|'biblioteca'|'ia-gerada', peca, erros }.
// Nunca lança — erro de rede/IA vira { ok:false, erros:[...] }.
// ──────────────────────────────────────────────────────────────
async function resolverPeca(nichoTema: string, especificacao: EspecificacaoPeca | null | undefined): Promise<ResultadoResolucaoPeca> {
    const pedido = especificacao && especificacao.pedido;
    if (!pedido || typeof pedido !== 'string') {
        return { ok: false, origem: null, peca: null, erros: ['especificacao.pedido é obrigatório.'] };
    }

    const dossie = carregarNichoDossie(nichoTema) as DossiePecas | null;
    if (!dossie) {
        return { ok: false, origem: null, peca: null, erros: [`nicho "${nichoTema}" não tem dossiê — resolverPeca só funciona em nichos migrados.`] };
    }

    // 1. Já existe no próprio dossiê?
    const existente = jaExisteNoDossie(dossie, pedido);
    if (existente) {
        return { ok: true, origem: 'dossie', peca: existente, erros: [] };
    }

    // 2. Biblioteca cross-nicho?
    const daBiblioteca = await buscarNaBiblioteca(pedido, { excluirNicho: nichoTema });
    if (daBiblioteca) {
        const id = _idUnicoParaDossie(dossie, daBiblioteca.id || _gerarId(pedido));
        const peca = { ...daBiblioteca, id, origem: 'ia-gerada' };
        delete peca.nichoOrigem;

        const gravado = adicionarPeca(nichoTema, peca);
        if (!gravado.ok) {
            console.warn(`[PECA-ORCHESTRATOR] peça da biblioteca não persistida no dossiê de "${nichoTema}": ${gravado.erros.join(' | ')}`);
        }
        return { ok: true, origem: 'biblioteca', peca, erros: gravado.ok ? [] : gravado.erros };
    }

    // 3-4. Gera por IA, valida, retry com erro no prompt se reprovar.
    let ultimoErro = '';
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS_IA; tentativa++) {
        const resultado = await gerarPeca(
            { pedido, nichoTema, tokensCss: dossie.tokensCss },
            ultimoErro ? { erroAnterior: ultimoErro } : {}
        );

        if (!resultado || !resultado.valido || !resultado.peca) {
            ultimoErro = (resultado && resultado.erros && resultado.erros.join(' | ')) || 'IA não devolveu peça válida.';
            continue;
        }

        const validacao = validarPecaGerada(resultado.peca, dossie);
        if (!validacao.ok) {
            ultimoErro = validacao.erros.join(' | ');
            continue;
        }

        // 5. Aprovada — persiste no dossiê + registra na biblioteca cross-nicho.
        const id = _idUnicoParaDossie(dossie, _gerarId(resultado.peca.descricao || pedido));
        const pecaFinal = { ...resultado.peca, id, origem: 'ia-gerada' };

        const gravado = adicionarPeca(nichoTema, pecaFinal);
        if (!gravado.ok) {
            return { ok: false, origem: 'ia-gerada', peca: null, erros: gravado.erros };
        }
        await registrarNaBiblioteca(pecaFinal, nichoTema);

        return { ok: true, origem: 'ia-gerada', peca: pecaFinal, erros: [] };
    }

    return { ok: false, origem: null, peca: null, erros: [`peça reprovada após ${MAX_TENTATIVAS_IA} tentativas: ${ultimoErro}`] };
}

export { resolverPeca, jaExisteNoDossie, validarPecaGerada, _tokensExternos };
