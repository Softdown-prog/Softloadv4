'use strict';

// Armazenamento novo, isolado em users/{uid}/lite-v1/{uuid}.
// Nenhuma rotina deste módulo apaga arquivos legados ou executa expiração.
const express=require('express');
const rateLimit=require('express-rate-limit');
const crypto=require('node:crypto');
const path=require('node:path');
const { db,bucket }=require('../../services/firebase');
const { exigirLogin }=require('../../middlewares/authGuard');
const { currentStorageLimit,MB,DAY }=require('../../services/essentialStoragePolicy.cjs');
const router=express.Router();
const ON=()=>process.env.SOFTLOAD_LITE_FILES_ENABLED==='true';
const FILE_MAX=5*MB;
const TOTAL_MAX=50*MB;
const LEGACY_LIMITS={starter:100,start:100,pro:100,studio:500,premium:100};
const EXTENSIONS=new Set(['.xml','.png','.jpg','.jpeg','.webp','.gif','.json','.zip']);
const MIME={'application/octet-stream':'application/octet-stream'};
const ID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const raw=express.raw({type:'application/octet-stream',limit:FILE_MAX});
const throttle=rateLimit({windowMs:60*60*1000,limit:12,standardHeaders:'draft-8',legacyHeaders:false,
  message:{erro:'Limite de uploads atingido; tente novamente mais tarde.'}});
