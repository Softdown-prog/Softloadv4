'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Module=require('node:module');
const file=require.resolve('./compiler.js');
function app(user={uid:'uid-123',email:'teste@example.com',plano:'free'},options={}) {
  const map={get:new Map(),post:new Map()};
  const router={
    get(path,...handlers){map.get.set(path,handlers[handlers.length-1]);},
    post(path,...handlers){map.post.set(path,handlers[handlers.length-1]);}
  };
  const data={gerador_sem_ia_testes_usados:0,is_active:false,plano:'free'};
  let compilation=0;
  const mocks={
    express:{Router:()=>router},
    'express-rate-limit':()=> (_req,_res,next)=>next(),
    '../../middlewares/authGuard':{exigirLogin:()=>{}},
    '../../core/compilerWorker':{executarCompilacao:(o)=>{
      compilation++;
      assert.equal(o.colorPreset,'tech-blue');
      return {slug:'teste',xmlFinal:"<html><b:widget id='Blog1' type='Blog'/></html>"};
    }},
    '../../core/xmlValidator':{validarXmlCompilado:()=>[],validarXmlEstrutura:()=>({erros:[]}),validarSemanticaBlogger:()=>({erros:[]})},
    '../../core/presets':{COLOR_PRESETS:{'tech-blue':{label:'Tech Blue'}},TYPOGRAPHY_PRESETS:{inter:{label:'Inter'}}},
    '../../core/nichoTaxonomy':{NICHO_PAGE_TYPE_MAP:{'noticias-mag-news':'portal-noticias','culinaria-boutique-gourmet':'blogger-conteudo'},PAGE_TYPES_SEM_CHASSIS_DEDICADO:new Set()},
    '../../services/firebase':{db:{collection:()=>({
      where:(field,op,value)=>{
        assert.equal(field,'email');assert.equal(op,'==');assert.equal(value,user.email);
        return {limit:()=>({get:async()=>({
          docs:options.missingAccount?[]:[
            {ref:{id:options.documentId||'uid-keyed-document'},
              data:()=>({email:user.email,uid:user.uid,...data})}
          ]
        })})};
      }
    }),
      runTransaction:async callback=>{
        const tx={get:async ref=>{
            assert.equal(ref.id,options.documentId||'uid-keyed-document');
            return {exists:true,data:()=>({email:user.email,uid:user.uid,...data})};
          },
          set:(ref,upd)=>{
            assert.equal(ref.id,options.documentId||'uid-keyed-document');
            Object.assign(data,upd);
          }};
        return callback(tx);
      }}}
  };
  const mod=new Module(file,module);mod.filename=file;mod.paths=module.paths;
  mod.require=id=>mocks[id]||require(id);
  mod._compile(fs.readFileSync(file,'utf8'),file);
  function res() {
    return {statusCode:200,payload:null,headers:{},
      status(x){this.statusCode=x;return this;},
      type(){return this;},
      set(h){this.headers=h;return this;},
      send(x){this.payload=x;return this;},
      render(view,locals){this.payload={view,locals};return this;},
      redirect(code,where){this.payload={code,where};return this;}
    };
  }
  async function download(body) {
    const output=res();
    await map.post.get('/dashboard/gerador-blogger/download')({body,session:{user},get:()=>undefined},output);
    return output;
  }
  return {map,res,download,data,get compilation(){return compilation;}};
}
const valid={siteName:'Blog Azul',modo:'novo',colorPreset:'tech-blue',gridLayout:'revista',sidebarPosition:'right',typography:'inter'};
test('página SSR inclui todos os nichos reais, sem React/Gemini',()=>{
  const a=app(),r=a.res();
  a.map.get.get('/dashboard/gerador-blogger')({session:{user:{email:'u@example.com'}}},r);
  assert.equal(r.payload.view,'pages/gerador-blogger');
  assert.equal(r.payload.locals.nichos.length,2);
  const view=fs.readFileSync(require('node:path').join(__dirname,'../../../views/pages/gerador-blogger.ejs'),'utf8');
  assert.match(view,/Criar do zero/);assert.match(view,/Personalizar um nicho/);
  assert.doesNotMatch(view,/react-root|\/dist\/assets\/main\.js|Gemini.*generateContent/);
});
test('free tem 2 XML válidos e o terceiro é recusado sem chamar a IA',async()=>{
  const a=app();
  for(let i=0;i<2;i++){
    const r=await a.download(valid);
    assert.equal(r.statusCode,200);
    assert.match(r.headers['Content-Disposition'],/teste\.xml/);
    assert.match(r.payload,/Blog1/);
  }
  assert.equal(a.data.gerador_sem_ia_testes_usados,2);
  const third=await a.download(valid);
  assert.equal(third.statusCode,402);
  assert.match(third.payload,/2 downloads gratuitos/);
  assert.equal(a.data.gerador_sem_ia_testes_usados,2);
});
test('não debita quando formulário falha e recusa nicho desconhecido',async()=>{
  const a=app();
  const wrong=await a.download({...valid,siteName:'A'});
  assert.equal(wrong.statusCode,422);
  const fakeNiche=await a.download({...valid,modo:'modelo',nichoTema:'../../../secrets'});
  assert.equal(fakeNiche.statusCode,422);
  assert.equal(a.data.gerador_sem_ia_testes_usados,0);
  assert.equal(a.compilation,0);
});

test('sessão autenticada com documento Firestore por UID debita na conta original',async()=>{
  const f=app({uid:'firebase-uid-original',email:'teste@example.com',plano:'free'},
    {documentId:'firebase-uid-original'});
  const result=await f.download(valid);
  assert.equal(result.statusCode,200);
  assert.equal(f.data.gerador_sem_ia_testes_usados,1);
  assert.equal(f.compilation,1);
});
test('não cria conta fantasma nem libera download se a conta não existe',async()=>{
  const f=app({uid:'firebase-uid-missing',email:'teste@example.com',plano:'free'},
    {missingAccount:true});
  const result=await f.download(valid);
  assert.equal(result.statusCode,503);
  assert.match(result.payload,/Não foi possível verificar a cota/);
  assert.equal(f.data.gerador_sem_ia_testes_usados,0);
});
