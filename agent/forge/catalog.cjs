'use strict';

const fs = require('node:fs');
const path = require('node:path');
const ROOT = __dirname;
const CONTRACT_COMMAND = {
    CH_2D_GRAPH_RECIPE_V1: 'draw-graph', CH_2D_GRAPH_RECIPE_V2: 'draw-graph',
    CH_2D_SHAPE_RECIPE_V1: 'draw-recipe',
    CH_2D_ORGANIC_SCENERY_V1: 'run-workers', CH_2D_FENCE_SCENERY_V1: 'run-workers',
    CH_2D_SCENE_RECIPE_V1: 'run-workers', CH_2D_SCENE_RECIPE_V2: 'run-workers',
    CH_2D_SCENE_RECIPE_V3: 'run-workers', CH_2D_SCENE_RECIPE_V4: 'run-workers',
    A7_PLANT_INTENT_V1: 'plan-plant', CH_2D_ART_BRIEF_V1: 'author-art',
    CH_2D_PROP_BRIEF_V1: 'author-prop', A7_FORGE_2D_PIXEL_CHARACTER_V1: 'render-pixel-character',
    A7_FORGE_2D_ANIMATION_V1: 'pack-animation', CH_AUDIO_GENERATION_V1: 'audio-synth',
};
const COMMANDS = [...new Set(Object.values(CONTRACT_COMMAND)), 'html5-runtime'];
let cached;
function catalog() {
    if (!cached) {
        const entries = [];
        function visit(dir) {
            for (const file of fs.readdirSync(dir, { withFileTypes: true })) {
                const abs = path.join(dir, file.name);
                if (file.isDirectory()) visit(abs);
                else if (file.name.endsWith('.json')) {
                    const data = JSON.parse(fs.readFileSync(abs, 'utf8'));
                    if (!data || Array.isArray(data)) continue;
                    entries.push({ recipeId: path.relative(ROOT, abs).split(path.sep).join('/'),
                        contract: data.contract || null, command: CONTRACT_COMMAND[data.contract] || null,
                        id: data.id || path.basename(file.name, '.json') });
                }
            }
        }
        visit(path.join(ROOT, 'tools/visitor_forge_2d/examples'));
        visit(path.join(ROOT, 'tools/a7_audio_lab/jobs'));
        cached = entries.sort((a, b) => a.recipeId.localeCompare(b.recipeId));
    }
    return { version: 1, commands: COMMANDS, recipes: cached.map(x => ({ ...x })),
        runtime: ['runtime.mjs', 'procedural.mjs'],
        reviewRequired: true, imageGeneration: 'deterministic-procedural',
        externalAudioProviders: 'manual deployment only; never executed by Solaris recipes' };
}
function readRecipe(recipeId) {
    const entry = catalog().recipes.find(x => x.recipeId === recipeId);
    if (!entry) throw new Error('Receita ausente do catálogo Forge. Use forge.catalog.');
    return { ...entry, recipe: JSON.parse(fs.readFileSync(path.join(ROOT, recipeId), 'utf8')) };
}
module.exports = { ROOT, COMMANDS, CONTRACT_COMMAND, catalog, readRecipe };
