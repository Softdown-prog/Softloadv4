/** Contracts for Solaris project editing, proposals, Forge bundles and persistence. */
import type { Buffer } from 'node:buffer';
declare function require(name: string): unknown;
export type OperacaoSolaris = 'criar' | 'editar' | 'deletar';
export type TipoSolaris = 'html' | 'css' | 'js' | 'php' | 'ejs' | 'json' | 'py';
export interface ForgeTask { id: string; command: string; recipe: { frames?: Array<string | { path: string }> } }
export interface MudancaSolaris { caminho: string; operacao: string; resumo: string; conteudoNovo?: string | Buffer | null }
export interface PropostaSolaris extends MudancaSolaris { forgeTask?: ForgeTask }
export interface HistoricoSolaris { autor: string; texto: string }
export interface ToolArgs { caminho?: string; operacao?: string; conteudo?: string; resumo?: string; caminhos?: string[]; id?: string; command?: string; recipeId?: string; receitaJson?: string; termo?: string; [key: string]: unknown }
export interface ToolDeclaration { name: string; description: string; parameters: Record<string, unknown> }
export interface ToolGroup { functionDeclarations: ToolDeclaration[] }
export interface EditorState { propostas: Map<string, PropostaSolaris>; criadasNesteTurno: Set<string>; mudancasAplicadas: MudancaSolaris[] }
export type PersistirMudancas = (mudancas: MudancaSolaris[]) => Promise<unknown>;
export interface ModelRouter { executarTarefaComFerramentas(opcoes: { prompt: string; systemInstruction: string; tools: ToolGroup[]; executorFerramenta(nome: string, args: ToolArgs): unknown | Promise<unknown>; maxToolCalls: number; onProgress?: ((evento: unknown) => void) | undefined }): Promise<{ texto?: string; iteracoes: number; tokens: Record<string, unknown> }> }
export interface ProjectEditorOptions { baseDir?: string; framework?: string | null; arquivos?: string[]; mensagem?: string; historico?: HistoricoSolaris[]; propostasPendentes?: PropostaSolaris[]; modelRouter?: ModelRouter; aplicarMudancasReal?: PersistirMudancas; onProgress?: (evento: unknown) => void }
export type ProjectEditorResult = { ok: false; motivo: string } | { ok: true; resposta: string; propostasFinais: PropostaSolaris[]; mudancasAplicadas: MudancaSolaris[]; iteracoes: number; tokens: Record<string, unknown> };

// ============================================================
// SOLARIS PROJECT EDITOR (Fase 2d)
// ============================================================
// Loop de tool-calling (Gemini Pro, via modelRouter.executarTarefaComFerramentas)
// que assume o turno de chat inteiro sobre um projeto ANEXADO à sessão
// (upload anterior persistido no GCS via tools/projectStorage.js) —
// substitui o antigo responderComProjeto() de projectInspector.js, que
// era só leitura. Aqui o modelo pode, além de ler
// (readFile/listFiles/searchInProject, reusadas de projectInspector.js),
// PROPOR mudança em arquivo: criar, editar ou deletar.
//
// Confirmação por arquivo, nunca aplicação direta: cada proposta
// (proporMudancaArquivo) fica pendente em memória — nada é escrito no
// projeto de verdade até uma chamada SEGUINTE de aplicarMudancasPendentes,
// e mesmo essa é recusada em código se a proposta foi criada NESTA MESMA
// resposta (`estado.criadasNesteTurno` — mesmo guard reforçado em código
// que templateEditAgent.js usa pra edição de template: nunca confiar só
// no prompt pra essa garantia). Cada arquivo tem sua própria proposta
// pendente — aplicar ou cancelar pode mirar um caminho específico ou
// todos de uma vez.
//
// Validação determinística ANTES de aceitar a proposta (princípio #5 do
// CLAUDE.md, mesmo gate que peça de dossiê gerada por IA passa em
// pecaOrchestrator.js): conteúdo de criar/editar roda pelo Worker do
// tipo certo (WORKER_POR_TIPO de pipeline/orchestrator.js, resolvido
// pela extensão do caminho) — proposta com erro de sintaxe nunca vira
// pendente, o modelo recebe o erro e tenta de novo.
//
// Quem persiste de verdade (baseDir local + GCS via tools/projectStorage.js)
// é o CALLER, injetado como `aplicarMudancasReal` — este módulo não
// conhece GCS/Firestore, só orquestra o loop e o estado de propostas em
// memória do turno (mesmo desenho de aplicarEdicaoReal em
// src/ai/templateEditAgent.js).
// ============================================================

