import test from 'node:test';
import assert from 'node:assert/strict';
import {INITIAL_EDITOR_FIELDS, GRID_LAYOUTS, SIDEBAR_POSITIONS, fieldsFromExample} from '../src/app/editor-state.ts';

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
