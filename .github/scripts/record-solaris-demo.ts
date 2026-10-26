// Grava o React real do Solaris com resposta SSE simulada localmente.
// Nenhum dado pessoal, API de IA, VPS ou rede externa é usado.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

const PUBLIC = resolve('public');
const OUTPUT = resolve(process.argv[2] || 'out/solaris-demo');
const QUESTION = "Por que const total: number = '42' dá erro no TypeScript?";
const tick = String.fromCharCode(96);
const ANSWER = [
  'O erro está no tipo de ' + tick + 'total' + tick + ': foi declarado como ',
  tick + 'number' + tick + ', mas recebeu uma ' + tick + 'string' + tick + '.\n\n',
  'A correção é:\n\n' + tick.repeat(3) + 'ts\nconst total: number = 42;\n' + tick.repeat(3) + '\n\n',
  'Se o valor vier como texto, converta com ' + tick + 'Number(valor)' + tick + '.'
].join('');
const mime: Record<string, string> = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
  '.ico': 'image/x-icon', '.html': 'text/html; charset=utf-8' };
const wait = ms => new Promise(done => setTimeout(done, ms));
function json(res: ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
async function streamDemo(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 4096) { json(res, { error: 'Requisição muito grande' }, 413); return; }
  }
  let data;
  try { data = JSON.parse(body); } catch { json(res, { error: 'JSON inválido' }, 400); return; }
  if (data.message !== QUESTION || data.tool !== 'none') {
    json(res, { error: 'Somente o roteiro de demonstração é aceito' }, 400); return;
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' });
  const send = value => res.write('data: ' + JSON.stringify(value) + '\n\n');
  send({ type: 'status', label: 'Analisando o código TypeScript...' });
  await wait(600);
  send({ type: 'status', label: 'Preparando a correção...' });
  await wait(550);
  for (const part of ANSWER.match(/.{1,17}/gs) || []) {
    if (res.destroyed) break;
    send({ type: 'chunk', text: part });
    await wait(350);
  }
  if (!res.destroyed) {
    send({ type: 'done', reply: ANSWER, sessionId: 'solaris-demo-local' });
    res.end();
  }
}
async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
    if (pathname === '/dashboard/solaris' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('<!doctype html><html lang="pt-BR" data-bs-theme="dark" data-theme="dark"><head>'
        + '<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<title>Solaris Code · demonstração local</title>'
        + '<link rel="stylesheet" href="/vendor/bootstrap/css/bootstrap.min.css">'
        + '<link rel="stylesheet" href="/css/softload.css"></head><body>'
        + '<div id="react-root"></div><script type="module" src="/dist/assets/main.js"></script></body></html>');
      return;
    }
    if (pathname === '/api/app-config') {
      json(res, { user: { nome: 'Demonstração', plano: 'studio', is_active: true } }); return;
    }
    if (pathname === '/api/ai-credits/v2') {
      json(res, { versao: 2, modo: 'ativo', cicloExpiraEm: '2026-12-31T23:59:59Z',
        saldo: { creditosDoCiclo: 600, creditosDisponiveis: 596, creditosConsumidos: 4,
          creditosReservados: 0, creditosExcedentes: 0, preliminar: true } }); return;
    }
    if (pathname === '/api/chat/sessions') { json(res, { sessions: [] }); return; }
    if (pathname === '/dashboard/solaris/github/status') {
      json(res, { connected: false, account: null, repository: null }); return;
    }
    if (pathname === '/dashboard/solaris/github/pending') {
      json(res, { state: 'none' }); return;
    }
    if (pathname === '/dashboard/solaris/visual-review/status') {
      json(res, { ok: false, enabled: false }); return;
    }
    if (pathname === '/dashboard/solaris/chat/stream' && req.method === 'POST') {
      await streamDemo(req, res); return;
    }
    if (req.method !== 'GET' || !/^\/(dist|vendor|css|fonts|favicon\.svg)(\/|$)/.test(pathname)) {
      json(res, { error: 'Rota não disponível' }, 404); return;
    }
    const absolute = resolve(PUBLIC, '.' + pathname);
    if (absolute !== PUBLIC && !absolute.startsWith(PUBLIC + sep)) {
      json(res, { error: 'Caminho inválido' }, 403); return;
    }
    const bytes = await readFile(absolute);
    res.writeHead(200, { 'Content-Type': mime[extname(absolute)] || 'application/octet-stream' });
    res.end(bytes);
  } catch { json(res, { error: 'Recurso não encontrado' }, 404); }
}
await mkdir(OUTPUT, { recursive: true });
const server = createServer(handler);
await new Promise(ready => server.listen(0, '127.0.0.1', ready));
const origin = 'http://127.0.0.1:' + server.address().port;
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1, recordVideo: { dir: OUTPUT, size: { width: 1280, height: 720 } },
    reducedMotion: 'reduce' });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { await route.abort(); return; }
    await route.continue();
  });
  await page.goto(origin + '/dashboard/solaris', { waitUntil: 'load', timeout: 20000 });
  await page.getByRole('heading', { name: /Solaris Code AI/i }).waitFor({ timeout: 20000 });
  await page.evaluate(() => {
    const label = document.createElement('div');
    label.textContent = 'DEMONSTRAÇÃO • RESPOSTA SIMULADA';
    label.style.cssText = 'position:fixed;right:14px;top:9px;z-index:9999;padding:7px 12px;'
      + 'border-radius:9px;background:rgba(15,23,42,.95);border:1px solid #38bdf8;'
      + 'color:#e2e8f0;font:600 11px system-ui;letter-spacing:.04em';
    document.body.append(label);
  });
  const input = page.getByPlaceholder('Fale com o Solaris...');
  await input.waitFor({ state: 'visible' });
  await wait(850);
  await input.pressSequentially(QUESTION, { delay: 70 });
  await wait(450);
  await page.getByRole('button', { name: 'Enviar mensagem' }).click();
  await page.locator('.sl-conversation__bubble--assistant').last()
    .getByText('Number(valor)', { exact: false }).waitFor({ timeout: 18000 });
  await wait(2400);
  if (pageErrors.length) throw new Error('Erro React: ' + pageErrors.join(' | '));
  await page.screenshot({ path: resolve(OUTPUT, 'solaris-demo-final.png'), fullPage: false });
  const video = page.video();
  const recorded = await video.path();
  await context.close();
  await rename(recorded, resolve(OUTPUT, 'solaris-demo-real-ui.webm'));
  await writeFile(resolve(OUTPUT, 'demo-manifest.json'), JSON.stringify({
    tipo: 'interface-real-com-respostas-simuladas', autenticacao: 'local-ficticia',
    custosDeIA: 0, redeExterna: false, pergunta: QUESTION,
    arquivos: ['solaris-demo-real-ui.webm', 'solaris-demo-final.png']
  }, null, 2) + '\n');
  console.log('Interface real gravada com streaming simulado, sem chamadas de IA.');
} finally {
  if (browser) await browser.close();
  await new Promise(done => server.close(done));
}