const path = require('path') as typeof import('node:path');
const { lerArquivo, _resolverSeguro } = require('../tools/fileTools') as {
  lerArquivo(baseDir: string, caminho: string): {ok: boolean; conteudo?: string};
  _resolverSeguro(baseDir: string, caminho: string): string;
};
const { WORKER_POR_TIPO } = require('./orchestrator') as { WORKER_POR_TIPO: Partial<Record<TipoSolaris, (code: string) => {ok: boolean; erros?: string[]}>> };
const { INSPECAO_TOOLS, _executorFerramenta: executarFerramentaLeitura } = require('./projectInspector') as { INSPECAO_TOOLS: ToolGroup[]; _executorFerramenta(base: string, nome: string, args: ToolArgs): unknown };
const { SOLARIS_MD, registrarMudancasNoSolarisMd } = require('./projectMemory') as { SOLARIS_MD: string; registrarMudancasNoSolarisMd(base: string, mudancas: MudancaSolaris[]): void };
const { FORGE_READ_TOOLS, executarLeituraForge, validateTask, safePath, render: renderAsset } = require('../tools/assetForge') as {
  FORGE_READ_TOOLS: ToolDeclaration[]; executarLeituraForge(nome: string, args: ToolArgs): unknown;
  validateTask(args: ToolArgs): ForgeTask; safePath(base: string, relative: string): string;
  render(task: ForgeTask, options: {baseDir: string}): Promise<{files: Array<{caminho: string}>}>;
};
const fs = require('node:fs') as typeof import('node:fs');
const os = require('node:os') as typeof import('node:os');

const MAX_TOOL_CALLS = 10;

const TIPO_POR_EXTENSAO: Record<string, TipoSolaris> = {
    '.html': 'html', '.htm': 'html',
    '.css': 'css',
    '.js': 'js',
    '.mjs': 'js',
    '.php': 'php',
    '.ejs': 'ejs',
    '.json': 'json',
    '.py': 'py',
};

export function _tipoPorCaminho(caminho: string | null | undefined): TipoSolaris | null {
    return TIPO_POR_EXTENSAO[path.extname(caminho || '').toLowerCase()] || null;
}

const OPERACOES_VALIDAS: string[] = ['criar', 'editar', 'deletar'];

