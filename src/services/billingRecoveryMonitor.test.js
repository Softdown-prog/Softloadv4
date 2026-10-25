'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarMonitorRecuperacaoCobrancas, definirMonitorRecuperacaoCobrancas,
    obterStatusRecuperacaoCobrancas } = require('./billingRecoveryMonitor');

test('sucesso registra métricas agregadas sem informações pessoais', async () => {
    const alertas=[];
    const m=criarMonitorRecuperacaoCobrancas({
        recuperar: async()=>({processadas:2,falhas:0}),
        inspecionar: async()=>({quantidadeAmostrada:1,amostraLimitada:false,maisAntigaMs:120000,ilegivel:0}),
        notificar:async value=>alertas.push(value),
        agora:()=>Date.parse('2026-10-25T12:00:00Z'),
    });
    const r=await m.executar();
    assert.equal(r.estado,'ok');assert.equal(r.processadas,2);
    assert.equal(r.quantidadeAmostrada,1);
    assert.equal(r.maisAntigaMinutos,2);
    assert.equal(r.falhasConsecutivas,0);assert.equal(alertas.length,0);
    assert.doesNotMatch(JSON.stringify(r),/example.com|cliente|operacaoId/);
});

test('três falhas consecutivas disparam alerta, mas não repetem antes de 1h', async () => {
    let clock=Date.parse('2026-10-25T12:00:00Z');
    const enviados=[];
    const m=criarMonitorRecuperacaoCobrancas({
        recuperar:async()=>({processadas:0,falhas:1}),
        inspecionar:async()=>({quantidadeAmostrada:2,maisAntigaMs:7200000,amostraLimitada:false,ilegivel:0}),
        notificar:async x=>enviados.push(x),
        agora:()=>clock,
    });
    await m.executar();await m.executar();
    assert.equal(enviados.length,0);
    await m.executar();
    assert.equal(enviados.length,1);
    assert.equal(enviados[0].tipo,'cobrancas_pendentes');
    assert.equal(m.estado().falhasConsecutivas,3);
    await m.executar();assert.equal(enviados.length,1);
    clock+=3600001;await m.executar();assert.equal(enviados.length,2);
    assert.equal(m.estado().alertaAtivo,true);
});

test('recuperação saudável encerra alerta e zera contagem',async()=>{
    let falhar=true,clock=10000000;
    const enviados=[];
    const m=criarMonitorRecuperacaoCobrancas({
        recuperar:async()=>({processadas:falhar?0:3,falhas:falhar?1:0}),
        inspecionar:async()=>({quantidadeAmostrada:0,amostraLimitada:false,maisAntigaMs:null,ilegivel:0}),
        notificar:async x=>enviados.push(x),
        agora:()=>clock,
    });
    for(let i=0;i<3;i++)await m.executar();
    falhar=false;clock+=300000;await m.executar();
    assert.deepEqual(enviados.map(x=>x.tipo),['cobrancas_pendentes','cobrancas_normalizadas']);
    assert.equal(m.estado().alertaAtivo,false);
    assert.equal(m.estado().falhasConsecutivas,0);
});

test('erro na inspeção gera alerta após ciclos; falha do webhook não interrompe worker',async()=>{
    let n=0;
    const m=criarMonitorRecuperacaoCobrancas({
        recuperar:async()=>{n++;return {processadas:0,falhas:0};},
        inspecionar:async()=>{throw Error('GCS unavailable');},
        notificar:async()=>{throw Error('webhook unavailable');},
    });
    await m.executar();await m.executar();await m.executar();
    assert.equal(n,3);assert.equal(m.estado().estado,'alerta');
    assert.equal(m.estado().erroNotificacao,true);
});

test('não inicia ciclos simultâneos, endpoint administrativo só lê estado',async()=>{
    let liberar;
    const gate=new Promise(r=>{liberar=r;});
    let chamadas=0;
    const m=criarMonitorRecuperacaoCobrancas({
        recuperar:async()=>{chamadas++;await gate;return {processadas:1,falhas:0};},
        inspecionar:async()=>({quantidadeAmostrada:0,amostraLimitada:false,maisAntigaMs:null,ilegivel:0}),
    });
    definirMonitorRecuperacaoCobrancas(m);
    const running=m.executar();
    assert.equal(m.estado().emExecucao,true);
    await m.executar();assert.equal(chamadas,1);
    liberar();await running;
    assert.equal(obterStatusRecuperacaoCobrancas().processadas,1);
});


test('fila vazia deixa idade nula',async()=>{
    const m=criarMonitorRecuperacaoCobrancas({
        recuperar:async()=>({processadas:0,falhas:0}),
        inspecionar:async()=>({quantidadeAmostrada:0,amostraLimitada:false,maisAntigaMs:null,ilegivel:0}),
    });
    assert.equal((await m.executar()).maisAntigaMinutos,null);
});
test('endpoint operacional exige superadmin',()=>{
    const fs=require('node:fs'),path=require('node:path');
    const source=fs.readFileSync(path.join(__dirname,'../routes/adminRoutes.js'),'utf8');
    assert.match(source,/router\.get\('\/eu\/api\/billing\/recuperacao', exigirSuperAdmin/);
    assert.match(source,/webhookConfigurado: !!process\.env\.BILLING_ALERT_WEBHOOK_URL/);
});


test('conflito CAS é informativo e não dispara falso alerta de débito',async()=>{
    const avisos=[];
    const m=criarMonitorRecuperacaoCobrancas({
        recuperar:async()=>({processadas:1,falhas:0,conflitosCursor:2}),
        inspecionar:async()=>({quantidadeAmostrada:0,amostraLimitada:false,maisAntigaMs:null,ilegivel:0}),
        notificar:async x=>avisos.push(x),
    });
    for(let i=0;i<4;i++){
        const s=await m.executar();
        assert.equal(s.conflitosCursor,2);
        assert.equal(s.falhas,0);
        assert.equal(s.alertaAtivo,false);
        assert.equal(s.estado,'ok');
    }
    assert.equal(avisos.length,0);
});
