'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
// Todas as dependências externas são simuladas e nenhum dossiê real é modificado.
const filename = require.resolve('./pecaOrchestrator');
const source = fs.readFileSync(filename,'utf8');
function criarHarness({dossie, biblioteca=null, geracoes=[]}={}) {
    const chamadas = {ia:[],biblioteca:0,gravacao:[],registro:[]};
    const respostas=[...geracoes];
    const mocks = {
        './dossieLoader': {carregarNichoDossie:()=>dossie||null},
        './dossieWriter': {adicionarPeca:(n,p)=>{chamadas.gravacao.push(p);return {ok:true,erros:[]};}},
        './bibliotecaPecas': {
            buscarNaBiblioteca:async()=>{chamadas.biblioteca++;return biblioteca;},
            registrarNaBiblioteca:async(p,n)=>{chamadas.registro.push({p,n});return {ok:true,erros:[]};}
        },
        './workers/cssWorker': {validarTokensCss:(css)=>css&&css.includes('var(--orfa)')?{ok:false,erros:['variável órfã']}:{ok:true,erros:[]}},
        './workers/htmlWorker': {validarDomIds:()=>({ok:true,erros:[]})},
        './workers/jsWorker': {validarEscopoGlobal:()=>({ok:true,erro:''})},
        './designTokensCss': {TOKENS_GLOBAIS_CHASSIS:['--sl-primary-rgb']},
        '../../rag/ragMatcher': {
            criarMatcher:pedido=>kw=>pedido.toLowerCase().includes(kw.toLowerCase()),
            pontuarKeywords:(match,kws)=>{
                const found=kws.filter(match);return {hits:found.length,score:found.reduce((n,s)=>n+s.length,0)};
            }
        },
        '../../services/geminiService': {
            gerarPeca:async(input,opts)=>{chamadas.ia.push({input,opts});return respostas.shift();}
        }
    };
    const m=new Module(filename,module);m.filename=filename;m.paths=module.paths;
    m.require=id=>Object.prototype.hasOwnProperty.call(mocks,id)?mocks[id]:require(id);
    m._compile(source,filename);
    return {api:m.exports,chamadas};
}
const peca = (id, descricao='Peça moderna visual') => ({
    id,tipo:'modulo',protegida:false,domIds:[],css:'.x{color:var(--sl-primary-rgb)}',html:'',js:'',descricao
});
const dossie = () => ({pecas:[peca('cabecalho-protegido','Cabeçalho moderno visual')],tokensCss:{light_mode:{'--tw-primary':'#123'}}});
(async()=>{
    {
        const h=criarHarness({dossie:dossie()});
        assert.equal((await h.api.resolverPeca('nicho',{})).ok,false);
        assert.equal((await h.api.resolverPeca('nicho',null)).ok,false);
        assert.equal(h.chamadas.biblioteca,0);
    }
    {
        const h=criarHarness();
        const r=await h.api.resolverPeca('inexistente',{pedido:'novo widget'});
        assert.equal(r.ok,false);assert.match(r.erros[0],/não tem dossiê/);
        assert.equal(h.chamadas.ia.length,0);
    }
    {
        const h=criarHarness({dossie:dossie()});
        const r=await h.api.resolverPeca('nicho',{pedido:'Cabeçalho moderno visual'});
        assert.equal(r.origem,'dossie');assert.equal(r.peca.id,'cabecalho-protegido');
        assert.equal(h.chamadas.biblioteca,0);assert.equal(h.chamadas.gravacao.length,0);
    }
    {
        const h=criarHarness({dossie:dossie(),biblioteca:{...peca('reusada'),nichoOrigem:'outro'}});
        const r=await h.api.resolverPeca('nicho',{pedido:'novo painel ilustrado'});
        assert.equal(r.origem,'biblioteca');assert.equal(h.chamadas.gravacao.length,1);
        assert.equal(r.peca.nichoOrigem,undefined);assert.equal(h.chamadas.ia.length,0);
    }
    {
        const h=criarHarness({dossie:dossie(),geracoes:[
            {valido:true,erros:[],peca:{...peca(undefined),css:'.a{color:var(--orfa)}'}},
            {valido:true,erros:[],peca:peca(undefined,'Painel aprovado')}
        ]});
        const r=await h.api.resolverPeca('nicho',{pedido:'novo painel ilustrado'});
        assert.equal(r.origem,'ia-gerada');assert.equal(r.ok,true);
        assert.equal(h.chamadas.ia.length,2);
        assert.match(h.chamadas.ia[1].opts.erroAnterior,/órfã/);
        assert.equal(h.chamadas.gravacao.length,1);assert.equal(h.chamadas.registro.length,1);
    }
    {
        const h=criarHarness({dossie:dossie(),geracoes:[
            {valido:false,erros:['json inválido']}, {valido:false,erros:['sem peça']}
        ]});
        const r=await h.api.resolverPeca('nicho',{pedido:'novo painel ilustrado'});
        assert.equal(r.ok,false);assert.match(r.erros[0],/2 tentativas/);
        assert.equal(h.chamadas.gravacao.length,0);assert.equal(h.chamadas.registro.length,0);
    }
    {
        const h=criarHarness();
        assert.ok(h.api._tokensExternos(null).includes('--sl-primary-rgb'));
        const v=h.api._tokensExternos({light_mode:{'--tw-primary':'#000'},dark_mode:{'--dark':'#fff',seletor:':root'}});
        assert.ok(v.includes('--tw-primary'));assert.ok(v.includes('--dark'));assert.equal(v.includes('seletor'),false);
    }
    console.log('✅ pecaOrchestrator: testes de contrato isolados, sem rede ou escrita em dossiês.');
})().catch(err=>{console.error(err);process.exitCode=1;});