export const EDICAO_TOOLS: ToolGroup[] = [{
    functionDeclarations: [
        ...INSPECAO_TOOLS[0].functionDeclarations,
        ...FORGE_READ_TOOLS,
        {
            name: 'proporAssetForge',
            description: 'Propõe gerar um bundle de assets por receita ou módulos Canvas 2D. Não escreve no projeto até confirmação no próximo turno. Consulte catálogo/receita antes de adaptar JSON.',
            parameters: { type: 'object', required: ['id', 'command', 'resumo'], properties: {
                id: { type: 'string' }, command: { type: 'string' }, recipeId: { type: 'string' }, receitaJson: { type: 'string' }, resumo: { type: 'string' },
            } },
        },
        {
            name: 'proporMudancaArquivo',
            description: 'Propõe criar, editar ou deletar um arquivo do projeto — NÃO aplica a mudança, só monta a proposta pendente de confirmação. Cada caminho tem no máximo uma proposta pendente por vez; propor de novo pro mesmo caminho substitui a anterior.',
            parameters: {
                type: 'object',
                required: ['caminho', 'operacao', 'resumo'],
                properties: {
                    caminho: { type: 'string', description: 'Caminho relativo do arquivo dentro do projeto (ex: "app.py", "static/style.css").' },
                    operacao: { type: 'string', enum: OPERACOES_VALIDAS, description: '"criar" (arquivo ainda não existe), "editar" (arquivo já existe, conteúdo novo é o arquivo INTEIRO, não um diff) ou "deletar".' },
                    conteudo: { type: 'string', description: 'Conteúdo completo do arquivo — obrigatório pra "criar"/"editar", ignorado em "deletar".' },
                    resumo: { type: 'string', description: 'Resumo curto em PT-BR do que muda nesse arquivo.' },
                },
            },
        },
        {
            name: 'verPropostasPendentes',
            description: 'Lista as propostas de mudança de arquivo pendentes de confirmação nesta sessão.',
            parameters: { type: 'object', properties: {} },
        },
        {
            name: 'aplicarMudancasPendentes',
            description: 'Aplica de verdade as propostas pendentes (grava no projeto persistido). SÓ chame depois que o usuário confirmar claramente, numa mensagem SEGUINTE à(s) proposta(s) — nunca na mesma resposta em que foram criadas (o sistema recusa isso de qualquer forma).',
            parameters: {
                type: 'object',
                properties: {
                    caminhos: { type: 'array', items: { type: 'string' }, description: 'Caminhos específicos a aplicar. Omitido = aplica TODAS as propostas pendentes.' },
                },
            },
        },
        {
            name: 'cancelarMudancasPendentes',
            description: 'Descarta proposta(s) pendente(s) sem aplicar — use quando o usuário rejeitar ou desistir.',
            parameters: {
                type: 'object',
                properties: {
                    caminhos: { type: 'array', items: { type: 'string' }, description: 'Caminhos específicos a cancelar. Omitido = cancela TODAS as propostas pendentes.' },
                },
            },
        },
    ],
}];

const SYSTEM_INSTRUCTION_EDICAO = `Você é o Solaris Code, da Softload, conversando com um usuário sobre um projeto de código que ele enviou por upload anteriormente nesta mesma sessão. Além de responder perguntas sobre o projeto, você também pode PROPOR mudanças nos arquivos — criar um arquivo novo, editar um existente (mandando o arquivo INTEIRO, não um diff) ou apagar um — mas nunca aplica uma mudança sozinho.

Você também tem o A7 Forge 2D: consulte catalogoAssetForge e lerReceitaAssetForge para gerar imagens procedurais, props, plantas, personagens pixel art, animações, sons sintéticos e módulos reutilizáveis Canvas 2D. Use proporAssetForge para propor um bundle novo em assets/<id>/. O bundle só será gerado ao aplicar a proposta confirmada num turno seguinte. Depois de aplicar, liste os arquivos reais e leia os manifests antes de propor código que os utiliza. Nunca invente caminhos de sprites; nunca trate revisão técnica como aprovação artística. Não proponha imagens binárias como texto em proporMudancaArquivo. Nenhum jogo foi importado.

Use readFile/listFiles/searchInProject quando precisar entender o projeto antes de responder ou propor algo — nunca invente conteúdo de arquivo que você não leu de verdade, e nunca proponha editar um arquivo sem antes ter lido o conteúdo atual dele.

Se o projeto tiver um arquivo "solaris.md" na raiz, leia-o (readFile) no início da conversa antes de propor qualquer mudança — ele documenta o objetivo original do projeto e o histórico de mudanças já aplicadas. Use isso pra manter coerência: não contradiga uma decisão já registrada lá (ex.: framework, convenção de nomes, estrutura de pastas) sem o usuário pedir explicitamente pra mudar. Nunca proponha editar o solaris.md diretamente — ele é atualizado automaticamente pelo sistema quando uma mudança é aplicada de verdade.

Pra propor uma mudança, chame proporMudancaArquivo com o caminho, a operacao, o conteúdo completo do arquivo (quando não for deletar) e um resumo curto em PT-BR. Cada proposta fica PENDENTE — nada é gravado até o usuário confirmar. Depois de propor, sempre pergunte se pode aplicar.

Ao criar ou editar um arquivo, deixe comentários no código explicando decisões não óbvias (por que, não o que — nomes já dizem o que o código faz) — quem herdar este projeto depois precisa entender o raciocínio, não só ler sintaxe.

Só chame aplicarMudancasPendentes depois que o usuário confirmar CLARAMENTE, numa mensagem SEGUINTE à proposta (ex: "sim", "pode aplicar", "confirmo", "manda ver") — nunca na mesma resposta em que a proposta foi criada (o sistema recusa isso de qualquer forma, então nem tente). Se a resposta for ambígua, pergunte de novo em vez de aplicar. Se o usuário rejeitar ou pedir algo diferente, chame cancelarMudancasPendentes (ou proponha de novo pra substituir). Use verPropostasPendentes se não tiver certeza do que já está pendente.

Se a pergunta não tiver a ver com o conteúdo do projeto nem com propor uma mudança, responda normalmente com base no histórico da conversa, sem forçar uso de ferramenta.

Se algum arquivo (existente ou proposto) parecer conter segredo/credencial (chave de API, senha, token, string de conexão), NÃO reproduza o valor na resposta — só mencione que existe e recomende removê-lo.

Depois que uma mudança for aplicada de verdade, mencione brevemente que ela já foi salva no projeto anexado a esta sessão.

Responda sempre em português do Brasil, direto e natural, como uma continuação da conversa — não repita a lista crua de arquivos.`;

