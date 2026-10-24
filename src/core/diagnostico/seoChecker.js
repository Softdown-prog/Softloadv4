"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checarSeo = checarSeo;
// ──────────────────────────────────────────────────────────────────────────
// SEO CHECKER — análise estática do XML compilado, sem chamada de rede.
// Parte do "Diagnóstico Inteligente" — v1 restrito a templates gerados pela
// própria Softload (ver src/core/diagnostico/index.js).
// ──────────────────────────────────────────────────────────────────────────
// Encontra o cond do <b:if data:view.is*> mais próximo (ainda aberto) que
// envolve a posição dada. Usado para distinguir H1 legitimamente repetido
// em views mutuamente exclusivas dentro do MESMO includable, de H1
// duplicado de verdade (ambos renderizariam juntos).
function _gateDeView(xml, posicao) {
    const antes = xml.slice(0, posicao);
    const tokenRe = /<b:if\s+cond=(['"])(.*?)\1\s*(\/)?>|<\/b:if>/g;
    const pilha = [];
    let m;
    while ((m = tokenRe.exec(antes)) !== null) {
        if (m[0] === '</b:if>')
            pilha.pop();
        else if (!m[3])
            pilha.push(m[2]); // ignora self-closing — não abre escopo
    }
    for (let i = pilha.length - 1; i >= 0; i--) {
        if (/data:view\.is/.test(pilha[i]))
            return pilha[i];
    }
    return null; // sem gate de view — renderiza sempre que o includable rodar
}
// Encontra o <b:includable id='...'> mais próximo (ainda aberto) que envolve
// a posição dada, ou null se a posição está fora de qualquer includable.
// Isto é o sinal mais confiável de exclusividade: 'main' e 'post' (ou 'item')
// são includables SEPARADOS que o Blogger invoca um de cada vez conforme o
// tipo de página — um H1 em 'main' e outro em 'post' NUNCA renderizam juntos,
// mesmo que nenhum dos dois tenha um <b:if cond='data:view.is...'> local (o
// próprio b:include que chama 'post' geralmente já está dentro do <b:else/>
// do 'main', então rastrear apenas b:if locais gera falso positivo aqui).
function _includableDeH1(xml, posicao) {
    const antes = xml.slice(0, posicao);
    const tokenRe = /<b:includable\s+id=(['"])(.*?)\1[^>]*>|<\/b:includable>/g;
    const pilha = [];
    let m;
    while ((m = tokenRe.exec(antes)) !== null) {
        if (m[0] === '</b:includable>')
            pilha.pop();
        else
            pilha.push(m[2]);
    }
    return pilha.length ? pilha[pilha.length - 1] : null;
}
// Chave de exclusividade de um H1: dois H1 com a MESMA chave podem renderizar
// juntos (erro); chaves DIFERENTES e não-nulas são consideradas mutuamente
// exclusivas (o Blogger só roda um includable de um widget por vez; um
// <b:if cond='data:view.is...'> só deixa passar um ramo por vez).
// 'includable' tem prioridade sobre 'gate' quando NENHUM dos H1 do mesmo
// grupo tem gate — é o sinal mais forte (funciona mesmo sem nenhum b:if
// local, caso do 'main' vs 'post'). Um H1 sem includable MAS com gate de
// view (ex: hero-area envolvido por <b:if cond='data:view.isMultipleItems'>)
// ainda é seguro. Só é verdadeiramente "sempre presente" quando não tem
// NENHUM dos dois.
function _chaveDeExclusividade(ctx) {
    if (ctx.includable)
        return 'includable:' + ctx.includable;
    if (ctx.gate)
        return 'gate:' + ctx.gate;
    return null; // incondicional — renderiza em toda página, sempre
}
function _checarH1(xml, achados) {
    const h1s = [...xml.matchAll(/<h1\b/g)];
    if (h1s.length === 0) {
        achados.push({ nivel: 'aviso', mensagem: 'Nenhuma tag <h1> encontrada — todo tipo de página deveria ter um título principal marcado como H1.' });
        return;
    }
    if (h1s.length === 1)
        return;
    const ctxs = h1s.map(m => ({
        includable: _includableDeH1(xml, m.index),
        gate: _gateDeView(xml, m.index),
    }));
    // Qualquer H1 sem includable E sem gate de view é verdadeiramente
    // incondicional — coexiste com qualquer outro H1 da página. Erro direto.
    if (ctxs.some(c => c.includable === null && c.gate === null)) {
        achados.push({
            nivel: 'erro',
            mensagem: `${h1s.length} tags <h1> encontradas e pelo menos uma renderiza incondicionalmente (fora de qualquer <b:includable> e sem <b:if cond='data:view.is...'> em volta) — vai coexistir com o H1 de cada view específica. Múltiplos H1 na mesma página confundem o Google sobre qual é o título principal.`,
        });
        return;
    }
    // Agrupa por includable primeiro (sinal mais forte — 'main' vs 'post'
    // nunca rodam juntos mesmo sem b:if local). DENTRO do mesmo includable,
    // sub-agrupa por gate de view: achado real (extração verbatim de
    // exemplos/noticias-mag-news.xml) — o main includable do Blog1 tem h1
    // de 404 (dentro de 'b:if data:view.isError') E h1 de post único
    // (dentro do b:else de 'isMultipleItems'), os dois no MESMO includable
    // 'main', mas em ramos de b:if mutuamente exclusivos — nunca renderizam
    // juntos. Sub-agrupar só dentro do mesmo includable (não promover gate
    // a chave global) evita o risco oposto: um H1 sem gate (renderiza
    // sempre que o includable rodar) sub-agrupado incorretamente como
    // "diferente" de um H1 irmão COM gate no mesmo includable — nesse caso
    // os dois realmente colidem sempre que o gate for verdadeiro, e por
    // isso ficam agrupados na mesma chave-base (só por includable) abaixo.
    const porIncludable = new Map();
    for (const c of ctxs) {
        const chaveBase = _chaveDeExclusividade(c);
        if (!porIncludable.has(chaveBase))
            porIncludable.set(chaveBase, []);
        porIncludable.get(chaveBase).push(c.includable ? c.gate : null);
    }
    for (const [chaveBase, gates] of porIncludable) {
        if (gates.length <= 1)
            continue;
        const todasGatedEDistintas = chaveBase.startsWith('includable:')
            && gates.every(g => g !== null)
            && new Set(gates).size === gates.length;
        if (todasGatedEDistintas)
            continue; // ramos de b:if mutuamente exclusivos
        achados.push({
            nivel: 'erro',
            mensagem: `${gates.length} tags <h1> compartilham o mesmo escopo (${chaveBase}) — podem renderizar juntas na mesma página. Múltiplos H1 na mesma página confundem o Google sobre qual é o título principal.`,
        });
    }
}
function _extrairBlocosJsonLd(xml) {
    const blocos = [];
    const re = /<script[^>]*type=['"]application\/ld\+json['"][^>]*>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(xml)) !== null)
        blocos.push(m[1]);
    return blocos;
}
// Tags <data:.../> são substituídas pelo motor do Blogger antes do JSON
// chegar ao navegador — não são JSON inválido, são template tags. Troca por
// um placeholder SEM aspas próprias, porque normalmente já aparecem dentro
// de um valor de string existente (ex: "url": "<data:blog.homepageUrl/>").
function _jsonLdEhParseavel(raw) {
    const semTagsBlogger = raw
        .replace(/<data:[\w.]+\s*\/>/g, '__DATA__')
        .replace(/<b:eval\b[^>]*\/>/g, '__EVAL__');
    try {
        JSON.parse(semTagsBlogger);
        return true;
    }
    catch (_) {
        return false;
    }
}
/**
 * Audita SEO estrutural de um XML Blogger já compilado.
 * @param {string} xml
 * @returns {{ nivel: 'erro'|'aviso', mensagem: string }[]}
 */
function checarSeo(xml) {
    const achados = [];
    if (!/<title>/.test(xml)) {
        achados.push({ nivel: 'erro', mensagem: 'Tag <title> ausente — impacta diretamente como o Google exibe o resultado de busca.' });
    }
    if (!/<meta[^>]*name=['"]description['"][^>]*>/.test(xml)) {
        achados.push({ nivel: 'aviso', mensagem: 'Meta description ausente — sem ela, o Google gera um resumo automático a partir do conteúdo, geralmente pior que um escrito à mão.' });
    }
    if (!/<link[^>]*rel=['"]canonical['"][^>]*>/.test(xml)) {
        achados.push({ nivel: 'aviso', mensagem: "Tag <link rel='canonical'> ausente — risco de conteúdo duplicado entre variações da mesma URL (ex: com e sem barra final)." });
    }
    _checarH1(xml, achados);
    const blocosLd = _extrairBlocosJsonLd(xml);
    if (blocosLd.length === 0) {
        achados.push({ nivel: 'aviso', mensagem: 'Nenhum bloco JSON-LD (application/ld+json) encontrado — dados estruturados ajudam o Google a exibir rich snippets (avaliação, autor, data).' });
    }
    else {
        blocosLd.forEach((bloco, i) => {
            if (!_jsonLdEhParseavel(bloco)) {
                achados.push({ nivel: 'erro', mensagem: `Bloco JSON-LD #${i + 1} não é JSON válido (mesmo desconsiderando tags do Blogger) — provável vírgula ou chave a mais/faltando.` });
            }
        });
    }
    return achados;
}
