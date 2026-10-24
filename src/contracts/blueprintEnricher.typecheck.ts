import { enriquecerBlueprint } from '../core/blueprintEnricher';
import type { BlueprintEnricherInput, BlueprintEnricherResult, BlueprintEnricherStatus } from '../core/blueprintEnricher';

const status: BlueprintEnricherStatus = (label: string) => { void label; };
const input: BlueprintEnricherInput = {
    siteName: 'Estúdio & Casa',
    nichoTema: 'gamer-playerone',
    heroTitle: 'Lançamentos',
    heroSubtitle: 'O melhor da semana',
    categoryBadges: [{ nome: 'Novidades', bg: '#000', text: '#fff' }, 'Tendências'],
};
const enriched: Promise<BlueprintEnricherResult> = enriquecerBlueprint(input, status);
const untouched: Promise<BlueprintEnricherResult> = enriquecerBlueprint({heroHtml:'<h1>Pronto</h1>', customCss:'.pronto{}'});
void enriched; void untouched;
// @ts-expect-error onStatus recebe string, não número.
const invalidStatus: BlueprintEnricherStatus = (value: number) => { void value; };
void invalidStatus;
// @ts-expect-error blueprint precisa ser um objeto, não string.
enriquecerBlueprint('site simples');
// @ts-expect-error o resultado de enrich é assíncrono.
const badResult: BlueprintEnricherResult = enriquecerBlueprint(input);
void badResult;
