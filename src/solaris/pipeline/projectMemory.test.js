'use strict';

/**
 * Testes de projectMemory.js — 100% sem rede, opera em diretório
 * temporário real (fs).
 *
 * Execute: node src/solaris/pipeline/projectMemory.test.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { criarArquivo, lerArquivo } = require('../tools/fileTools');
const { SOLARIS_MD, montarSolarisMdInicial, inicializarSolarisMd, registrarMudancasNoSolarisMd } = require('./projectMemory');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

function tempDir() {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-projectmemory-test-'));
}

async function run() {
    // A. montarSolarisMdInicial — documenta objetivo/framework/arquivos.
    {
        const md = montarSolarisMdInicial({
            objetivo: 'Landing page pra academia online',
            framework: 'html5',
            arquivos: [
                { caminho: 'index.html', tipo: 'html', descricao: 'Página inicial com hero e CTA.' },
                { caminho: 'style.css', tipo: 'css', descricao: 'Estilo do hero.' },
            ],
        });
        assert('inclui o objetivo', md.includes('Landing page pra academia online'));
        assert('inclui o framework', md.includes('html5'));
        assert('lista os arquivos com caminho e descrição', md.includes('index.html') && md.includes('Página inicial com hero e CTA.'));
        assert('tem seção de histórico vazia', md.includes('Histórico de mudanças') && md.includes('Nenhuma mudança registrada ainda'));
    }

    // B. montarSolarisMdInicial sem arquivos não quebra.
    {
        const md = montarSolarisMdInicial({ objetivo: 'x', framework: 'html5', arquivos: [] });
        assert('sem arquivos: placeholder em vez de lista vazia', md.includes('(nenhum arquivo ainda)'));
    }

    // C. inicializarSolarisMd — cria o arquivo de verdade no baseDir.
    {
        const dir = tempDir();
        inicializarSolarisMd(dir, { objetivo: 'App de tarefas', framework: 'flask', arquivos: [{ caminho: 'app.py', tipo: 'py', descricao: 'rotas principais' }] });
        const leitura = lerArquivo(dir, SOLARIS_MD);
        assert('solaris.md foi criado', leitura.ok);
        assert('conteúdo reflete o projeto', leitura.ok && leitura.conteudo.includes('App de tarefas') && leitura.conteudo.includes('app.py'));
        fs.rmSync(dir, { recursive: true, force: true });
    }

    // D. inicializarSolarisMd NUNCA sobrescreve um solaris.md já existente.
    {
        const dir = tempDir();
        criarArquivo(dir, SOLARIS_MD, '# conteúdo customizado que não deve sumir\n');
        inicializarSolarisMd(dir, { objetivo: 'outro objetivo', framework: 'django', arquivos: [] });
        const leitura = lerArquivo(dir, SOLARIS_MD);
        assert('solaris.md pré-existente não foi sobrescrito', leitura.ok && leitura.conteudo.includes('conteúdo customizado'));
        assert('não vazou o objetivo novo pro arquivo antigo', !leitura.conteudo.includes('outro objetivo'));
        fs.rmSync(dir, { recursive: true, force: true });
    }

    // E. registrarMudancasNoSolarisMd — acrescenta changelog a um solaris.md existente.
    {
        const dir = tempDir();
        inicializarSolarisMd(dir, { objetivo: 'Blog simples', framework: 'html5', arquivos: [{ caminho: 'index.html', tipo: 'html', descricao: 'home' }] });
        registrarMudancasNoSolarisMd(dir, [
            { caminho: 'index.html', operacao: 'editar', resumo: 'adiciona seção de contato' },
            { caminho: 'contato.html', operacao: 'criar', resumo: 'nova página de contato' },
        ]);
        const leitura = lerArquivo(dir, SOLARIS_MD);
        assert('changelog registrado', leitura.ok && leitura.conteudo.includes('adiciona seção de contato') && leitura.conteudo.includes('nova página de contato'));
        assert('placeholder de "nenhuma mudança" removido depois da 1ª entrada', !leitura.conteudo.includes('Nenhuma mudança registrada ainda'));
        assert('conteúdo original do projeto continua lá', leitura.conteudo.includes('Blog simples'));
        fs.rmSync(dir, { recursive: true, force: true });
    }

    // F. registrarMudancasNoSolarisMd — múltiplas chamadas acumulam (nunca sobrescreve entrada anterior).
    {
        const dir = tempDir();
        inicializarSolarisMd(dir, { objetivo: 'x', framework: 'html5', arquivos: [] });
        registrarMudancasNoSolarisMd(dir, [{ caminho: 'a.html', operacao: 'criar', resumo: 'primeira mudança' }]);
        registrarMudancasNoSolarisMd(dir, [{ caminho: 'b.html', operacao: 'criar', resumo: 'segunda mudança' }]);
        const leitura = lerArquivo(dir, SOLARIS_MD);
        assert('primeira entrada ainda está lá', leitura.conteudo.includes('primeira mudança'));
        assert('segunda entrada foi acrescentada', leitura.conteudo.includes('segunda mudança'));
        fs.rmSync(dir, { recursive: true, force: true });
    }

    // G. registrarMudancasNoSolarisMd sem solaris.md prévio cria um mínimo (projeto vindo de upload, nunca gerado pelo Solaris).
    {
        const dir = tempDir();
        registrarMudancasNoSolarisMd(dir, [{ caminho: 'novo.js', operacao: 'criar', resumo: 'primeira edição de um projeto externo' }]);
        const leitura = lerArquivo(dir, SOLARIS_MD);
        assert('solaris.md foi criado mesmo sem inicialização prévia', leitura.ok);
        assert('changelog da 1ª edição está lá', leitura.ok && leitura.conteudo.includes('primeira edição de um projeto externo'));
        fs.rmSync(dir, { recursive: true, force: true });
    }

    // H. registrarMudancasNoSolarisMd com array vazio/ausente é no-op (nunca cria arquivo à toa).
    {
        const dir = tempDir();
        registrarMudancasNoSolarisMd(dir, []);
        registrarMudancasNoSolarisMd(dir, null);
        assert('nenhum solaris.md criado sem mudança nenhuma', !lerArquivo(dir, SOLARIS_MD).ok);
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

run().then(() => {
    console.log(`\n${failed === 0 ? '✅' : '❌'} projectMemory: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
});
