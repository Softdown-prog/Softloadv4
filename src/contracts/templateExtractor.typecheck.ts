import { extrairTemplate } from '../core/templateExtractor';
import type { ExtractedTemplate, ExtractedPiece, ExtractedConfig } from '../core/templateExtractor';

const template: ExtractedTemplate = extrairTemplate('<html/>', 'theme-demo');
const pieces: ExtractedPiece[] = template.pecas;
const config: ExtractedConfig = template.config;
const checkedId: string = config.id;
const cssVars: Record<string, string> = template.cssVars;
void pieces;
void checkedId;
void cssVars;
