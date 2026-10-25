'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PRICES_CENTS, approvedPlanForPayment } = require('./mpPlanRules');
const { TETOS_IA_EXPERIMENTAIS_CENTAVOS } = require('./geminiCost');
const root = path.resolve(__dirname, '../..');
const frontend = fs.readFileSync(path.join(root, 'frontend/pages/Upgrade.tsx'),'utf8');
const adminUsers = fs.readFileSync(path.join(root, 'frontend/pages/admin/Usuarios.tsx'),'utf8');
const checkout = fs.readFileSync(path.join(root,'src/routes/apiRoutes.js'),'utf8');
const grant = fs.readFileSync(path.join(root,'src/services/creditService.ts'),'utf8');
const catalog = [["starter",2990,150,"R$ 29,90","150 créditos Gemini / mês"],["pro",3990,600,"R$ 39,90","600 créditos Gemini / mês"],["studio",5990,1200,"R$ 59,90","1.200 créditos Gemini / mês"]];
test('checkout, UI, aprovação MP e limite V2 correspondem a cada plano barato',()=>{
  for(const [plan,price,credits,label,count] of catalog) {
    assert.equal(PRICES_CENTS[plan],price);
    assert.equal(TETOS_IA_EXPERIMENTAIS_CENTAVOS[plan],credits);
    assert.equal(approvedPlanForPayment({status:'approved',currency_id:'BRL',transaction_amount:price/100},plan),plan);
    assert.equal(approvedPlanForPayment({status:'approved',currency_id:'BRL',transaction_amount:(price+1)/100},plan),null);
    const block=frontend.match(new RegExp("id: '"+plan+"'[\\s\\S]*?(?=\\n    \\},)"))?.[0];
    assert.ok(block, 'UI nao apresenta '+plan);
    assert.ok(block.includes("preco: '"+label+"'"),'UI mostra mensalidade diferente '+plan);
    assert.ok(block.includes("creditos: '"+count+"'"),'UI mostra creditos diferentes '+plan);
    assert.match(checkout,new RegExp("preco: PRICES_CENTS\\."+plan+" \\/ 100"));
    assert.match(checkout,new RegExp("creditos: PLAN_CREDITS\\."+plan));
    const quotas = grant.split('export const PLAN_CREDITS:')[1].split('};')[0];
    assert.match(quotas, new RegExp(plan+"\\s*:\\s*"+credits+"[,\\n]"));
  }
});
test('pior caso de consumo da API + encargos estimados deixa pelo menos R$20 após provisão de R$3',()=>{
  // Conservador: toda a quota V2 usada e 15% de taxas/impostos/estornos
  // SIMULADOS (não são alíquotas fiscais verificadas) + R$3 por conta em despesas variáveis.
  const taxaBps = 1500;  // 15%
  const provisaoOperacionalCentavos = 300;
  const saldoMinimoCentavos = 2000;
  for (const [plan,price,credits] of catalog) {
    const encargos=Math.ceil(price*taxaBps/10000);
    const caixa=price-credits-encargos-provisaoOperacionalCentavos;
    assert.ok(caixa >= saldoMinimoCentavos,
      plan+': sobra R$'+(caixa/100).toFixed(2)+' abaixo de R$20');
  }
});
test('painel admin sempre usa as mesmas cotas dos planos que o cliente compra',()=>{
  for(const [plan,_price,credits] of catalog) {
    assert.match(adminUsers,new RegExp(plan+": \\{ gemini: "+credits+", label:"));
    const show=credits.toLocaleString('pt-BR');
    const caption=plan==='starter'?'Starter':plan==='pro'?'Pro':'Studio';
    assert.ok(adminUsers.includes(caption+' — '+show+' créditos Gemini'));
  }
});
test('pagamentos antigos sao rejeitados em vez de ativar plano pelo valor errado',()=>{
  for(const [plan,oldValue] of [['starter',49],['pro',119],['studio',249]]) {
    assert.equal(approvedPlanForPayment({status:'approved',currency_id:'BRL',transaction_amount:oldValue},plan),null);
  }
});
