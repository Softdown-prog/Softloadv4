/** Contrato utilizado pelo pipeline de validação Solaris. */
export interface SolarisWorkerResult<T = unknown> {
    ok: boolean;
    erros: string[];
    avisos: string[];
    analise?: T;
}

interface PythonProcessFailure {
    code?: string;
    killed?: boolean;
    signal?: string | null;
    stderr?: string;
}
declare function require(name: string): unknown;
declare const Buffer: { byteLength(value: string, encoding: string): number };

// ============================================================
// SOLARIS PYTHON WORKER (Flask/Django, tipo "py")
// ============================================================
// Único Worker desta pasta que faz shell-out — decisão consciente,
// diferente do motivo de phpWorker.js/jsWorker.js NÃO fazerem isso
// (ver o comentário de topo de src/core/parser/phpParser.js): pra
// PHP/CSS/JS/EJS/JSON existe parser puro-JS maduro o bastante
// (php-parser/PostCSS/Acorn/ejs/JSON.parse), então shell-out nunca foi
// necessário. Pra Python, os parsers puro-JS avaliados (filbert,
// python-ast) não cobrem sintaxe de Python 3 moderna com confiança —
// sem alternativa determinística viável, entra a exceção (mesmo
// raciocínio do princípio #5 do CLAUDE.md — "IA só entra onde não há
// alternativa determinística viável" — generalizado aqui pra
// "shell-out só entra onde não há parser puro-JS viável").
//
// O shell-out é estritamente `ast.parse()`, NUNCA `exec()`/`eval()`:
// ast.parse só constrói a árvore sintática — nenhuma linha do código
// do usuário roda, nenhum import é resolvido, nenhum efeito colateral
// acontece. Mesma garantia de segurança que os parsers puro-JS dos
// outros Workers, só que via processo Python em vez de biblioteca JS.
// Escopo estreito de propósito:
//   - entrada só via stdin — nunca grava o código num arquivo .py real
//     em disco, elimina qualquer chance de algo tentar importá-lo;
//   - sem rede, sem argumento extra, timeout curto (defesa em
//     profundidade — ast.parse não deveria travar nunca, mas nenhum
//     processo externo deste projeto roda sem teto de tempo);
//   - limite de tamanho de entrada — defesa em profundidade extra:
//     nenhum código-fonte legítimo que o Solaris gera chega perto
//     desse tamanho, então um payload muito maior é sinal de abuso,
//     não de caso de uso real;
//   - `python3-minimal` na imagem de produção (ver Dockerfile) — só o
//     interpretador + stdlib mínima, zero pip/pacote de terceiro.
// ============================================================

const { execFileSync } = require('child_process') as {
    execFileSync(
        file: string,
        args: string[],
        options: {
            input: string;
            timeout: number;
            encoding: 'utf-8';
            stdio: ['pipe', 'pipe', 'pipe'];
        },
    ): string;
};

const TIMEOUT_MS = 5000;
const MAX_BYTES = 200_000; // ~200KB — bem acima de qualquer arquivo Python real gerado pelo Solaris

// Traceback do "python3 -c" termina com "SyntaxError: ..." (ou outro tipo
// de erro) na última linha — o resto é o traceback interno da chamada em
// si (irrelevante pro usuário, sempre a mesma stack de "<string>").
function _extrairMensagemErro(stderrBruto: string | undefined): string {
    const linhas = (stderrBruto || '').trim().split('\n').filter(Boolean);
    return linhas.length ? linhas[linhas.length - 1] : 'erro de sintaxe Python não identificado.';
}

// timeoutMs exposto como parâmetro (em vez de só usar TIMEOUT_MS direto)
// pra permitir os testes de timeout sem esperar 5s de verdade — chamadores
// normais nunca passam o segundo argumento e recebem o timeout padrão.
export function validarPy(codigo: unknown, timeoutMs = TIMEOUT_MS): SolarisWorkerResult {
    if (typeof codigo !== 'string' || !codigo.trim()) {
        return { ok: false, erros: ['código Python vazio ou inválido.'], avisos: [] };
    }

    if (Buffer.byteLength(codigo, 'utf-8') > MAX_BYTES) {
        return { ok: false, erros: [`código Python excede o tamanho máximo permitido (${MAX_BYTES} bytes).`], avisos: [] };
    }

    try {
        execFileSync('python3', ['-c', 'import ast, sys; ast.parse(sys.stdin.read())'], {
            input: codigo,
            timeout: timeoutMs,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'], // nunca deixa stderr do processo filho vazar pro processo do servidor
        });
        return { ok: true, erros: [], avisos: [] };
    } catch (e) {
        const error = e as PythonProcessFailure;
        if (error.code === 'ENOENT') {
            // python3 ausente neste ambiente (ex.: dev sem Docker) — não
            // finge que validou; mesmo padrão de "sem Worker pro tipo
            // ainda" já usado em orchestrator.js pra tipo sem Worker
            // registrado, nunca bloqueia a geração por uma lacuna de
            // ambiente que não tem a ver com a correção do código em si.
            return { ok: true, erros: [], avisos: ['python3 não encontrado neste ambiente — sintaxe NÃO foi verificada.'] };
        }

        // Timeout mata o processo filho (SIGTERM por padrão) antes que ele
        // termine de escrever em stderr — sem essa checagem, cairia no
        // branch de erro de sintaxe abaixo com uma mensagem genérica e
        // enganosa ("erro de sintaxe... não identificado"), quando na
        // verdade não foi erro de sintaxe nenhum, foi estouro de tempo.
        if (error.killed || error.signal) {
            return { ok: false, erros: ['tempo limite de validação excedido.'], avisos: [] };
        }

        return { ok: false, erros: [_extrairMensagemErro(error.stderr)], avisos: [] };
    }
}

