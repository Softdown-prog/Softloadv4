/**
 * Motor do A7 Forge servido diretamente pelo app, sem Worker Agent ou LLM.
 * O arquivo forgeStandalone.cjs preserva o runtime CommonJS do servidor.
 */
import type { Firestore } from 'firebase-admin/firestore';
import type { ForgeTask } from '../../../agent/forge/index';
import type { ForgeFileDescriptor } from '../../../agent/forge/index';
declare const require: (moduleName: string) => any;
interface ForgeRecipeEntry { recipeId: string; command: string | null; id: string }
interface ForgeUser { email?: string }
interface ForgeRequest {
  session: {user?: ForgeUser};
  body?: { receita?: unknown };
  get(header: string): string | undefined;
}
interface ForgeResponse {
  status(code: number): ForgeResponse;
  send(body: string): ForgeResponse;
  type(contentType: string): ForgeResponse;
  render(view: string, locals: Record<string, unknown>): unknown;
  set(headers: Record<string, string>): ForgeResponse;
  once(event: string, listener: () => void): ForgeResponse;
  destroy(err?: Error): void;
  headersSent?: boolean;
  destroyed?: boolean;
}
interface ForgeAPI {
  catalog(): {recipes: ForgeRecipeEntry[]};
  render(task: ForgeTask, options: {baseDir: string}): Promise<{files: Array<ForgeFileDescriptor | {caminho: string}>}>;
}
interface ForgeAccount {
  plano?: string;
  is_active?: boolean;
  premium_ate?: string;
}
const fs = require('node:fs') as typeof import('node:fs');
const path = require('node:path') as typeof import('node:path');
const os = require('node:os') as typeof import('node:os');
const {db} = require('../../services/firebase') as {db: Firestore};
const ALLOWED = new Set(['draw-graph','draw-recipe','run-workers','plan-plant','render-pixel-character','author-art','author-prop']);
const running = new Set<string>();
const forge = (): ForgeAPI => require('../../../agent/forge/index.cjs') as ForgeAPI;
function catalog(): ForgeRecipeEntry[] {
  return forge().catalog().recipes.filter(r => r.command !== null && ALLOWED.has(r.command));
}
export function show(req: ForgeRequest, res: ForgeResponse): void {
  try {
    const receitas = catalog().map(r => ({id:r.recipeId,nome:r.id,comando:r.command}));
    res.render('pages/forge-2d',{activePage:'forge-2d',user:req.session.user,receitas});
  } catch(error) {
    console.error('[A7] Catálogo indisponível:',(error as Error).message);
    res.status(503).type('text/plain; charset=utf-8').send('O catálogo A7 Forge está indisponível.');
  }
}
export async function download(req: ForgeRequest, res: ForgeResponse): Promise<unknown> {
  const origin = req.get('origin');
  if (origin) {
    try { if(new URL(origin).host !== req.get('host')) return res.status(403).send('Origem não autorizada.'); }
    catch { return res.status(403).send('Origem inválida.'); }
  }
  const email = typeof req.session.user?.email === 'string' ? req.session.user.email.trim().toLowerCase() : '';
  if (!email) return res.status(401).send('Entre novamente para gerar seu asset.');
  const selected = typeof req.body?.receita === 'string' ? req.body.receita : '';
  const item = catalog().find(r=>r.recipeId===selected);
  if(!item || !item.command || !ALLOWED.has(item.command))
    return res.status(400).send('Escolha uma receita válida do A7 Forge.');
  let account: ForgeAccount | null = null;
  try {
    const snap = await db.collection('clientes_premium').doc(email).get();
    account = snap.exists ? (snap.data() as ForgeAccount) : null;
  } catch {
    return res.status(503).send('Não foi possível confirmar sua assinatura.');
  }
  const expiry = Date.parse(account?.premium_ate || '');
  if(account?.is_active!==true || !Number.isFinite(expiry) || expiry<=Date.now() ||
    !['essencial','starter','start','pro','studio','premium'].includes(account.plano || ''))
    return res.status(402).send('A7 Forge disponível para assinantes ativos.');
  if(running.has(email)) return res.status(429).send('Já existe uma geração em andamento.');
  running.add(email);
  let dir: string | null = null;
  let streamed = false;
  const cleanup = (): void => {if(dir){try{fs.rmSync(dir,{recursive:true,force:true});}catch{/* already gone */}}};
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(),'softload-a7-'));
    const result = await forge().render({id:'produto',command:item.command as ForgeTask['command'],recipeId:item.recipeId} as ForgeTask,{baseDir:dir});
    const root = path.resolve(dir,'assets','produto');
    const files = (Array.isArray(result.files) ? result.files : []).map(file => ({
      name:file.caminho, absolute:path.resolve(dir as string,String(file.caminho||''))
    })).filter(file => typeof file.name === 'string' && file.name.startsWith('assets/produto/') &&
      file.absolute.startsWith(root+path.sep) && fs.existsSync(file.absolute) && fs.statSync(file.absolute).isFile());
    if(!files.length) throw new Error('Nenhum asset foi criado');
    const zip = require('archiver')('zip',{zlib:{level:6}}) as {
      on(event:string,handler:(e:Error)=>void):unknown;
      pipe(stream:ForgeResponse):unknown;
      file(file:string,options:{name:string}):unknown;
      finalize():Promise<void>;
    };
    zip.on('error',error=>{console.error('[A7] ZIP',error.message);res.destroy(error);});
    res.once('close',cleanup);res.once('finish',cleanup);
    res.status(200).set({'Content-Type':'application/zip',
      'Content-Disposition':'attachment; filename="a7-forge-2d.zip"',
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    streamed = true;
    zip.pipe(res);
    for(const file of files) zip.file(file.absolute,{name:path.relative(root,file.absolute).split(path.sep).join('/')});
    await zip.finalize();
  } catch(error) {
    console.error('[A7] Falha ao gerar:',(error as Error).message);
    if(!streamed&&!res.headersSent){cleanup();return res.status(503).type('text/plain; charset=utf-8').send('Falha ao gerar. Tente outra receita.');}
    if(!res.destroyed) res.destroy(error as Error);
  } finally {
    running.delete(email);
    if(!streamed)cleanup();
  }
}
