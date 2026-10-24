import { _agregarEventos, consultarTelemetria, registrarCompilacao } from '../core/telemetria';
import type { TelemetriaResumo, TelemetriaEvento, ConsultaTelemetriaResultado } from '../core/telemetria';

const evento: TelemetriaEvento = {
    nichoTema: 'tecnologia-techwind',
    pecaGeradaPorIA: true,
    validadoresPassaram: { xml: true, html: false },
};
registrarCompilacao(evento);
const resumo: TelemetriaResumo = _agregarEventos([evento]);
const resultado: Promise<ConsultaTelemetriaResultado> = consultarTelemetria();
void resumo;
void resultado;
