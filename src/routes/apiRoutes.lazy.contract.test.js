'use strict';
const { test }=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');

test('boot API mantém checkout e webhook sem importar RAG/limpeza Solaris',()=>{
  const routes=new Map(),imports=[];
  const router={
    get(route,...handlers){routes.set('GET '+route,handlers.at(-1));},
    post(route,...handlers){routes.set('POST '+route,handlers.at(-1));},
  };
  const env={NODE_ENV:'production',MP_ACCESS_TOKEN:'test',MP_WEBHOOK_SECRET:'secret',
};
  const fake={
    'express':{Router:()=>router},
    'express-rate-limit':()=>(_req,_res,next)=>next(),
    '../services/firebase':{db:{}},
    '../services/creditService':{PLAN_CREDITS:{free:0,starter:100,pro:200,studio:300,essencial:0},
      GPT_PLAN_CREDITS:{},BLOGGERAI_PLAN_CREDITS:{}},
    '../services/mpPlanRules':{approvedPlanForPayment:()=>null,PRICES_CENTS:{}},
    '../services/storageService':{STORAGE_LIMITS_MB:{free:5}},
    '../services/emailService':{enviarPlanoAtivado:()=>Promise.resolve()},
    'mercadopago':{MercadoPagoConfig:class {},Payment:class {},Preference:class {}},
    '../middlewares/authGuard':{exigirLogin:()=>{}}
  };
  const module={exports:{}};
  const script=fs.readFileSync(path.join(__dirname,'apiRoutes.js'),'utf8');
  vm.runInNewContext(script,{
    module,exports:module.exports,console:{warn(){},log(){},error(){}},
    process:{env},Buffer,Date,URL,
    require(name){
      imports.push(name);
      if(name==='crypto')return require('node:crypto');
      if(Object.hasOwn(fake,name))return fake[name];
      throw Error('Import não permitido no boot: '+name);
    }
  },{filename:'apiRoutes.js'});
  assert.equal(module.exports,router);
  assert.equal(routes.has('POST /dashboard/checkout-create'),true);
  assert.equal(routes.has('POST /webhook/mercado-pago'),true);
  assert.equal([...routes.keys()].some(path => path.includes('/internal/')), false);
  assert.equal(imports.some(name => /creditService|\/(?:solaris|rag)|gemini|openai/.test(name)), false);
});
