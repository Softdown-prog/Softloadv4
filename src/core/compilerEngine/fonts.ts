/** Módulo de fontes do Chassis Blogger, sem alterar o markup emitido. */
export interface TypographyFont {
    fontUrl?: string | null;
}

export function gerarFontModule(typography: TypographyFont): string {
    const safeFontUrl = typography.fontUrl ? typography.fontUrl.replace(/&/g, '&amp;') : '';

    return `<link rel='preconnect' href='https://fonts.googleapis.com'/>
    <link rel='preconnect' href='https://fonts.gstatic.com' crossorigin='anonymous'/>
    <link href='${safeFontUrl}' rel='stylesheet'/>`;
}
