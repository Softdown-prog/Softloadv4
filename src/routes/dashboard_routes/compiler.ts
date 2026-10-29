'use strict';
declare const require: (id: string) => any;
declare const module: { exports: unknown };
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { exigirLogin } = require('../../middlewares/authGuard');
const { executarCompilacao } = require('../../core/compilerWorker');
const { validarXmlCompilado, validarXmlEstrutura, validarSemanticaBlogger } = require('../../core/xmlValidator');
const { COLOR_PRESETS, TYPOGRAPHY_PRESETS } = require('../../core/presets');
const { NICHO_PAGE_TYPE_MAP, PAGE_TYPES_SEM_CHASSIS_DEDICADO } = require('../../core/nichoTaxonomy');
const { db } = require('../../services/firebase');

const NICHO_NOMES: Readonly<Record<string, string>> = Object.freeze({
  'gamer-playerone': 'Games e reviews', 'pop-retro-pixel': 'Cultura pop e retrô',
  'culinaria-boutique-gourmet': 'Culinária e receitas', 'natureza-bulma-vegan': 'Vegano e natureza',
  'noticias-mag-news': 'Notícias e jornalismo', 'tecnologia-mag-tech': 'Tecnologia e análises',
  'tecnologia-techwind': 'Programação e tecnologia', 'viral-magazine': 'Revista e tendências',
  'saas-nexus': 'Software e negócios', 'brutalista-appcraft': 'Aplicativos e startups',
  'portfolio-minimalista': 'Portfólio minimalista', 'aquarela': 'Portfólio artístico',
  'biolink-social': 'Links e redes sociais', 'elearning-academy': 'Educação e cursos',
  'appstore-bulma-mobile': 'Catálogo de aplicativos'
});
const LAYOUTS = new Set(['lista','dupla','revista','quadrado','mural','coluna-unica','zigzag']);
const SIDEBARS = new Set(['right','left','none']);
const MAX_FREE_DOWNLOADS = 2;
const limite = rateLimit({windowMs:60000, limit:8, standardHeaders:'draft-8', legacyHeaders:false,
  message:'Muitas gerações em pouco tempo. Tente novamente mais tarde.'});

