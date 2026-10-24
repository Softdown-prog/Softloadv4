"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FORGE_READ_TOOLS = exports.ASSET_SCHEMA = void 0;
exports.validarAssets = validarAssets;
exports.contextoForge = contextoForge;
exports.pedidoForge = pedidoForge;
exports.executarLeituraForge = executarLeituraForge;
// A single bundle is shared by the web pipeline and the Worker Agent. Keeping
// recipes beside their source libraries preserves the upstream relative paths.
const forge = require('../../../agent/forge/index.cjs');
const { COMMANDS } = require('../../../agent/forge/catalog.cjs');
exports.ASSET_SCHEMA = {
    type: 'OBJECT', required: ['id', 'command'],
    properties: {
        id: { type: 'STRING', description: 'Unique lowercase asset bundle id; exported under assets/<id>/.' },
        command: { type: 'STRING', enum: COMMANDS },
        recipeId: { type: 'STRING', description: 'Existing recipeId from the Forge catalog. Omit when using receitaJson or html5-runtime.' },
        receitaJson: { type: 'STRING', description: 'Complete JSON recipe with a supported contract; never Python, shell or JavaScript. Use instead of recipeId.' },
    },
};
function validarAssets(raw) {
    if (raw === undefined)
        return [];
    if (!Array.isArray(raw) || raw.length > 12)
        throw new Error('assets deve ser uma lista de no máximo 12 bundles.');
    const ids = new Set();
    return raw.map(item => {
        if (ids.has(item?.id || ''))
            throw new Error('Asset id duplicado.');
        const task = forge.validateTask(item);
        ids.add(task.id);
        return task;
    });
}
function contextoForge() {
    const c = forge.catalog();
    const templates = ['author-art', 'author-prop', 'render-pixel-character', 'plan-plant'].map(command => {
        const entry = c.recipes.find(r => r.command === command);
        return forge.readRecipe(entry.recipeId);
    });
    return `\n\nFerramentas A7 Forge disponíveis para assets de jogos HTML5 (receitas de autoria, sem jogos importados):\n${JSON.stringify(c)}\nReceitas completas para adaptar briefs, personagens e plantas sem inventar schema:\n${JSON.stringify(templates)}\n` +
        'No manifesto, use assets:[{id,command,recipeId OU receitaJson}]. Para html5-runtime use só id e command. ' +
        'A geração é real, determinística, por receita; não é um serviço de imagens por difusão. ' +
        'Use render-pixel-character para spritesheets; plan-plant para quatro vistas; author-art/author-prop para briefs suportados. ' +
        'Não invente contratos: use uma recipeId do catálogo ou consulte a receita antes de adaptá-la. ' +
        'O runtime Canvas é opcional e contém loop, input, colisão, isometria, animação e geração com seed. ' +
        'As ferramentas rodam antes do código: cada arquivo receberá os caminhos reais dos assets exportados. ' +
        'Separe render, simulação, UI, input e saves. Não inclua cópias de jogos existentes. Resultado técnico exige revisão visual/artística.';
}
function pedidoForge(text) {
    return /\b(jogo[s]?|game[s]?|canvas|sprite[s]?|spritesheet[s]?|assets?|pixel\s*art|procedura[lisi]+|isom[eé]tric[oa]|forge)\b/i.test(text || '');
}
exports.FORGE_READ_TOOLS = [
    { name: 'catalogoAssetForge', description: 'Lista comandos e receitas reais para assets 2D/HTML5. Não modifica o projeto.', parameters: { type: 'object', properties: {} } },
    { name: 'lerReceitaAssetForge', description: 'Lê uma receita completa do catálogo para adaptar seu JSON sem inventar um contrato.', parameters: { type: 'object', required: ['recipeId'], properties: { recipeId: { type: 'string' } } } },
];
function executarLeituraForge(name, args) {
    if (name === 'catalogoAssetForge')
        return forge.catalog();
    if (name === 'lerReceitaAssetForge')
        return forge.readRecipe(args.recipeId);
    throw new Error('Ferramenta Forge desconhecida.');
}
// Preserve the legacy CJS entrypoint's complete Forge API (including render/safePath).
Object.assign(exports, forge);
