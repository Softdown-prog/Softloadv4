/**
 * Softload v4 x Data_libray SAC — execution in disposable GitHub Actions.
 * Never imports/evaluates app sources, invokes payments, changes the VPS or
 * treats an observational SAC "unverified" as deployment approval.
 *
 * Trusted operator supplies the pinned Data_libray checkout in .sac-tools/.
 * The Angular build is separately performed by the first-party Angular CLI.
 */
import assert from 'node:assert/strict';
import {mkdtemp, readdir, lstat, readFile, mkdir, copyFile, cp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const app=path.join(root,'frontend');
const sourceRoot=path.join(app,'src');
const dist=path.join(app,'dist','softload','browser');
const toolsRoot=path.join(root,'.sac-tools');
const requiredCommit='97d5ae71844b56cfb073b5202c2f32398e9d532a';
const reportPath=process.env.SAC_REPORT_FILE||path.join(os.tmpdir(),'softload-sac-audit.json');
const require=createRequire(path.join(app,'package.json'));
const ts=require('typescript');
const ng=await import(pathToFileURL(require.resolve('@angular/compiler')).href);
const {analyzeImportGraph}=await import(pathToFileURL(path.join(toolsRoot,'packages/angular-precompiler/src/dependency-graph.mjs')).href);
const {analyzeAngularComponentWiring}=await import(pathToFileURL(path.join(toolsRoot,'packages/angular-precompiler/src/component-wiring.mjs')).href);
const {inspectAngularTemplateLinks}=await import(pathToFileURL(path.join(toolsRoot,'packages/angular-precompiler/src/template-links.mjs')).href);
const {inspectAngularTemplateBindings}=await import(pathToFileURL(path.join(toolsRoot,'packages/angular-precompiler/src/template-binding-evidence.mjs')).href);
const {verify}=await import(pathToFileURL(path.join(toolsRoot,'packages/angular-postcompiler/src/index.mjs')).href);

const safeRead=async (filename,limit)=>{
  const stat=await lstat(filename);
  assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=limit,'sac-nonregular-or-oversized');
  return readFile(filename,'utf8');
};
const gitLog=(await import('node:child_process')).execFileSync;
const version=gitLog('git',['-C',toolsRoot,'rev-parse','HEAD'],{encoding:'utf8',timeout:10000}).trim();
assert.equal(version,requiredCommit,'SAC toolchain checkout is not pinned to expected revision');
const files=[],templates=[];
let total=0,dirs=0;
async function collect(dir){
  assert.ok(++dirs<=128,'SAC source directory limit reached');
  for(const item of (await readdir(dir,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    assert.ok(!item.isSymbolicLink(),'SAC source symlink rejected');
    const absolute=path.join(dir,item.name);
    if(item.isDirectory()){await collect(absolute);continue;}
    assert.ok(item.isFile(),'SAC special file rejected');
    if(!/\.(?:tsx?|html)$/.test(item.name))continue;
    const source=await safeRead(absolute,512*1024);
    total+=Buffer.byteLength(source,'utf8');
    assert.ok(total<=2*1024*1024,'SAC total source bytes exceeded');
    const rel=path.relative(app,absolute).split(path.sep).join('/');
    assert.ok(rel.startsWith('src/')&&!rel.includes('..'),'SAC source escaped frontend/src');
    if(/\.tsx?$/.test(rel))files.push({path:rel,source});
    else templates.push({path:rel,source});
    assert.ok(files.length<=128&&templates.length<=128,'SAC source inventory exceeded');
  }
}
await collect(sourceRoot);
assert.ok(files.length>=4,'SAC did not enumerate Angular sources');

const findings=arr=>Object.fromEntries(
  arr.reduce((m,x)=>m.set(x.code,(m.get(x.code)||0)+1),new Map()));
const report={
  schema_version:1,
  project:'Softdown-prog/Softloadv4',
  tool:'Softdown-prog/Data_libray',
  tool_sha:requiredCommit,
  source_sha:process.env.GITHUB_SHA||'local-unverified',
  source_ts_files:files.length,
  source_html_files:templates.length,
  deployment_authorized:false,
  checks:{}
};
const wiring=analyzeAngularComponentWiring({files,typescript:ts});
report.checks.pre003={
  status:wiring.status,components_checked:wiring.components_checked,
  finding_codes:findings(wiring.findings),aot_verified:false
};
const links=inspectAngularTemplateLinks({files,templates,typescript:ts});
report.checks.pre004={
  status:links.status,
  external_templates_linked:links.external_templates_linked,
  inline_templates_observed:links.inline_templates_observed,
  finding_codes:findings(links.findings),aot_verified:false
};
const bindings=inspectAngularTemplateBindings({files,templates,typescript:ts,angularCompiler:ng});
report.checks.pre005={
  status:bindings.status,templates_total_parsed:bindings.templates_total_parsed,
  inline_templates_not_inspected:bindings.inline_templates_not_inspected,
  template_parser_error_count:bindings.template_parser_error_count,
  potential_event_handlers_not_declared_locally:bindings.potential_event_handlers_not_declared_locally,
  potential_property_bindings_not_declared_locally:bindings.potential_property_bindings_not_declared_locally,
  potential_interpolation_members_not_declared_locally:bindings.potential_interpolation_members_not_declared_locally,
  finding_codes:findings(bindings.findings),aot_verified:false
};
const graph=analyzeImportGraph({
  files,typescript:ts,policy:{
    layers:[{name:'frontend',prefix:'src/'}],
    allowImports:{frontend:['frontend']},
    external:['@angular/','rxjs','tslib']
  }
});
report.checks.pre002={
  status:graph.status,edges:graph.edges.length,
  finding_codes:findings(graph.findings),scope:graph.scope
};
// Postflight checks compiled Angular output + the static JS that the same
// Dockerfile copies from public/ into the public origin in production.
const stage=await mkdtemp(path.join(os.tmpdir(),'softload-sac-stage-'));
try{
  await cp(dist,stage,{recursive:true,force:false,errorOnExist:false});
  await mkdir(path.join(stage,'js'),{recursive:true});
  await copyFile(path.join(root,'public/js/blogger-preview.js'),path.join(stage,'js/blogger-preview.js'));
  const html=await safeRead(path.join(stage,'index.html'),2*1024*1024);
  // Diagnose executable inline scripts without publishing their source.
  // A script lacking src cannot be certified by P001 static checks.
  const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const inline=scripts.filter(([,attrs,body])=>
    !/\bsrc\s*=/.test(attrs)&&
    !/\btype\s*=\s*["']application\/(?:ld\+)?json["']/.test(attrs)&&
    body.trim().length>0);
  report.checks.html_script_inventory={
    inline_executable_count:inline.length,
    external_script_count:scripts.length-inline.length,
    inline_lengths:inline.map(([,attrs,body])=>Buffer.byteLength(body,'utf8'))
  };
  console.log('SAC_HTML_SCRIPT_INVENTORY '+JSON.stringify(report.checks.html_script_inventory));
  const assets=await readdir(stage);
  const mains=assets.filter(n=>/^main(?:-[a-zA-Z0-9]+)?\.js$/.test(n));
  const styles=assets.filter(n=>/^styles(?:-[a-zA-Z0-9]+)?\.css$/.test(n));
  assert.equal(mains.length,1,'Expected exactly one Angular main bundle');
  assert.equal(styles.length,1,'Expected exactly one Angular styles bundle');
  assert.ok(html.includes(mains[0])&&html.includes(styles[0]),'Angular entrypoints not referenced by index');
  // Bind the audited dist to the *actual* Docker-served application in the
  // independent Chrome test. A pass is not assigned until hashes match.
  const digest=async file=>{
    const target=path.join(stage,file),stat=await lstat(target);
    assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>0&&stat.size<=16*1024*1024,
      'SAC artifact integrity input is unsafe');
    return createHash('sha256').update(await readFile(target)).digest('hex');
  };
  report.checks.artifact_integrity={
    status:'pending-runtime-comparison',
    index_sha256:await digest('index.html'),
    resources:await Promise.all([mains[0],styles[0],'js/blogger-preview.js']
      .map(async file=>({file,sha256:await digest(file)})))
  };
  const result=await verify(stage,{
    schema_version:1,index:'index.html',angular_host:'sl-root',
    mode:'angular-only',angular_entrypoints:mains,assets:styles,
    legacy_react_entrypoints:['legacy-react.js']
  });
  if(result.status!=='pass')console.error('SAC-P001-DIAGNOSTIC',JSON.stringify(
    result.evidence.filter(x=>x.status!=='pass').map(x=>({assertion:x.assertion,status:x.status,
      message:typeof x.message==='string'?x.message.slice(0,160):null}))));
  report.checks.p001={
    status:result.status,
    evidence:result.evidence.map(x=>({assertion:x.assertion,status:x.status})),
    source_and_production_artifact_same:false
  };
}finally{await rm(stage,{recursive:true,force:true});}

// Observational findings are never promoted to a universal pass. A proven
// structural issue, parser error, or failed dist gate blocks the PR.
const suspicious=bindings.potential_event_handlers_not_declared_locally+
  bindings.potential_property_bindings_not_declared_locally+
  bindings.potential_interpolation_members_not_declared_locally;
const provenFail=['pre002','pre003'].some(x=>report.checks[x].status==='fail')||
  bindings.template_parser_error_count>0||
  ['fail','infra-error'].includes(report.checks.p001.status);
report.status=provenFail?'fail':(
  suspicious>0||report.checks.p001.status!=='pass'
    ?'needs-review':'observed');
report.browser_verified=false; // separate Playwright job
report.aot_verified_separately=Boolean(process.env.SAC_ANGULAR_BUILD_PASSED==='true');
report.scope='static-components-templates-imports-and-generated-dist';
await writeFile(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'w',mode:0o600});
console.log('SAC_SOFTLOAD_REPORT '+JSON.stringify(report));
if(provenFail)process.exitCode=1; // SAC unverified is never promoted to pass.