function catalogo() {
  return Object.keys(NICHO_PAGE_TYPE_MAP).sort((a,b) =>
    (NICHO_NOMES[a] || a).localeCompare(NICHO_NOMES[b] || b, 'pt-BR')
  ).map(id => ({
    id, nome:NICHO_NOMES[id] || id, pageType:NICHO_PAGE_TYPE_MAP[id],
    aviso: PAGE_TYPES_SEM_CHASSIS_DEDICADO.has(NICHO_PAGE_TYPE_MAP[id])
      ? 'Utiliza a estrutura de blog enquanto não há estrutura dedicada.' : null
  }));
}
function normalizar(body: any) {
  const nome = typeof body?.siteName === 'string' ? body.siteName.trim() : '';
  if(nome.length < 2 || nome.length > 60) throw new Error('Informe um nome com 2 a 60 caracteres.');
  const modo = body?.modo === 'modelo' ? 'modelo' : body?.modo === 'novo' ? 'novo' : null;
  if (!modo) throw new Error('Selecione como deseja começar: do zero ou a partir de um nicho.');
  const nicho = body?.nichoTema;
  if(modo === 'modelo' && (typeof nicho !== 'string' || !Object.hasOwn(NICHO_PAGE_TYPE_MAP,nicho)))
    throw new Error('Selecione um nicho válido do catálogo.');
  const cor = typeof body?.colorPreset === 'string' ? body.colorPreset : 'tech-blue';
  if(!Object.hasOwn(COLOR_PRESETS,cor)) throw new Error('A paleta de cor não é válida.');
  const grade = body?.gridLayout || 'revista';
  const barra = body?.sidebarPosition || 'right';
  const fonte = body?.typography || 'inter';
  if(!LAYOUTS.has(grade) || !SIDEBARS.has(barra) || !Object.hasOwn(TYPOGRAPHY_PRESETS,fonte))
    throw new Error('Uma das opções de layout, fonte ou barra lateral é inválida.');
  return {
    siteName:nome, nichoTema:modo==='modelo'?nicho:null, modo,
    colorPreset:cor, gridLayout:grade, sidebarPosition:barra, typography:fonte
  };
}
function compilarSemIa(body: any) {
  const op = normalizar(body);
  const { xmlFinal, slug } = executarCompilacao({
    siteName:op.siteName, nichoTema:op.nichoTema, colorPreset:op.colorPreset,
    gridLayout:op.gridLayout, sidebarPosition:op.sidebarPosition, typography:op.typography
  });
  const erros = [...validarXmlCompilado(xmlFinal), ...validarXmlEstrutura(xmlFinal).erros,
                 ...validarSemanticaBlogger(xmlFinal).erros];
  if(erros.length) throw new Error('O XML não passou nas verificações: '+erros.slice(0,3).join(' | '));
  if(!xmlFinal.includes("id='Blog1'") && !xmlFinal.includes('id="Blog1"'))
    throw new Error('O XML gerado não contém o widget obrigatório Blog1.');
  return {xmlFinal, slug, op};
}
async function debitarTesteGratuito(user: any) {
  const email = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : '';
  if(!email) throw new Error('Conta não identificada. Entre novamente.');
  const ref = db.collection('clientes_premium').doc(email);
  const hoje = Date.now();
  return db.runTransaction(async (tx: any) => {
    const snap = await tx.get(ref);
    const dados = snap.exists ? snap.data() || {} : {};
    const venc = Date.parse(dados.premium_ate || '');
    const pago = dados.is_active === true && Number.isFinite(venc) && venc >= hoje &&
      dados.plano !== 'free';
    if(pago) return {gratuito:false, restantes:null};
    const usado = Number.isSafeInteger(dados.gerador_sem_ia_testes_usados) &&
      dados.gerador_sem_ia_testes_usados >= 0 ? dados.gerador_sem_ia_testes_usados : 0;
    if(usado >= MAX_FREE_DOWNLOADS) {
      const err: any = new Error('Você já utilizou seus 2 downloads gratuitos. O plano de R$ 5 está sendo preparado.');
      err.status = 402;
      throw err;
    }
    tx.set(ref,{gerador_sem_ia_testes_usados:usado+1},{merge:true});
    return {gratuito:true, restantes:MAX_FREE_DOWNLOADS-usado-1};
  });
}
router.get('/dashboard/gerador-blogger', exigirLogin, (req: any,res: any) => {
  res.render('pages/gerador-blogger', {activePage:'gerador-blogger',user:req.session.user,
    nichos:catalogo(), cores:Object.entries(COLOR_PRESETS).map(([id,p]: any)=>({id,nome:p.label})),
    fontes:Object.entries(TYPOGRAPHY_PRESETS).map(([id,p]: any)=>({id,nome:p.label})),
    gratuitoLimite:MAX_FREE_DOWNLOADS});
});
router.post('/dashboard/gerador-blogger/download', exigirLogin, limite, async (req: any,res: any) => {
  const origin = req.get('origin');
  if(origin) {
    try { if(new URL(origin).host !== req.get('host')) return res.status(403).send('Origem não autorizada.'); }
    catch { return res.status(403).send('Origem inválida.'); }
  }
  let resultado: any;
  try {
    resultado = compilarSemIa(req.body);
  } catch(err: any) {
    return res.status(422).type('text/plain; charset=utf-8').send(err.message || 'Configuração inválida.');
  }
  try {
    await debitarTesteGratuito(req.session.user);
  } catch(err: any) {
    return res.status(err.status || 503).type('text/plain; charset=utf-8')
      .send(err.status===402?err.message:'Não foi possível verificar a cota de testes. Nenhum download foi cobrado.');
  }
  const filename = (resultado.slug || 'template').replace(/[^a-z0-9-]/g,'').slice(0,40) || 'template';
  return res.status(200).set({
    'Content-Type':'application/xml; charset=utf-8',
    'Content-Disposition':'attachment; filename="'+filename+'.xml"',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff'
  }).send(resultado.xmlFinal);
});
router.get('/dashboard/compiler', exigirLogin, (_req: any,res: any) => res.redirect(302,'/dashboard/gerador-blogger'));
router.get('/dashboard/compiler-blogger-xml', exigirLogin, (_req: any,res: any) => res.redirect(302,'/dashboard/gerador-blogger'));

const FORGE_PUBLIC_COMMANDS = new Set(['draw-graph','draw-recipe','run-workers','plan-plant','render-pixel-character','author-art','author-prop']);
const forgeLimiter = rateLimit({windowMs:15*60*1000,limit:2,standardHeaders:'draft-8',legacyHeaders:false,
  message:'Limite temporário do A7 Forge atingido. Tente novamente mais tarde.'});
