import type { Firestore } from 'firebase-admin/firestore';
import type { GithubFetch, GithubRepoProvider, GithubSelectedRepo } from './solarisGithubOperations';
import type { GithubRepoItem, GithubCatalogFetch } from './solarisGithubRepositoryCatalog';
export interface GithubOAuthState { state: string; verifier: string; uid: string; until: number }
export interface GithubOAuthRequest { session: { user: { uid: string }; solarisGithubState?: GithubOAuthState; save(callback: (error?: Error | null) => void): void } }
export interface GithubAppStatus { configured: boolean; connected: boolean; account: string | null; repository: string | null; installable: boolean; mcpEnabled: boolean }
export interface GithubAppService extends GithubRepoProvider {
  ready(): boolean; status(uid: string): Promise<GithubAppStatus>; installUrl(): string | null;
  listRepos(uid: string): Promise<{ repositories: GithubRepoItem[]; truncated: boolean }>;
  begin(req: GithubOAuthRequest): Promise<string>;
  finish(req: GithubOAuthRequest, params: { state: unknown; code: unknown }): Promise<string>;
  repoContext(uid: string, url: string): Promise<string>;
  selectRepo(uid: string, url: string): Promise<string>;
  disconnect(uid: string): Promise<void>;
}
interface ConnectionRecord { account?: string; repository: string | null; encrypted?: string; expires: number }
interface OAuthResponse { access_token?: unknown; error?: unknown; expires_in?: unknown }
interface GithubUser { login?: unknown }

'use strict';
/** GitHub App user authorization: each Solaris customer connects their OWN account.
 * No platform token, no access before explicit consent. Tokens encrypted at rest.
 */
