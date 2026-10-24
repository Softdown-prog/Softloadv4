import { processarEdicaoAgentica, criarExecutorDeFerramentas, _extrairBlocosScript,
    _validarCamposLivres, _labelParaFerramentaEdicao, TEMPLATE_EDIT_TOOL_DECLARATIONS } from '../ai/templateEditAgent';
import type { EditAgentOptions, EditAgentResult, EditAgentProposal, EditAgentApply,
    EditAgentExecutor, EditAgentManifest, EditAgentToolName, EditAgentProgressEvent } from '../ai/templateEditAgent';

const manifesto: EditAgentManifest = { siteName:'Meu Portal', colorPreset:'tech-blue' };
const proposta: EditAgentProposal = { campos: {siteName:'Novo Nome'}, resumo:'Alterar o nome' };
const aplicar: EditAgentApply = async (campos,resumo) => {
    void campos; void resumo;
    return {downloadUrl:'https://example.invalid/template.xml', manifesto};
};
const executor: EditAgentExecutor = criarExecutorDeFerramentas(manifesto,proposta,aplicar);
const options: EditAgentOptions = {
    manifestoAtual:manifesto, propostaPendente:proposta, aplicarEdicaoReal:aplicar,
    onProgress(evento: EditAgentProgressEvent) { const label:string=evento.label; void label; },
    budgetTokens:6000, maxOutputTokens:1024, temperature:0.2,
};
const response: Promise<EditAgentResult> = processarEdicaoAgentica(
    [{role:'user',content:'Mudar o nome'}],'sim, pode aplicar', options
);
const name: EditAgentToolName = 'aplicar_edicao_pendente';
const blocks: string[] = _extrairBlocosScript('<script>let x=1;</script>');
const problems: string[] = _validarCamposLivres({customCss:'.x{color:#fff}'},manifesto);
const label: string = _labelParaFerramentaEdicao(name);
const declarations: object = TEMPLATE_EDIT_TOOL_DECLARATIONS;
void executor;void response;void blocks;void problems;void label;void declarations;
// @ts-expect-error ferramenta inexistente não pertence à enumeração.
const wrongTool: EditAgentToolName = 'apagar_projeto';
// @ts-expect-error confirmação deve usar campo resumo string.
const wrongProposal: EditAgentProposal = {campos:{siteName:'x'},resumo:3};
// @ts-expect-error aplicador de alterações não pode retornar valor síncrono.
const wrongApply: EditAgentApply = () => ({downloadUrl:'x'});
// @ts-expect-error mensagem atual é texto, não inteiro.
processarEdicaoAgentica([],42,options);
void wrongTool;void wrongProposal;void wrongApply;
