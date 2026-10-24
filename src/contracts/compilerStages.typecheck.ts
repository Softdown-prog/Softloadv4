import { injetarSlotsXml, construirTraceCompilacao } from '../core/compilerEngine/compileStages';
import type { ResolvedSlots } from '../core/compilerEngine/compileStages';
import type { CompilerTraceSlot } from './compiler';

const values: ResolvedSlots = { NICHO_CSS: '', NICHO_HERO: '', THEME_COLOR: '#fff' };
const xml: string = injetarSlotsXml('[[THEME_COLOR]]', values, {});
const trace: CompilerTraceSlot[] = construirTraceCompilacao(values);
void xml;
void trace;
// @ts-expect-error O mapa deve conter os slots estruturais NICHO_CSS e NICHO_HERO.
const incomplete: ResolvedSlots = { THEME_COLOR: '#fff' };
void incomplete;