function _formatarHistorico(historico: HistoricoSolaris[] | undefined): string {
    return (historico || []).map((h) => `${h.autor === 'usuario' ? 'Usuário' : 'Solaris'}: ${h.texto}`).join('\n');
}

function _promptTurno({ framework, arquivos, mensagem, historico, temPropostaPendente }: { framework?: string | null; arquivos: string[]; mensagem: string; historico?: HistoricoSolaris[]; temPropostaPendente: boolean }): string {
    const lista = arquivos.slice(0, 50).join(', ');
    const contexto = _formatarHistorico(historico);
    const avisoPendencia = temPropostaPendente
        ? '\nHá proposta(s) de mudança de arquivo pendente(s) de confirmação nesta sessão — use verPropostasPendentes se precisar saber quais antes de decidir o que fazer.'
        : '';
    return `Projeto anexado a esta sessão — framework detectado: ${framework || 'não identificado com confiança'}. Total de arquivos: ${arquivos.length}. Alguns caminhos: ${lista}${arquivos.length > 50 ? ', ...' : ''}.${avisoPendencia}
${contexto ? `\nHistórico da conversa até aqui:\n${contexto}\n` : ''}
Pergunta/pedido atual do usuário: "${mensagem}"

Use as ferramentas disponíveis conforme necessário.`;
}

/** Executor de proporMudancaArquivo — validação determinística completa
 *  ANTES de aceitar a proposta (path traversal, consistência
 *  operacao×existência, campos obrigatórios, e o Worker do tipo certo
 *  pra criar/editar). Nunca toca disco — só monta/substitui a entrada
 *  em `estado.propostas`. */
