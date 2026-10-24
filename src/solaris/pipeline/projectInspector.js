"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INSPECAO_TOOLS = void 0;
exports._executorFerramenta = _executorFerramenta;
exports.inspecionarProjeto = inspecionarProjeto;
// ============================================================
// SOLARIS PROJECT INSPECTOR (Fase 2b + Fase 2c)
// ============================================================
// Loop de tool-calling (Gemini Pro, via modelRouter.executarTarefaComFerramentas)
// que deixa o modelo INSPECIONAR de verdade o conteúdo de um projeto
// enviado por upload — em vez de só ver os nomes de arquivo que
// tools/frameworkDetector.js usa pra detecção heurística.
//
// SOMENTE LEITURA — mesmo princípio de src/ai/solAgent.js: nenhuma
// ferramenta aqui grava, executa ou modifica nada. As três ferramentas
// (readFile/listFiles/searchInProject) são só wrappers finos sobre
// tools/fileTools.js (lerArquivo/listarProjeto/buscarNoProjeto), já
// confinadas ao `baseDir` recebido — o modelo nunca vê caminho fora do
// projeto.
//
// Único uso hoje: `inspecionarProjeto()` (Fase 2b) — roda na MESMA
// requisição de upload, contra o baseDir que a rota acabou de montar
// com os arquivos extraídos via tools/archiveExtractClient.js
// (sandbox-efemoro/), produz o resumo inicial (`analiseIA` na resposta
// de upload).
//
// O Q&A de turno SEGUINTE ao upload (Fase 2c, contra um baseDir
// reconstruído do GCS via tools/projectStorage.js) morava aqui como
// `responderComProjeto()` até esta ficar obsoleta — pipeline/projectEditor.js
// assumiu esse papel por completo (Fase 2d: mesmas 3 ferramentas de
// leitura MAIS a capacidade de propor mudança de arquivo), pra não ter
// dois agentes de turno concorrendo pelo mesmo baseDir. `_executorFerramenta`
// continua exportado daqui porque projectEditor.js reusa as mesmas 3
// ferramentas de leitura em vez de reimplementá-las.
// ============================================================
const { lerArquivo, listarProjeto, buscarNoProjeto } = require('../tools/fileTools');
const MAX_TOOL_CALLS = 8;
const TAMANHO_MAX_ARQUIVO_LEITURA = 60 * 1024; // 60KB — mesmo teto do Sol (src/ai/solAgent.js)
exports.INSPECAO_TOOLS = [{
        functionDeclarations: [
            {
                name: 'readFile',
                description: 'Lê o conteúdo de um arquivo do projeto enviado pelo usuário. Use depois de listFiles/searchInProject pra saber o que existe antes de pedir um arquivo específico.',
                parameters: {
                    type: 'object',
                    properties: {
                        caminho: { type: 'string', description: 'Caminho relativo do arquivo dentro do projeto (ex: "app.py").' },
                    },
                    required: ['caminho'],
                },
            },
            {
                name: 'listFiles',
                description: 'Lista todos os arquivos do projeto enviado (caminhos relativos).',
                parameters: { type: 'object', properties: {} },
            },
            {
                name: 'searchInProject',
                description: 'Busca um termo literal (texto, nome de função/rota/classe) em todos os arquivos de texto do projeto. Use pra achar ONDE algo está definido antes de ler arquivo às cegas.',
                parameters: {
                    type: 'object',
                    properties: {
                        termo: { type: 'string', description: 'Texto literal a buscar (case-insensitive, não é regex).' },
                    },
                    required: ['termo'],
                },
            },
        ],
    }];