const forgeRunning = new Set<string>();
function catalogoForge() {
  // O motor é usado diretamente; não chama Worker Agent, Solaris nem modelos de IA.
  const forge = require('../../../agent/forge/index.cjs');
  return forge.catalog().recipes.filter((r: any) => FORGE_PUBLIC_COMMANDS.has(r.command));
}
router.get('/dashboard/forge-2d', exigirLogin, (req: any,res: any) => {
  try {
    res.render('pages/forge-2d',{activePage:'forge-2d',user:req.session.user,
      receitas:catalogoForge().map((item: any)=>({id:item.recipeId,nome:item.id,comando:item.command}))});
  } catch (err: any) {
    console.error('[FORGE] Catálogo indisponível:',err.message);
    res.status(503).type('text/plain; charset=utf-8').send('O catálogo A7 Forge está indisponível.');
  }
});
router.post('/dashboard/forge-2d/download', exigirLogin, forgeLimiter, async (req: any,res: any) => {
  const origin = req.get('origin');
  if (origin) {
    try { if (new URL(origin).host !== req.get('host')) return res.status(403).send('Origem não autorizada.'); }
    catch { return res.status(403).send('Origem inválida.'); }
  }
  const email = typeof req.session.user?.email === 'string' ? req.session.user.email.trim().toLowerCase() : '';
  if (!email) return res.status(401).send('Entre novamente para gerar seu asset.');
  const selected = typeof req.body?.receita === 'string' ? req.body.receita : '';
  const item = catalogoForge().find((r: any)=>r.recipeId === selected);
  if (!item) return res.status(400).send('Escolha uma receita válida do catálogo A7 Forge.');
  // Consulta sempre o Firestore; uma sessão com plano vencido não habilita uso pago.
  let current: any;
  try {
    const snap = await db.collection('clientes_premium').doc(email).get();
    current = snap.exists ? snap.data() : null;
  } catch {
    return res.status(503).send('Não foi possível confirmar a assinatura.');
  }
  const expiry = Date.parse(current?.premium_ate || '');
  if (current?.is_active !== true || !Number.isFinite(expiry) || expiry <= Date.now() ||
      !['essencial','starter','start','pro','studio','premium'].includes(current?.plano)) {
    return res.status(402).send('O A7 Forge 2D está disponível para assinantes ativos. Consulte o plano Essencial.');
  }
  if (forgeRunning.has(email)) return res.status(429).send('Já existe uma geração em andamento para esta conta.');
  forgeRunning.add(email);
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'softload-a7-'));
  const cleanup = () => { try { fs.rmSync(dir,{recursive:true,force:true}); } catch {} };
  let streamStarted = false;
  try {
    const forge = require('../../../agent/forge/index.cjs');
    const output = await forge.render({id:'produto',command:item.command,recipeId:item.recipeId},{baseDir:dir});
    const files = Array.isArray(output.files) ? output.files : [];
    const root = path.resolve(dir,'assets','produto');
    const safeFiles = files.map((f: any)=>({name:f.caminho,absolute:path.resolve(dir,String(f.caminho||''))}))
      .filter((f: any)=>f.name.startsWith('assets/produto/') && f.absolute.startsWith(root+path.sep) && fs.statSync(f.absolute).isFile());
    if (!safeFiles.length) throw new Error('Nenhum arquivo gerado.');
    const archiver = require('archiver');
    const zip = archiver('zip',{zlib:{level:6}});
    zip.on('error',(err: any)=>{console.error('[FORGE] ZIP:',err.message);res.destroy(err);});
    res.once('close',cleanup);res.once('finish',cleanup);
    res.status(200).set({'Content-Type':'application/zip',
      'Content-Disposition':'attachment; filename="a7-forge-2d.zip"',
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    streamStarted=true;
    zip.pipe(res);
    safeFiles.forEach((f: any)=>zip.file(f.absolute,{name:path.relative(root,f.absolute).split(path.sep).join('/')}));
    await zip.finalize();
  } catch (err: any) {
    console.error('[FORGE] Falha ao gerar:',err.message);
    if (!streamStarted && !res.headersSent) {cleanup();return res.status(503).type('text/plain; charset=utf-8').send('Não foi possível gerar o asset. Escolha outra receita.');}
    if (!res.destroyed) res.destroy(err);
  } finally {
    forgeRunning.delete(email);
    if (!streamStarted) cleanup();
  }
});
module.exports = router;
export {};