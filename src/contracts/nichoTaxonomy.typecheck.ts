import {
 NICHO_PAGE_TYPE_MAP, NICHO_CHASSIS_MAP, PAGE_TYPES_VALIDOS, PAGE_TYPES_SEM_CHASSIS_DEDICADO,
 pageTypeParaNicho, chassisParaNicho,
} from '../core/nichoTaxonomy';
const page: string | null = pageTypeParaNicho('tecnologia-techwind');
const chassis: string | null = chassisParaNicho(null);
const pageMap: Record<string,string> = NICHO_PAGE_TYPE_MAP;
const chassisMap: Record<string,string> = NICHO_CHASSIS_MAP;
const all: Set<string> = PAGE_TYPES_VALIDOS;
const pending: Set<string> = PAGE_TYPES_SEM_CHASSIS_DEDICADO;
void page;void chassis;void pageMap;void chassisMap;void all;void pending;
// @ts-expect-error lookup é string|null.
const bad: number = chassisParaNicho('aquarela');
void bad;
// @ts-expect-error o mapa contém strings, não números.
const badMap: Record<string, number> = NICHO_CHASSIS_MAP;
void badMap;
