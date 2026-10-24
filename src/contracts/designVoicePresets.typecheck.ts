import {
    DESIGN_VOICE_PRESETS, NICHO_DESIGN_VOICE_MAP, COLOR_DESIGN_VOICE_HINT, gerarDesignVoiceCss
} from '../core/designVoicePresets';

const voices: Record<string, string> = DESIGN_VOICE_PRESETS;
const defaults: Record<string, string> = NICHO_DESIGN_VOICE_MAP;
const hints: Record<string, string> = COLOR_DESIGN_VOICE_HINT;
const css: string = gerarDesignVoiceCss(defaults['tecnologia-techwind']);
const missing: string = gerarDesignVoiceCss(undefined);
void voices;
void hints;
void css;
void missing;
