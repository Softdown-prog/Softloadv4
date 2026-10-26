'use strict';
/** GitHub App user authorization: each Solaris customer connects their OWN account.
 * No platform token, no access before explicit consent. Tokens encrypted at rest.
 */
const crypto=require('node:crypto');
const {contextoRepositorioPublico,normalizarRepositorioGithub}=require('../solaris/tools/solarisToolModes');
const {listGithubRepositories}=require('./solarisGithubRepositoryCatalog');
const BASE='https://softload.analysepro.com/dashboard/solaris/github/callback';
function config(env=process.env){
 const id=env.SOLARIS_GITHUB_APP_CLIENT_ID||'',secret=env.SOLARIS_GITHUB_APP_CLIENT_SECRET||'';
 const raw=env.SOLARIS_GITHUB_ENCRYPTION_KEY||'';
 const slug=env.SOLARIS_GITHUB_APP_SLUG||'';
 return {id,secret,key:/^[0-9a-f]{64}$/i.test(raw)?Buffer.from(raw,'hex'):null,
  ready:!!(id&&secret&&/^[0-9a-f]{64}$/i.test(raw)),callback:BASE,
  installUrl:/^[a-z0-9-]{3,80}$/i.test(slug)?'https://github.com/apps/'+slug+'/installations/new':null};
}
function key(uid){return crypto.createHash('sha256').update('solaris-gh-user-v1:'+uid).digest('hex');}
function seal(value,k){
 const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',k,nonce);
 const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
 return [nonce,cipher.getAuthTag(),ciphertext].map(x=>x.toString('base64url')).join('.');
}
function unseal(value,k){
 const p=String(value||'').split('.').map(x=>Buffer.from(x,'base64url'));
 if(p.length!==3||p[0].length!==12||p[1].length!==16)throw Error('Credencial inválida');
 const c=crypto.createDecipheriv('aes-256-gcm',k,p[0]);c.setAuthTag(p[1]);
 return Buffer.concat([c.update(p[2]),c.final()]).toString('utf8');
}
function createGithubAppService(db,{env=process.env,fetchImpl=fetch}={}){
 const col=db.collection('solaris_github_users'),settings=()=>config(env);
 const doc=uid=>col.doc(key(uid));
 const load=async uid=>{const snap=await doc(uid).get();return snap.exists?snap.data():null;};
 const saveSession=req=>new Promise((yes,no)=>req.session.save(err=>err?no(err):yes()));
 async function token(uid){
  const cfg=settings(),record=await load(uid);
  if(!cfg.ready||!record?.encrypted||!(record.expires> Date.now()+30000))
   throw Error('Conecte novamente sua conta GitHub para continuar.');
  return {record,value:unseal(record.encrypted,cfg.key)};
 }
 return {
  ready:()=>settings().ready,
  async status(uid){
   const row=await load(uid);
   return {configured:settings().ready,connected:settings().ready&&!!row?.encrypted&&row.expires>Date.now()+30000,
    account:row?.account||null,repository:row?.repository||null,installable:!!settings().installUrl,
    mcpEnabled:process.env.SOLARIS_GITHUB_MCP_ENABLED==='true'};
  },
  installUrl(){return settings().ready?settings().installUrl:null;},
  async listRepos(uid){const {value}=await token(uid);return listGithubRepositories(value,fetchImpl);},
  async begin(req){
   const cfg=settings();
   if(!cfg.ready)throw Error('GitHub App ainda não configurado pelo administrador.');
   const state=crypto.randomBytes(24).toString('hex');
   const verifier=crypto.randomBytes(32).toString('base64url');
   const challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
   req.session.solarisGithubState={state,verifier,uid:req.session.user.uid,until:Date.now()+600000};
   await saveSession(req);
   const params=new URLSearchParams({client_id:cfg.id,redirect_uri:cfg.callback,state,
     code_challenge:challenge,code_challenge_method:'S256'});
   return 'https://github.com/login/oauth/authorize?'+params.toString();
  },
  async finish(req,{state,code}){
   const cfg=settings(),pending=req.session.solarisGithubState;
   delete req.session.solarisGithubState;await saveSession(req);
   if(!cfg.ready||!pending||pending.uid!==req.session.user?.uid||pending.until<Date.now()
      ||typeof state!=='string'||!/^[a-f0-9]{48}$/.test(state)
      ||!crypto.timingSafeEqual(Buffer.from(state),Buffer.from(pending.state))
      ||typeof code!=='string'||!/^[A-Za-z0-9_-]{8,250}$/.test(code))
      throw Error('Autorização GitHub inválida ou expirada.');
   const response=await fetchImpl('https://github.com/login/oauth/access_token',{
     method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},
     body:JSON.stringify({client_id:cfg.id,client_secret:cfg.secret,code,redirect_uri:cfg.callback,
       code_verifier:pending.verifier}),
     signal:AbortSignal.timeout(12000)});
   if(!response.ok)throw Error('Autorização GitHub indisponível.');
   const auth=await response.json();
   if(typeof auth.access_token!=='string'||!auth.access_token||auth.error)
      throw Error('O GitHub não autorizou a conexão.');
   const me=await fetchImpl('https://api.github.com/user',{headers:{
     Authorization:'Bearer '+auth.access_token,Accept:'application/vnd.github+json'},
     signal:AbortSignal.timeout(12000)});
   if(!me.ok)throw Error('Falha ao validar conta GitHub.');
   const user=await me.json();
   if(typeof user.login!=='string'||!/^[a-z0-9-]{1,39}$/i.test(user.login))
      throw Error('Conta GitHub inválida.');
   // Expiring user tokens de GitHub Apps, sem refresh automático.
   const expires=Date.now()+Math.min(8*3600,Number(auth.expires_in)||3600)*1000;
   await doc(req.session.user.uid).set({account:user.login,
     encrypted:seal(auth.access_token,cfg.key),expires,repository:null,created:new Date().toISOString()});
   return user.login;
  },
  // Entrega um token somente à função server-side, sem expor para UI ou modelo.
  async withSelectedRepo(uid,callback){
   const {record,value}=await token(uid);
   const repo=normalizarRepositorioGithub(record.repository);
   if(!repo || repo!==record.repository)throw Error('Vincule um repositório GitHub primeiro.');
   return callback({repository:repo,accessToken:value});
  },
  async repoContext(uid,url){
   const repo=normalizarRepositorioGithub(url);
   if(!repo)throw Error('Link GitHub inválido.');
   return this.withSelectedRepo(uid,async ({repository,accessToken})=>{
    if(repository.toLowerCase()!==repo.toLowerCase())throw Error('Selecione o repositório vinculado antes de consultar.');
    return contextoRepositorioPublico(repo,{token:accessToken,fetchImpl});
   });
  },
  async selectRepo(uid,url){
   const repo=normalizarRepositorioGithub(url);
   if(!repo)throw Error('Informe o link completo do repositório GitHub.');
   const {value}=await token(uid);
   await contextoRepositorioPublico(repo,{token:value,fetchImpl}); // exige acesso efetivo antes de salvar
   await doc(uid).update({repository:repo});
   return repo;
  },
  async disconnect(uid){await doc(uid).delete();}
 };
}
module.exports={config,seal,unseal,createGithubAppService};
