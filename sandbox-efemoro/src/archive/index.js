// Ponto de entrada das capabilities de arquivo. ZIP mantém o parser
// dedicado; a API genérica usa libarchive nos formatos adicionais.
export { runArchiveExtract as runZipExtract } from "./extractZip.js";
export { runArchiveExtract } from "./extractArchive.js";
