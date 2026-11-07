/** Decision-only authorization used by Express handlers and opt-in Nest Guards. */
interface AccessUser { email?: unknown; is_super_admin?: unknown; [key:string]: unknown }
interface AccessRequest {
  path?: string;
  session?: { user?: AccessUser | null } | null;
  get?: (header:string) => string | undefined;
}
type AccessScope='session'|'admin'|'worker';
const WORKER_EMAIL='softloady@gmail.com';

function wantsJson(req:AccessRequest|null|undefined):boolean {
  if(typeof req?.path==='string' && req.path.startsWith('/api/'))return true;
  const get=typeof req?.get==='function' ? req.get.bind(req) : () => '';
  return String(get('accept')||'').toLowerCase().includes('application/json') ||
    String(get('x-requested-with')||'').toLowerCase()==='xmlhttprequest';
}
function decideAccess(scope:AccessScope,req:AccessRequest|null|undefined) {
  if(!['session','admin','worker'].includes(scope))throw new TypeError('Unknown access scope');
  const user=req?.session?.user;
  if(scope==='session')return user ? {allow:true} :
    {allow:false,reason:'session-required',transport:wantsJson(req)?'json':'navigation'};
  if(scope==='admin')return {allow:user?.is_super_admin===true,reason:'not-found'};
  return {allow:typeof user?.email==='string' &&
    user.email.toLowerCase()===WORKER_EMAIL,reason:'not-found'};
}
declare const module:{exports:unknown};
module.exports={decideAccess,wantsJson};
export {};
