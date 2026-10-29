'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const {PRICES_CENTS,approvedPlanForPayment}=require('./mpPlanRules');
test('plano Blogger custa exatamente R$5 por 30 dias, sem saldo de IA',()=>{
  assert.equal(PRICES_CENTS.essencial,500);
  assert.equal(approvedPlanForPayment({status:'approved',currency_id:'BRL',transaction_amount:5},'essencial'),'essencial');
  assert.equal(approvedPlanForPayment({status:'approved',currency_id:'BRL',transaction_amount:5.01},'essencial'),null);
  assert.equal(approvedPlanForPayment({status:'approved',currency_id:'USD',transaction_amount:5},'essencial'),null);
  const credits=read('src/services/creditService.ts');
  const sections=['PLAN_CREDITS','GPT_PLAN_CREDITS','BLOGGERAI_PLAN_CREDITS'];
  for(const label of sections) {
    const block=credits.split('export const '+label+':')[1]?.split('};')[0];
    assert.ok(block,'Tabela ausente: '+label);
    assert.match(block,/essencial:\s*0/,'Plano Essencial não deve fornecer créditos IA: '+label);
  }
  assert.match(read('src/services/storageService.ts'),/essencial:\s*5/);
});
test('Mercado Pago reconhece preço R$5, protege o checkout até homologação e preserva recibos legados',()=>{
  const api=read('src/routes/apiRoutes.ts');
  const js=read('src/routes/apiRoutes.js');
  assert.match(api,/essencial: \{ titulo: 'Softload Blogger — Acesso 30 dias', preco: PRICES_CENTS\.essencial \/ 100, creditos: 0 \}/);
  assert.match(api,/BLOGGER_ESSENCIAL_CHECKOUT_ENABLED/);
  assert.match(js,/BLOGGER_ESSENCIAL_CHECKOUT_ENABLED/);
  assert.match(api,/approvedPlanForPayment\(paymentDetails, userData\.plano_pendente\)/);
  assert.match(api,/softload_mp_payments/);
  const html=read('views/pages/plano-essencial.ejs');
  assert.match(html,/R\$ 5,00/);
  assert.match(html,/30 dias/);
  assert.match(html,/plano:'essencial'/);
  assert.doesNotMatch(html,/react-root|\/dist\/assets\/main\.js/);
});
