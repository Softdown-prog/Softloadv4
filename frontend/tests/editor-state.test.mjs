import test from 'node:test';
import assert from 'node:assert/strict';
import {INITIAL_EDITOR_FIELDS, GRID_LAYOUTS, SIDEBAR_POSITIONS, fieldsFromExample, restoreEditorFields} from '../src/app/editor-state.ts';

test('editor presets preserve defaults and produce independent states',()=>{
  const first=fieldsFromExample({id:'one',nome:'Meu Blog',nichoTema:'tecnologia'});
  assert.equal(first.modo,'modelo');
  assert.equal(first.siteName,'Meu Blog');
  assert.equal(first.nichoTema,'tecnologia');
  assert.equal(first.colorPreset,INITIAL_EDITOR_FIELDS.colorPreset);
  assert.equal(first.typography,INITIAL_EDITOR_FIELDS.typography);
  assert.equal(first.gridLayout,INITIAL_EDITOR_FIELDS.gridLayout);
  assert.equal(first.sidebarPosition,INITIAL_EDITOR_FIELDS.sidebarPosition);
  first.siteName='Personalizado';
  assert.equal(INITIAL_EDITOR_FIELDS.siteName,'Meu Blog Azul');
  assert.equal(fieldsFromExample({id:'one',nome:'Meu Blog',nichoTema:'tecnologia'}).siteName,'Meu Blog');
});
test('gallery example overrides layout and color without mutating defaults',()=>{
  const state=fieldsFromExample({
    id:'two',nome:'Galeria',nichoTema:'fotos',colorPreset:'coral',
    typography:'playfair',gridLayout:'mural',sidebarPosition:'left'
  });
  assert.equal(state.colorPreset,'coral');
  assert.equal(state.typography,'playfair');
  assert.equal(state.gridLayout,'mural');
  assert.equal(state.sidebarPosition,'left');
  assert.ok(GRID_LAYOUTS.includes(state.gridLayout));
  assert.ok(SIDEBAR_POSITIONS.includes(state.sidebarPosition));
  assert.equal(INITIAL_EDITOR_FIELDS.gridLayout,'revista');
  assert.equal(INITIAL_EDITOR_FIELDS.sidebarPosition,'right');
});

test('saved editor fields restore together, including site name and niche',()=>{
  const current={...INITIAL_EDITOR_FIELDS,nichoTema:'niche-one'};
  const catalog={colors:['tech-blue','coral'],fonts:['inter','playfair'],niches:['niche-one','niche-two']};
  const next=restoreEditorFields(current,{
    modo:'modelo',nichoTema:'niche-two',siteName:'Minha revista',
    colorPreset:'coral',typography:'playfair',gridLayout:'zigzag',sidebarPosition:'none'
  },catalog);
  assert.deepEqual(next,{
    modo:'modelo',nichoTema:'niche-two',siteName:'Minha revista',
    colorPreset:'coral',typography:'playfair',gridLayout:'zigzag',sidebarPosition:'none'
  });
  assert.equal(current.siteName,'Meu Blog Azul');
  assert.equal(current.nichoTema,'niche-one');
});
test('saved settings reject unknown values and malformed localStorage data',()=>{
  const current={...INITIAL_EDITOR_FIELDS,nichoTema:'valid'};
  const catalog={colors:['tech-blue'],fonts:['inter'],niches:['valid']};
  const next=restoreEditorFields(current,{
    modo:'other',nichoTema:'unknown',siteName:'x',
    colorPreset:'from-another-user',typography:'unknown',gridLayout:'whatever',sidebarPosition:'invalid'
  },catalog);
  assert.deepEqual(next,current);
  assert.deepEqual(restoreEditorFields(current,[],catalog),current);
  assert.deepEqual(restoreEditorFields(current,null,catalog),current);
  assert.deepEqual(restoreEditorFields(current,'oops',catalog),current);
});
