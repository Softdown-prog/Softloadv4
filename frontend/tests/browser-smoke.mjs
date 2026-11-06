// Browser integration smoke: the real Angular bundle served by the VPS-style
// Docker image. External persistence and payment calls are deliberately mocked:
// this never creates users, downloads from a paid quota, or starts a charge.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';

const origin=process.env.SOFTLOAD_BROWSER_URL||'http://127.0.0.1:18080';
const catalog={
  user:null, guestMode:true, guestToken:'a'.repeat(48),
  downloadPath:'/criar/download',
  cores:[
    {id:'tech-blue',nome:'Azul',hex:'#0ea5e9',bg:'#f8fafc',surface:'#ffffff',text:'#1e293b',footer:'#0f172a'},
    {id:'coral',nome:'Coral',hex:'#f87171',bg:'#ffffff',surface:'#fff7ed',text:'#1e293b',footer:'#0f172a'}
  ],
  fontes:[{id:'inter',nome:'Inter'},{id:'playfair',nome:'Playfair'}],
  nichos:[{id:'tecnologia-mag-tech',nome:'Tecnologia',pageType:'blogger-conteudo',aviso:'Blog de tecnologia'}],
  exemplos:[{id:'tech',nome:'Meu Blog Tech',categoria:'Tecnologia',nichoTema:'tecnologia-mag-tech',colorPreset:'tech-blue',typography:'inter',gridLayout:'revista',sidebarPosition:'right'}],
  checkoutEnabled:true,filesEnabled:false
};
// Compare actual bytes served by the Docker image with the files inspected by
// the independent SAC runner. Never infer equivalence from a green build alone.
const sacReport=process.env.SAC_REPORT_FILE
  ? JSON.parse(readFileSync(process.env.SAC_REPORT_FILE,'utf8')) : null;
