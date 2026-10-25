'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'../..');
const pages=[
  {name:'Especialista Blogger',file:'frontend/pages/Chat.tsx',endpoint:'/dashboard/chat/stream'},
  {name:'Solaris Code',file:'frontend/pages/Solaris.tsx',endpoint:'/dashboard/solaris/chat/stream'},
  {name:'Workspace',file:'frontend/pages/WorkspaceChat.tsx',endpoint:'/dashboard/workspace/chat/stream'},
];
const css=fs.readFileSync(path.join(root,'public/css/softload.css'),'utf8');

test('estilos responsivos e mobile-safe aplicados nos três chats',()=>{
  for(const selector of [
    '.sl-conversation__feed','.sl-conversation__content',
    '.sl-conversation__bubble--assistant','.sl-conversation__bubble--user',
    '.sl-conversation__composer','.sl-conversation__input.form-control',
    '.sl-conversation__send','.sl-conversation__avatar',
  ]) assert.ok(css.includes(selector),'Estilo ausente: '+selector);
  assert.match(css,/height:\s*calc\(100dvh\s*-\s*64px\)/);
  assert.match(css,/env\(safe-area-inset-bottom\)/);
  assert.match(css,/@media \(max-width:\s*767\.98px\)/);
  assert.match(css,/@media \(prefers-reduced-motion:\s*reduce\)/);
  const template=fs.readFileSync(path.join(root,'views/pages/react-test.ejs'),'utf8');
  assert.ok(template.includes('/css/softload.css'),'CSS não é servido pela página React');
});
test('Solaris, Blogger e Workspace mantêm integração SSE e controles acessíveis',()=>{
  for(const {name,file,endpoint} of pages){
    const source=fs.readFileSync(path.join(root,file),'utf8');
    for(const term of [
      'sl-conversation d-flex flex-column','sl-conversation__header','sl-conversation__feed',
      'sl-conversation__content','sl-conversation__who','sl-conversation__bubble',
      'sl-conversation__input','sl-conversation__send','sl-conversation__composer',
      'sl-conversation__suggestion','role="status" aria-live="polite"',
      'onClick={stopGeneration}', 'onSubmit={handleSend}',
      'e.nativeEvent.isComposing',
    ]) assert.ok(source.includes(term),name+' perdeu controle/estilo: '+term);
    assert.ok(source.includes(endpoint),name+' perdeu endpoint streaming');
    assert.ok(source.includes('parseSseJsonFrame'),name+' perdeu parser SSE');
    assert.ok(source.includes('onScroll={() =>'),name+' não acompanha posição do leitor');
    assert.ok(source.includes('shouldFollowRef.current = true'),name+' não volta ao fim no envio');
    assert.ok(source.includes('if (feed && shouldFollowRef.current) feed.scrollTop = feed.scrollHeight'),
      name+' ainda força a rolagem enquanto o usuário lê mensagens anteriores');
    assert.ok(!source.includes("scrollIntoView({ behavior: 'smooth' })"),
      name+' usa scroll global ao receber chunks');
  }
});
