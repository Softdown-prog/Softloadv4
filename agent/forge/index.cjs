"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { ROOT, COMMANDS, CONTRACT_COMMAND, catalog, readRecipe } = require('./catalog.cjs');
const MAX_BYTES = 32 * 1024 * 1024;
function safePath(root, relative) {
    if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes('\0') || path.isAbsolute(relative))
        throw new Error('Forge exige caminho relativo.');
    const base = fs.realpathSync(root);
    const target = path.resolve(base, relative);
    if (!target.startsWith(base + path.sep))
        throw new Error('Caminho fora do projeto Forge.');
    let ancestor = target;
    while (!fs.existsSync(ancestor))
        ancestor = path.dirname(ancestor);
    const real = fs.realpathSync(ancestor);
    if (real !== base && !real.startsWith(base + path.sep))
        throw new Error('Symlink fora do projeto Forge.');
    return target;
}
function validateTask(input) {
    const task = input;
    if (!task || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(task.id || ''))
        throw new Error('Asset id inválido.');
    if (!COMMANDS.includes(task.command))
        throw new Error('Comando Forge não permitido.');
    if (task.command === 'html5-runtime')
        return { id: task.id, command: task.command, recipe: {} };
    if (!!task.recipeId === (task.recipe !== undefined || task.receitaJson !== undefined))
        throw new Error('Informe uma recipeId OU uma receita JSON.');
    const entry = task.recipeId ? readRecipe(task.recipeId) : null;
    const recipe = entry ? entry.recipe : task.receitaJson !== undefined ? JSON.parse(task.receitaJson) : task.recipe;
    if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe) || JSON.stringify(recipe).length > 128 * 1024)
        throw new Error('Receita inválida ou maior que 128 KiB.');
    if (CONTRACT_COMMAND[recipe.contract] !== task.command)
        throw new Error('Contrato incompatível com o comando Forge.');
    let nodes = 0;
    function check(value, key = '', depth = 0) {
        if (++nodes > 30000 || depth > 40)
            throw new Error('Receita excede limite de complexidade.');
        if (typeof value === 'number' && (!Number.isFinite(value) || Math.abs(value) > 1e10))
            throw new Error('Número fora dos limites.');
        if (key === 'id' && typeof value === 'string' && !/^[a-zA-Z0-9_-]{1,100}$/.test(value))
            throw new Error('ID de receita inválido.');
        if (['canvas', 'frameSize', 'outputSize', 'workingSize'].includes(key) && Array.isArray(value) && value.some(x => !Number.isInteger(x) || x < 1 || x > 1024))
            throw new Error('Canvas deve ter até 1024 pixels por dimensão.');
        if (Array.isArray(value))
            value.forEach(v => check(v, '', depth + 1));
        else if (value && typeof value === 'object')
            Object.entries(value).forEach(([k, v]) => check(v, k, depth + 1));
    }
    check(recipe);
    if (task.command === 'pack-animation' && (!Array.isArray(recipe.frames) || recipe.frames.length < 2 || recipe.frames.length > 64))
        throw new Error('Animação exige 2–64 frames.');
    if (task.command === 'audio-synth' && recipe.provider?.type !== 'synthetic_smoke')
        throw new Error('Provider de áudio não habilitado.');
    return { id: task.id, command: task.command, recipe: structuredClone(recipe) };
}
function filesIn(root) {
    const files = [];
    function visit(dir) {
        for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
            const abs = path.join(dir, item.name);
            if (item.isSymbolicLink())
                throw new Error('Forge não exporta symlinks.');
            if (item.isDirectory())
                visit(abs);
            else if (item.isFile())
                files.push(abs);
        }
    }
    visit(root);
    return files.sort();
}
async function render(task, { baseDir } = {}) {
    if (!baseDir)
        throw new Error('Forge precisa de um diretório de projeto.');
    const validated = validateTask(task);
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-forge-'));
    try {
        if (validated.command === 'html5-runtime') {
            fs.cpSync(path.join(ROOT, 'html5'), path.join(temp, 'out'), { recursive: true });
        }
        else {
            // Frame paths are explicitly copied into the job; the renderer never
            // receives direct access to an uploaded project's directory.
            if (validated.command === 'pack-animation') {
                const frames = validated.recipe.frames;
                if (!Array.isArray(frames) || frames.length < 2 || frames.length > 64)
                    throw new Error('Animação exige 2–64 frames.');
                let total = 0;
                for (const frame of frames) {
                    const rel = typeof frame === 'string' ? frame : frame.path;
                    const source = safePath(baseDir, rel);
                    total += fs.statSync(source).size;
                    if (total > MAX_BYTES)
                        throw new Error('Frames excedem 32 MiB.');
                    const dest = safePath(temp, rel);
                    if (['recipe.json', 'out', 'audio_job.json'].includes(rel.split('/')[0]))
                        throw new Error('Caminho reservado.');
                    fs.mkdirSync(path.dirname(dest), { recursive: true });
                    fs.copyFileSync(source, dest);
                }
            }
            await new Promise((resolve, reject) => {
                const child = spawn(process.env.SOLARIS_FORGE_PYTHON || 'python3', ['-B', path.join(ROOT, 'render.py')], {
                    cwd: temp, shell: false, env: { PATH: process.env.PATH, LANG: 'C.UTF-8', PYTHONDONTWRITEBYTECODE: '1', HOME: temp },
                    stdio: ['pipe', 'pipe', 'pipe'],
                });
                let errorText = '', outputSize = 0;
                const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Forge excedeu 90 segundos.')); }, 90000);
                child.stdout.on('data', (b) => { outputSize += b.length; if (outputSize > 1024 * 1024)
                    child.kill('SIGKILL'); });
                child.stderr.on('data', (b) => { errorText = (errorText + b.toString()).slice(-4000); });
                child.on('error', e => { clearTimeout(timer); reject(e); });
                child.on('close', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Forge falhou (${code}): ${errorText.replaceAll(temp, '<job>').slice(-1200)}`)); });
                child.stdin.on('error', () => { });
                child.stdin.end(JSON.stringify(validated));
            });
        }
        const out = path.join(temp, 'out');
        const files = filesIn(out);
        if (!files.length || files.length > 512 || files.reduce((sum, f) => sum + fs.statSync(f).size, 0) > MAX_BYTES)
            throw new Error('Saída Forge vazia ou acima da cota (512 arquivos/32 MiB).');
        const prefix = `assets/${validated.id}`;
        const destDir = safePath(baseDir, prefix);
        // Immutable bundles avoid partially replacing a previously approved asset.
        if (fs.existsSync(destDir))
            throw new Error(`Asset ${validated.id} já existe; escolha um id novo.`);
        const descriptors = files.map(file => ({ caminho: `${prefix}/${path.relative(out, file).split(path.sep).join('/')}`,
            tamanhoBytes: fs.statSync(file).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }));
        fs.mkdirSync(path.dirname(destDir), { recursive: true });
        const staging = fs.mkdtempSync(path.join(path.dirname(destDir), '.forge-'));
        try {
            fs.cpSync(out, staging, { recursive: true });
            fs.renameSync(staging, destDir);
        }
        finally {
            fs.rmSync(staging, { recursive: true, force: true });
        }
        const provenance = { contract: 'SOLARIS_FORGE_ASSET_V1', id: validated.id, command: validated.command,
            recipe: validated.recipe, files: descriptors, artApproved: false, runtimePromotion: false };
        const provenancePath = `${prefix}/solaris-asset.json`;
        fs.writeFileSync(safePath(baseDir, provenancePath), JSON.stringify(provenance, null, 2));
        // The code generator has no filesystem tool in its per-file call. Give
        // it actual animation contracts and the authored runtime API, not just
        // filenames that it would have to guess how to consume.
        let budget = 24 * 1024;
        const metadata = [];
        for (const file of descriptors.filter(f => f.caminho.endsWith('.json'))) {
            if (file.tamanhoBytes > budget)
                continue;
            metadata.push({ caminho: file.caminho, conteudo: JSON.parse(fs.readFileSync(safePath(baseDir, file.caminho), 'utf8')) });
            budget -= file.tamanhoBytes;
        }
        return { ok: true, id: validated.id, command: validated.command, reviewRequired: true,
            files: [...descriptors, { caminho: provenancePath }], metadata,
            ...(validated.command === 'html5-runtime' ? { api: fs.readFileSync(path.join(ROOT, 'html5/README.md'), 'utf8') } : {}) };
    }
    finally {
        fs.rmSync(temp, { recursive: true, force: true });
    }
}
const forge = { catalog, readRecipe, validateTask, render, safePath, filesIn };
// Node ESM consumers import this CommonJS API as default.
exports.default = forge;
module.exports = forge;
