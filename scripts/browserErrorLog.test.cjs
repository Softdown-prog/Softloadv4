'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/js/workers/w-errorlog.js'),'utf8');
function setup(provider) {
 const elements=new Map(),links=[];let calls=0;
 function element(id){if(!elements.has(id))elements.set(id,{innerHTML:'',style:{},className:'',textContent:'',scrollTop:0});return elements.get(id);}
 const win={_w:{
  el:element,
  setText:(id,value)=>{element(id).textContent=String(value)},
  esc:value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
 }};
 const document={querySelectorAll:()=>[],
   createElement:()=>({href:'',click(){links.push(this.href)}}),
   body:{appendChild(){},removeChild(){}}
 };
 vm.runInNewContext(source,{window:win,document,fetch:async(...args)=>{calls++;return provider(...args)},console}, {filename:'w-errorlog.js',timeout:1000});
 return {win,document,element,links,calls:()=>calls};
}
test('painel escapa conteúdo, calcula estatísticas e filtra sem nova solicitação',async()=>{
 const f=setup(async()=>({ok:true,json:async()=>({
  logs:[{level:'error',source:'GEMINI',message:'<script>alert(1)</script>',stack:'<stack>',ts:'2026-10-26T10:00:00Z'},
        {level:'warn',source:'NODE',message:'offline'}],
  stats:{total:2,byLevel:{error:1,warn:1},bySource:{GEMINI:1,NODE:1}}
 })}));
 await f.win.loadErrorLog();
 assert.equal(f.calls(),1);
 assert.match(f.element('errorLogEntries').innerHTML,/&lt;script&gt;/);
 assert.doesNotMatch(f.element('errorLogEntries').innerHTML,/<script>/);
 assert.equal(f.element('elTotal').textContent,'2');
 assert.equal(f.element('elWarns').textContent,'1');
 assert.match(f.element('errorLogSourceList').innerHTML,/source-chip--ai/);
 f.win.elToggleFilter('GEMINI');
 assert.match(f.element('errorLogEntries').innerHTML,/GEMINI/);
 assert.doesNotMatch(f.element('errorLogEntries').innerHTML,/offline/);
 assert.equal(f.calls(),1);
 f.win.elToggleFilter('GEMINI');
 assert.match(f.element('errorLogEntries').innerHTML,/offline/);
 f.win.downloadErrorLog('json');
 assert.deepEqual(f.links,['/workers/api/errors/download?format=json']);
});
test('painel deduplica solicitações pendentes e libera novo fetch após falha',async()=>{
 let release;const promise=new Promise(resolve=>{release=resolve});
 const f=setup(async()=>promise);
 const first=f.win.loadErrorLog();const next=f.win.loadErrorLog();
 assert.equal(f.calls(),1);await next;
 release({ok:false,status:503});await first;
 assert.match(f.element('errorLogEntries').innerHTML,/HTTP 503/);
 const third=f.win.loadErrorLog();await third;
 assert.equal(f.calls(),2);
});
