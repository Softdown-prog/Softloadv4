'use strict';

/**
 * Teste do placeholder de imagem (card sem foto de post) — achado real:
 * todo chassis usava https://placehold.co/WxH/hex/hex?text=Softload|Post,
 * serviço externo com "Softload" literal escrito no card de sites de
 * clientes. Corrigido gerando um SVG local (data URI), com a cor real do
 * colorPreset do site — este teste garante que a saída nunca regressa
 * pra nenhum dos dois problemas.
 *
 * Execute: node src/core/compilerEngine/placeholderImage.test.js
 */

const { gerarPlaceholderImagemSvg } = require('./placeholderImage');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// ── Formato: data URI de SVG, nunca URL externa ──────────────────────────
{
    const uri = gerarPlaceholderImagemSvg('#0ea5e9', '#f8fafc');
    assert('é data URI (self-contained, sem requisição de rede)', uri.startsWith('data:image/svg+xml;base64,'));
    assert('nunca aponta pra serviço externo', !uri.includes('placehold') && !uri.includes('http'));

    const svg = Buffer.from(uri.split(',')[1], 'base64').toString('utf8');
    assert('é SVG válido (tag <svg>)', svg.includes('<svg'));
    assert('nunca tem texto embutido (sem <text>, sem marca)', !svg.includes('<text') && !svg.toLowerCase().includes('softload'));
    assert('usa a cor primária recebida', svg.includes('#0ea5e9'));
    assert('usa a cor de fundo recebida', svg.includes('#f8fafc'));
}

// ── Cores diferentes → SVGs diferentes (reflete o colorPreset real) ─────
{
    const a = gerarPlaceholderImagemSvg('#0ea5e9', '#f8fafc');
    const b = gerarPlaceholderImagemSvg('#ff5722', '#fff5f2');
    assert('presets diferentes geram data URIs diferentes (cor real do site, não fixa)', a !== b);
}

// ── Entrada inválida não quebra, cai num fallback seguro ─────────────────
{
    const uri = gerarPlaceholderImagemSvg('not-a-color', undefined);
    assert('cor inválida não lança exceção, gera algo', uri.startsWith('data:image/svg+xml;base64,'));
    const svg = Buffer.from(uri.split(',')[1], 'base64').toString('utf8');
    assert('fallback usa hex válido (não propaga string inválida pro SVG)', /#[0-9a-fA-F]{3,8}/.test(svg) && !svg.includes('not-a-color'));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} placeholderImage: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
