'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const inventory = require('./UPSTREAM.json');
for (const file of inventory.files) {
    if (!/^tools\/(visitor_forge_2d|a7_audio_lab)\//.test(file.path)) throw new Error('Unexpected upstream path');
    const bytes = fs.readFileSync(path.join(__dirname, file.path));
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== (file.localSha256 || file.sha256)) throw new Error(`Upstream drift: ${file.path}`);
}
console.log(`Verified ${inventory.files.length} tool files from ${inventory.commit}; ${inventory.files.filter(f => f.localSha256).length} documented test adaptation`);
