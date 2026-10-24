import {
    ehArquivoDeCatalogo, listarArquivosDeCatalogo, separarNomeExtensao, paraKebabCase,
    ehKebabCase, validarNomeArquivo, normalizarDiretorioRag, auditarCatalogo,
    validarEntradaGerada, CAMPOS_RECOMENDADOS, DESCRICAO_MIN_CHARS,
} from '../solaris/workers/ragKebabWorker';
import type {
    RagFileNameParts, RagFileNameValidation, RagNormalizeReport, RagCatalogAudit,
    RagGeneratedEntryValidation, RagNormalizeOptions, RagAuditOptions,
} from '../solaris/workers/ragKebabWorker';
const candidate: boolean = ehArquivoDeCatalogo('flask.json');
const files: string[] = listarArquivosDeCatalogo('/tmp/rag');
const parts: RagFileNameParts = separarNomeExtensao('flask/blueprints.json');
const kebab: string = paraKebabCase('LandingPage');
const ok: boolean = ehKebabCase(kebab);
const validation: RagFileNameValidation = validarNomeArquivo('LandingPage.json');
const normalization: RagNormalizeReport[] = normalizarDiretorioRag({ dir: '/tmp/rag', aplicar: false } satisfies RagNormalizeOptions);
const audit: RagCatalogAudit = auditarCatalogo({ dir: '/tmp/rag' } satisfies RagAuditOptions);
const generated: RagGeneratedEntryValidation = validarEntradaGerada({
    id: 'flask-blueprints', slug: 'flask-blueprints', categoria: 'backend',
    descricao: 'A técnica de blueprints agrupa endpoints por domínio de negócio.', componentes: ['Blueprint'],
    keywords: ['flask', 'python'],
});
const fields: string[] = CAMPOS_RECOMENDADOS;
const minDescription: number = DESCRICAO_MIN_CHARS;
void candidate;void files;void parts;void ok;void validation;void normalization;void audit;
void generated;void fields;void minDescription;
