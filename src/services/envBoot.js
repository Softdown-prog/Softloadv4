'use strict';

// ============================================================
// ENV BOOT — validação de variáveis de ambiente, chamada uma única vez
// no início do boot do servidor (server.js), antes de qualquer
// middleware ser montado. Falha rápido (process.exit) quando falta algo
// crítico pra segurança/funcionamento básico, em vez de deixar o
// processo subir num estado inseguro (SESSION_SECRET com valor
// hardcoded e público no repositório) ou quebrado de forma silenciosa
// (login/registro chamando a API do Firebase sem chave) — só
// descoberto na primeira requisição de um usuário real.
// ============================================================

// Sem essas, o servidor NÃO deve subir: SESSION_SECRET é segurança de
// sessão (nunca um valor hardcoded no código, que qualquer um lendo o
// repositório já sabe); FIREBASE_API_KEY é usado nas chamadas REST de
// login/registro (authRoutes.js); FIREBASE_APP_ID inicializa o SDK
// client-side injetado em toda página (res.locals.firebaseAppId).
const OBRIGATORIAS = ['SESSION_SECRET', 'FIREBASE_API_KEY', 'FIREBASE_APP_ID'];

// Sem essas, a feature associada degrada — mesmo espírito de
// resiliência já usado em toda a base (ex: envio de email nunca
// bloqueia cadastro, é fire-and-forget) — mas o servidor sobe
// normalmente. Só um aviso pra quem for investigar por que aquela
// feature específica não está funcionando.
const OPCIONAIS = [
    'GEMINI_API_KEY', 'OPENAI_API_KEY', 'RESEND_API_KEY',
    'PIXABAY_API_KEY', 'MP_ACCESS_TOKEN', 'MP_WEBHOOK_SECRET', 'GCS_BUCKET_NAME',
    'SOLARIS_CLEANUP_SECRET',
];

// ──────────────────────────────────────────────────────────────
// validarEnvBoot — pura (recebe `env`, default process.env, pra ficar
// testável sem precisar mutar a variável global). Nunca lança nem
// encerra o processo — quem decide abortar o boot é o caller
// (server.js), depois de logar a mensagem.
// ──────────────────────────────────────────────────────────────
function validarEnvBoot(env = process.env) {
    
    const faltandoObrigatorias = OBRIGATORIAS.filter(v => !env[v]);
    const faltandoOpcionais = OPCIONAIS.filter(v => !env[v]);
    return {
        ok: faltandoObrigatorias.length === 0,
        faltandoObrigatorias,
        faltandoOpcionais,
    };
}

module.exports = { validarEnvBoot, OBRIGATORIAS, OPCIONAIS };