const integrity=sacReport?.checks?.artifact_integrity;
if(process.env.SAC_REPORT_FILE){
  assert.equal(sacReport?.deployment_authorized,false);
  assert.equal(integrity?.status,'pending-runtime-comparison');
  assert.match(integrity?.index_sha256||'',/^[a-f0-9]{64}$/);
  assert.equal(integrity.resources.length,3,'expected Angular main, CSS and preview script');
}
async function verifySacArtifact(page){
  const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
  const checks=[{file:'',sha256:integrity.index_sha256},...integrity.resources];
  for(const {file,sha256} of checks){
    assert.ok(file===''||/^(?:main(?:-[a-zA-Z0-9]+)?\.js|styles(?:-[a-zA-Z0-9]+)?\.css|js\/blogger-preview\.js)$/.test(file),'unexpected artifact path');
    assert.match(sha256,/^[a-f0-9]{64}$/);
    const res=await page.request.get(origin+'/'+file,{failOnStatusCode:true});
    assert.equal(digest(await res.body()),sha256,'served Docker asset drifted from SAC-audited dist: '+file);
  }
  console.log('SAC_DOCKER_ARTIFACT_MATCH: index, Angular JS/CSS and procedural preview script');
}
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-sandbox']});
let checks=0;
try {
  for(const viewport of [{width:1366,height:860},{width:390,height:844}]){
    const mobile=viewport.width<600;
    const context=await browser.newContext({viewport,acceptDownloads:true,isMobile:mobile,hasTouch:mobile,deviceScaleFactor:mobile?2:1});
    const page=await context.newPage();
    const pageErrors=[];
    let fakeUser=null;
    page.on('pageerror',error=>pageErrors.push(error.message));

    await page.route('**/api/frontend/bootstrap',async route=>{
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({...catalog,user:fakeUser})});
    });
    await page.route('**/criar/download',async route=>{
      assert.equal(route.request().method(),'POST');
      const params=new URLSearchParams(route.request().postData()||'');
      assert.equal(params.get('guestToken'),catalog.guestToken);
      assert.equal(params.get('siteName'),'Blog de Teste Angular');
      await route.fulfill({
        status:200,
        headers:{'content-type':'application/xml; charset=utf-8','content-disposition':'attachment; filename="blog-teste.xml"'},
        body:'<?xml version="1.0" encoding="UTF-8"?>\n'+
             '<blogger><title>Browser smoke</title><body>'+('teste'.repeat(240))+'</body></blogger>'
      });
    });
    await page.route('**/dashboard/checkout-create',async route=>{
      assert.equal(route.request().method(),'POST');
      assert.deepEqual(JSON.parse(route.request().postData()||'{}'),
        {plano:'essencial',aceitePoliticaArmazenamento:true});
      await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({erro:'Checkout indisponível em homologação.'})});
    });

    // Public landing: navigation is handled by Angular, not EJS.
    let res=await page.goto(origin+'/',{waitUntil:'networkidle'});
    assert.equal(res?.status(),200,'landing HTTP 200');
    // Angular/Beasties injects a tiny media-restoration script during
    // critical CSS inlining. Verify its intended browser effect instead of
    // stripping it to trick the static SAC P001 rule into returning "pass".
    const cssState=await page.evaluate(()=>{
      const styles=[...document.querySelectorAll('link[rel="stylesheet"]')];
      return {
        leftoverBeastiesLinks:document.querySelectorAll('link[data-beasties-media]').length,
        angularStyles:styles.filter(el => /(?:^|\/)styles(?:-[A-Za-z0-9]+)?\.css(?:\?|$)/.test(el.getAttribute('href')||''))
          .map(el=>({media:el.media,loaded:el.sheet!==null,restored:!el.hasAttribute('data-beasties-media')}))
      };
    });
    assert.equal(cssState.leftoverBeastiesLinks,0,'Angular Beasties CSS media restoration did not complete');
    assert.ok(cssState.angularStyles.some(s=>s.loaded&&s.restored&&s.media!=='print'),
      'Angular stylesheet unavailable or media stuck in print mode');
    checks++;

    if(integrity&&viewport.width===1366){await verifySacArtifact(page);checks++;}
    await page.getByRole('heading',{name:/Um blog com a/i}).waitFor();
    await page.getByRole('link',{name:'Criar meu template'}).first().click();
    await page.waitForURL('**/criar');
    await page.getByRole('heading',{name:'Configurar template'}).waitFor();
    assert.equal(await page.getByRole('link',{name:'Plano Essencial'}).getAttribute('href'),'/planos');
    checks++;

    // The gallery selection updates form fields and the isolated iframe.
    await page.getByRole('button',{name:/Meu Blog Tech/}).click();
    // The editor uses OnPush and signals: assert settled DOM after render,
    // not the stale input value from the click's synchronous frame.
    await page.waitForFunction(() => {
      const input=document.querySelector('#siteName');
      const button=[...document.querySelectorAll('button')].find(
        b=>b.textContent?.includes('Meu Blog Tech'));
      return input instanceof HTMLInputElement &&
        input.value==='Meu Blog Tech' && button?.getAttribute('aria-pressed')==='true';
    });
    await page.locator('#siteName').fill('Blog de Teste Angular');
    await page.getByRole('button',{name:'Celular'}).click();
    await page.waitForFunction(()=>document.querySelector('.preview-window')?.getAttribute('data-device')==='mobile');
    await page.waitForFunction(()=>document.querySelector('.preview-window iframe')?.srcdoc?.includes('Blog de Teste Angular'));
    checks++;

    // Exercise XML download through Angular without consuming a real quota.
    const [download]=await Promise.all([
      page.waitForEvent('download',{timeout:15000}),
      page.getByRole('button',{name:'Gerar e baixar XML'}).click()
    ]);
    assert.equal(download.suggestedFilename(),'blog-teste.xml');
    await page.getByRole('link',{name:'Baixar XML novamente'}).waitFor();
    checks++;

    // Auth screens are real routed components; no Firebase request is made.
    await page.goto(origin+'/login');
    await page.getByRole('heading',{name:'Entrar',exact:true}).waitFor();
    assert.equal(await page.locator('form').getAttribute('action'),'/login');
    await page.goto(origin+'/register');
    await page.getByRole('heading',{name:'Criar conta',exact:true}).waitFor();
    assert.equal(await page.locator('form').getAttribute('action'),'/register');
    await page.goto(origin+'/recover');
    await page.getByRole('heading',{name:'Recuperar senha'}).waitFor();
    assert.equal(await page.locator('form').getAttribute('action'),'/recover');
    checks++;

    // Policies must be readable when Angular fetches the unchanged legal copy.
    await page.goto(origin+'/privacidade');
    await page.getByRole('heading',{name:'Política de Privacidade'}).waitFor();
    await page.goto(origin+'/termos-de-uso');
    await page.getByRole('heading',{name:'Termos de Uso'}).waitFor();
    checks++;

    // The real backend must deny private pages without a session.
    await page.goto(origin+'/dashboard');
    await page.waitForURL('**/login?**');
    await page.getByRole('heading',{name:'Entrar',exact:true}).waitFor();
    checks++;

    // Prices must have a public, refreshable URL; payment requires login.
    await page.goto(origin+'/');
    await page.getByRole('link',{name:'Conhecer o Essencial'}).click();
    await page.waitForURL('**/planos');
    await page.getByRole('link',{name:'Entrar ou criar conta para contratar'}).waitFor();
    let pricing=await page.goto(origin+'/planos');
    assert.equal(pricing?.status(),200,'public pricing URL must survive hard refresh');
    await page.getByRole('link',{name:'Entrar ou criar conta para contratar'}).waitFor();
    checks++;

    // Simulated authenticated UI: all checkout requests are intercepted.
    fakeUser={uid:'browser-only',nome:'Pessoa de Teste',email:'test@example.invalid',plano:'free'};
    await page.reload();
    const pay=page.getByRole('button',{name:/Continuar para pagamento/});
    assert.equal(await pay.isDisabled(),true,'consent is required');
    await page.getByRole('checkbox').check();
    // Signal-driven OnPush updates run on Angular's scheduled render tick.
    await page.waitForFunction(()=>[...document.querySelectorAll('button')]
      .some(b=>b.textContent?.includes('Continuar para pagamento')&&!b.disabled));
    assert.equal(await pay.isEnabled(),true);
    await pay.click();
    await page.getByText('Checkout indisponível em homologação.').waitFor();
    checks++;

    if(viewport.width===390){
      const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
      assert.ok(dimensions.scroll<=dimensions.width+2,
        'mobile horizontal overflow: '+JSON.stringify(dimensions));
      checks++;
    }
    assert.deepEqual(pageErrors,[],'Angular runtime console errors for '+viewport.width+'px');
    await context.close();
    console.log('BROWSER_SMOKE_OK: '+viewport.width+'px, 8 flows, no runtime exceptions');
  }
  console.log('BROWSER_SMOKE_OK_TOTAL: '+checks+' checks, XML/payment mocked, Express routes live');
  // Emit a single joined audit artifact ONLY after all browser assertions
  // pass. A static P001 "unverified" must stay "unverified"; this evidence
  // proves the scoped Docker asset identity and checked UI behaviors.
  if(sacReport){
    assert.ok(checks>=20,'expected desktop/mobile tests, critical CSS and artifact integrity');
    sacReport.checks.artifact_integrity.status='pass';
    sacReport.checks.p001.source_and_production_artifact_same=true;
    sacReport.checks.inline_scripts.browser_effect_verified=
      sacReport.checks.inline_scripts.status==='known-beasties-requires-browser';
    sacReport.browser_verified=true;
    sacReport.browser_evidence={
      status:'pass',checks,viewports:[1366,390],
      scope:'Angular UI, CSS activation, guest dashboard guard and Docker asset identity',
      guest_bootstrap_mocked:true,checkout_mocked:true,xml_download_mocked:true,
      android_physical_device_verified:false
    };
    assert.equal(sacReport.deployment_authorized,false,'SAC may not authorize deployment');
    writeFileSync(process.env.SAC_REPORT_FILE,JSON.stringify(sacReport,null,2)+String.fromCharCode(10),{mode:0o600});
    console.log('SAC_BROWSER_EVIDENCE: '+checks+' scoped checks passed, asset hashes identical, P001 remains '+sacReport.checks.p001.status);
  }

} finally {
  await browser.close();
}
