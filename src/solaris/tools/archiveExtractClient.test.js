'use strict';

/**
 * Testes de archiveExtractClient.js — mocka global.fetch (nunca faz
 * chamada de rede de verdade), mesmo roteiro de cobertura de
 * agent/src/capabilities/archive.test.js (a implementação de
 * referência que este cliente espelha pro app principal).
 *
 * Execute: node src/solaris/tools/archiveExtractClient.test.js
 */

const { extrairZipViaSandbox } = require('./archiveExtractClient');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

const fetchOriginal = global.fetch;
const envOriginal = { ...process.env };

function respostaJson(status, corpo) {
    return { ok: status >= 200 && status < 300, status, json: async () => corpo };
}

function resetEnv() {
    process.env = { ...envOriginal };
    process.env.SANDBOX_SERVICE_URL = 'https://sandbox.exemplo.internal';
    process.env.SANDBOX_SHARED_SECRET = 'segredo-teste';
}

async function run() {
    // A. zipBuffer inválido/vazio é rejeitado sem chamar rede.
    {
        resetEnv();
        let chamouRede = false;
        global.fetch = async () => { chamouRede = true; return respostaJson(200, {}); };

        let erro1 = null;
        try { await extrairZipViaSandbox(Buffer.alloc(0)); } catch (e) { erro1 = e; }
        assert('buffer vazio rejeitado', erro1 !== null);

        let erro2 = null;
        try { await extrairZipViaSandbox(null); } catch (e) { erro2 = e; }
        assert('buffer null rejeitado', erro2 !== null);

        assert('nem chamou a rede com buffer inválido', chamouRede === false);
    }

    // B. SANDBOX_SERVICE_URL não configurada lança erro claro.
    {
        resetEnv();
        delete process.env.SANDBOX_SERVICE_URL;
        global.fetch = async () => respostaJson(200, { success: true, arquivos: [], totalArquivos: 0 });

        let erro = null;
        try { await extrairZipViaSandbox(Buffer.from('zip')); } catch (e) { erro = e; }
        assert('SANDBOX_SERVICE_URL ausente lança erro claro', erro !== null && /SANDBOX_SERVICE_URL/.test(erro.message), erro ? erro.message : 'não lançou');
    }

    // C. Envia POST correto -- URL, método, headers, corpo = Buffer bruto.
    {
        resetEnv();
        const bytesZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xde, 0xad, 0xbe, 0xef]);
        const chamadas = [];
        global.fetch = async (url, opcoes) => {
            chamadas.push({ url, opcoes });
            return respostaJson(200, { success: true, arquivos: [], totalArquivos: 0 });
        };

        await extrairZipViaSandbox(bytesZip);

        assert('exatamente 1 chamada de rede', chamadas.length === 1);
        assert('URL bate com /extract-zip', chamadas[0].url === 'https://sandbox.exemplo.internal/extract-zip');
        assert('método é POST', chamadas[0].opcoes.method === 'POST');
        assert('header x-sandbox-secret presente', chamadas[0].opcoes.headers['x-sandbox-secret'] === 'segredo-teste');
        assert('header Content-Type é octet-stream', chamadas[0].opcoes.headers['Content-Type'] === 'application/octet-stream');
        assert('corpo é o Buffer bruto do zip', Buffer.isBuffer(chamadas[0].opcoes.body) && chamadas[0].opcoes.body.equals(bytesZip));
    }

    // D. Repassa só os limites definidos como query string.
    {
        resetEnv();
        let urlChamada;
        global.fetch = async (url) => {
            urlChamada = url;
            return respostaJson(200, { success: true, arquivos: [], totalArquivos: 0 });
        };

        await extrairZipViaSandbox(Buffer.from('z'), { maxFiles: 50, timeoutMs: 5000 });

        const url = new URL(urlChamada);
        assert('maxFiles vai na query', url.searchParams.get('maxFiles') === '50');
        assert('timeoutMs vai na query', url.searchParams.get('timeoutMs') === '5000');
        assert('maxFileBytes (não definido) NÃO vai na query', url.searchParams.has('maxFileBytes') === false);
    }

    // E. Sucesso -- devolve { arquivos, totalArquivos } do serviço.
    {
        resetEnv();
        global.fetch = async () => respostaJson(200, {
            success: true,
            totalArquivos: 2,
            arquivos: [
                { caminho: 'app.py', conteudo: "print('oi')", binario: false },
                { caminho: 'logo.png', conteudo: null, binario: true },
            ],
        });

        const r = await extrairZipViaSandbox(Buffer.from('z'));
        assert('devolve totalArquivos', r.totalArquivos === 2);
        assert('devolve arquivos brutos do serviço (com binario)', r.arquivos.length === 2 && r.arquivos[1].binario === true);
    }

    // F. Falha de INFRAESTRUTURA (HTTP não-ok) vira exceção com status+motivo.
    {
        resetEnv();
        global.fetch = async () => respostaJson(401, { error: 'não autenticado' });

        let erro = null;
        try { await extrairZipViaSandbox(Buffer.from('z')); } catch (e) { erro = e; }
        assert('HTTP não-ok vira exceção com status e motivo', erro !== null && /401/.test(erro.message) && /não autenticado/.test(erro.message), erro ? erro.message : 'não lançou');
    }

    // G. Extração RECUSADA (HTTP 200, success:false) também vira exceção.
    {
        resetEnv();
        global.fetch = async () => respostaJson(200, { success: false, errors: [{ message: 'zip-slip detectado' }] });

        let erro = null;
        try { await extrairZipViaSandbox(Buffer.from('z')); } catch (e) { erro = e; }
        assert('success:false vira exceção com o motivo do serviço', erro !== null && /zip-slip detectado/.test(erro.message), erro ? erro.message : 'não lançou');
    }

    // H. Funciona sem SANDBOX_SHARED_SECRET -- não manda o header.
    {
        resetEnv();
        delete process.env.SANDBOX_SHARED_SECRET;
        let headersRecebidos;
        global.fetch = async (url, opcoes) => {
            headersRecebidos = opcoes.headers;
            return respostaJson(200, { success: true, arquivos: [], totalArquivos: 0 });
        };

        await extrairZipViaSandbox(Buffer.from('z'));
        assert('sem SANDBOX_SHARED_SECRET, header x-sandbox-secret ausente', headersRecebidos['x-sandbox-secret'] === undefined);
    }

    global.fetch = fetchOriginal;
    process.env = envOriginal;
}

run().then(() => {
    console.log(`\n${failed === 0 ? '✅' : '❌'} archiveExtractClient: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
});
