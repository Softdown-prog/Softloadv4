import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,relative} from 'node:path';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {ExpressAdapter} from '@nestjs/platform-express';

// Preflight for Express 5. It never boots server.js, Firestore or Mercado Pago.
// The route inventory comes from runtime JS/CJS files, not hand-copied paths.
const root=fileURLToPath(new URL('../../',import.meta.url));
const rootRequire=createRequire(new URL('../../server.js',import.meta.url));
const ROUTE_METHODS=new Set(['get','post','put','patch','delete','all','use']);
const requiredPaths=[
  ['get','/dashboard'],['get','/api/frontend/bootstrap'],
  ['post','/criar/download'],['post','/dashboard/gerador-blogger/download'],
  ['get','/dashboard/compilacao/:id/download'],
  ['post','/dashboard/checkout-create'],['post','/webhook/mercado-pago'],
  ['post','/login'],['get','/logout'],['get','/eu/api/usuarios'],
  ['post','/eu/api/usuario/:email/premium'],['get','/workers/api/status'],
  ['get','/dashboard/arquivos/:id/download']
];

function runtimeFiles(dir){
  const output=[];
  for(const entry of readdirSync(dir,{withFileTypes:true})){
    const path=join(dir,entry.name);
    if(entry.isDirectory()){output.push(...runtimeFiles(path));continue;}
    if(!entry.isFile()||!/\.(?:js|cjs)$/.test(entry.name)||
       /\.(?:test|spec)\./.test(entry.name))continue;
    output.push(path);
  }
  return output;
}
function literalPaths(node,constants){
  if(ts.isStringLiteral(node)||ts.isNoSubstitutionTemplateLiteral(node))return [node.text];
  if(ts.isArrayLiteralExpression(node)){
    return node.elements.flatMap(el=>literalPaths(el,constants));
  }
  if(ts.isIdentifier(node)&&constants.has(node.text)){
    return literalPaths(constants.get(node.text),constants);
  }
  return null;
}
function inventoryRoutes(){
  const routes=[];
  const files=[join(root,'server.js'),...runtimeFiles(join(root,'src/routes'))];
  for(const file of files){
    const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    assert.equal(source.parseDiagnostics.length,0,'Unparseable runtime file: '+relative(root,file));
    const constants=new Map();
    function collect(node){
      if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer&&
         ts.isArrayLiteralExpression(node.initializer))constants.set(node.name.text,node.initializer);
      ts.forEachChild(node,collect);
    }
    collect(source);
    function inspect(node){
      if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&
         ts.isIdentifier(node.expression.expression)&&
         ['router','app'].includes(node.expression.expression.text)&&
         ROUTE_METHODS.has(node.expression.name.text)){
        const method=node.expression.name.text;
        const first=node.arguments[0];
        if(first){
          const paths=literalPaths(first,constants);
          // app.use(function) or router.use(otherRouter) does not declare a path.
          if(paths===null&&method!=='use'){
            assert.fail('Dynamic HTTP route needs manual Express 5 review: '+relative(root,file)+
              ' '+source.getLineAndCharacterOfPosition(node.getStart()).line);
          }
          for(const path of paths??[]){
            routes.push({method,path,file:relative(root,file)});
          }
        }
      }
      ts.forEachChild(node,inspect);
    }
    inspect(source);
  }
  return routes;
}

test('every statically declared legacy HTTP path registers on genuine Express 5',()=>{
  const routes=inventoryRoutes();
  assert.ok(routes.length>=60,'unexpected route inventory shrink: '+routes.length);
  for(const [method,path] of requiredPaths){
    assert.ok(routes.some(r=>r.method===method&&r.path===path),
      'missing critical real route '+method+' '+path);
  }
  const app=new ExpressAdapter().getInstance(); // Nest 12 adapter uses Express 5
  for(const {method,path,file} of routes){
    assert.doesNotThrow(
      ()=>app[method](path,(_req,res)=>res.status(204).end()),
      'Express 5 rejects path '+method+' '+path+' from '+file
    );
  }
  // This is a route-registration proof, not execution of commercial handlers.
});

