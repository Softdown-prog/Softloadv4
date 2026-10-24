'use strict';
// Runs inside both production images too, so missing Pillow/ffmpeg/resources
// fail the image build instead of the first user's generation request.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { render, catalog } = require('./index.cjs');
(async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-image-smoke-'));
    try {
        for (const command of ['draw-recipe', 'audio-synth', 'html5-runtime']) {
            const entry = catalog().recipes.find(x => x.command === command);
            const result = await render({ id: command, command, ...(entry ? { recipeId: entry.recipeId } : {}) }, { baseDir });
            console.log(`Forge ${command}: ${result.files.length} files`);
        }
    } finally { fs.rmSync(baseDir, { recursive: true, force: true }); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
