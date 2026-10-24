"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SOLARIS_MD = void 0;
exports.montarSolarisMdInicial = montarSolarisMdInicial;
exports.inicializarSolarisMd = inicializarSolarisMd;
exports.registrarMudancasNoSolarisMd = registrarMudancasNoSolarisMd;
// ============================================================
// SOLARIS PROJECT MEMORY — solaris.md (Fase 2e)
// ============================================================
// Pedido direto: manter a coerência do projeto ao longo de várias
// gerações/edições, escrevendo um `solaris.md` dentro do próprio
// projeto — objetivo, framework, lista de arquivos e um changelog de
// toda mudança aplicada de verdade (nunca proposta cancelada/pendente,
// só o que foi de fato persistido). Viaja com o projeto: sai junto no
// ZIP de download (mesmo baseDir que orchestrator.criarZip empacota) e
// pode ser lido pelo próprio usuário fora do Solaris.
//
// 100% determinístico (código, nunca uma chamada extra ao modelo só
// pra formatar markdown) — princípio #5 do CLAUDE.md: os dados que
// entram aqui (objetivo/framework do manifesto, resumo de cada
// proposta aplicada) já existem prontos no fluxo normal de
// orchestrator.js/projectEditor.js antes deste módulo entrar em jogo.
//
// Nunca sobrescreve o arquivo do zero numa edição — só ACRESCENTA uma
// entrada de changelog ao final. Projeto que nunca teve solaris.md
// (upload de projeto externo, nunca gerado pelo Solaris) ganha um
// mínimo na primeira edição aplicada, não trava por falta dele.
// ============================================================
const { criarArquivo, lerArquivo } = require('../tools/fileTools');
exports.SOLARIS_MD = 'solaris.md';
const CABECALHO = '# solaris.md\n\n> Gerado automaticamente pelo Solaris Code (Softload). O Solaris lê este arquivo antes de propor mudanças pra manter coerência com decisões já tomadas — evite editar manualmente sem necessidade.\n';
const PLACEHOLDER_SEM_HISTORICO = '_Nenhuma mudança registrada ainda._\n';
function _dataIso() {
    return new Date().toISOString().slice(0, 10);
}
/** Monta o conteúdo inicial do solaris.md — chamado uma vez, logo
 *  depois que orchestrator.gerarProjeto() termina com sucesso. */
function montarSolarisMdInicial({ objetivo, framework, arquivos }) {
    const listaArquivos = (arquivos || [])
        .map((a) => `- \`${a.caminho}\` (${a.tipo}) — ${a.descricao || 'sem descrição'}`)
        .join('\n') || '(nenhum arquivo ainda)';
    return `${CABECALHO}
## Projeto
- **Objetivo:** ${objetivo}
- **Framework:** ${framework}
- **Criado em:** ${_dataIso()}

## Arquivos
${listaArquivos}

## Histórico de mudanças
${PLACEHOLDER_SEM_HISTORICO}`;
}
/** Escreve o solaris.md inicial no baseDir. Nunca sobrescreve um
 *  solaris.md já existente (ex.: reexecução acidental) — só cria
 *  quando ainda não existe. Chamar ANTES de empacotar o ZIP, pra ele
 *  sair incluso no download. */
function inicializarSolarisMd(baseDir, { objetivo, framework, arquivos }) {
    const existente = lerArquivo(baseDir, exports.SOLARIS_MD);
    if (existente.ok)
        return;
    criarArquivo(baseDir, exports.SOLARIS_MD, montarSolarisMdInicial({ objetivo, framework, arquivos }));
}
/** Acrescenta uma entrada de changelog ao solaris.md — chamado com as
 *  mudanças [{caminho,operacao,resumo}] JÁ CONFIRMADAS pelo usuário,
 *  antes da persistência real (mesmo baseDir local que o caller vai
 *  relistar/persistir em seguida — ver projectEditor.js). Sem
 *  mudanças, é no-op. Sem solaris.md prévio, cria um mínimo na hora. */
function registrarMudancasNoSolarisMd(baseDir, mudancas) {
    if (!Array.isArray(mudancas) || mudancas.length === 0)
        return;
    const leitura = lerArquivo(baseDir, exports.SOLARIS_MD);
    const base = leitura.ok
        ? leitura.conteudo
        : `${CABECALHO}\n## Histórico de mudanças\n${PLACEHOLDER_SEM_HISTORICO}`;
    const linhas = mudancas
        .map((m) => `- \`${m.caminho}\` (${m.operacao}) — ${m.resumo}`)
        .join('\n');
    const entrada = `### ${_dataIso()}\n${linhas}\n`;
    const semPlaceholder = base.includes(PLACEHOLDER_SEM_HISTORICO)
        ? base.replace(PLACEHOLDER_SEM_HISTORICO, '')
        : base;
    const atualizado = `${semPlaceholder.trimEnd()}\n\n${entrada}`;
    criarArquivo(baseDir, exports.SOLARIS_MD, atualizado);
}
