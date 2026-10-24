import { detectarMarcador, removerMarcadorTruncado, SOLARIS_GERAR_MARKER_RE } from '../solaris/chat/solarisGenerationTrigger';
import type { SolarisGenerationPayload, SolarisGenerationMarkerResult } from '../solaris/chat/solarisGenerationTrigger';
const payload: SolarisGenerationPayload = { objetivo: 'Landing page', framework: 'html5' };
const match: SolarisGenerationMarkerResult | null = detectarMarcador('[[SOLARIS_GERAR:{"objetivo":"Landing page","framework":"html5"}]]');
const visible: string | null | undefined = removerMarcadorTruncado('texto [[SOLARIS_GERAR:');
const marker: RegExp = SOLARIS_GERAR_MARKER_RE;
void payload; void match; void visible; void marker;
