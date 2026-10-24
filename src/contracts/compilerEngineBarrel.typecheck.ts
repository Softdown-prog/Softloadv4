import {
    compilarTemplate, construirGrafoCampos, sanitizarInput, validarHex,
    gerarDynamicCss, montarWidgetHtml, GRID_OPTIONS, SLOT_MANIFEST,
    COLOR_PRESETS, BUTTON_STYLES, TYPOGRAPHY_PRESETS,
    carregarNichoImpl, carregarNichoImplComBlocos,
    carregarNichoDossie, validarDossie, verificarDomIdsNoOutput,
} from '../core/compilerEngine/index';
import type { CompilerEnginePublicApi } from '../core/compilerEngine/index';
import type { CompilerTemplateOptions, CompilerTemplateResult } from './compiler';

const api: CompilerEnginePublicApi = {
    compilarTemplate, construirGrafoCampos, sanitizarInput, validarHex,
    gerarDynamicCss, montarWidgetHtml, GRID_OPTIONS, SLOT_MANIFEST,
    COLOR_PRESETS, BUTTON_STYLES, TYPOGRAPHY_PRESETS,
    carregarNichoImpl, carregarNichoImplComBlocos,
    carregarNichoDossie, validarDossie, verificarDomIdsNoOutput,
    // As demais referências vêm de import dinâmico tipado para validar o contrato integral.
    ...({} as Omit<CompilerEnginePublicApi, 'compilarTemplate' | 'construirGrafoCampos' |
      'sanitizarInput' | 'validarHex' | 'gerarDynamicCss' | 'montarWidgetHtml' |
      'GRID_OPTIONS' | 'SLOT_MANIFEST' | 'COLOR_PRESETS' | 'BUTTON_STYLES' |
      'TYPOGRAPHY_PRESETS' | 'carregarNichoImpl' | 'carregarNichoImplComBlocos' |
      'carregarNichoDossie' | 'validarDossie' | 'verificarDomIdsNoOutput'>),
};
const texto: string = api.sanitizarInput('<b>');
const cores: string = api.GRID_OPTIONS.revista;
const compilar: (xml: string, options: CompilerTemplateOptions) => CompilerTemplateResult = api.compilarTemplate;
const achados: string[] = validarDossie({}).erros;
void texto; void cores; void compilar; void achados;
// @ts-expect-error a API não aceita manifestos incompletos.
compilarTemplate('<b/>', { enableSeo: true });
// @ts-expect-error o ID do widget precisa ser texto.
montarWidgetHtml(45, 'Título', '<p>teste</p>');
// @ts-expect-error carregamento de nicho não aceita números.
carregarNichoImpl(14);
// @ts-expect-error a saída tipada do compilador não é um número.
const invalido: number = sanitizarInput('texto');
void invalido;
