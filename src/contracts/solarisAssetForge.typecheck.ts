import * as Forge from '../solaris/tools/assetForge';
const list: { id: string; command: string; recipe: Record<string, unknown> }[] = Forge.validarAssets([
    { id: 'runtime', command: 'html5-runtime' },
]);
const requested: boolean = Forge.pedidoForge('Gere jogo HTML5');
const summary: string = Forge.contextoForge();
const schema: { type: string } = Forge.ASSET_SCHEMA;
const tools: { name: string }[] = Forge.FORGE_READ_TOOLS;
void list; void requested; void summary; void schema; void tools;