// Run the actual legacy middleware implementation under the Express 5 router.
// Firestore is substituted with deterministic in-memory data, as in existing
// Express-vs-Nest Premium tests; never connect an external account.
const authSource=readFileSync(join(root,'src/middlewares/authGuard.js'),'utf8');
function legacyGuards(){
  const collection={
    doc(email){
      assert.equal(email,email.toLowerCase(),'Premium lookup must normalize email');
      return {async get(){
        const renewed=email==='paid@example.com';
        return {exists:renewed,data:()=>renewed?{
          is_active:true,plano:'essencial',premium_ate:'2099-01-01T00:00:00.000Z'
        }:null};
      }};
    }
  };
  const module={exports:{}};
  runInNewContext(authSource,{
    module,exports:module.exports,Date,
    console:{warn(){},error(){}},
    require(id){
      if(id==='../services/firebase')return {db:{collection(name){
        assert.equal(name,'clientes_premium');
        return collection;
      }}};
      if(id==='./accessPolicy.js')return rootRequire('./src/middlewares/accessPolicy.js');
      throw Error('Unexpected production dependency '+id);
    }
  },{filename:'authGuard.js'});
  return module.exports;
}
function testUser(role){
  switch(role){
    case 'free':return {uid:'free',email:'free@example.com',is_active:false,plano:'free'};
    case 'paid':return {uid:'paid',email:'paid@example.com',is_active:true,
      premium_ate:'2099-01-01T00:00:00.000Z'};
    case 'renewed':return {uid:'renewed',email:'PAID@EXAMPLE.COM',is_active:true,
      plano:'essencial',premium_ate:'2020-01-01T00:00:00.000Z'};
    case 'admin':return {uid:'admin',is_super_admin:true};
    case 'worker':return {uid:'worker',email:'softloady@gmail.com'};
    default:return null;
  }
}
test('legacy login, admin, worker and Premium guards preserve HTTP contracts on Express 5',
  {timeout:30000},async()=>{
  const {exigirLogin,exigirPlanoAtivo}=legacyGuards();
  const {exigirSuperAdmin}=rootRequire('./src/middlewares/adminGuard.js');
  const {exigirWorkerAccess}=rootRequire('./src/middlewares/workerGuard.js');
  const app=new ExpressAdapter().getInstance();
  app.use((req,res,next)=>{
    const user=testUser(req.get('x-proof-role'));
    req.session=user?{user}:{};
    // No EJS: only the real guards' concealment status is under test.
    res.render=(_view)=>res.type('text/html').send('concealed');
    next();
  });
  app.get('/dashboard/proof',exigirLogin,(_req,res)=>res.json({ok:true}));
  app.get('/api/proof/session',exigirLogin,(_req,res)=>res.json({ok:true}));
  app.get('/eu/proof',exigirSuperAdmin,(_req,res)=>res.json({ok:true}));
  app.get('/workers/proof',exigirWorkerAccess,(_req,res)=>res.json({ok:true}));
  app.get('/dashboard/proof/premium',exigirPlanoAtivo,(_req,res)=>res.json({ok:true}));
  app.post('/webhook/mercado-pago',(_req,res)=>res.json({queryId:_req.query['data.id']??null}));

  const server=app.listen(0,'127.0.0.1');
  try{
    const address=server.address();
    assert.ok(address&&typeof address!=='string');
    const base='http://127.0.0.1:'+address.port;
    const get=(path,role,accept='text/html')=>fetch(base+path,{
      redirect:'manual',headers:{accept,...(role?{'x-proof-role':role}:{})}
    });
    const html=await get('/dashboard/proof');
    assert.equal(html.status,302);
    assert.equal(decodeURI(html.headers.get('location')),
      '/login?erro=Faça login para continuar.');
    assert.equal((await get('/api/proof/session')).status,401);
    const anonymousJson=await get('/dashboard/proof',null,'application/json');
    assert.equal(anonymousJson.status,401);
    assert.equal((await anonymousJson.json()).error,
      'Sessão expirada. Recarregue a página e faça login novamente.');
    assert.equal((await get('/dashboard/proof','free')).status,200);
    assert.equal((await get('/eu/proof','free')).status,404);
    assert.equal((await get('/eu/proof','admin')).status,200);
    assert.equal((await get('/workers/proof','free')).status,404);
    assert.equal((await get('/workers/proof','worker')).status,200);
    const free=await get('/dashboard/proof/premium','free','application/json');
    assert.equal(free.status,403);
    assert.equal((await free.json()).plano_necessario,'premium');
    assert.equal((await get('/dashboard/proof/premium','renewed')).status,200);
    assert.equal((await get('/dashboard/proof/premium','paid')).status,200);
    assert.equal((await get('/dashboard/proof/premium','free')).status,302);
    // Query shape used by the signed webhook: no payment lookup is performed.
    const webhook=await fetch(base+'/webhook/mercado-pago?data.id=123',{
      method:'POST',redirect:'manual'
    });
    assert.equal(webhook.status,200);
    assert.equal((await webhook.json()).queryId,'123');
  }finally{
    await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
  }
});
