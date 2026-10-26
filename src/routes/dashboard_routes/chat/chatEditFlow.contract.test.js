'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'chatEditFlow.js'), 'utf8');
function setup(result, { agentThrows=false, persistThrows=false, billingThrows=false, pending=null }={}) {
    const calls={ events:[],writes:[],charged:[],applied:[],snapshot:[],log:[] };
    const deleted={kind:'delete-field'},timestamp={kind:'server-time'};
    const user={uid:'uid-test',email:'user@example.test'};
    const session={
        async update(payload){if(persistThrows) throw Error('db-down');calls.writes.push({method:'update',payload});},
        async set(payload,options){if(persistThrows) throw Error('db-down');calls.writes.push({method:'set',payload,options});}
    };
    const dependencies={
        '../../../services/firebase':{admin:{firestore:{FieldValue:{delete(){return deleted;},serverTimestamp(){return timestamp;}}}}},
        '../../../core/templateEditWorker':{async aplicarEdicao(...args){calls.applied.push(args);return {compiled:true};}},
        '../../../services/creditService':{async debitarCreditos(...args){calls.charged.push(args);if(billingThrows)throw Error('billing-down');}},
        '../../../ai/templateEditAgent':{async processarEdicaoAgentica(history,msg,options){
            assert.equal(msg,'edite meu template');
            assert.ok(Array.isArray(history));
            assert.equal(options.manifestoAtual.siteName,'Antes');
            if(agentThrows)throw Error('provider-down');
            if(result && result.invokeApply)await options.aplicarEdicaoReal({color:'blue'},'mudar cor');
            return result;
        }},
        './chatTemplateCompiler':{_snapshotDeManifesto(...args){calls.snapshot.push(args);return {siteName:'Depois',created:true};}}
    };
    const module={exports:{}};
    vm.runInNewContext(source,{
        module,exports:{},require(id){if(!(id in dependencies))throw Error('unexpected import '+id);return dependencies[id];},
        console:{error(...x){calls.log.push(x.join(' '));}}
    },{filename:'chatEditFlow.js'});
    const params={
        msg:'edite meu template',wsSnapshot:{manifesto:{siteName:'Antes'}},
        edicaoPendente:pending,sessaoRef:session,user,
        sendEvent:event=>calls.events.push(event),historico:[],
        wsProjetoId:'projeto-teste',wsSessionId:'sessao-teste',billingOperationId:'bill-unique'
    };
    return {run:()=>module.exports.processarEdicaoDeTemplate(params),calls,deleted,timestamp};
}
test('proposta nova é registrada sem compilar; cobrança usa operação idempotente',async()=>{
    const f=setup({resposta:'Proponho azul',propostaFinal:{campos:{color:'blue'},resumo:'azul'},tokens:{input:3,output:4}});
    const out=await f.run();
    assert.equal(out.fullText,'Proponho azul');
    assert.equal(out.downloadUrl,null);
    assert.equal(out.preview,null);
    assert.equal(f.calls.applied.length,0);
    assert.equal(f.calls.writes.length,1);
    assert.equal(f.calls.writes[0].method,'set');
    assert.equal(f.calls.writes[0].payload.edicaoPendente.resumo,'azul');
    assert.equal(f.calls.writes[0].payload.edicaoPendente.criadoEm,f.timestamp);
    assert.equal(f.calls.writes[0].options.merge,true);
    assert.deepEqual(f.calls.charged[0],['user@example.test',3,4,'bill-unique']);
});
test('aplicação cria snapshot, limpa pendência e expõe preview real',async()=>{
    const result={resposta:'Aplicado',propostaFinal:null,downloadUrl:'https://files.example.test/template.xml',manifestoFinal:{siteName:'Depois',colorPreset:'warm',nichoTema:'loja'},xmlPath:'v2.xml',gcPath:'storage/v2.xml',invokeApply:true};
    const f=setup(result,{pending:{campos:{},resumo:'anterior'}});
    const out=await f.run();
    assert.equal(f.calls.applied.length,1);
    assert.equal(f.calls.events[0].type,'status');
    assert.equal(out.downloadUrl,result.downloadUrl);
    assert.equal(out.preview.xmlPath,'v2.xml');
    assert.equal(out.preview.siteName,'Depois');
    assert.equal(f.calls.snapshot.length,1);
    assert.equal(f.calls.writes.length,1);
    assert.equal(f.calls.writes[0].method,'update');
    assert.equal(f.calls.writes[0].payload.edicaoPendente,f.deleted);
    assert.equal(f.calls.writes[0].payload.snapshot.siteName,'Depois');
});
test('cancelar proposta limpa pendência, resposta comum não grava',async()=>{
    const prior={campos:{a:1},resumo:'igual'};
    for(const [proposal,expectedWrites] of [[null,1],[prior,0]]){
        const f=setup({resposta:'Resposta',propostaFinal:proposal},{pending:prior});
        await f.run();assert.equal(f.calls.writes.length,expectedWrites);
        if(expectedWrites)assert.equal(f.calls.writes[0].payload.edicaoPendente,f.deleted);
    }
});
test('erros do agente retornam resposta técnica sem cobrança ou gravação',async()=>{
    const f=setup(null,{agentThrows:true});
    const out=await f.run();
    assert.match(out.fullText,/problema técnico/);
    assert.equal(f.calls.writes.length,0);
    assert.equal(f.calls.charged.length,0);
});
test('erro de persistência ou de débito não transforma resposta em sucesso falso',async()=>{
    const proposal={resposta:'Proposta preparada',propostaFinal:{campos:{},resumo:'nova'},tokens:{input:5,output:6}};
    const a=setup(proposal,{persistThrows:true,billingThrows:true});
    const out=await a.run();
    assert.match(out.fullText,/Proposta preparada/);
    assert.match(out.fullText,/Não foi possível confirmar o débito/);
    assert.equal(a.calls.log.length,2);
    assert.equal(a.calls.writes.length,0);
});
