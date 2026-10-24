/** Contratos internos dos achados do diagnóstico estático do template. */
export interface AchadoDiagnostico {
    nivel: 'erro' | 'aviso';
    mensagem: string;
}

export interface CategoriaDiagnostico {
    id: string;
    nome: string;
    achados: readonly AchadoDiagnostico[];
}

export interface ScoreDiagnostico {
    score: number;
    totalErros: number;
    totalAvisos: number;
}

/** Relatório retornado pelo diagnóstico Blogger e pelo fluxo Corrigir Tudo. */
export interface DiagnosticoResultado extends ScoreDiagnostico {
    categorias: CategoriaDiagnostico[];
    corrigivelAutomaticamente: boolean;
    xmlCorrigido: string | null;
    reparosAplicados: import('../core/repairEngine').XmlRepair[];
}
