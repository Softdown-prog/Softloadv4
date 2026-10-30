// ENV BOOT — validação das variáveis de ambiente antes de subir o servidor.
// A função é pura: não registra valores, não encerra o processo e permite
// receber um objeto env simulado sem alterar process.env nos testes.

export interface EnvBootResult {
    ok: boolean;
    faltandoObrigatorias: string[];
    faltandoOpcionais: string[];
}
export type EnvBootValues = Record<string, string | undefined>;
declare const process: { env: EnvBootValues };

// Segredos/sessão e credenciais necessárias ao login: obrigatórios.
export const OBRIGATORIAS: string[] = ['SESSION_SECRET', 'FIREBASE_API_KEY', 'FIREBASE_APP_ID'];

// A ausência de integrações opcionais degrada apenas sua funcionalidade.
export const OPCIONAIS: string[] = ['RESEND_API_KEY', 'MP_ACCESS_TOKEN', 'MP_WEBHOOK_SECRET', 'GCS_BUCKET_NAME'];

/** Mantém o contrato de boot: strings vazias contam como ausentes. */
export function validarEnvBoot(env: EnvBootValues = process.env): EnvBootResult {
    const faltandoObrigatorias = OBRIGATORIAS.filter(v => !env[v]);
    const faltandoOpcionais = OPCIONAIS.filter(v => !env[v]);
    return {
        ok: faltandoObrigatorias.length === 0,
        faltandoObrigatorias,
        faltandoOpcionais,
    };
}
