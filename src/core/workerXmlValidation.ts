/**
 * Diagnóstico de saída Blogger após repararXml(): não bloqueia a compilação.
 * Conserva deliberadamente o detector textual legado (não é parser SAX).
 */
export function validarXmlSaida(xml: string): string[] {
    const avisos: string[] = [];

    if (!xml.includes('<html') || !xml.includes('</html>')) {
        avisos.push('Estrutura <html> ausente no XML de saída.');
    }
    if (!xml.includes('<head') || !xml.includes('</head>')) {
        avisos.push('Estrutura <head> ausente no XML de saída.');
    }
    if (!xml.includes('<body') || !xml.includes('</body>')) {
        avisos.push('Estrutura <body> ausente no XML de saída.');
    }
    if (!xml.includes('<b:skin>') && !xml.includes("<b:skin ")) {
        avisos.push('Tag <b:skin> ausente — CSS não será aplicado pelo Blogger.');
    }
    if (!xml.includes('bootstrap@5') && !xml.includes('bootstrap.min.css')) {
        avisos.push('Bootstrap CDN não encontrado no <head> — layout depende do Bootstrap.');
    }

    // Tokens residuais após repararXml indicam problema no engine
    const orfaos = xml.match(/\[\[[A-Z0-9_]+\]\]/g);
    if (orfaos) {
        avisos.push(`Placeholders residuais detectados: ${[...new Set(orfaos)].join(', ')}`);
    }

    // & nu fora de CDATA → causa SAXParseException no Blogger/Java
    // Remove blocos CDATA antes de checar para não gerar falso positivo
    const xmlForaCdata = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
    const ampNus = xmlForaCdata.match(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g);
    if (ampNus) {
        avisos.push(`SAXParseException potencial: ${ampNus.length} '&' não-escapado(s) fora de CDATA. Use &amp; em heroHtml/svgLogo/staticSections.`);
    }

    return avisos;
}
