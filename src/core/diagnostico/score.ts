import type { CategoriaDiagnostico, ScoreDiagnostico } from '../../contracts/diagnostico';

// ──────────────────────────────────────────────────────────────────────────
// SCORE — nota heurística 0-100 a partir dos achados de todas as categorias.
// Não é uma métrica de terceiros (tipo Lighthouse) — é um resumo interno
// pra dar ao usuário uma noção rápida de "quão limpo está o template".
// ──────────────────────────────────────────────────────────────────────────

const PESO_ERRO  = 15;
const PESO_AVISO = 4;

/**
 * @param {{ id: string, nome: string, achados: { nivel: 'erro'|'aviso', mensagem: string }[] }[]} categorias
 * @returns {{ score: number, totalErros: number, totalAvisos: number }}
 */
export function calcularScore(categorias: readonly CategoriaDiagnostico[]): ScoreDiagnostico {
    let totalErros  = 0;
    let totalAvisos = 0;

    for (const cat of categorias) {
        for (const achado of cat.achados) {
            if (achado.nivel === 'erro') totalErros++;
            else totalAvisos++;
        }
    }

    const penalidade = totalErros * PESO_ERRO + totalAvisos * PESO_AVISO;
    const score = Math.max(0, Math.min(100, 100 - penalidade));

    return { score, totalErros, totalAvisos };
}

