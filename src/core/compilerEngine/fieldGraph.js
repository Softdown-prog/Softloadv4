"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.construirGrafoCampos = construirGrafoCampos;
/**
 * Grafo campo → slot construído diretamente do trace do Chassis+DNA.
 * Preserva as referências das listas `sources` e de `trace` do contrato legado.
 */
function construirGrafoCampos(trace) {
    const campoParaSlots = new Map();
    const slotParaCampos = new Map();
    for (const no of trace) {
        slotParaCampos.set(no.slot, no.sources);
        for (const campo of no.sources) {
            if (!campoParaSlots.has(campo))
                campoParaSlots.set(campo, []);
            campoParaSlots.get(campo).push(no.slot);
        }
    }
    return { campoParaSlots, slotParaCampos, nos: trace };
}
