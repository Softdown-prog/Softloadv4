'use strict';
// Diagnóstico temporário: exercita exatamente o fluxo público de geração de XML.
// Uma sessão nova de teste, um download gratuito; não faz pagamentos nem acessa contas.
const assert = require('node:assert/strict');
const ORIGIN = 'https://softload.analysepro.com';
async function req(path, options = {}) {
  const url = ORIGIN + path;
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
    headers: { 'Cache-Control': 'no-cache', ...(options.headers || {}) },
    ...options,
  });
  return response;
}
function classify(response) {
  return 'HTTP ' + response.status + ', content-type=' + (response.headers.get('content-type') || '-');
}
(async () => {
  const healthResponse = await req('/health?smoke=public-compiler');
  const h = await healthResponse.json();
  console.log('[LIVE] /health:', classify(healthResponse), 'sha=' + String(h.deploy?.gitSha || 'missing').slice(0,12), 'firestore=' + h.firestore);
  assert.equal(healthResponse.status, 200, '/health unreachable');
  const landing = await req('/');
  const landingHtml = await landing.text();
  console.log('[LIVE] /:', classify(landing), 'body bytes=' + landingHtml.length);
  assert.equal(landing.status,200,'Landing unavailable');
  const editor = await req('/criar');
  const editorHtml = await editor.text();
  console.log('[LIVE] /criar:', classify(editor), 'body bytes=' + editorHtml.length);
  assert.equal(editor.status,200,'Guest editor unavailable');
  const token = editorHtml.match(/name="guestToken"\s+value="([a-f\d]{48})"/);
  assert.ok(token,'Editor rendered without guest token');
  const setCookie = editor.headers.get('set-cookie') || '';
  const sessionCookie = setCookie.match(/(?:^|,\s*)(connect\.sid=[^;]+)/)?.[1] || setCookie.split(';')[0];
  assert.ok(/^connect\.sid=/.test(sessionCookie),'Editor has no session cookie');
  const form = new URLSearchParams({
    guestToken: token[1], modo:'novo', siteName:'Teste Smoke Softload',
    colorPreset:'tech-blue', typography:'inter', gridLayout:'revista',
    sidebarPosition:'right',
  });
  const compiled = await req('/criar/download', {
    method:'POST',
    headers: {
      'Origin':ORIGIN, 'Content-Type':'application/x-www-form-urlencoded',
      'Accept':'application/xml', 'Cookie':sessionCookie
    },
    body:form.toString(),
  });
  const content = await compiled.text();
  console.log('[LIVE] /criar/download:',classify(compiled),'response bytes='+content.length,
    'attachment='+Boolean(compiled.headers.get('content-disposition')));
  if(compiled.status !== 200) {
    const reason = content.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,220);
    throw new Error('Compilação pública falhou: HTTP '+compiled.status+'; mensagem='+reason);
  }
  assert.match(compiled.headers.get('content-type') || '', /xml/i,'Download not XML');
  assert.match(content, /(?:id=['"]Blog1['"])/, 'Missing Blogger Blog1 widget');
  assert.ok(content.length > 1000,'Suspiciously short compiled XML');
  console.log('[LIVE] Compilação real de XML Blogger aprovada; tamanho='+content.length);
})().catch(err => {
  console.error('[LIVE] TEST FAILED:',String(err.message||err).slice(0,350));
  process.exitCode=1;
});
