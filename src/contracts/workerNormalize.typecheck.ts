import { normalizarModulosAtivos, normalizarBadgesCategoria } from '../core/workerNormalize';
import type { BadgeProcessado, NicheModuleDefaults } from '../core/workerNormalize';

const defaults: NicheModuleDefaults = { darkMode: true, menuType: 'offcanvas', contactFormTitle: 'Contato' };
const modules: Record<string, unknown> = normalizarModulosAtivos({ darkMode: false }, defaults);
const badges: BadgeProcessado[] = normalizarBadgesCategoria(['FPS', { nome: 'A', bg: '#abc' }]);
void modules;
void badges;
// @ts-expect-error Badge precisa conter nome e ambas as cores.
const invalidBadge: BadgeProcessado = { nome: 'FPS', bg: '#fff' };
void invalidBadge;
