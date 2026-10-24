import {
    FRAMEWORKS_VALIDOS, TIPOS_ARQUIVO_VALIDOS,
    GEMINI_MANIFEST_RESPONSE_SCHEMA, validarManifesto,
} from '../solaris/manifest/manifestSchema';
import type {
    FrameworkSolaris, TipoArquivoSolaris, ManifestoSolaris,
    ArquivoManifestoSolaris, ValidacaoManifestoSolaris,
} from '../solaris/manifest/manifestSchema';

const framework: FrameworkSolaris = 'html5';
const tipo: TipoArquivoSolaris = 'json';
const arquivo: ArquivoManifestoSolaris = { caminho: 'package.json', tipo, descricao: 'Pacotes' };
const result: ValidacaoManifestoSolaris = validarManifesto({ framework, arquivos: [arquivo] });
if (result.ok) {
    const manifesto: ManifestoSolaris = result.manifesto;
    const firstPath: string | undefined = manifesto.arquivos[0]?.caminho;
    void firstPath;
} else {
    const rejected: null = result.manifesto;
    void rejected;
}
const frameworks: readonly FrameworkSolaris[] = FRAMEWORKS_VALIDOS;
const tipos: readonly TipoArquivoSolaris[] = TIPOS_ARQUIVO_VALIDOS;
const schema: Record<string, unknown> = GEMINI_MANIFEST_RESPONSE_SCHEMA;
void frameworks;
void tipos;
void schema;
