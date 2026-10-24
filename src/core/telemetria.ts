/** Telemetria interna Firestore: sem bloqueio da compilação por escrita de logs. */
export interface TelemetriaEvento {
    nichoTema?: string;
    pecaGeradaPorIA?: boolean;
    validadoresPassaram?: Record<string, boolean>;
    [campo: string]: unknown;
}
export interface TelemetriaResumo {
    totalCompilacoes: number;
    porNicho: Record<string, number>;
    compilacoesComPecaGeradaPorIA: number;
    falhasPorValidador: Record<string, number>;
}
export type ConsultaTelemetriaResultado =
    | TelemetriaResumo
    | { erro: string }
    | { aviso: string; totalCompilacoes: 0 };
interface TelemetriaSnapshot {
    empty: boolean;
    docs: { data(): TelemetriaEvento }[];
}
interface TelemetriaCollection {
    add(evento: Record<string, unknown>): Promise<unknown>;
    orderBy(campo: string, direcao: 'desc'): {
        limit(limite: number): { get(): Promise<TelemetriaSnapshot> };
    };
}
declare function require(name: string): unknown;
// ============================================================
// TELEMETRIA — Cano 4 (Learning Engine), fase 1: instrumentação
// interna.
//
// Zero IA, zero API externa — só registra, por compilação, o que o
// próprio compilador já produz (nicho, peças usadas, se cada
// validador passou). É o alicerce sem o qual uma fase futura de
// "aprendizado" (correlacionar peça escolhida com resultado real do
// site publicado) nunca teria dado real pra consumir — essa fase
// futura (Search Console/PSI, consentimento do usuário) fica fora
// de escopo aqui, só a coleta interna.
//
// Persistido no Firestore (coleção telemetria_compilacoes), não em
// arquivo local — Cloud Run tem filesystem efêmero, um arquivo local
// se perde a cada deploy/restart/instância nova (achado real: essa
// era a versão anterior desta função, e o dado nunca sobrevivia mais
// que um deploy). Escrita é fire-and-forget (sem await no chamador):
// registrarCompilacao roda dentro de executarCompilacao(), função
// síncrona chamada em todo o caminho quente de compilação — falha de
// rede no log nunca pode derrubar uma compilação real.
// ============================================================

const { db, admin } = require('../services/firebase') as {
    db: { collection(nome: string): TelemetriaCollection };
    admin: { firestore: { FieldValue: { serverTimestamp(): unknown } } };
};

const COLLECTION = 'telemetria_compilacoes';

// Teto de leitura pra consultar_telemetria (Sol) — evita um custo de
// leitura ilimitado conforme o volume real de compilações cresce.
// Cobre uma janela generosa de uso normal; se um histórico mais longo
// for necessário no futuro, isso vira agregação pré-computada, não
// uma leitura maior aqui.
const LIMITE_CONSULTA = 5000;

export function registrarCompilacao(evento: TelemetriaEvento | undefined): void {
    db.collection(COLLECTION).add({
        ...evento,
        criadoEm: admin.firestore.FieldValue.serverTimestamp(),
    }).catch(e => {
        console.warn('[TELEMETRIA] falha ao registrar compilação (ignorado):', (e as Error).message);
    });
}

// ──────────────────────────────────────────────────────────────
// _agregarEventos — pura, sem I/O. Recebe uma lista de eventos (já
// carregados do Firestore) e devolve o resumo que consultarTelemetria()
// expõe ao Sol. Separada da leitura pra ser testável sem rede.
// ──────────────────────────────────────────────────────────────
export function _agregarEventos(eventos: readonly TelemetriaEvento[]): TelemetriaResumo {
    const porNicho: Record<string, number> = {};
    let pecaGeradaPorIA = 0;
    const falhasPorValidador: Record<string, number> = {};

    for (const evento of eventos) {
        const nicho = evento.nichoTema || 'desconhecido';
        porNicho[nicho] = (porNicho[nicho] || 0) + 1;
        if (evento.pecaGeradaPorIA) pecaGeradaPorIA++;
        const validadores = evento.validadoresPassaram || {};
        for (const [nomeValidador, passou] of Object.entries(validadores)) {
            if (!passou) falhasPorValidador[nomeValidador] = (falhasPorValidador[nomeValidador] || 0) + 1;
        }
    }

    return {
        totalCompilacoes: eventos.length,
        porNicho,
        compilacoesComPecaGeradaPorIA: pecaGeradaPorIA,
        falhasPorValidador,
    };
}

// ──────────────────────────────────────────────────────────────
// consultarTelemetria — lê os eventos mais recentes do Firestore e
// agrega. Async (diferente de registrarCompilacao, fire-and-forget) —
// só é chamada sob demanda pelo Sol, fora do caminho quente de
// compilação.
// ──────────────────────────────────────────────────────────────
export async function consultarTelemetria(): Promise<ConsultaTelemetriaResultado> {
    let snap: TelemetriaSnapshot;
    try {
        snap = await db.collection(COLLECTION).orderBy('criadoEm', 'desc').limit(LIMITE_CONSULTA).get();
    } catch (e) {
        return { erro: `Falha ao ler telemetria: ${(e as Error).message}` };
    }

    if (snap.empty) {
        return { aviso: 'Nenhuma compilação registrada em telemetria ainda — a coleção existe mas ainda não recebeu eventos reais.', totalCompilacoes: 0 };
    }

    return _agregarEventos(snap.docs.map(d => d.data()));
}

