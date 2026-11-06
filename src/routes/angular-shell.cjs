'use strict';
// Interface Angular canônica: somente entrega HTML e metadados para a UI.
// Express continua responsável por XML, pagamentos, identidade e storage.
const express=require('express');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const router=express.Router();
const {exigirLogin}=require('../middlewares/authGuard');
const {exigirSuperAdmin}=require('../middlewares/adminGuard');
const {db}=require('../services/firebase');
const {currentStorageLimit,DAY}=require('../services/essentialStoragePolicy.cjs');
const compiler=require('./dashboard_routes/compiler');
const angularIndex=path.resolve(__dirname,'../../angular/index.html');
const pages=['/','/criar','/login','/register','/recover','/dashboard',
 '/dashboard/gerador-blogger','/dashboard/historico','/dashboard/arquivos',
 '/dashboard/configuracoes','/dashboard/upgrade','/dashboard/plano-essencial',
 '/contato','/privacidade','/termos-de-uso','/eu','/eu/usuarios'];
function ensureGuestToken(req){
 if(!req.session)return '';
 if(typeof req.session.bloggerGuestToken!=='string'||! /^[a-f0-9]{48}$/.test(req.session.bloggerGuestToken))
   req.session.bloggerGuestToken=crypto.randomBytes(24).toString('hex');
 return req.session.bloggerGuestToken;
}
router.get('/api/frontend/bootstrap',(req,res)=>{
 try{
  const user=req.session?.user||null,{cores,fontes}=compiler.publicPresets();
  return res.json({
   user:user?{uid:user.uid,email:user.email,nome:user.nome,plano:user.plano,is_super_admin:user.is_super_admin===true}:null,
   guestMode:!user,guestToken:user?'':ensureGuestToken(req),
   downloadPath:user?'/dashboard/gerador-blogger/download':'/criar/download',
   cores,fontes,nichos:compiler.publicCatalog(),exemplos:compiler.publicExamples(),
   checkoutEnabled:process.env.BLOGGER_ESSENCIAL_CHECKOUT_ENABLED==='true',
   filesEnabled:process.env.SOFTLOAD_LITE_FILES_ENABLED==='true'
  });
 }catch(err){console.error('[ANGULAR BOOTSTRAP]',err.message);return res.status(503).json({erro:'Editor indisponível.'});}
});
const OLD_LIMITS={starter:100,start:100,pro:100,studio:500,premium:100};
function paid(account){
 const until=Date.parse(account?.premium_ate||'');
 return account?.is_active===true&&Number.isFinite(until)&&until>Date.now()&&account.plano!=='free';
}
function downloadable(file,account){
 if(file.scope!=='essential-v1')return true;
 if(paid(account))return true;
 const until=Date.parse(account?.essencial_storage_expira_em||account?.premium_ate||'');
 return Number.isFinite(until)&&Date.now()<=until+5*DAY;
}
router.get('/api/frontend/files',exigirLogin,async(req,res)=>{
 const user=req.session.user,email=typeof user?.email==='string'?user.email.trim().toLowerCase():'';
 if(!email.includes('@')||typeof user.uid!=='string')return res.status(401).json({erro:'Sessão inválida.'});
 if(!req.session.liteFilesCsrf||! /^[a-f0-9]{48}$/.test(req.session.liteFilesCsrf))
   req.session.liteFilesCsrf=crypto.randomBytes(24).toString('hex');
 const csrfToken=req.session.liteFilesCsrf;
 const enabled=process.env.SOFTLOAD_LITE_FILES_ENABLED==='true';
 if(!enabled)return res.json({enabled:false,csrfToken,items:[],limitMb:5,usedMb:0});
 try{
  const ref=db.collection('clientes_premium').doc(email),snap=await ref.get();
  if(!snap.exists||snap.data()?.uid!==user.uid)return res.status(403).json({erro:'Conta não encontrada.'});
  const account=snap.data(),used=Number(account.storage_usado_mb??0);
  if(!Number.isFinite(used)||used<0)return res.status(503).json({erro:'Cota precisa de conferência.'});
  const query=await ref.collection('lite_files').orderBy('createdAt','desc').limit(60).get();
  const items=query.docs.filter(doc=>doc.data()?.uid===user.uid).map(doc=>{
   const file=doc.data();
   return {id:doc.id,name:file.name,bytes:file.bytes,state:file.state,canDownload:downloadable(file,account)};
  });
  const limitMb=currentStorageLimit(account)??OLD_LIMITS[account.plano]??50;
  return res.json({enabled:true,csrfToken,items,limitMb,usedMb:Math.round(used*100)/100});
 }catch(err){console.error('[ANGULAR FILES]',err.message);return res.status(503).json({erro:'Arquivos indisponíveis.'});}
});
// Apenas as páginas humanas entram no Angular: APIs, POST, downloads, health
// e webhooks continuam sendo processados por seus módulos backend originais.
router.get(pages,(req,res,next)=>{
 const enabled=process.env.NODE_ENV==='production'||process.env.SOFTLOAD_USE_ANGULAR==='true';
 if(!enabled)return next();
 if(!fs.existsSync(angularIndex))return res.status(503).send('Frontend Angular ausente no build.');
 const serve=()=>res.status(200).set('Cache-Control','no-store').sendFile(angularIndex);
 if(req.path.startsWith('/dashboard'))return exigirLogin(req,res,serve);
 if(req.path==='/eu'||req.path==='/eu/usuarios')return exigirSuperAdmin(req,res,serve);
 if(['/login','/register','/recover'].includes(req.path)&&req.session?.user)return res.redirect(302,'/dashboard');
 return serve();
});
module.exports=router;
