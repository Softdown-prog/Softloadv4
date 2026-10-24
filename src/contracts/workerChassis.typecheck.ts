import { criarCarregadorChassis } from '../core/workerChassis';
import type { ChassisDependencies } from '../core/workerChassis';
const deps: ChassisDependencies = {
    workerDir: '/src/core',
    joinPath: (...parts) => parts.join('/'),
    readFileSync: () => 'x'.repeat(250),
    existsSync: () => false,
    chassisParaNicho: () => null,
    warn: () => undefined,
};
const read: (nichoTema: unknown) => string = criarCarregadorChassis(deps);
void read;
// @ts-expect-error retorno da leitura de arquivo deve ser string.
const bad: ChassisDependencies = { ...deps, readFileSync: () => 99 };
void bad;
// @ts-expect-error callback de aviso não pode ser substituído por número.
const badWarn: ChassisDependencies = { ...deps, warn: 3 };
void badWarn;