function _executarProporMudanca(baseDir: string, estado: EditorState, args: ToolArgs) {
    const { caminho, operacao, conteudo, resumo } = args || {};

    if (operacao !== 'deletar' && /\.(png|gif|jpe?g|webp|ogg|wav|mp3|zip)$/i.test(caminho || '')) {
        return { erro: 'Assets binários não podem ser escritos como texto. Use proporAssetForge com um id novo.' };
    }

    if (caminho === SOLARIS_MD) {
        return { erro: `"${SOLARIS_MD}" é mantido automaticamente pelo sistema (histórico de coerência do projeto) — não pode ser proposto pra criar/editar/deletar diretamente.` };
    }
    if (!OPERACOES_VALIDAS.includes(operacao || '')) {
        return { erro: `operacao inválida: "${operacao}" — use "criar", "editar" ou "deletar".` };
    }
    try {
        _resolverSeguro(baseDir, caminho || '');
    } catch (e) {
        return { erro: (e as Error).message };
    }
    if (!resumo || typeof resumo !== 'string' || !resumo.trim()) {
        return { erro: 'resumo é obrigatório — descreva brevemente a mudança em PT-BR.' };
    }

    const leitura = lerArquivo(baseDir, caminho as string);
    const existeAtualmente = leitura.ok;

    if (operacao === 'criar' && existeAtualmente) {
        return { erro: `"${caminho}" já existe no projeto — use operacao:"editar" pra modificá-lo.` };
    }
    if (operacao !== 'criar' && !existeAtualmente) {
        return { erro: `"${caminho}" não existe no projeto — use operacao:"criar" pra criar um arquivo novo.` };
    }

    const resumoLimpo = resumo.trim();

    if (operacao === 'deletar') {
        estado.propostas.set(caminho as string, { caminho: caminho as string, operacao: operacao as string, conteudoNovo: null, resumo: resumoLimpo });
        estado.criadasNesteTurno.add(caminho as string);
        return { sucesso: true, caminho, operacao, resumo: resumoLimpo };
    }

    if (typeof conteudo !== 'string' || conteudo.length === 0) {
        return { erro: 'conteudo é obrigatório pra criar/editar (não pode ser vazio).' };
    }

    const tipo = _tipoPorCaminho(caminho);
    const worker = tipo ? WORKER_POR_TIPO[tipo] : null;
    let aviso: string | undefined;
    if (worker) {
        const diagnostico = worker(conteudo);
        if (!diagnostico.ok) {
            return {
                erro: 'O conteúdo proposto não passou na validação técnica — não foi aceito como proposta. Corrija e proponha de novo.',
                detalhes: diagnostico.erros || diagnostico,
            };
        }
    } else {
        aviso = `sem validador determinístico pro tipo de arquivo de "${caminho}" ainda — proposta aceita sem checagem automática de sintaxe.`;
    }

    estado.propostas.set(caminho as string, {
        caminho: caminho as string, operacao: operacao as string,
        conteudoNovo: conteudo,
        resumo: resumoLimpo,
    });
    estado.criadasNesteTurno.add(caminho as string);
    return { sucesso: true, caminho, operacao, resumo: resumoLimpo, aviso };
}

