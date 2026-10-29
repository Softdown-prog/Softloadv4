'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const p=require('./essentialStoragePolicy.cjs');
const now=Date.parse('2026-11-01T12:00:00.000Z');
const iso=t=>new Date(t).toISOString();
test('5 MB free e 50 MB somente durante o pagamento vigente',()=>{
  assert.equal(p.currentStorageLimit({plano:'free'},now),5);
  assert.equal(p.currentStorageLimit({plano:'essencial',is_active:true,premium_ate:iso(now+1)},now),50);
  assert.equal(p.currentStorageLimit({plano:'essencial',is_active:false,premium_ate:iso(now+1)},now),5);
  assert.equal(p.currentStorageLimit({plano:'essencial',is_active:true,premium_ate:iso(now-1)},now),5);
  assert.equal(p.currentStorageLimit({plano:'studio',is_active:true,premium_ate:iso(now+1)},now),null);
});
test('30 dias íntegros + aviso cinco dias antes + exclusão cinco dias depois',()=>{
  const expiry=now+30*p.DAY;
  const a={plano:'free',is_active:false,essencial_storage_expira_em:iso(expiry),
    essencial_storage_aceite_em:iso(now),essencial_storage_migrado:true};
  assert.equal(p.essentialLifecycle(a,expiry-5*p.DAY).eligible,false);
  assert.equal(p.essentialLifecycle(a,expiry).eligible,false);
  assert.equal(p.essentialLifecycle(a,expiry+5*p.DAY-1).eligible,false);
  const status=p.essentialLifecycle(a,expiry+5*p.DAY);
  assert.equal(status.eligible,true);
  assert.equal(status.noticeFrom,iso(expiry-5*p.DAY));
  assert.equal(status.deleteAfter,iso(expiry+5*p.DAY));
  assert.equal(status.scope,'essential-v1');
});
test('não excluir contrato legado, renovado, sem aceite ou retido',()=>{
  const expiry=now-6*p.DAY;
  const a={plano:'free',is_active:false,essencial_storage_expira_em:iso(expiry),
    essencial_storage_aceite_em:iso(now-50*p.DAY),essencial_storage_migrado:true};
  assert.equal(p.essentialLifecycle({...a,essencial_storage_aceite_em:null},now).eligible,false);
  assert.equal(p.essentialLifecycle({...a,essencial_storage_migrado:false},now).eligible,false);
  assert.equal(p.essentialLifecycle({...a,is_active:true,premium_ate:iso(now+10*p.DAY)},now).eligible,false);
  assert.equal(p.essentialLifecycle({...a,legal_hold:true},now).eligible,false);
  assert.equal(p.essentialLifecycle({...a,storage_retention_hold:true},now).eligible,false);
  assert.equal(p.essentialLifecycle(a,now).eligible,true);
});
