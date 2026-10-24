// ============================================================
// MANIFEST SCHEMA — contrato interno do Solaris Code (Fase 0).
// ============================================================
// O manifesto conecta Brainstorm → Orquestrador → Workers → IA.
// Schema Gemini na entrada e validação independente no servidor.
// O Node em produção carrega o espelho CommonJS gerado desta fonte.

declare function require(name: string): unknown;

interface GeminiType {
    OBJECT: string;
    STRING: string;
    ARRAY: string;
}
const { Type } = require('@google/genai') as { Type: GeminiType };

/** Resultado de validarAssets; o contrato detalhado pertence ao Asset Forge. */
export interface ManifestAsset {
    id: string;
    command: string;
    [field: string]: unknown;
}
const { ASSET_SCHEMA, validarAssets } = require('../tools/assetForge') as {
    ASSET_SCHEMA: Record<string, unknown>;
    validarAssets(input: unknown): ManifestAsset[];
};

export const FRAMEWORKS_VALIDOS = [
    'html5', 'bootstrap5', 'php', 'flask', 'django', 'node-express', 'ejs',
] as const;

export const TIPOS_ARQUIVO_VALIDOS = [
    'html', 'css', 'js', 'php', 'py', 'ejs', 'json', 'md', 'outro',
] as const;

export type FrameworkSolaris = (typeof FRAMEWORKS_VALIDOS)[number];
export type TipoArquivoSolaris = (typeof TIPOS_ARQUIVO_VALIDOS)[number];

export interface ArquivoManifestoSolaris {
    caminho: string;
    tipo: TipoArquivoSolaris;
    descricao: string;
}

export interface ManifestoSolaris {
    assets: ManifestAsset[];
    framework: FrameworkSolaris;
    objetivo: string;
    paginas: string[];
    componentes: string[];
    arquivos: ArquivoManifestoSolaris[];
    dependencias: string[];
}

export type ValidacaoManifestoSolaris =
    | { ok: true; erros: string[]; avisos: string[]; manifesto: ManifestoSolaris }
    | { ok: false; erros: string[]; avisos: string[]; manifesto: null };

export const GEMINI_MANIFEST_RESPONSE_SCHEMA = {
    type: Type.OBJECT,
    required: ['framework', 'arquivos', 'objetivo'],
    properties: {
        assets: { type: Type.ARRAY, items: ASSET_SCHEMA, description: 'Optional deterministic Forge asset bundles, rendered before source files. Never put binary image data in arquivos.' },
        framework: {
            type: Type.STRING,
            enum: FRAMEWORKS_VALIDOS,
            description: 'Framework/stack principal do projeto.',
        },
        objetivo: {
            type: Type.STRING,
            description: 'Resumo de 1-2 frases do que o projeto faz, levantado no brainstorm.',
        },
        paginas: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Nomes das páginas/rotas do projeto (ex: ["Home","Sobre","Contato"]).',
        },
        componentes: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Componentes reutilizáveis previstos (ex: ["navbar","hero","card-produto"]).',
        },
        arquivos: {
            type: Type.ARRAY,
            description: 'Lista de arquivos que o Orquestrador vai gerar um a um (fluxo granular — nunca tudo numa chamada só).',
            items: {
                type: Type.OBJECT,
                required: ['caminho', 'tipo', 'descricao'],
                properties: {
                    caminho: { type: Type.STRING, description: 'Caminho relativo do arquivo dentro do projeto (ex: "css/style.css").' },
                    tipo: { type: Type.STRING, enum: TIPOS_ARQUIVO_VALIDOS },
                    descricao: { type: Type.STRING, description: 'O que este arquivo específico precisa conter — escopo da chamada de geração granular.' },
                },
            },
        },
        dependencias: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Bibliotecas/dependências externas previstas (ex: ["bootstrap@5","flask"]).',
        },
    },
};

// Segunda camada: descarta campos inválidos isolados, sem confiar no modelo.
export function validarManifesto(manifesto: unknown): ValidacaoManifestoSolaris {
    const erros: string[] = [];
    const avisos: string[] = [];
    let assets: ManifestAsset[] = [];

    if (!manifesto || typeof manifesto !== 'object') {
        return { ok: false, erros: ['manifesto não é um objeto.'], avisos, manifesto: null };
    }
    const raw = manifesto as Record<string, unknown>;
    try { assets = validarAssets(raw.assets); } catch (e) { erros.push((e as Error).message); }

    if (!FRAMEWORKS_VALIDOS.includes(raw.framework as FrameworkSolaris)) {
        erros.push(`framework inválido ou ausente: ${JSON.stringify(raw.framework)} — válidos: ${FRAMEWORKS_VALIDOS.join(', ')}.`);
    }

    if (!Array.isArray(raw.arquivos) || raw.arquivos.length === 0) {
        erros.push('arquivos deve ser um array não-vazio — sem arquivo nenhum não há o que o Orquestrador gerar.');
    }

    const arquivosValidos: ArquivoManifestoSolaris[] = [];
    if (Array.isArray(raw.arquivos)) {
        for (const [i, arq] of raw.arquivos.entries()) {
            const item = arq as Record<string, unknown> | null | undefined;
            if (!item || typeof item.caminho !== 'string' || !item.caminho.trim()) {
                avisos.push(`arquivos[${i}] descartado: caminho ausente/inválido.`);
                continue;
            }
            if (!TIPOS_ARQUIVO_VALIDOS.includes(item.tipo as TipoArquivoSolaris)) {
                avisos.push(`arquivos[${i}] (${item.caminho}): tipo inválido, forçado pra 'outro'.`);
            }
            arquivosValidos.push({
                caminho: item.caminho.trim(),
                tipo: TIPOS_ARQUIVO_VALIDOS.includes(item.tipo as TipoArquivoSolaris) ? item.tipo as TipoArquivoSolaris : 'outro',
                descricao: typeof item.descricao === 'string' ? item.descricao : '',
            });
        }
    }

    if (erros.length > 0) {
        return { ok: false, erros, avisos, manifesto: null };
    }

    return {
        ok: true,
        erros,
        avisos,
        manifesto: {
            assets,
            framework: raw.framework as FrameworkSolaris,
            objetivo: typeof raw.objetivo === 'string' ? raw.objetivo : '',
            paginas: Array.isArray(raw.paginas) ? raw.paginas.filter((p): p is string => typeof p === 'string') : [],
            componentes: Array.isArray(raw.componentes) ? raw.componentes.filter((c): c is string => typeof c === 'string') : [],
            arquivos: arquivosValidos,
            dependencias: Array.isArray(raw.dependencias) ? raw.dependencias.filter((d): d is string => typeof d === 'string') : [],
        },
    };
}
