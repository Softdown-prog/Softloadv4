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
