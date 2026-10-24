import type { CompilerTraceSlot } from '../../contracts/compiler';

/**
 * Grafo campo → slot construído diretamente do trace do Chassis+DNA.
 * Preserva as referências das listas `sources` e de `trace` do contrato legado.
 */
export function construirGrafoCampos(trace: readonly CompilerTraceSlot[]): {
    campoParaSlots: Map<string, string[]>;
    slotParaCampos: Map<string, readonly string[]>;
    nos: readonly CompilerTraceSlot[];
} {
    const campoParaSlots = new Map<string, string[]>();
    const slotParaCampos = new Map<string, readonly string[]>();

    for (const no of trace) {
        slotParaCampos.set(no.slot, no.sources);
        for (const campo of no.sources) {
            if (!campoParaSlots.has(campo)) campoParaSlots.set(campo, []);
            campoParaSlots.get(campo)!.push(no.slot);
        }
    }

    return { campoParaSlots, slotParaCampos, nos: trace };
}
