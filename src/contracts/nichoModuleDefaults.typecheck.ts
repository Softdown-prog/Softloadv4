import { NICHO_MODULE_DEFAULTS, modulosPadraoDoNicho } from '../core/nichoModuleDefaults';
import type { NichoModuleConfig } from '../core/nichoModuleDefaults';
const defaults: NichoModuleConfig = modulosPadraoDoNicho('gamer-playerone');
const all: Record<string, NichoModuleConfig> = NICHO_MODULE_DEFAULTS;
const unknown: NichoModuleConfig = modulosPadraoDoNicho(undefined);
void defaults;
void all;
void unknown;
