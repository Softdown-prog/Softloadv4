'use strict';

/**
 * Testes para acessibilidadeChecker.js
 * Execute: node src/core/diagnostico/acessibilidadeChecker.test.js
 */

const { checarAcessibilidade } = require('./acessibilidadeChecker');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

function tem(achados, trecho) {
    return achados.some(a => a.mensagem.includes(trecho));
}

// ── img sem alt ──────────────────────────────────────────────────────────
{
    const semAlt = "<img src='a.jpg'/><img src='b.jpg' alt='descrição'/>";
    const r = checarAcessibilidade(semAlt);
    assert('detecta exatamente 1 img sem alt (a outra tem)', tem(r, '1 tag(s) <img>'));
}
{
    const todasComAlt = "<img src='a.jpg' alt=''/><img src='b.jpg' alt='x'/>";
    const r = checarAcessibilidade(todasComAlt);
    assert('alt vazio (decorativo) conta como presente, não gera achado', !tem(r, '<img>'));
}
{
    const semImg = '<div>sem imagens aqui</div>';
    assert('sem nenhuma img não gera achado de alt', !tem(checarAcessibilidade(semImg), '<img>'));
}
{
    // Achado real (viral-magazine): JS embutido com regex de extração de
    // imagem (`/<img.+?src="([^"]+)"/`) não fecha com `>` antes do próximo
    // `>` real do script — a regex ingênua de <img> "vazava" pro resto do
    // <script> inteiro e acusava alt ausente numa imagem que não existe.
    const comRegexJsNoScript = `
<html lang='pt-BR'><body>
<img src='real.jpg' alt='foto real'/>
<script>
//<![CDATA[
function extrairImg(post) {
    if (post.content.$t.match(/<img.+?src="([^"]+)"/)) {
        return post.content.$t.match(/<img.+?src="([^"]+)"/)[1];
    }
    return null;
}
//]]>
</script>
</body></html>`;
    assert('regex JS com "<img" dentro de <script> não gera falso positivo de alt',
        !tem(checarAcessibilidade(comRegexJsNoScript), '<img>'));
}
{
    // Mesmo achado, mas pro checker de botão — <button> literal dentro de
    // JS (template string montando HTML de carrossel) não deve contar como
    // botão real sem aria-label.
    const comBotaoDentroDeScript = `
<html lang='pt-BR'><body>
<button aria-label='Real'><i class='bi bi-x'/></button>
<script>
//<![CDATA[
var html = '<button type="button" data-bs-slide-to="0"></button>';
//]]>
</script>
</body></html>`;
    assert('<button> dentro de string JS não conta pro checker de aria-label',
        !tem(checarAcessibilidade(comBotaoDentroDeScript), 'aria-label'));
}

// ── lang no <html> ───────────────────────────────────────────────────────
{
    const semLang = "<html><body></body></html>";
    assert('sem lang é aviso', tem(checarAcessibilidade(semLang), 'lang'));
}
{
    const comLang = "<html lang='pt-BR'><body></body></html>";
    assert('com lang literal não gera achado', !tem(checarAcessibilidade(comLang), 'lang ausente'));
}
{
    const comExprLang = "<html expr:lang='data:blog.locale'><body></body></html>";
    assert('com expr:lang (Blogger) não gera achado', !tem(checarAcessibilidade(comExprLang), 'lang ausente'));
}

// ── button só com ícone, sem aria-label ─────────────────────────────────
{
    const botaoSoIcone = "<button class='x'><i class='bi bi-search'/></button>";
    assert('botão só com ícone e sem aria-label é aviso', tem(checarAcessibilidade(botaoSoIcone), 'aria-label'));
}
{
    const botaoComLabel = "<button aria-label='Buscar'><i class='bi bi-search'/></button>";
    assert('botão com aria-label literal não gera achado', !tem(checarAcessibilidade(botaoComLabel), 'aria-label'));
}
{
    const botaoComExprLabel = "<button expr:aria-label='data:messages.share.escaped'><i class='bi bi-share'/></button>";
    assert('botão com expr:aria-label (Blogger, dinâmico) não gera achado',
        !tem(checarAcessibilidade(botaoComExprLabel), 'aria-label'));
}
{
    const botaoComTexto = "<button class='x'>Assinar</button>";
    assert('botão com texto visível não gera achado (não precisa de aria-label)',
        !tem(checarAcessibilidade(botaoComTexto), 'aria-label'));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} acessibilidadeChecker: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
