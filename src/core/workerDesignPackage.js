"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.injetarDesignPackage = injetarDesignPackage;
exports.verificarMarcadoresDesignPackage = verificarMarcadoresDesignPackage;
/** Extração fiel: nenhuma nova sanitização ou alteração de XML aqui. */
function injetarDesignPackage(xml, body, deps) {
    const injecoes = [];
    // 1. darkTheme → script anti-flash antes de </head>
    if (body.darkTheme === true || body.darkTheme === 'true') {
        const scriptDark = [
            "<script>",
            "  //<![CDATA[",
            "  document.documentElement.setAttribute('data-bs-theme','dark');",
            "  //]]>",
            "</script>",
        ].join('\n');
        if (xml.includes('</head>')) {
            xml = xml.replace('</head>', scriptDark + '\n</head>');
            injecoes.push('darkTheme');
        }
    }
    // 2. customCss → DENTRO do CDATA do <b:skin>, antes do ]]>
    //    Substituir </b:skin> injetaria FORA do CDATA → & nu causa SAX error.
    //    Marcadores DP:CSS:START/END permitem extração exata pelo templateExtractor
    if (typeof body.customCss === 'string' && body.customCss.trim()) {
        const cdataSkinEnd = ']]></b:skin>';
        if (xml.includes(cdataSkinEnd)) {
            const css = '\n<!-- DP:CSS:START -->\n' + body.customCss.trim() + '\n<!-- DP:CSS:END -->\n';
            xml = xml.replace(cdataSkinEnd, css + cdataSkinEnd);
            injecoes.push('customCss');
        }
        else if (xml.includes('</b:skin>')) {
            // fallback: skin sem CDATA — escapa & para segurança no XML
            const css = '\n<!-- DP:CSS:START -->\n' + deps.sanitizarEntidadesXml(body.customCss.trim()) + '\n<!-- DP:CSS:END -->\n';
            xml = xml.replace('</b:skin>', css + '</b:skin>');
            injecoes.push('customCss');
        }
    }
    // 3. svgLogo → antes de <b:section id='header-logo' (presente em todos os templates)
    //    Injetado no corpo XML (fora de CDATA) → & deve ser &amp;
    //    Marcadores DP:LOGO:START/END permitem extração exata pelo templateExtractor
    if (typeof body.svgLogo === 'string' && body.svgLogo.trim()) {
        const svgHtml = '\n        <!-- DP:LOGO:START -->\n        ' + deps.sanitizarEntidadesXml(body.svgLogo.trim()) + '\n        <!-- DP:LOGO:END -->\n        ';
        const headerLogoMarker = "<b:section id='header-logo'";
        const brandMarkers = [
            "class='saas-nav-brand",
            "class='sl-header-brand",
            "class='mag-nav-brand",
            "class='portfolio-brand",
            "class='navbar-brand",
        ];
        let svgInjetado = false;
        if (xml.includes(headerLogoMarker)) {
            xml = xml.replace(headerLogoMarker, svgHtml + headerLogoMarker);
            injecoes.push('svgLogo');
            svgInjetado = true;
        }
        else {
            for (const marker of brandMarkers) {
                if (xml.includes(marker)) {
                    const idx = xml.indexOf(marker);
                    const gt = xml.indexOf('>', idx);
                    if (gt !== -1) {
                        xml = xml.slice(0, gt + 1) + svgHtml + xml.slice(gt + 1);
                        injecoes.push('svgLogo');
                        svgInjetado = true;
                    }
                    break;
                }
            }
        }
        if (!svgInjetado) {
            deps.warn('[COMPILER-WORKER] svgLogo: nenhum marcador de brand encontrado no template.');
        }
    }
    // 4. heroHtml + staticSections → widgets HTML numa b:section própria, antes
    //    do <b:section id='main' (marcador canônico). Embrulhar em widgets torna
    //    o hero e as seções da landing editáveis/removíveis pelo painel de Layout
    //    do Blogger (estilo WordPress) — antes eram HTML fixo, invisível ao Layout.
    //    Marcadores DP:HERO:*/DP:SECTIONS:* permitem extração exata pelo templateExtractor
    const mainMarker = "<b:section id='main'";
    if (xml.includes(mainMarker)) {
        let inject = '';
        if (typeof body.heroHtml === 'string' && body.heroHtml.trim()) {
            inject += "\n<!-- DP:HERO:START -->\n<b:section id='landing-hero' name='Landing — Hero' showaddelement='yes'>"
                + deps.montarWidgetHtml('HTML90', 'Hero da Landing', body.heroHtml)
                + '</b:section>\n<!-- DP:HERO:END -->';
            injecoes.push('heroHtml');
        }
        if (typeof body.staticSections === 'string' && body.staticSections.trim()) {
            inject += "\n<!-- DP:SECTIONS:START -->\n<b:section id='landing-sections' name='Landing — Seções' showaddelement='yes'>"
                + deps.montarWidgetHtml('HTML91', 'Seções da Landing', body.staticSections)
                + '</b:section>\n<!-- DP:SECTIONS:END -->';
            injecoes.push('staticSections');
        }
        if (inject) {
            // Gated por isMultipleItems: hero/seções de landing são conteúdo de
            // home/listagem. Sem esse b:if, renderizavam em TODA página (inclusive
            // posts individuais) — o <h1> quase sempre presente no heroHtml colidia
            // com o <h1> do título do post (achado real do diagnostico-sweep: 14
            // itens com H1 duplicado, todos com heroHtml/staticSections de design
            // package). Os marcadores DP:*:START/END ficam DENTRO do b:if — o
            // templateExtractor só procura entre eles, o wrapper externo não afeta
            // a extração ao reeditar o pacote.
            xml = xml.replace(mainMarker, "<b:if cond='data:view.isMultipleItems'>" + inject + "\n</b:if>\n    " + mainMarker);
        }
    }
    return { xml, injecoes };
}
function verificarMarcadoresDesignPackage(xmlEsqueleto) {
    const erros = [];
    if (!xmlEsqueleto.includes('</head>')) {
        erros.push('darkTheme: marcador "</head>" ausente.');
    }
    if (!xmlEsqueleto.includes(']]></b:skin>') && !xmlEsqueleto.includes('</b:skin>')) {
        erros.push('customCss: nem "]]></b:skin>" (CDATA) nem "</b:skin>" (fallback) presentes.');
    }
    const brandMarkers = [
        "class='saas-nav-brand", "class='sl-header-brand", "class='mag-nav-brand",
        "class='portfolio-brand", "class='navbar-brand",
    ];
    if (!xmlEsqueleto.includes("<b:section id='header-logo'") && !brandMarkers.some(m => xmlEsqueleto.includes(m))) {
        erros.push('svgLogo: nem "header-logo" nem nenhuma classe de marca conhecida presentes.');
    }
    if (!xmlEsqueleto.includes("<b:section id='main'")) {
        erros.push('heroHtml/staticSections: marcador canônico "<b:section id=\'main\'" ausente.');
    }
    return { ok: erros.length === 0, erros };
}
