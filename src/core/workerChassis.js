"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.criarCarregadorChassis = criarCarregadorChassis;
/** O cache de includables pertence à instância, não à compilação. */
function criarCarregadorChassis(deps) {
    let _includablesPadraoCache = null;
    function templateParaNicho(nichoTema) {
        if (!nichoTema)
            return 'base';
        const chave = String(nichoTema).replace(/^tema-/, '').toLowerCase().trim();
        return deps.chassisParaNicho(chave) || 'base';
    }
    function resolverIncludablesPadrao(conteudo) {
        if (!conteudo.includes('[[BLOGGER_INCLUDABLES_PADRAO]]'))
            return conteudo;
        if (_includablesPadraoCache === null) {
            const partialPath = deps.joinPath(deps.workerDir, '../blogger/templates/_partials/blogger-includables-padrao.xml');
            _includablesPadraoCache = deps.readFileSync(partialPath, 'utf-8');
        }
        return conteudo.split('[[BLOGGER_INCLUDABLES_PADRAO]]').join(_includablesPadraoCache);
    }
    function carregarChassis(templateTipo = 'base') {
        const nomeArquivo = templateTipo === 'base'
            ? 'template_base.xml'
            : 'template_' + templateTipo + '.xml';
        const templatePath = deps.joinPath(deps.workerDir, '../blogger/templates', nomeArquivo);
        let conteudo;
        try {
            conteudo = deps.readFileSync(templatePath, 'utf-8');
        }
        catch (err) {
            if (templateTipo !== 'base') {
                deps.warn('[CHASSIS] template_' + templateTipo + '.xml não encontrado, usando base.');
                return carregarChassis('base');
            }
            throw new Error('[CHASSIS] Falha ao ler template_base.xml: ' + err.message);
        }
        if (!conteudo || conteudo.length < 200) {
            throw new Error('[CHASSIS] ' + nomeArquivo + ' está vazio ou corrompido.');
        }
        return resolverIncludablesPadrao(conteudo);
    }
    return function carregarChassisParaNicho(nichoTema) {
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
