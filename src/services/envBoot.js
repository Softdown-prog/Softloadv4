"use strict";
// ENV BOOT — validação das variáveis de ambiente antes de subir o servidor.
// A função é pura: não registra valores, não encerra o processo e permite
// receber um objeto env simulado sem alterar process.env nos testes.
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPCIONAIS = exports.OBRIGATORIAS = void 0;
exports.validarEnvBoot = validarEnvBoot;
// Segredos/sessão e credenciais necessárias ao login: obrigatórios.
exports.OBRIGATORIAS = ['SESSION_SECRET', 'FIREBASE_API_KEY', 'FIREBASE_APP_ID'];
// A ausência de integrações opcionais degrada apenas sua funcionalidade.
exports.OPCIONAIS = [
    'GEMINI_API_KEY', 'OPENAI_API_KEY', 'RESEND_API_KEY',
    'PIXABAY_API_KEY', 'MP_ACCESS_TOKEN', 'MP_WEBHOOK_SECRET', 'GCS_BUCKET_NAME',
    'SOLARIS_CLEANUP_SECRET',
];
/** Mantém o contrato de boot: strings vazias contam como ausentes. */
function validarEnvBoot(env = process.env) {
    const faltandoObrigatorias = exports.OBRIGATORIAS.filter(v => !env[v]);
    const faltandoOpcionais = exports.OPCIONAIS.filter(v => !env[v]);
    return {
        ok: faltandoObrigatorias.length === 0,
        faltandoObrigatorias,
        faltandoOpcionais,
    };
}