async function _executarAplicarPendentes(baseDir: string, estado: EditorState, args: ToolArgs, aplicarMudancasReal: PersistirMudancas) {
    const caminhosAlvo = Array.isArray(args?.caminhos) && args.caminhos.length
        ? args.caminhos
        : Array.from(estado.propostas.keys());

    if (caminhosAlvo.length === 0) {
        return { erro: 'Não há nenhuma proposta pendente pra aplicar.' };
    }
    const bloqueadas = caminhosAlvo.filter((c) => estado.criadasNesteTurno.has(c));
    if (bloqueadas.length > 0) {
        return {
            erro: `Essas propostas acabaram de ser criadas agora mesmo, nesta mesma conversa — não podem ser aplicadas ainda: ${bloqueadas.join(', ')}. Pergunte ao usuário se ele confirma; só chame esta ferramenta de novo depois que ele responder numa mensagem seguinte.`,
        };
    }
    const naoEncontradas = caminhosAlvo.filter((c) => !estado.propostas.has(c));
    if (naoEncontradas.length > 0) {
        return { erro: `Sem proposta pendente pra: ${naoEncontradas.join(', ')}.` };
    }

    const propostas = caminhosAlvo.map((c) => estado.propostas.get(c)!);
    const mudancas: MudancaSolaris[] = [];
    try {
        for (const proposta of propostas) {
            if (!proposta.forgeTask) { mudancas.push(proposta); continue; }
            const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-forge-proposal-'));
            try {
                // Packaging existing frames is a read of the confirmed project;
                // only the selected frame files cross into the generation job.
                if (proposta.forgeTask.command === 'pack-animation') {
                    for (const frame of proposta.forgeTask.recipe.frames || []) {
                        const relative = typeof frame === 'string' ? frame : frame.path;
                        const source = safePath(baseDir, relative);
                        const dest = safePath(temp, relative);
                        fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(source, dest);
                    }
                }
                const asset = await renderAsset(proposta.forgeTask, { baseDir: temp });
                for (const file of asset.files) {
                    const dest = _resolverSeguro(baseDir, file.caminho);
                    if (fs.existsSync(dest) || mudancas.some(m => m.caminho === file.caminho)) throw new Error('Conflito com arquivo existente no bundle Forge.');
                    mudancas.push({ caminho: file.caminho, operacao: 'criar', conteudoNovo: fs.readFileSync(_resolverSeguro(temp, file.caminho)), resumo: proposta.resumo });
                }
            } finally { fs.rmSync(temp, { recursive: true, force: true }); }
        }
    } catch (e) { return { erro: `Forge não aplicado: ${(e as Error).message}` }; }

    // Changelog de coerência ANTES da persistência real — o baseDir já
    // reflete essa entrada quando aplicarMudancasReal relista os arquivos
    // pra persistir (mesmo mecanismo que o ZIP de download pós-edição já
    // reusa), então sai incluso sem round-trip extra. Nunca proposta
    // cancelada/pendente entra aqui, só o que foi de fato confirmado.
    registrarMudancasNoSolarisMd(baseDir, mudancas.map((m) => ({ caminho: m.caminho, operacao: m.operacao, resumo: m.resumo })));

    try {
        await aplicarMudancasReal(mudancas);
    } catch (err) {
        return { erro: `Falha ao aplicar as mudanças: ${(err as Error).message}` };
    }

    for (const c of caminhosAlvo) estado.propostas.delete(c);
    const aplicadas = mudancas.map((m) => ({ caminho: m.caminho, operacao: m.operacao, resumo: m.resumo }));
    estado.mudancasAplicadas.push(...aplicadas);
    return { sucesso: true, aplicadas };
}

function _executarCancelarPendentes(estado: EditorState, args: ToolArgs) {
    const caminhosAlvo = Array.isArray(args?.caminhos) && args.caminhos.length
        ? args.caminhos
        : Array.from(estado.propostas.keys());

    if (caminhosAlvo.length === 0) {
        return { erro: 'Não há nenhuma proposta pendente pra cancelar.' };
    }
    const canceladas = caminhosAlvo.filter((c) => estado.propostas.delete(c));
    return { sucesso: true, canceladas };
}

/** Roda o turno de chat completo (leitura + proposta/aplicação/cancelamento
 *  de mudança) sobre um projeto ANEXADO à sessão. Nunca lança — falha de
 *  IA (cota, chave, timeout, resposta inválida) vira { ok:false, motivo },
 *  o chamador decide se cai pro chat normal sem o projeto.
 *
 *  @param {string}   baseDir             diretório local temporário com o projeto reconstruído do GCS.
 *  @param {string}   framework
 *  @param {string[]} arquivos
 *  @param {string}   mensagem
 *  @param {Array}    historico
 *  @param {Array}    propostasPendentes  propostas trazidas da sessão anterior ({caminho,operacao,conteudoNovo,resumo}[]) — nunca bloqueadas por criadasNesteTurno (vieram de um turno ANTERIOR).
 *  @param {object}   modelRouter
 *  @param {Function} aplicarMudancasReal async (mudancas[]) => void — grava de verdade (baseDir + GCS), injetado pelo caller.
 *  @returns {Promise<{ok:true,resposta:string,propostasFinais:Array,mudancasAplicadas:Array,iteracoes:number,tokens:object}|{ok:false,motivo:string}>}
 */
