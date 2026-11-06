import type { Example } from './api';

// Pure editor state; no browser API, Angular instance or mutable shared object.
export interface EditorFields {
  modo: 'novo' | 'modelo'; nichoTema: string; siteName: string;
  colorPreset: string; typography: string; gridLayout: string; sidebarPosition: string;
}
export const INITIAL_EDITOR_FIELDS: Readonly<EditorFields> = {
  modo:'novo', nichoTema:'', siteName:'Meu Blog Azul',
  colorPreset:'tech-blue', typography:'inter', gridLayout:'revista', sidebarPosition:'right'
};
export const GRID_LAYOUTS: readonly string[] = [
  'lista','dupla','revista','quadrado','mural','coluna-unica','zigzag'
];
export const SIDEBAR_POSITIONS: readonly string[] = ['left','right','none'];

export function fieldsFromExample(example: Example): EditorFields {
  return {
    modo:'modelo', nichoTema:example.nichoTema, siteName:example.nome,
    colorPreset:example.colorPreset||INITIAL_EDITOR_FIELDS.colorPreset,
    typography:example.typography||INITIAL_EDITOR_FIELDS.typography,
    gridLayout:example.gridLayout||INITIAL_EDITOR_FIELDS.gridLayout,
    sidebarPosition:example.sidebarPosition||INITIAL_EDITOR_FIELDS.sidebarPosition
  };
}

export interface EditorCatalog {
  colors: readonly string[]; fonts: readonly string[]; niches: readonly string[];
}
export function restoreEditorFields(current:EditorFields,raw:unknown,catalog:EditorCatalog):EditorFields {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return current;
  const previous=raw as Partial<EditorFields>;
  const next={...current};
  if(previous.modo==='novo'||previous.modo==='modelo')next.modo=previous.modo;
  if(typeof previous.siteName==='string'&&previous.siteName.trim().length>=2&&previous.siteName.length<=60)
    next.siteName=previous.siteName;
  if(typeof previous.nichoTema==='string'&&catalog.niches.includes(previous.nichoTema))
    next.nichoTema=previous.nichoTema;
  if(typeof previous.colorPreset==='string'&&catalog.colors.includes(previous.colorPreset))
    next.colorPreset=previous.colorPreset;
  if(typeof previous.typography==='string'&&catalog.fonts.includes(previous.typography))
    next.typography=previous.typography;
  if(typeof previous.gridLayout==='string'&&GRID_LAYOUTS.includes(previous.gridLayout))
    next.gridLayout=previous.gridLayout;
  if(typeof previous.sidebarPosition==='string'&&SIDEBAR_POSITIONS.includes(previous.sidebarPosition))
    next.sidebarPosition=previous.sidebarPosition;
  return next;
}
