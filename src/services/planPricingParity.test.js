'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PRICES_CENTS, approvedPlanForPayment } = require('./mpPlanRules');
const { TETOS_IA_EXPERIMENTAIS_CENTAVOS } = require('./geminiCost');
const root = path.resolve(__dirname, '../..');
const bloggerPlan = fs.readFileSync(path.join(root, 'views/pages/plano-essencial.ejs'),'utf8');
const checkout = fs.readFileSync(path.join(root,'src/routes/apiRoutes.js'),'utf8');
const grant = fs.readFileSync(path.join(root,'src/services/creditService.ts'),'utf8');
const catalog = [["starter",2990,150,"R$ 29,90","150 créditos Gemini / mês"],["pro",3990,600,"R$ 39,90","600 créditos Gemini / mês"],["studio",5990,1200,"R$ 59,90","1.200 créditos Gemini / mês"]];
test('recibos legados mantêm preço, cota e aprovação MP compatíveis',()=>{
  for(const [plan,price,credits,label,count] of catalog) {
    assert.equal(PRICES_CENTS[plan],price);
    assert.equal(TETOS_IA_EXPERIMENTAIS_CENTAVOS[plan],credits);
    assert.equal(approvedPlanForPayment({status:'approved',currency_id:'BRL',transaction_amount:price/100},plan),plan);
    assert.equal(approvedPlanForPayment({status:'approved',currency_id:'BRL',transaction_amount:(price+1)/100},plan),null);
    assert.match(checkout,new RegExp("preco: PRICES_CENTS\\."+plan+" \\/ 100"));
    assert.match(checkout,new RegExp("creditos: PLAN_CREDITS\\."+plan));
    const quotas = grant.split('export const PLAN_CREDITS:')[1].split('};')[0];
    assert.match(quotas, new RegExp(plan+"\\s*:\\s*"+credits+"[,\\n]"));
  }
});
test('os dois checkouts Mercado Pago usam a mesma tabela de preços',()=>{
  // A página /dashboard/upgrade usa checkout-create. Bricks não pode cobrar outra tabela.
  assert.ok(checkout.includes("router.post('/dashboard/checkout-create'"));
  assert.ok(checkout.includes("router.post('/dashboard/payment/process'"));
  const checkoutBricks=checkout.split("router.post('/dashboard/payment/process'")[1]
    ?.split('// ==========================================')[0];
  assert.ok(checkoutBricks,'rota Bricks não encontrada');
  assert.ok(checkoutBricks.includes('Object.hasOwn(PRICES_CENTS, plano)'));
  assert.ok(checkoutBricks.includes('transaction_amount: PRICES_CENTS[plano] / 100'));
  for(const oldValue of ['49.00','119.00','249.00','PLANOS_VALIDOS']) {
    assert.equal(checkoutBricks.includes(oldValue),false,'preço antigo em Bricks: '+oldValue);
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
test('plano Blogger em produção exibe R$ 5 e mantém checkout bloqueado por flag',()=>{
  assert.equal(PRICES_CENTS.essencial,500);
  assert.equal(approvedPlanForPayment({status:'approved',currency_id:'BRL',transaction_amount:5},'essencial'),'essencial');
  assert.equal(approvedPlanForPayment({status:'approved',currency_id:'BRL',transaction_amount:5.01},'essencial'),null);
  assert.match(bloggerPlan,/R\$ 5,00/);
  assert.match(bloggerPlan,/50 MB/);
  assert.match(bloggerPlan,/checkoutEnabled/);
  assert.match(bloggerPlan,/Pagamento temporariamente indisponível/);
  assert.doesNotMatch(bloggerPlan,/R\$ (?:29,90|39,90|59,90)/);
});
test('pagamentos antigos sao rejeitados em vez de ativar plano pelo valor errado',()=>{
  for(const [plan,oldValue] of [['starter',49],['pro',119],['studio',249]]) {
    assert.equal(approvedPlanForPayment({status:'approved',currency_id:'BRL',transaction_amount:oldValue},plan),null);
  }
});
