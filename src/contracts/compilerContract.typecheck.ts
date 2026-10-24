import type {
  CompilerTemplateOptions, CompilerTemplateResult, CompilerSlotDefinition
} from './compiler';
import { GRID_OPTIONS, SLOT_MANIFEST } from '../core/compilerEngine/slotManifest';
import { compilarTemplate } from '../core/compilerEngine/compile';

// Teste estático: o shape passado pelo worker é compatível com a assinatura.
const opcoes = {
  siteName: 'Meu site',
  description: null,
  enableSeo: true,
  gridLayout: 'revista',
  colorPreset: 'tech-blue',
  buttonStyle: 'default',
  typography: 'inter',
  lazyLoad: true,
  nichoTema: null,
  modules: { dropcap: true },
  categoryBadges: [{ nome: 'RPG', bg: '#000000', text: '#ffffff' }],
} satisfies CompilerTemplateOptions;
const compilado: CompilerTemplateResult = compilarTemplate('<html/>', opcoes);
const slots: readonly CompilerSlotDefinition[] = SLOT_MANIFEST;
const grid: string = GRID_OPTIONS.revista;
void compilado;
void slots;
void grid;

// @ts-expect-error siteName obrigatório, não aceitar manifesto incompleto.
const incompleto: CompilerTemplateOptions = { enableSeo: true, lazyLoad: true };
void incompleto;
// @ts-expect-error tipo inválido de slot não pode passar pelo contrato.
const invalido: CompilerSlotDefinition = { slot: 'A', type: 'unknown', sources: [] };
void invalido;
