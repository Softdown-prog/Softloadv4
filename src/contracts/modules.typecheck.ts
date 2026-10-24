import {
    resolverModulos, escolherIconeAutor, _DARK_MODE_VARIANTES,
    _BACK_TO_TOP_VARIANTES, PAGINATION_VARIANTES,
} from '../core/modules';
import type { ModuleOptions, ResolvedModuleSnippets } from '../core/modules';

const options: ModuleOptions = { darkMode: true, backToTop: true, cookieBanner: false, error404Theme: 'gamer' };
const result: ResolvedModuleSnippets = resolverModulos(options, 'meu-site');
const author: string = escolherIconeAutor('meu-site');
const menu: string = result['[[MOBILE_MENU_TYPE]]'];
const darkModes: string[] = _DARK_MODE_VARIANTES;
const top: string[] = _BACK_TO_TOP_VARIANTES;
const pagination: string[] = PAGINATION_VARIANTES;
void author;
void menu;
void darkModes;
void top;
void pagination;
