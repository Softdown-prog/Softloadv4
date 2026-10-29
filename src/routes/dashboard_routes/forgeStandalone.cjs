'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { db } = require('../../services/firebase');
const ALLOWED = new Set(['draw-graph','draw-recipe','run-workers','plan-plant','render-pixel-character','author-art','author-prop']);
const running = new Set();
const MAX_PARALLEL_GENERATIONS = 1; // VPS de 4 GB: só uma geração Python simultânea
const forge = () => require('../../../agent/forge/index.cjs');
function catalog() {
  return forge().catalog().recipes.filter(r=>ALLOWED.has(r.command));
}
function show(req,res) {
  try {
    if(typeof req.session.forgeCsrfToken !== 'string' || !/^[a-f0-9]{48}$/.test(req.session.forgeCsrfToken)) {
      req.session.forgeCsrfToken = crypto.randomBytes(24).toString('hex');
    }
    const receitas=catalog().map(r=>({id:r.recipeId,nome:r.id,comando:r.command}));
    res.render('pages/forge-2d',{activePage:'forge-2d',user:req.session.user,receitas,forgeCsrfToken:req.session.forgeCsrfToken});
  } catch(e) {
    console.error('[A7] Catalogo indisponivel:',e.message);
    res.status(503).type('text/plain; charset=utf-8').send('O catalogo A7 Forge esta indisponivel.');
  }
}
async function download(req,res) {
  const expected=req.session?.forgeCsrfToken;
  const supplied=req.body?.forgeCsrfToken;
  if(typeof expected!=='string'||typeof supplied!=='string'||expected.length!==48||supplied.length!==48||
     !/^[a-f0-9]{48}$/.test(expected)||!/^[a-f0-9]{48}$/.test(supplied)||
     !crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(supplied,'hex'))) {
    return res.status(403).send('Sessão expirada ou formulário inválido. Atualize a página e tente novamente.');
  }
  const origin=req.get('origin');
  if(origin) {
    try { if(new URL(origin).host !== req.get('host')) return res.status(403).send('Origem nao autorizada.'); }
    catch { return res.status(403).send('Origem invalida.'); }
  }
  const email=typeof req.session.user?.email==='string'?req.session.user.email.trim().toLowerCase():'';
  if(!email)return res.status(401).send('Entre novamente para gerar seu asset.');
  const selected=typeof req.body?.receita==='string'?req.body.receita:'';
  let item;
  try {item=catalog().find(r=>r.recipeId===selected);} catch {return res.status(503).send('Catálogo A7 Forge indisponível.');}
  if(!item)return res.status(400).send('Escolha uma receita valida do A7 Forge.');
  let account;
  try {
    const snap=await db.collection('clientes_premium').doc(email).get();
    account=snap.exists?snap.data():null;
  } catch { return res.status(503).send('Nao foi possivel confirmar sua assinatura.'); }
  const expiry=Date.parse(account?.premium_ate||'');
  if(account?.is_active!==true||!Number.isFinite(expiry)||expiry<=Date.now()||
     !['essencial','starter','start','pro','studio','premium'].includes(account?.plano))
     return res.status(402).send('A7 Forge disponivel para assinantes ativos do plano Essencial.');
  if(running.has(email))return res.status(429).send('Ja existe uma geracao em andamento.');
  if(running.size>=MAX_PARALLEL_GENERATIONS)return res.status(503).send('A7 Forge ocupado. Aguarde antes de gerar outro asset.');
  running.add(email);
  let dir=null;
  const cleanup=()=>{if(dir)try{fs.rmSync(dir,{recursive:true,force:true});}catch{}};
  let streamed=false;
  try{
    dir=fs.mkdtempSync(path.join(os.tmpdir(),'softload-a7-'));
    const out=await forge().render({id:'produto',command:item.command,recipeId:item.recipeId},{baseDir:dir});
    const root=path.resolve(dir,'assets','produto');
    const files=(Array.isArray(out.files)?out.files:[]).map(f=>({
      name:f.caminho,absolute:path.resolve(dir,String(f.caminho||''))
    })).filter(f=>typeof f.name==='string'&&f.name.startsWith('assets/produto/')&&
      f.absolute.startsWith(root+path.sep)&&fs.existsSync(f.absolute)&&fs.statSync(f.absolute).isFile());
    if(!files.length)throw Error('Sem arquivos para exportar');
    const zip=require('archiver')('zip',{zlib:{level:6}});
    zip.on('error',err=>{console.error('[A7] ZIP',err.message);res.destroy(err);});
    res.once('close',cleanup);res.once('finish',cleanup);
    res.status(200).set({'Content-Type':'application/zip',
      'Content-Disposition':'attachment; filename="a7-forge-2d.zip"',
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    streamed=true;
    zip.pipe(res);
    for(const file of files)zip.file(file.absolute,{name:path.relative(root,file.absolute).split(path.sep).join('/')});
    await zip.finalize();
  }catch(err){
    console.error('[A7] Render failed',err.message);
    if(!streamed&&!res.headersSent){cleanup();return res.status(503).type('text/plain; charset=utf-8').send('Falha ao gerar. Tente outra receita.');}
    if(!res.destroyed)res.destroy(err);
  }finally{running.delete(email);if(!streamed)cleanup();}
}
module.exports={show,download};
