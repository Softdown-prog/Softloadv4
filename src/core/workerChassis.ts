/**
 * Carregamento de chassis Blogger com I/O delegado ao worker CommonJS.
 * Preserva prioridade do nicho, fallback da família, validação e cache.
 */
export interface ChassisDependencies {
    workerDir: string;
    joinPath: (...segments: string[]) => string;
    readFileSync: (filePath: string, encoding: 'utf-8') => string;
    existsSync: (filePath: string) => boolean;
    chassisParaNicho: (nicho: string) => string | null;
    warn: (message: string) => void;
}

/** O cache de includables pertence à instância, não à compilação. */
export function criarCarregadorChassis(deps: ChassisDependencies): (nichoTema: unknown) => string {
    let _includablesPadraoCache: string | null = null;

    function templateParaNicho(nichoTema: unknown): string {
        if (!nichoTema) return 'base';
        const chave = String(nichoTema).replace(/^tema-/, '').toLowerCase().trim();
        return deps.chassisParaNicho(chave) || 'base';
    }

    function resolverIncludablesPadrao(conteudo: string): string {
        if (!conteudo.includes('[[BLOGGER_INCLUDABLES_PADRAO]]')) return conteudo;
        if (_includablesPadraoCache === null) {
            const partialPath = deps.joinPath(deps.workerDir, '../blogger/templates/_partials/blogger-includables-padrao.xml');
            _includablesPadraoCache = deps.readFileSync(partialPath, 'utf-8');
        }
        return conteudo.split('[[BLOGGER_INCLUDABLES_PADRAO]]').join(_includablesPadraoCache);
    }

    function carregarChassis(templateTipo = 'base'): string {
        const nomeArquivo = templateTipo === 'base'
            ? 'template_base.xml'
            : 'template_' + templateTipo + '.xml';
        const templatePath = deps.joinPath(deps.workerDir, '../blogger/templates', nomeArquivo);
        let conteudo: string;
        try {
            conteudo = deps.readFileSync(templatePath, 'utf-8');
        } catch (err) {
            if (templateTipo !== 'base') {
                deps.warn('[CHASSIS] template_' + templateTipo + '.xml não encontrado, usando base.');
                return carregarChassis('base');
            }
            throw new Error('[CHASSIS] Falha ao ler template_base.xml: ' + (err as Error).message);
        }
        if (!conteudo || conteudo.length < 200) {
            throw new Error('[CHASSIS] ' + nomeArquivo + ' está vazio ou corrompido.');
        }
        return resolverIncludablesPadrao(conteudo);
    }

    return function carregarChassisParaNicho(nichoTema: unknown): string {
        const chave = nichoTema ? String(nichoTema).replace(/^tema-/, '').toLowerCase().trim() : '';
        if (chave) {
            const caminhoProprio = deps.joinPath(deps.workerDir, '../blogger/templates', 'template_' + chave + '.xml');
            if (deps.existsSync(caminhoProprio)) {
                return carregarChassis(chave);
            }
        }
        return carregarChassis(templateParaNicho(nichoTema));
    };
}
