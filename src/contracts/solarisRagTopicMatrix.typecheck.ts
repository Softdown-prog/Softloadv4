import { TOPICOS, listarGrupos, listarTopicos, idParaTopico } from '../solaris/rag/ragTopicMatrix';
const matrix: Record<string, string[]> = TOPICOS;
const groups: string[] = listarGrupos();
const topics: string[] = listarTopicos('html5');
const identifier: string = idParaTopico('html5', 'forms');
void matrix;
void groups;
void topics;
void identifier;