const refused=(req,res,next)=>ON()?next():res.status(503).send('Área de arquivos ainda não foi habilitada.');
const isSafeInt=n=>Number.isSafeInteger(n)&&n>=0;
const accountRef=email=>db.collection('clientes_premium').doc(email);
const filesRef=email=>accountRef(email).collection('lite_files');
function identity(req) {
  const email=typeof req.session?.user?.email==='string'?req.session.user.email.toLowerCase().trim():'';
  const uid=req.session?.user?.uid;
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || typeof uid!=='string' ||
     !/^[a-zA-Z0-9_-]{5,128}$/.test(uid)) throw Object.assign(Error('Sessão inválida.'),{status:401});
  return {email,uid};
}
function quotaMb(a) {
  const standard=currentStorageLimit(a);
  if(standard!==null)return standard;
  return LEGACY_LIMITS[a?.plano]||50;
}
function userBytes(a) {
  const used=Number(a?.storage_usado_mb??0);
  const pending=Number(a?.lite_storage_pendente_bytes??0);
  if(!Number.isFinite(used)||used<0||!isSafeInt(pending))
    throw Object.assign(Error('Saldo de armazenamento precisa de conferência.'),{status:503});
  return {used:Math.ceil(used*MB),pending};
}
function filename(value) {
  if(typeof value!=='string')throw Object.assign(Error('Nome inválido.'),{status:400});
  let decoded;
  try{decoded=decodeURIComponent(value);}catch{throw Object.assign(Error('Nome inválido.'),{status:400});}
  const name=decoded.trim();
  if(name.length<1||Buffer.byteLength(name,'utf8')>128||/[\x00-\x1f\x7f\\/]/.test(name)||
     name==='.'||name==='..'||!EXTENSIONS.has(path.extname(name).toLowerCase()))
     throw Object.assign(Error('Envie XML, PNG, JPG, WebP, GIF, JSON ou ZIP (nome de até 128 bytes).'),{status:400});
  return name;
}
function csrf(req) {
  const expected=req.session?.liteFilesCsrf;
  const supplied=req.get('x-lite-csrf')||req.body?.liteFilesCsrf;
  return typeof expected==='string'&&typeof supplied==='string'&&
    /^[a-f0-9]{48}$/.test(expected)&&/^[a-f0-9]{48}$/.test(supplied)&&
    crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(supplied,'hex'));
}
function originOk(req) {
  const origin=req.get('origin');
  if(!origin)return true;
  try {return new URL(origin).host===req.get('host');}catch{return false;}
}
function filePath(uid,id) {return 'users/'+uid+'/lite-v1/'+id;}
function paidUntil(a) {
  const expires=Date.parse(a?.premium_ate||'');
  return a?.is_active===true&&Number.isFinite(expires)&&expires>Date.now()&&a?.plano!=='free';
}
function canDownload(file,a) {
  if(file.scope!=='essential-v1')return true;
  if(paidUntil(a))return true;
  const expires=Date.parse(a?.essencial_storage_expira_em||a?.premium_ate||'');
  return Number.isFinite(expires)&&Date.now()<=expires+5*DAY;
}
function replyError(res,err) {
  const status=[400,401,402,403,404,409,413,429,503].includes(err?.status)?err.status:503;
  if(status===503)console.error('[LITE FILES]',err?.message||'Erro inesperado');
  return res.status(status).json({erro:status===503?'Armazenamento indisponível. Não tente enviar novamente sem conferir a lista.':err.message});
}
router.get('/dashboard/arquivos',exigirLogin,async(req,res)=>{
  let me;try{me=identity(req);}catch(e){return res.redirect('/login');}
  if(!req.session.liteFilesCsrf||! /^[a-f0-9]{48}$/.test(req.session.liteFilesCsrf))
    req.session.liteFilesCsrf=crypto.randomBytes(24).toString('hex');
  const enabled=ON();
  if(!enabled)return res.render('pages/arquivos-simples',{activePage:'arquivos',user:req.session.user,
    enabled:false,items:[],limitMb:5,usedMb:0,csrfToken:req.session.liteFilesCsrf});
  try{
    const a=await accountRef(me.email).get();
    if(!a.exists||a.data()?.uid!==me.uid)return res.status(403).send('Conta não encontrada.');
    const docs=await filesRef(me.email).orderBy('createdAt','desc').limit(60).get();
    const acc=a.data();const bytes=userBytes(acc);
    return res.render('pages/arquivos-simples',{activePage:'arquivos',user:req.session.user,
      enabled:true,items:docs.docs.map(x=>({id:x.id,...x.data(),canDownload:canDownload(x.data(),acc)})),
      limitMb:quotaMb(acc),usedMb:Math.round(bytes.used/MB*100)/100,
      csrfToken:req.session.liteFilesCsrf});
  }catch(e){console.error('[LITE FILES] Listagem:',e.message);return res.status(503).send('Arquivos indisponíveis no momento.');}
});
router.post('/dashboard/arquivos/upload',exigirLogin,refused,throttle,raw,async(req,res)=>{
  let me,id,ref,account,locked=false,saved=false;
  try{
    if(!originOk(req)||!csrf(req))throw Object.assign(Error('Formulário expirado. Atualize a página.'),{status:403});
    me=identity(req);
    const data=req.body;
    if(!Buffer.isBuffer(data)||data.length<1||data.length>FILE_MAX)
      throw Object.assign(Error('Arquivo vazio ou maior que 5 MB.'),{status:413});
    const name=filename(req.get('x-file-name'));
    id=crypto.randomUUID();
    ref=filesRef(me.email).doc(id);
    account=accountRef(me.email);
    const obj=filePath(me.uid,id);
    const createdAt=new Date().toISOString();
    // A reserva é transacional entre todos os workers da aplicação.
    await db.runTransaction(async tx=>{
      const snap=await tx.get(account);
      if(!snap.exists||snap.data()?.uid!==me.uid)
        throw Object.assign(Error('Conta não encontrada.'),{status:403});
      const a=snap.data(),q=quotaMb(a),bytes=userBytes(a);
      if(bytes.used+bytes.pending+data.length>q*MB)
        throw Object.assign(Error('Cota excedida. Apague arquivos antigos antes de enviar.'),{status:413});
      const scope=a.plano==='essencial'&&paidUntil(a)?'essential-v1':'free-v1';
      if(scope==='essential-v1'&&!a.essencial_storage_aceite_em)
        throw Object.assign(Error('Aceite a política do plano Essencial antes de armazenar.'),{status:403});
      tx.create(ref,{name,bytes:data.length,uid:me.uid,scope,state:'uploading',
        createdAt,contentType:'application/octet-stream'});
      tx.set(account,{lite_storage_pendente_bytes:bytes.pending+data.length},{merge:true});
      locked=true;
    });
    await bucket.file(obj).save(data,{resumable:false,metadata:{contentType:'application/octet-stream',
      cacheControl:'private, no-store'}});
    saved=true;
    // Só marcar como disponível depois de subir ao bucket.
    await db.runTransaction(async tx=>{
      const [fileSnap,userSnap]=await Promise.all([tx.get(ref),tx.get(account)]);
      if(!fileSnap.exists||fileSnap.data()?.state!=='uploading'||!userSnap.exists)
        throw Error('Reserva perdida; conferência manual necessária.');
      const a=userSnap.data(),pending=Number(a.lite_storage_pendente_bytes);
      if(!isSafeInt(pending)||pending<data.length)throw Error('Saldo reservado inconsistente.');
      const used=userBytes(a).used;
      if(used+pending>quotaMb(a)*MB)
        throw Error('A cota mudou durante o upload. Manter reserva até conferência.');
      tx.set(account,{storage_usado_mb:(used+data.length)/MB,
        lite_storage_pendente_bytes:pending-data.length},{merge:true});
      tx.update(ref,{state:'ready',uploadedAt:new Date().toISOString()});
    });
    return res.status(201).json({id,name,bytes:data.length});
  }catch(err){
    // Não tentar limpar um commit ambíguo: poderia apagar um arquivo já confirmado.
    if(locked&&ref){
      try{
        const snap=await ref.get();
        if(snap.exists&&snap.data().state==='ready')return res.status(201).json({id,recuperado:true});
        if(saved){await bucket.file(filePath(me.uid,id)).delete({ignoreNotFound:true});saved=false;}
        await db.runTransaction(async tx=>{
          const [fileSnap,ownerSnap]=await Promise.all([tx.get(ref),tx.get(account)]);
          if(!fileSnap.exists||fileSnap.data()?.state!=='uploading')return;
          const pending=Number(ownerSnap.data()?.lite_storage_pendente_bytes);
          if(!isSafeInt(pending)||pending<fileSnap.data().bytes)return;
          tx.delete(ref);tx.set(account,{lite_storage_pendente_bytes:pending-fileSnap.data().bytes},{merge:true});
        });
      }catch(cleanupError){console.error('[LITE FILES] Reserva pendente para reconciliar:',id,cleanupError.message);}
    }
    return replyError(res,err);
  }
});
router.get('/dashboard/arquivos/:id/download',exigirLogin,refused,async(req,res)=>{
  try{
    const me=identity(req),id=req.params.id;
    if(typeof id!=='string'||!ID.test(id))throw Object.assign(Error('Arquivo não encontrado.'),{status:404});
    const [f,a]=await Promise.all([filesRef(me.email).doc(id).get(),accountRef(me.email).get()]);
    if(!f.exists||!a.exists||a.data()?.uid!==me.uid||f.data()?.uid!==me.uid||f.data()?.state!=='ready')
      throw Object.assign(Error('Arquivo não encontrado.'),{status:404});
    if(!canDownload(f.data(),a.data()))throw Object.assign(Error('Prazo de recuperação encerrado.'),{status:403});
    const name=f.data().name;
    res.set({'Content-Type':'application/octet-stream',
      'Content-Disposition':"attachment; filename=\"arquivo\"; filename*=UTF-8''"+encodeURIComponent(name),
      'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'});
    bucket.file(filePath(me.uid,id)).createReadStream().on('error',err=>{
      console.error('[LITE FILES] Download:',err.message);
      if(!res.headersSent)res.status(503).end();
      else res.destroy(err);
    }).pipe(res);
  }catch(err){return replyError(res,err);}
});
router.post('/dashboard/arquivos/:id/excluir',exigirLogin,refused,async(req,res)=>{
  try{
    if(!originOk(req)||!csrf(req))throw Object.assign(Error('Formulário expirado.'),{status:403});
    const me=identity(req),id=req.params.id;
    if(typeof id!=='string'||!ID.test(id))throw Object.assign(Error('Arquivo não encontrado.'),{status:404});
    const ref=filesRef(me.email).doc(id),account=accountRef(me.email);
    await db.runTransaction(async tx=>{
      const [file,user]=await Promise.all([tx.get(ref),tx.get(account)]);
      if(!file.exists||!user.exists||file.data()?.uid!==me.uid||user.data()?.uid!==me.uid ||
         !['ready','deleting'].includes(file.data()?.state))
        throw Object.assign(Error('Arquivo não encontrado.'),{status:404});
      if(file.data().state==='ready')tx.update(ref,{state:'deleting'});
    });
    await bucket.file(filePath(me.uid,id)).delete({ignoreNotFound:true});
    await db.runTransaction(async tx=>{
      const [file,user]=await Promise.all([tx.get(ref),tx.get(account)]);
      if(!file.exists||file.data()?.state!=='deleting'||!user.exists)return;
      const bytes=file.data().bytes;
      if(!isSafeInt(bytes))throw Error('Tamanho inconsistente.');
      const old=userBytes(user.data()).used;
      tx.set(account,{storage_usado_mb:Math.max(0,old-bytes)/MB},{merge:true});
      tx.delete(ref);
    });
    return res.redirect(303,'/dashboard/arquivos');
  }catch(err){return replyError(res,err);}
});
module.exports=router;
