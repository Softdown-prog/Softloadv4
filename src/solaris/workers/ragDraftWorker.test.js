'use strict';

/**
 * Testes de ragDraftWorker.js — triarRascunho puro testado direto;
 * triarDiretorio testado contra diretório temporário isolado (nunca
 * toca rag/drafts/ real).
 *
 * Execute: node src/solaris/workers/ragDraftWorker.test.js
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { triarRascunho, triarDiretorio, resumirTriagem, CAMPOS_CATALOGO } = require('./ragDraftWorker');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

function run() {
    // A. triarRascunho — schema totalmente divergente (achado real: flask2.json).
    {
        const r = triarRascunho('flask2.json', { 'nome-framework': 'flask', 'tipo-framework': 'micro-framework' });
        assert('jsonValido true', r.jsonValido === true);
        assert('temAlgumSinalDeCatalogo false', r.temAlgumSinalDeCatalogo === false);
        assert('camposPresentes vazio', r.camposPresentes.length === 0);
        assert('camposAusentes = todos os campos de catálogo', r.camposAusentes.length === CAMPOS_CATALOGO.length);
        assert('idCandidato derivado do nome do arquivo', r.idCandidato === 'flask2');
        assert('pastaSugerida null (sem sinal real)', r.pastaSugerida === null);
        assert('prontoPraCatalogo false', r.prontoPraCatalogo === false);
        assert('motivo cita schema divergente', /schema totalmente divergente/.test(r.motivo));
    }

    // B. triarRascunho — schema diferente do catálogo (achado real: select-users.json,
    // usa "unit-id" em vez de "id").
    {
        const r = triarRascunho('select-users.json', { 'unit-id': 'select-users', type: 'database-query' });
        assert('unit-id não conta como id (nome de campo diferente)', r.camposPresentes.length === 0);
        assert('motivo cita schema divergente', /schema totalmente divergente/.test(r.motivo));
    }

    // C. triarRascunho — sinal parcial (tem id/categoria, mas falta o resto).
    {
        const r = triarRascunho('parcial.json', { id: 'flask-context', categoria: 'topico' });
        assert('camposPresentes inclui id e categoria', r.camposPresentes.includes('id') && r.camposPresentes.includes('categoria'));
        assert('temAlgumSinalDeCatalogo true', r.temAlgumSinalDeCatalogo === true);
        assert('prontoPraCatalogo false (falta descricao/componentes|exemplos/keywords)', r.prontoPraCatalogo === false);
        assert('pastaSugerida usa o grupo real do id', r.pastaSugerida === 'flask', r.pastaSugerida);
        assert('motivo cita schema parcial e lista o que falta', /schema parcial/.test(r.motivo) && /descricao/.test(r.motivo));
    }

    // D. triarRascunho — entrada completa, pronta pra virar catálogo de verdade.
    {
        const r = triarRascunho('bootstrap5-tooltip.json', {
            id: 'bootstrap5-tooltip', slug: 'bootstrap5-tooltip', categoria: 'topico',
            descricao: 'Componente de tooltip do Bootstrap 5.',
            componentes: ['tooltip', 'data-bs-toggle'],
            keywords: ['tooltip', 'dica'],
        });
        assert('prontoPraCatalogo true', r.prontoPraCatalogo === true);
        assert('pastaSugerida = bootstrap5', r.pastaSugerida === 'bootstrap5', r.pastaSugerida);
        assert('motivo diz que só falta mover', /só falta mover/.test(r.motivo));
    }

    // E. triarRascunho — aceita "prompt_keywords" como equivalente de "keywords".
    {
        const r = triarRascunho('x.json', {
            id: 'x', categoria: 'topico', descricao: 'algo',
            exemplos: ['<div>x</div>'],
            prompt_keywords: ['x'],
        });
        assert('prompt_keywords conta como keywords', r.camposPresentes.includes('keywords'));
        assert('exemplos sozinho (sem componentes) já satisfaz esse par', r.prontoPraCatalogo === true);
    }

    // F. triarRascunho — array vazio não conta como campo presente.
    {
        const r = triarRascunho('vazio.json', { id: 'y', categoria: 'topico', descricao: 'algo', componentes: [], exemplos: [], keywords: [] });
        assert('componentes/exemplos/keywords vazios não contam', !r.camposPresentes.includes('componentes') && !r.camposPresentes.includes('exemplos') && !r.camposPresentes.includes('keywords'));
        assert('prontoPraCatalogo false', r.prontoPraCatalogo === false);
    }

    // G. triarRascunho — JSON inválido (erro de parse) nunca lança, vira relatório.
    {
        const r = triarRascunho('quebrado.json', null, 'Unexpected token');
        assert('jsonValido false', r.jsonValido === false);
        assert('erroJson repassado', r.erroJson === 'Unexpected token');
        assert('idCandidato ainda é derivado do nome (não depende do conteúdo)', r.idCandidato === 'quebrado');
    }

    // H. triarRascunho — entrada não-objeto (null/array/string) vira "JSON inválido", não lança.
    {
        assert('entrada null', triarRascunho('a.json', null).jsonValido === false);
        assert('entrada array', triarRascunho('a.json', []).jsonValido === false);
    }

    // I. triarDiretorio — diretório temporário isolado com os 2 casos reais + 1 .md
    // + 1 sem extensão (achado real: 5 rascunhos chegaram sem extensão numa
    // única leva — precisa ser triado, não descartado como fora de escopo).
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-rag-draft-test-'));
        fs.writeFileSync(path.join(dir, 'flask2.json'), JSON.stringify({ 'nome-framework': 'flask' }));
        fs.writeFileSync(path.join(dir, 'select-users.json'), JSON.stringify({ 'unit-id': 'select-users' }));
        fs.writeFileSync(path.join(dir, 'Documentacao.md'), '# doc');
        fs.writeFileSync(path.join(dir, 'quebrado.json'), '{ invalido');
        fs.writeFileSync(path.join(dir, 'django-sem-extensao'), JSON.stringify({ tema: 'django' }));
        fs.writeFileSync(path.join(dir, '.gitkeep'), '');

        const relatorio = triarDiretorio({ dir });
        assert('triarDiretorio: 5 arquivos (ignora dotfile)', relatorio.length === 5, `encontrou ${relatorio.length}`);

        const md = relatorio.find((r) => r.arquivo === 'Documentacao.md');
        assert('.md entra como foraDeEscopo, não desaparece do relatório', md && md.foraDeEscopo === true);

        const quebrado = relatorio.find((r) => r.arquivo === 'quebrado.json');
        assert('JSON quebrado vira jsonValido:false, não lança', quebrado && quebrado.jsonValido === false);

        const flask2 = relatorio.find((r) => r.arquivo === 'flask2.json');
        assert('flask2.json (schema divergente) presente e reportado', flask2 && flask2.temAlgumSinalDeCatalogo === false);

        const semExtensao = relatorio.find((r) => r.arquivo === 'django-sem-extensao');
        assert('arquivo sem extensão entra em escopo (não é foraDeEscopo)', semExtensao && semExtensao.foraDeEscopo === undefined);
        assert('arquivo sem extensão é triado como JSON de verdade', semExtensao && semExtensao.jsonValido === true);
        assert('arquivo sem extensão: idCandidato = próprio nome (já kebab)', semExtensao && semExtensao.idCandidato === 'django-sem-extensao');

        const resumo = resumirTriagem(relatorio);
        assert('resumirTriagem: total = 5', resumo.total === 5, JSON.stringify(resumo));
        assert('resumirTriagem: foraDeEscopo = 1', resumo.foraDeEscopo === 1);
        assert('resumirTriagem: jsonInvalido = 1', resumo.jsonInvalido === 1);
        assert('resumirTriagem: semSinalNenhum = 3', resumo.semSinalNenhum === 3, JSON.stringify(resumo));

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // J. triarDiretorio contra o rag/drafts/ real — nunca escreve, só confirma
    // que o Worker roda sem lançar. Os 31 rascunhos que motivaram este Worker
    // já foram promovidos pra catálogo (curadoria manual, ver
    // src/solaris/README.md); novos rascunhos continuam chegando em drafts/
    // depois disso. Não assume snapshot de conteúdo (o diretório muda), só
    // que roda limpo e que nada nele já nasce "pronto" sem curadoria.
    {
        const relatorio = triarDiretorio({});
        const resumo = resumirTriagem(relatorio);
        assert('triarDiretorio real: roda sem lançar contra drafts/ real', Array.isArray(relatorio));

}
}
run();
console.log(`\n${failed === 0 ? '✅' : '❌'} ragDraftWorker: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