const SYSTEM_INSTRUCTION_INSPECAO = `Você está inspecionando um projeto de código que um usuário acabou de enviar (upload de .zip) pro Solaris Code, da Softload.
Use readFile/listFiles/searchInProject pra entender do que se trata o projeto antes de descrever — nunca invente conteúdo de arquivo que você não leu de verdade.
Você é SOMENTE LEITURA: nunca afirme ter executado, instalado dependência ou modificado qualquer coisa — você só lê texto, nada é rodado.
Se algum arquivo parecer conter segredo/credencial (chave de API, senha, token, string de conexão), NÃO reproduza o valor na resposta — só mencione que existe e recomende removê-lo antes de compartilhar o projeto.
Responda em português do Brasil: um resumo curto e direto do que o projeto faz, sua estrutura principal, e qualquer observação técnica relevante (framework, dependências notáveis, algo que pareça incompleto ou arriscado). Não repita a lista crua de arquivos, o usuário já viu isso na tela.`;
function _promptInspecao({ framework, arquivos }) {
    const lista = arquivos.slice(0, 50).join(', ');
    return `Framework detectado por heurística determinística (pode estar incompleto ou errado): ${framework || 'não identificado com confiança — nenhum framework teve sinal forte o bastante'}.
Total de arquivos no projeto: ${arquivos.length}. Alguns caminhos: ${lista}${arquivos.length > 50 ? ', ...' : ''}.

Inspecione o projeto com as ferramentas disponíveis e descreva o que ele faz.`;
}
async function _executorFerramenta(baseDir, nome, args) {
    switch (nome) {
        case 'readFile': {
            const r = lerArquivo(baseDir, args.caminho || '');
            if (!r.ok)
                return { erro: r.erro };
            if (r.conteudo.length > TAMANHO_MAX_ARQUIVO_LEITURA) {
                return { erro: `"${args.caminho}" é grande demais pra ler de uma vez (${(r.conteudo.length / 1024).toFixed(0)}KB) — use searchInProject pra localizar o trecho relevante.` };
            }
            return { caminho: args.caminho, conteudo: r.conteudo };
        }
        case 'listFiles':
            return { arquivos: listarProjeto(baseDir) };
        case 'searchInProject':
            return buscarNoProjeto(baseDir, args.termo || '');
        default:
            return { erro: `Ferramenta desconhecida: ${nome}` };
    }
}
// Só dispara o loop de tool-calling, sem decidir prompt/system
// instruction (isso é responsabilidade de cada chamador). Nunca faz
// parte da API pública deste módulo — só orquestra
// `modelRouter.executarTarefaComFerramentas` com as mesmas 3
// ferramentas somente-leitura confinadas ao `baseDir`. Único chamador
// hoje é inspecionarProjeto — mantido como função à parte mesmo assim
// (mesmo racional de nomear o núcleo pelo que ele FAZ, não por quem
// chama, caso um segundo uso somente-leitura apareça).
async function _rodarLoopSomenteLeitura({ baseDir, prompt, systemInstruction, modelRouter }) {
    return modelRouter.executarTarefaComFerramentas({
        prompt,
        systemInstruction,
        tools: exports.INSPECAO_TOOLS,
        executorFerramenta: (nome, args) => _executorFerramenta(baseDir, nome, args),
        maxToolCalls: MAX_TOOL_CALLS,
    });
}
/** Roda o loop de inspeção sobre um projeto já extraído em `baseDir` —
 *  produz o resumo inicial mostrado logo após o upload.
 *  Nunca lança — falha de IA (cota, chave, timeout, resposta inválida)
 *  vira { ok:false, motivo } pro chamador decidir se ainda assim
 *  entrega a detecção determinística de framework mesmo sem o resumo
 *  (ver rota de upload — a parte determinística nunca deve depender da
 *  IA responder).
 *  @returns {Promise<{ok:true,resumo:string,iteracoes:number,tokens:object}|{ok:false,motivo:string}>}
 */
async function inspecionarProjeto({ baseDir, framework, arquivos, modelRouter }) {
    if (!baseDir || !Array.isArray(arquivos) || !modelRouter) {
        throw new Error('[SOLARIS-PROJECT-INSPECTOR] inspecionarProjeto: baseDir, arquivos e modelRouter são obrigatórios.');
    }
    try {
        const resultado = await _rodarLoopSomenteLeitura({
            baseDir, modelRouter,
            prompt: _promptInspecao({ framework, arquivos }),
            systemInstruction: SYSTEM_INSTRUCTION_INSPECAO,
        });
        if (!resultado.texto) {
            return { ok: false, motivo: 'o modelo não produziu um resumo (provável esgotamento do limite de chamadas de ferramenta).' };
        }
        return { ok: true, resumo: resultado.texto, iteracoes: resultado.iteracoes, tokens: resultado.tokens };
    }
    catch (e) {
        console.warn(`[SOLARIS-PROJECT-INSPECTOR] inspecionarProjeto falhou: ${e.message}`);
        return { ok: false, motivo: e.message };
    }
}