const crypto=require('node:crypto') as typeof import('node:crypto');
const {contextoRepositorioPublico,normalizarRepositorioGithub}=require('../solaris/tools/solarisToolModes') as { normalizarRepositorioGithub(url: unknown): string | null; contextoRepositorioPublico(repo: string, options: { token: string; fetchImpl: GithubFetch }): Promise<string> };
const {listGithubRepositories}=require('./solarisGithubRepositoryCatalog') as typeof import('./solarisGithubRepositoryCatalog');
const BASE='https://softload.analysepro.com/dashboard/solaris/github/callback';
export function config(env: Record<string, string | undefined> = process.env){
 const id=env.SOLARIS_GITHUB_APP_CLIENT_ID||'',secret=env.SOLARIS_GITHUB_APP_CLIENT_SECRET||'';
 const raw=env.SOLARIS_GITHUB_ENCRYPTION_KEY||'';
 const slug=env.SOLARIS_GITHUB_APP_SLUG||'';
 return {id,secret,key:/^[0-9a-f]{64}$/i.test(raw)?Buffer.from(raw,'hex'):null,
  ready:!!(id&&secret&&/^[0-9a-f]{64}$/i.test(raw)),callback:BASE,
  installUrl:/^[a-z0-9-]{3,80}$/i.test(slug)?'https://github.com/apps/'+slug+'/installations/new':null};
}
function key(uid: string){return crypto.createHash('sha256').update('solaris-gh-user-v1:'+uid).digest('hex');}
export function seal(value: string, k: Buffer): string{
 const nonce=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',k,nonce);
 const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
 return [nonce,cipher.getAuthTag(),ciphertext].map(x=>x.toString('base64url')).join('.');
}
export function unseal(value: string, k: Buffer): string{
 const p=String(value||'').split('.').map(x=>Buffer.from(x,'base64url'));
 if(p.length!==3||p[0].length!==12||p[1].length!==16)throw Error('Credencial inválida');
 const c=crypto.createDecipheriv('aes-256-gcm',k,p[0]);c.setAuthTag(p[1]);
 return Buffer.concat([c.update(p[2]),c.final()]).toString('utf8');
}
export function createGithubAppService(db: Firestore, {env=process.env,fetchImpl=fetch}: { env?: Record<string, string | undefined>; fetchImpl?: GithubFetch } = {}): GithubAppService{
 const col=db.collection('solaris_github_users'),settings=()=>config(env);
 const doc=(uid: string)=>col.doc(key(uid));
 const load=async (uid: string): Promise<ConnectionRecord | null>=>{const snap=await doc(uid).get();return snap.exists?snap.data() as ConnectionRecord:null;};
 const saveSession=(req: GithubOAuthRequest)=>new Promise<void>((yes,no)=>req.session.save(err=>err?no(err):yes()));
 async function token(uid: string){
  const cfg=settings(),record=await load(uid);
  if(!cfg.ready||!record?.encrypted||!(record.expires> Date.now()+30000))
   throw Error('Conecte novamente sua conta GitHub para continuar.');
  return {record,value:unseal(record.encrypted,cfg.key!)};
 }
 return {
  ready:()=>settings().ready,
  async status(uid: string){
   const row=await load(uid);
   return {configured:settings().ready,connected:settings().ready&&!!row?.encrypted&&row.expires>Date.now()+30000,
    account:row?.account||null,repository:row?.repository||null,installable:!!settings().installUrl,
    mcpEnabled:process.env.SOLARIS_GITHUB_MCP_ENABLED==='true'};
  },
  installUrl(){return settings().ready?settings().installUrl:null;},
  async listRepos(uid: string){const {value}=await token(uid);return listGithubRepositories(value,fetchImpl as unknown as GithubCatalogFetch);},
  async begin(req: GithubOAuthRequest){
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
  async finish(req: GithubOAuthRequest, {state,code}: { state: unknown; code: unknown }){
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
   const auth=await response.json() as OAuthResponse;
   if(typeof auth.access_token!=='string'||!auth.access_token||auth.error)
      throw Error('O GitHub não autorizou a conexão.');
   const me=await fetchImpl('https://api.github.com/user',{headers:{
     Authorization:'Bearer '+auth.access_token,Accept:'application/vnd.github+json'},
     signal:AbortSignal.timeout(12000)});
   if(!me.ok)throw Error('Falha ao validar conta GitHub.');
   const user=await me.json() as GithubUser;
   if(typeof user.login!=='string'||!/^[a-z0-9-]{1,39}$/i.test(user.login))
      throw Error('Conta GitHub inválida.');
   // Expiring user tokens de GitHub Apps, sem refresh automático.
   const expires=Date.now()+Math.min(8*3600,Number(auth.expires_in)||3600)*1000;
   await doc(req.session.user.uid).set({account:user.login,
     encrypted:seal(auth.access_token,cfg.key!),expires,repository:null,created:new Date().toISOString()});
   return user.login;
  },
  // Entrega um token somente à função server-side, sem expor para UI ou modelo.
  async withSelectedRepo<T>(uid: string, callback: (auth: GithubSelectedRepo) => Promise<T>): Promise<T>{
   const {record,value}=await token(uid);
   const repo=normalizarRepositorioGithub(record.repository);
   if(!repo || repo!==record.repository)throw Error('Vincule um repositório GitHub primeiro.');
   return callback({repository:repo,accessToken:value});
  },
  async repoContext(uid: string, url: string){
   const repo=normalizarRepositorioGithub(url);
   if(!repo)throw Error('Link GitHub inválido.');
   return this.withSelectedRepo(uid,async ({repository,accessToken})=>{
    if(repository.toLowerCase()!==repo.toLowerCase())throw Error('Selecione o repositório vinculado antes de consultar.');
    return contextoRepositorioPublico(repo,{token:accessToken,fetchImpl});
   });
  },
  async selectRepo(uid: string, url: string){
   const repo=normalizarRepositorioGithub(url);
   if(!repo)throw Error('Informe o link completo do repositório GitHub.');
   const {value}=await token(uid);
   await contextoRepositorioPublico(repo,{token:value,fetchImpl}); // exige acesso efetivo antes de salvar
   await doc(uid).update({repository:repo});
   return repo;
  },
  async disconnect(uid: string){await doc(uid).delete();}
 };
}
