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


test('retorno à mensagem mais recente aparece ao subir no histórico sem quebrar o streaming',()=>{
  for(const {name,file} of pages){
    const source=fs.readFileSync(path.join(root,file),'utf8');
    for(const term of [
      'sl-conversation__feed-shell',
      'showJumpToLatest && messages.length > 0',
      'setShowJumpToLatest(!nearBottom)',
      'onClick={scrollToLatest}',
      'aria-label="Ir para a mensagem mais recente"',
      'feed.scrollTop = feed.scrollHeight',
      'setShowJumpToLatest(false)',
      'sl-conversation__suggestions',
    ]) assert.ok(source.includes(term),name+' não implementou retorno ou sugestões: '+term);
  }
  for(const term of ['.sl-conversation__jump','.sl-conversation__feed-shell','.sl-conversation__suggestions']){
    assert.ok(css.includes(term),'CSS de melhoria visual ausente: '+term);
  }
});

test('ações dos três chats ficam em menu compacto com saída acessível',()=>{
  const shared=fs.readFileSync(path.join(root,'frontend/components/ChatHeaderActions.tsx'),'utf8');
  for(const selector of [
    'aria-label="Opções da conversa"',
    'aria-expanded={open}',
    "event.key === 'Escape'",
    "document.addEventListener('pointerdown', onOutside)",
    'Histórico','Nova conversa'
  ]) assert.ok(shared.includes(selector),'Menu do cabeçalho sem comportamento: '+selector);
  for(const {name,file} of pages){
    const source=fs.readFileSync(path.join(root,file),'utf8');
    assert.ok(source.includes('<ChatHeaderActions'),name+' não reutiliza menu');
    assert.ok(!source.includes('aria-label="Nova conversa"'),name+' ainda possui botão redundante');
    assert.ok(!source.includes('aria-label="Histórico"'),name+' ainda possui botão de histórico separado');
  }
  const solaris=fs.readFileSync(path.join(root,'frontend/pages/Solaris.tsx'),'utf8');
  for(const token of [
    'sl-conversation__actions-scope','sl-conversation__actions-popover',
    'sl-conversation__plus-button','aria-label="Abrir opções e ferramentas"',
    "event.key === 'Escape'",'setQuickMenuOpen(false)',
    'id="solaris-tools-panel"','Criar Assets 2D','Conectar GitHub'
  ]) assert.ok(solaris.includes(token),'Solaris perdeu opção de ferramenta: '+token);
  // Sandbox retirado da VPS: não mostrar upload de ZIP ou navegador desativados.
  for (const obsolete of [
    'Anexar projeto ZIP', 'Auditar visualmente um site',
    'handleFileUpload', 'handleVisualReview', 'fileInputRef',
    '/dashboard/solaris/upload', '/dashboard/solaris/visual-review',
  ]) assert.ok(!solaris.includes(obsolete),'Solaris ainda anuncia opção sem sandbox: '+obsolete);
  assert.ok(solaris.includes('m.zip.base64'),'Download de ZIP gerado não depende de extrator externo');
  assert.ok(solaris.includes('download={m.zip.nome}'),'Download de ZIP gerado deve permanecer');
  const originalPanelPosition=solaris.indexOf('sl-conversation__actions-popover');
  const chatFormPosition=solaris.indexOf('<form onSubmit={handleSend}',originalPanelPosition);
  assert.ok(originalPanelPosition>0 && chatFormPosition>originalPanelPosition,'Menu precisa ficar antes do formulário');
  for(const selector of ['.sl-conversation__head-popover','.sl-conversation__actions-popover',
    '.sl-conversation__plus-button','.sl-conversation__action-item']){
    assert.ok(css.includes(selector),'CSS do menu ausente: '+selector);
  }
});

// O Solaris usa TypeScript; nunca rotular um bloco ts como CSS por autodetecção.
test('blocos de código TypeScript preservam linguagem e rótulo na conversa', () => {
  const source = fs.readFileSync(path.join(root, 'frontend/components/CodeBlock.tsx'), 'utf8');
  assert.match(source, /registerLanguage\('ts', typescript\)/);
  assert.match(source, /registerLanguage\('typescript', typescript\)/);
  assert.match(source, /ts: 'TypeScript'/);
  assert.match(source, /typescript: 'TypeScript'/);
});


test('Solaris e Blogger separam seleção de histórico e exclusão em botões irmãos',()=>{
  for (const file of ['frontend/pages/Chat.tsx','frontend/pages/Solaris.tsx']) {
    const source=fs.readFileSync(path.join(root,file),'utf8');
    const row=source.slice(source.indexOf('sl-conversation__history-row'));
    assert.ok(row.includes('aria-label={`Abrir conversa: ${title}`}'),file);
    assert.ok(row.includes('aria-label={`Excluir conversa: ${title}`}'),file);
    assert.ok(row.includes("aria-current={sessionId === s.sessionId ? 'page' : undefined}"),file);
    assert.ok(row.indexOf('</button>') < row.indexOf('className="sl-conversation__history-delete'),file);
    assert.doesNotMatch(row,/role="button"|tabIndex={0}|onKeyDown=\{\(e\) =>/);
    assert.ok(source.includes('sl-conversation__history-drawer'),file);
  }
  for(const selector of ['.sl-conversation__history-row','.sl-conversation__history-select',
    '.sl-conversation__history-delete','.sl-conversation__credit']) {
    assert.ok(css.includes(selector),selector);
  }
});
test('cabeçalhos dos dois chats são compactos e rotulam seus créditos',()=>{
  const solaris=fs.readFileSync(path.join(root,'frontend/pages/Solaris.tsx'),'utf8');
  const blogger=fs.readFileSync(path.join(root,'frontend/pages/Chat.tsx'),'utf8');
  assert.ok(solaris.includes('Solaris Code</span>'));
  assert.doesNotMatch(solaris,/>v3 IA</);
  assert.ok(solaris.includes("aria-label={saldoFonte === 'indisponivel'"));
  assert.ok(blogger.includes('Créditos Gemini disponíveis:'));
  assert.ok(solaris.includes('sl-conversation__heading'));
  assert.ok(blogger.includes('sl-conversation__heading'));
});
