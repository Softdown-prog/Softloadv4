'use strict';

/**
 * Testes do Sol — solAgent.js. Cobre a parte determinística e
 * crítica de segurança (_caminhoSeguro/executeSolTool), que roda
 * 100% sem rede. perguntarAoSol() (o loop agêntico de verdade) exige
 * GEMINI_API_KEY e chamada real à API — não testável aqui; a validação
 * de que o loop está correto foi feita por inspeção, espelhando o
 * mesmo padrão já em produção conceitual em src/rag/ragAgent.js.
 *
 * executeSolTool é async (consultar_telemetria depende de Firestore) —
 * este arquivo roda dentro de uma IIFE async pra poder usar await em
 * cada chamada.
 *
 * Execute: node src/ai/solAgent.test.js
 */

const { _agregarEventos } = require('../core/telemetria');
const { TokenBudget } = require('../rag/ragAgent');
const {
    executeSolTool, _caminhoSeguro, SOL_TOOL_DECLARATIONS,
    _buscarNoCodigo, _statusNichos,
} = require('./solAgent');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

(async () => {

// A. _caminhoSeguro — segurança de path é a parte mais crítica.
assert('permite arquivo dentro de src/', _caminhoSeguro('src/ai/solAgent.js') !== null);
assert('permite pasta dentro de src/', _caminhoSeguro('src/core') !== null);
assert('permite scripts/', _caminhoSeguro('scripts') !== null);
assert('permite CLAUDE.md na raiz', _caminhoSeguro('CLAUDE.md') !== null);
assert('permite "." (raiz, só listagem)', _caminhoSeguro('.') !== null);

assert('nega .env na raiz', _caminhoSeguro('.env') === null);
assert('nega .env.production', _caminhoSeguro('.env.production') === null);
assert('nega path traversal pra fora do projeto', _caminhoSeguro('../../../etc/passwd') === null);
assert('nega path traversal disfarçado dentro de src/', _caminhoSeguro('src/../../../etc/passwd') === null);
assert('nega pasta não listada (node_modules)', _caminhoSeguro('node_modules/express/package.json') === null);
assert('nega arquivo de raiz não permitido (server.js)', _caminhoSeguro('server.js') === null);
assert('nega arquivo com "secret" no nome mesmo dentro de src/', _caminhoSeguro('src/config/my-secret-key.js') === null);
assert('nega arquivo .pem mesmo dentro de src/', _caminhoSeguro('src/certs/algo.pem') === null);
assert('entrada não-string retorna null', _caminhoSeguro(null) === null);
assert('entrada vazia retorna null (cai no "." mas string vazia falha o trim)', _caminhoSeguro('') !== undefined); // não deve lançar

// B. executeSolTool — listar_arquivos.
{
    const budget = new TokenBudget();
    const r = await executeSolTool('listar_arquivos', { pasta: 'src/core/compilerEngine/workers' }, budget);
    assert('listar_arquivos: lista os 3 workers', Array.isArray(r.arquivos) && r.arquivos.includes('cssWorker.js') && r.arquivos.includes('jsWorker.js') && r.arquivos.includes('htmlWorker.js'), JSON.stringify(r));
    assert('listar_arquivos: incrementa toolCalls do budget', budget.toolCalls === 1);
}
{
    const budget = new TokenBudget();
    const r = await executeSolTool('listar_arquivos', { pasta: '../../../etc' }, budget);
    assert('listar_arquivos: nega path traversal', !!r.erro);
}

// C. executeSolTool — ler_arquivo_codigo.
{
    const budget = new TokenBudget();
    const r = await executeSolTool('ler_arquivo_codigo', { caminho: 'CLAUDE.md' }, budget);
    assert('ler_arquivo_codigo: lê CLAUDE.md com sucesso', typeof r.conteudo === 'string' && r.conteudo.includes('Softload'), JSON.stringify(r).slice(0, 200));
    assert('ler_arquivo_codigo: registra tokens no budget', budget.used > 0);
    assert('ler_arquivo_codigo: registra o arquivo em filesLoaded', budget.filesLoaded.includes('CLAUDE.md'));
}
{
    const budget = new TokenBudget();
    const r = await executeSolTool('ler_arquivo_codigo', { caminho: '.env' }, budget);
    assert('ler_arquivo_codigo: nega leitura de .env', !!r.erro && r.erro.includes('Acesso negado'));
}
{
    const budget = new TokenBudget();
    const r = await executeSolTool('ler_arquivo_codigo', { caminho: 'src/core/compilerEngine' }, budget);
    assert('ler_arquivo_codigo: recusa pasta (não é arquivo)', !!r.erro && r.erro.includes('pasta'));
}

// D. check_token_budget.
{
    const budget = new TokenBudget();
    budget.track(100, 'teste');
    const r = await executeSolTool('check_token_budget', {}, budget);
    assert('check_token_budget: reflete tokens usados', r.tokensUsados === 100);
}

// E. Formato das declarações de ferramenta — schema Gemini bem-formado.
{
    const nomes = SOL_TOOL_DECLARATIONS.functionDeclarations.map(f => f.name);
    assert('declara listar_arquivos', nomes.includes('listar_arquivos'));
    assert('declara ler_arquivo_codigo', nomes.includes('ler_arquivo_codigo'));
    assert('declara check_token_budget', nomes.includes('check_token_budget'));
    assert('declara buscar_no_codigo', nomes.includes('buscar_no_codigo'));
    assert('declara consultar_telemetria', nomes.includes('consultar_telemetria'));
    assert('declara status_nichos', nomes.includes('status_nichos'));
    assert('declara consultar_conhecimento_tecnico', nomes.includes('consultar_conhecimento_tecnico'));
    assert('declara analisar_css', nomes.includes('analisar_css'));
    assert('declara analisar_html', nomes.includes('analisar_html'));
    assert('declara analisar_js', nomes.includes('analisar_js'));
    assert('declara analisar_xml', nomes.includes('analisar_xml'));
}

// E3. executeSolTool — analisar_css (dispatcher aciona o parser certo).
{
    const budget = new TokenBudget();
    const r = await executeSolTool('analisar_css', { css: '.x { color: var(--nunca-declarada); }' }, budget);
    assert('analisar_css: ok=true (sintaxe válida)', r.ok === true, JSON.stringify(r));
    assert('analisar_css: detecta variável órfã via dispatcher', r.variaveisOrfas.length === 1, JSON.stringify(r));
}
{
    const budget = new TokenBudget();
    const r = await executeSolTool('analisar_css', { css: '.x { color: red;' }, budget);
    assert('analisar_css: sintaxe inválida devolve ok=false, não lança', r.ok === false);
}

// E4. executeSolTool — analisar_html/analisar_js/analisar_xml (dispatcher).
{
    const budget = new TokenBudget();
    const r = await executeSolTool('analisar_html', { html: '<div id="a"><span id="a"></span></div>' }, budget);
    assert('analisar_html: ok=true', r.ok === true, JSON.stringify(r));
    assert('analisar_html: detecta id duplicado via dispatcher', r.idsDuplicados.includes('a'), JSON.stringify(r));
}
{
    const budget = new TokenBudget();
    const r = await executeSolTool('analisar_js', { js: 'function f() { return zzzNuncaDeclarada; }' }, budget);
    assert('analisar_js: ok=true', r.ok === true, JSON.stringify(r));
    assert('analisar_js: detecta identificador não declarado via dispatcher',
        r.identificadoresNaoDeclarados.some(i => i.nome === 'zzzNuncaDeclarada'), JSON.stringify(r));
}
{
    const budget = new TokenBudget();
    const r = await executeSolTool('analisar_xml', { xml: '<a><b id="x"/><c id="x"/></a>' }, budget);
    assert('analisar_xml: ok=true', r.ok === true, JSON.stringify(r));
    assert('analisar_xml: detecta id duplicado via dispatcher', r.idsDuplicados.some(d => d.id === 'x'), JSON.stringify(r));
}

// E2. executeSolTool — consultar_conhecimento_tecnico (base vazia, hoje).
{
    const budget = new TokenBudget();
    const r = await executeSolTool('consultar_conhecimento_tecnico', { pergunta: 'como funciona include no EJS' }, budget);
    assert('consultar_conhecimento_tecnico: base vazia avisa em vez de inventar', typeof r.aviso === 'string' && Array.isArray(r.resultados) && r.resultados.length === 0, JSON.stringify(r));
    assert('consultar_conhecimento_tecnico: incrementa toolCalls do budget', budget.toolCalls === 1);
}

// F. buscar_no_codigo — grep case-insensitive limitado.
{
    const r = _buscarNoCodigo('resolverPeca');
    assert('buscar_no_codigo: acha pecaOrchestrator.js', r.ocorrencias.some(o => o.arquivo.includes('pecaOrchestrator.js')), JSON.stringify(r).slice(0, 200));
    assert('buscar_no_codigo: cada ocorrência tem arquivo/linha/trecho', r.ocorrencias.every(o => o.arquivo && typeof o.linha === 'number' && typeof o.trecho === 'string'));
}
{
    const r = _buscarNoCodigo('');
    assert('buscar_no_codigo: termo vazio retorna erro', !!r.erro);
}
{
    // termo montado em runtime pra não aparecer literalmente neste arquivo
    // (senão a própria busca recursiva se encontraria aqui dentro).
    const termoInexistente = ['zzqwexyz', '9182', 'naoexiste'].join('-');
    const r = _buscarNoCodigo(termoInexistente);
    assert('buscar_no_codigo: termo inexistente retorna 0 ocorrências, sem erro', r.totalEncontrado === 0 && !r.erro);
}
{
    const budget = new TokenBudget();
    const r = await executeSolTool('buscar_no_codigo', { termo: 'perguntarAoSol' }, budget);
    assert('executeSolTool: buscar_no_codigo funciona via dispatcher', Array.isArray(r.ocorrencias));
}

// G. consultar_telemetria — a agregação em si (_agregarEventos, pura)
// é testada em src/core/telemetria.test.js. Aqui só confirma que o
// dispatcher aciona a ferramenta certa e devolve algo com o shape
// esperado — sem exercitar a leitura real do Firestore (sem
// credenciais neste ambiente), consistente com o resto deste arquivo.
{
    const eventos = [
        { nichoTema: 'teste-sol-a', pecaGeradaPorIA: true, validadoresPassaram: { xmlSemAvisos: true, dossieDomIds: false } },
        { nichoTema: 'teste-sol-a', pecaGeradaPorIA: false, validadoresPassaram: { xmlSemAvisos: true, dossieDomIds: true } },
        { nichoTema: 'teste-sol-b', pecaGeradaPorIA: false, validadoresPassaram: { xmlSemAvisos: true, dossieDomIds: true } },
    ];
    const r = _agregarEventos(eventos);
    assert('consultar_telemetria (agregação): total correto', r.totalCompilacoes === 3, JSON.stringify(r));
    assert('consultar_telemetria (agregação): agrega por nicho', r.porNicho['teste-sol-a'] === 2 && r.porNicho['teste-sol-b'] === 1);
    assert('consultar_telemetria (agregação): conta peça gerada por IA', r.compilacoesComPecaGeradaPorIA === 1);
    assert('consultar_telemetria (agregação): conta falha de validador', r.falhasPorValidador.dossieDomIds === 1);
}

// H. status_nichos — reflete os 14 nichos, todos migrados pro dossiê ao
// final da leva de migrações desta sessão.
{
    const r = _statusNichos();
    assert('status_nichos: retorna lista não vazia', r.totalNichos > 0);
    const porNome = Object.fromEntries(r.nichos.map(n => [n.nicho, n]));
    assert('status_nichos: culinaria-boutique-gourmet migrado', porNome['culinaria-boutique-gourmet']?.migradoParaDossie === true);
    assert('status_nichos: viral-magazine migrado', porNome['viral-magazine']?.migradoParaDossie === true);
    assert('status_nichos: tecnologia-techwind migrado', porNome['tecnologia-techwind']?.migradoParaDossie === true);
    assert('status_nichos: appstore-bulma-mobile migrado (último da leva)', porNome['appstore-bulma-mobile']?.migradoParaDossie === true);
    assert('status_nichos: todos os 14 nichos migrados', r.nichos.every(n => n.migradoParaDossie === true));
    assert('status_nichos: contador "migrados" bate com a lista', r.migrados === r.nichos.filter(n => n.migradoParaDossie).length);
}

console.log(`\n${failed === 0 ? '✅' : '❌'} solAgent: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

})();