export async function responderOuEditarProjeto({ baseDir, framework, arquivos, mensagem, historico, propostasPendentes, modelRouter, aplicarMudancasReal, onProgress }: ProjectEditorOptions): Promise<ProjectEditorResult> {
    if (!baseDir || !Array.isArray(arquivos) || !mensagem || !modelRouter || typeof aplicarMudancasReal !== 'function') {
        throw new Error('[SOLARIS-PROJECT-EDITOR] responderOuEditarProjeto: baseDir, arquivos, mensagem, modelRouter e aplicarMudancasReal são obrigatórios.');
    }

    const estado: EditorState = {
        propostas: new Map<string, PropostaSolaris>((propostasPendentes || []).map((p) => [p.caminho, p])),
        criadasNesteTurno: new Set<string>(),
        mudancasAplicadas: [],
    };

    async function executor(nome: string, args: ToolArgs) {
        switch (nome) {
            case 'catalogoAssetForge':
            case 'lerReceitaAssetForge':
                try { return executarLeituraForge(nome, args); } catch (e) { return { erro: (e as Error).message }; }
            case 'proporAssetForge': {
                try {
                    const forgeTask = validateTask(args);
                    const caminho = `assets/${forgeTask.id}`;
                    if (typeof args.resumo !== 'string' || !args.resumo.trim()) throw new Error('resumo é obrigatório.');
                    if (fs.existsSync(_resolverSeguro(baseDir!, caminho))) throw new Error('Bundle já existe. Escolha um id novo.');
                    estado.propostas.set(caminho, { caminho, operacao: 'criar', resumo: args.resumo.trim(), forgeTask });
                    estado.criadasNesteTurno.add(caminho as string);
                    return { sucesso: true, caminho, geracaoPendente: true };
                } catch (e) { return { erro: (e as Error).message }; }
            }
            case 'readFile':
            case 'listFiles':
            case 'searchInProject':
                return executarFerramentaLeitura(baseDir!, nome, args);
            case 'proporMudancaArquivo':
                return _executarProporMudanca(baseDir!, estado, args);
            case 'verPropostasPendentes':
                return { pendentes: Array.from(estado.propostas.values()).map((p) => ({ caminho: p.caminho, operacao: p.operacao, resumo: p.resumo })) };
            case 'aplicarMudancasPendentes':
                return _executarAplicarPendentes(baseDir!, estado, args, aplicarMudancasReal!);
            case 'cancelarMudancasPendentes':
                return _executarCancelarPendentes(estado, args);
            default:
                return { erro: `Ferramenta desconhecida: ${nome}` };
        }
    }

    try {
        const resultado = await modelRouter.executarTarefaComFerramentas({
            prompt: _promptTurno({ framework, arquivos, mensagem, historico, temPropostaPendente: estado.propostas.size > 0 }),
            systemInstruction: SYSTEM_INSTRUCTION_EDICAO,
            tools: EDICAO_TOOLS,
            executorFerramenta: executor,
            maxToolCalls: MAX_TOOL_CALLS,
            onProgress,
        });
        if (!resultado.texto) {
            return { ok: false, motivo: 'o modelo não produziu uma resposta (provável esgotamento do limite de chamadas de ferramenta).' };
        }
        return {
            ok: true,
            resposta: resultado.texto,
            propostasFinais: Array.from(estado.propostas.values()),
            mudancasAplicadas: estado.mudancasAplicadas,
            iteracoes: resultado.iteracoes,
            tokens: resultado.tokens,
        };
    } catch (e) {
        console.warn(`[SOLARIS-PROJECT-EDITOR] responderOuEditarProjeto falhou: ${(e as Error).message}`);
        return { ok: false, motivo: (e as Error).message };
    }
}



