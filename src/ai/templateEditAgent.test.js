'use strict';

/**
 * Testes do templateEditAgent — mesmo escopo de solAgent.test.js: NÃO testa
 * o loop Gemini de ponta a ponta (exigiria chamada de rede real), só as
 * peças puras/determinísticas — o executor de ferramentas isolado
 * (criarExecutorDeFerramentas), a invariante de segurança "nunca aplica no
 * mesmo turno em que propôs", a validação de argumentos via validarEdicao
 * reaproveitado, e a função de label.
 *
 * Execute: node src/ai/templateEditAgent.test.js
 */

const {
    criarExecutorDeFerramentas,
    _labelParaFerramentaEdicao,
    _extrairBlocosScript,
    _validarCamposLivres,
    TEMPLATE_EDIT_TOOL_DECLARATIONS,
} = require('./templateEditAgent');
const { GEMINI_EDIT_RESPONSE_SCHEMA } = require('./templateEditSchema');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

const MANIFESTO_BASE = {
    siteName: 'Blog Teste',
    colorPreset: 'tech-blue',
    typography: 'inter',
    customCss: 'x'.repeat(300), // maior que 160 chars — testa truncamento de _resumirManifesto
};

async function run() {
    // ── Declarações de ferramentas ──────────────────────────────────────
    {
        const nomes = TEMPLATE_EDIT_TOOL_DECLARATIONS.functionDeclarations.map(f => f.name);
        assert('5 ferramentas declaradas', nomes.length === 5, nomes.join(','));
        assert('ver_template_atual declarada', nomes.includes('ver_template_atual'));
        assert('ver_proposta_pendente declarada', nomes.includes('ver_proposta_pendente'));
        assert('propor_edicao declarada', nomes.includes('propor_edicao'));
        assert('aplicar_edicao_pendente declarada', nomes.includes('aplicar_edicao_pendente'));
        assert('cancelar_edicao_pendente declarada', nomes.includes('cancelar_edicao_pendente'));

        const propor = TEMPLATE_EDIT_TOOL_DECLARATIONS.functionDeclarations.find(f => f.name === 'propor_edicao');
        assert('propor_edicao reaproveita GEMINI_EDIT_RESPONSE_SCHEMA (mesma referência, não duplicado)',
            propor.parameters === GEMINI_EDIT_RESPONSE_SCHEMA);
    }

    // ── Labels ───────────────────────────────────────────────────────────
    {
        assert('label ver_template_atual', _labelParaFerramentaEdicao('ver_template_atual').length > 0);
        assert('label propor_edicao', _labelParaFerramentaEdicao('propor_edicao').length > 0);
        assert('label aplicar_edicao_pendente', _labelParaFerramentaEdicao('aplicar_edicao_pendente').length > 0);
        assert('label ferramenta desconhecida cai no default', _labelParaFerramentaEdicao('xyz').includes('xyz'));
    }

    // ── ver_template_atual — devolve manifesto resumido (trunca campo longo) ──
    {
        const { executar } = criarExecutorDeFerramentas(MANIFESTO_BASE, null, async () => ({}));
        const r = await executar('ver_template_atual', {});
        assert('ver_template_atual devolve manifesto', !!r.manifesto);
        assert('ver_template_atual trunca customCss longo', r.manifesto.customCss.includes('truncado'));
        assert('ver_template_atual preserva siteName intacto', r.manifesto.siteName === 'Blog Teste');
    }

    // ── ver_proposta_pendente — reflete o estado inicial ────────────────
    {
        const semPendencia = criarExecutorDeFerramentas(MANIFESTO_BASE, null, async () => ({}));
        const r1 = await semPendencia.executar('ver_proposta_pendente', {});
        assert('sem proposta inicial: pendente=false', r1.pendente === false);

        const comPendencia = criarExecutorDeFerramentas(MANIFESTO_BASE, { campos: { siteName: 'Novo Nome' }, resumo: 'Muda o nome' }, async () => ({}));
        const r2 = await comPendencia.executar('ver_proposta_pendente', {});
        assert('com proposta inicial: pendente=true', r2.pendente === true);
        assert('com proposta inicial: resumo correto', r2.resumo === 'Muda o nome');
    }

    // ── propor_edicao — args válidos ────────────────────────────────────
    {
        const { executar, estado } = criarExecutorDeFerramentas(MANIFESTO_BASE, null, async () => ({}));
        const r = await executar('propor_edicao', { siteName: 'Site Novo', resumoMudancas: 'Muda o nome do site' });
        assert('propor_edicao válido: sucesso=true', r.sucesso === true, JSON.stringify(r));
        assert('propor_edicao válido: campo aceito', r.camposAceitos.includes('siteName'));
        assert('propor_edicao válido: estado.propostaAtual setado', estado.propostaAtual && estado.propostaAtual.resumo === 'Muda o nome do site');
        assert('propor_edicao válido: propostaFoiCriadaNesteTurno=true', estado.propostaFoiCriadaNesteTurno === true);
    }

    // ── propor_edicao — args vazios/sem campo reconhecido ───────────────
    {
        const { executar, estado } = criarExecutorDeFerramentas(MANIFESTO_BASE, null, async () => ({}));
        const r = await executar('propor_edicao', { resumoMudancas: '' });
        assert('propor_edicao vazio: devolve erro', typeof r.erro === 'string' && r.erro.length > 0);
        assert('propor_edicao vazio: não seta proposta', estado.propostaAtual === null);
    }

    // ── propor_edicao — enum inválido é descartado, não invalida a proposta inteira ──
    {
        const { executar } = criarExecutorDeFerramentas(MANIFESTO_BASE, null, async () => ({}));
        const r = await executar('propor_edicao', { colorPreset: 'cor-que-nao-existe', siteName: 'Válido', resumoMudancas: 'Muda nome e tenta cor inválida' });
        assert('propor_edicao parcialmente inválido: ainda sucesso (campo válido sobrevive)', r.sucesso === true, JSON.stringify(r));
        assert('propor_edicao parcialmente inválido: campo inválido descartado', !r.camposAceitos.includes('colorPreset'));
        assert('propor_edicao parcialmente inválido: campo válido aceito', r.camposAceitos.includes('siteName'));
        assert('propor_edicao parcialmente inválido: avisos reportados', Array.isArray(r.avisos) && r.avisos.length > 0);
    }

    // ── _extrairBlocosScript — extração de <script> de HTML solto ───────
    {
        assert('_extrairBlocosScript: HTML sem script → []', _extrairBlocosScript('<div>oi</div>').length === 0);
        assert('_extrairBlocosScript: string vazia/inválida → []', _extrairBlocosScript('').length === 0 && _extrairBlocosScript(null).length === 0);
        const blocos = _extrairBlocosScript('<div>x</div><script>const a = 1;</script><p>y</p><script src="x.js"></script><script>const b = 2;</script>');
        assert('_extrairBlocosScript: extrai só os blocos com conteúdo (ignora script vazio/externo)', blocos.length === 2, JSON.stringify(blocos));
        assert('_extrairBlocosScript: conteúdo correto', blocos[0].includes('const a = 1') && blocos[1].includes('const b = 2'));
    }

    // ── _validarCamposLivres — customCss com variável órfã é rejeitado ───
    {
        const erros = _validarCamposLivres({ customCss: '.x { color: var(--nao-declarada); }' }, MANIFESTO_BASE);
        assert('_validarCamposLivres: customCss com var órfã gera erro', erros.length > 0, JSON.stringify(erros));
        assert('_validarCamposLivres: erro prefixado com customCss:', erros[0].startsWith('customCss:'));
    }

    // ── _validarCamposLivres — customCss válido não gera erro ───────────
    {
        const erros = _validarCamposLivres({ customCss: '.x { color: #fff; }' }, MANIFESTO_BASE);
        assert('_validarCamposLivres: customCss válido sem erro', erros.length === 0, JSON.stringify(erros));
    }

    // ── _validarCamposLivres — heroHtml com <script> quebrado é rejeitado ─
    {
        const erros = _validarCamposLivres({ heroHtml: '<div>hero</div><script>const x = ;</script>' }, MANIFESTO_BASE);
        assert('_validarCamposLivres: heroHtml com JS sintaticamente inválido gera erro', erros.length > 0, JSON.stringify(erros));
        assert('_validarCamposLivres: erro prefixado com heroHtml:', erros[0].startsWith('heroHtml:'));
    }

    // ── _validarCamposLivres — heroHtml com script válido não gera erro ──
    {
        const erros = _validarCamposLivres({ heroHtml: '<div>hero</div><script>const y = 1;</script>' }, MANIFESTO_BASE);
        assert('_validarCamposLivres: heroHtml com JS válido sem erro', erros.length === 0, JSON.stringify(erros));
    }

    // ── _validarCamposLivres — heroHtml sem <script> nenhum não gera erro ─
    {
        const erros = _validarCamposLivres({ heroHtml: '<div>hero sem script</div>' }, MANIFESTO_BASE);
        assert('_validarCamposLivres: heroHtml sem script sem erro', erros.length === 0, JSON.stringify(erros));
    }

    // ── propor_edicao — customCss com var órfã é recusado pelo executor ──
    {
        const { executar, estado } = criarExecutorDeFerramentas(MANIFESTO_BASE, null, async () => ({}));
        const r = await executar('propor_edicao', { customCss: '.x { color: var(--inexistente); }', resumoMudancas: 'Muda o CSS' });
        assert('propor_edicao com customCss inválido: devolve erro', typeof r.erro === 'string' && r.erro.length > 0, JSON.stringify(r));
        assert('propor_edicao com customCss inválido: detalhes presentes', Array.isArray(r.detalhes) && r.detalhes.length > 0);
        assert('propor_edicao com customCss inválido: não seta proposta pendente', estado.propostaAtual === null);
    }

    // ── INVARIANTE DE SEGURANÇA: não aplica no mesmo turno em que propôs ──
    {
        let aplicarChamado = false;
        const aplicarEdicaoReal = async (campos) => { aplicarChamado = true; return { downloadUrl: 'https://x/download', manifesto: { ...MANIFESTO_BASE, ...campos } }; };
        const { executar, estado } = criarExecutorDeFerramentas(MANIFESTO_BASE, null, aplicarEdicaoReal);

        await executar('propor_edicao', { siteName: 'Site Novo', resumoMudancas: 'Muda o nome' });
        const rApply = await executar('aplicar_edicao_pendente', {});

        assert('aplicar logo após propor: devolve erro (não aplica)', typeof rApply.erro === 'string' && rApply.erro.length > 0, JSON.stringify(rApply));
        assert('aplicar logo após propor: aplicarEdicaoReal NUNCA foi chamado', aplicarChamado === false);
        assert('aplicar logo após propor: proposta continua pendente (não foi limpa)', estado.propostaAtual !== null);
    }

    // ── Aplicar SÓ funciona quando a proposta veio de um turno ANTERIOR ──
    {
        let aplicarChamado = false;
        const aplicarEdicaoReal = async (campos) => { aplicarChamado = true; return { downloadUrl: 'https://x/download', manifesto: { ...MANIFESTO_BASE, ...campos } }; };
        // propostaInicial simula uma proposta carregada do Firestore (turno anterior) — NÃO criada neste executor.
        const { executar, estado } = criarExecutorDeFerramentas(MANIFESTO_BASE, { campos: { siteName: 'Site Novo' }, resumo: 'Muda o nome' }, aplicarEdicaoReal);

        const r = await executar('aplicar_edicao_pendente', {});
        assert('aplicar de proposta de turno anterior: sucesso=true', r.sucesso === true, JSON.stringify(r));
        assert('aplicar de proposta de turno anterior: aplicarEdicaoReal foi chamado', aplicarChamado === true);
        assert('aplicar de proposta de turno anterior: downloadUrl devolvido', r.downloadUrl === 'https://x/download');
        assert('aplicar de proposta de turno anterior: estado.downloadUrlAplicado setado', estado.downloadUrlAplicado === 'https://x/download');
        assert('aplicar de proposta de turno anterior: proposta limpa depois de aplicar', estado.propostaAtual === null);
    }

    // ── aplicar_edicao_pendente sem nenhuma proposta pendente ───────────
    {
        const { executar } = criarExecutorDeFerramentas(MANIFESTO_BASE, null, async () => ({}));
        const r = await executar('aplicar_edicao_pendente', {});
        assert('aplicar sem proposta: erro', typeof r.erro === 'string' && r.erro.length > 0);
    }

    // ── aplicar_edicao_pendente propaga falha do handler sem lançar ─────
    {
        const aplicarEdicaoReal = async () => { throw new Error('falha de compilação simulada'); };
        const { executar } = criarExecutorDeFerramentas(MANIFESTO_BASE, { campos: { siteName: 'X' }, resumo: 'Y' }, aplicarEdicaoReal);
        const r = await executar('aplicar_edicao_pendente', {});
        assert('falha no handler de aplicação: erro devolvido, não lançado', typeof r.erro === 'string' && r.erro.includes('falha de compilação simulada'));
    }

    // ── cancelar_edicao_pendente ─────────────────────────────────────────
    {
        const { executar, estado } = criarExecutorDeFerramentas(MANIFESTO_BASE, { campos: { siteName: 'X' }, resumo: 'Y' }, async () => ({}));
        const r = await executar('cancelar_edicao_pendente', {});
        assert('cancelar com proposta pendente: sucesso', r.sucesso === true);
        assert('cancelar: estado limpo', estado.propostaAtual === null);

        const r2 = await executar('cancelar_edicao_pendente', {});
        assert('cancelar sem proposta pendente: erro', typeof r2.erro === 'string' && r2.erro.length > 0);
    }

    // ── ferramenta desconhecida ──────────────────────────────────────────
    {
        const { executar } = criarExecutorDeFerramentas(MANIFESTO_BASE, null, async () => ({}));
        const r = await executar('ferramenta_que_nao_existe', {});
        assert('ferramenta desconhecida: erro', typeof r.erro === 'string' && r.erro.length > 0);
    }

    console.log(`\n${failed === 0 ? '✅' : '❌'} templateEditAgent: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
}

run();
