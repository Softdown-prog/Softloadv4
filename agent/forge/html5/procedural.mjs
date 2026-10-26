export function seededRandom(seed = 1) {
    let state = seed >>> 0;
    return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function generateTerrain({ width, height, seed = 1, water = 0.2, forest = 0.6 }) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 1048576)
        throw new Error('Invalid terrain dimensions');
    if (!(water >= 0 && water <= forest && forest <= 1))
        throw new Error('Invalid terrain thresholds');
    const random = seededRandom(seed);
    return Array.from({ length: height }, () => Array.from({ length: width }, () => {
        const value = random();
        return value < water ? 'water' : value < forest ? 'grass' : 'forest';
    }));
}
/** Canvas-native procedural asset, useful when bitmap export is unnecessary. */
export function drawTree(ctx, { x, y, radius = 16, seed = 1, leaf = '#448345', trunk = '#75543d' }) {
    const random = seededRandom(seed);
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = trunk;
    ctx.fillRect(-radius * 0.15, -radius, radius * 0.3, radius);
    ctx.fillStyle = leaf;
    for (let i = 0; i < 7; i++) {
        ctx.beginPath();
        ctx.ellipse((random() - 0.5) * radius, -radius * (1 + random()), radius * 0.65, radius * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}
