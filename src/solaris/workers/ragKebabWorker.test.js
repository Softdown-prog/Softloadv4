'use strict';

/**
 * Testes de ragKebabWorker.js — funções puras testadas diretamente;
 * normalizarDiretorioRag testado contra um diretório temporário
 * isolado (fs.mkdtempSync/fs.rmSync, mesmo padrão de fileTools.test.js)
 * pra nunca tocar o catálogo real do repositório.
 *
 * Execute: node src/solaris/workers/ragKebabWorker.test.js
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const {
    ehArquivoDeCatalogo,
    listarArquivosDeCatalogo,
    separarNomeExtensao,
    paraKebabCase,
    ehKebabCase,
    validarNomeArquivo,
    normalizarDiretorioRag,
    auditarCatalogo,
    validarEntradaGerada,
} = require('./ragKebabWorker');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

function run() {
    // A. ehArquivoDeCatalogo filtra .js/.md/dotfiles, aceita o resto.
    {
        assert('ehArquivoDeCatalogo(".gitkeep") false', ehArquivoDeCatalogo('.gitkeep') === false);
        assert('ehArquivoDeCatalogo("worker.js") false', ehArquivoDeCatalogo('ragKebabWorker.js') === false);
        assert('ehArquivoDeCatalogo("README.md") false', ehArquivoDeCatalogo('README.md') === false);
        assert('ehArquivoDeCatalogo("Blog") true', ehArquivoDeCatalogo('Blog') === true);
        assert('ehArquivoDeCatalogo("Documentação.json") true', ehArquivoDeCatalogo('Documentação.json') === true);
    }

    // B. separarNomeExtensao.
    {
        const r1 = separarNomeExtensao('Documentação.json');
        assert('separarNomeExtensao base', r1.base === 'Documentação');
        assert('separarNomeExtensao ext', r1.ext === '.json');
        const r2 = separarNomeExtensao('Blog');
        assert('separarNomeExtensao sem extensão: base = nome inteiro', r2.base === 'Blog');
        assert('separarNomeExtensao sem extensão: ext vazia', r2.ext === '');
    }

    // C. paraKebabCase — acentos, maiúsculas, camelCase, espaços/hífen misto.
    {
        assert('paraKebabCase("Agência")', paraKebabCase('Agência') === 'agencia');
        assert('paraKebabCase("Clínica")', paraKebabCase('Clínica') === 'clinica');
        assert('paraKebabCase("Landing-page")', paraKebabCase('Landing-page') === 'landing-page');
        assert('paraKebabCase("LandingPage") separa camelCase', paraKebabCase('LandingPage') === 'landing-page');
        assert('paraKebabCase("Dashboard Admin") vira hífen', paraKebabCase('Dashboard Admin') === 'dashboard-admin');
        assert('paraKebabCase("  espacos  extras ") colapsa hífens', paraKebabCase('  espacos  extras ') === 'espacos-extras');
        assert('paraKebabCase("") vazio', paraKebabCase('') === '');
    }

    // D. ehKebabCase.
    {
        assert('ehKebabCase("landing-page") true', ehKebabCase('landing-page') === true);
        assert('ehKebabCase("blog") true', ehKebabCase('blog') === true);
        assert('ehKebabCase("Blog") false (maiúscula)', ehKebabCase('Blog') === false);
        assert('ehKebabCase("landing_page") false (underscore)', ehKebabCase('landing_page') === false);
        assert('ehKebabCase("landing--page") false (hífen duplo)', ehKebabCase('landing--page') === false);
        assert('ehKebabCase("landing-página") false (acento)', ehKebabCase('landing-página') === false);
    }

    // E. validarNomeArquivo — sem extensão, não-kebab (achado real dos arquivos do catálogo).
    {
        const r = validarNomeArquivo('Agência');
        assert('validarNomeArquivo("Agência") ok true (lint, não bloqueante)', r.ok === true);
        assert('validarNomeArquivo("Agência") aponta falta de extensão', r.avisos.some((a) => a.includes('sem extensão')));
        assert('validarNomeArquivo("Agência") aponta não-kebab', r.avisos.some((a) => a.includes('kebab-case')));
        assert('validarNomeArquivo("Agência") sugere nome correto', r.nomeSugerido === 'agencia.json');
    }

    // F. validarNomeArquivo — já correto, sem aviso nenhum.
    {
        const r = validarNomeArquivo('landing-page.json');
        assert('validarNomeArquivo já kebab+.json: ok true', r.ok === true);
        assert('validarNomeArquivo já kebab+.json: sem avisos', r.avisos.length === 0);
        assert('validarNomeArquivo já kebab+.json: nomeSugerido = mesmo nome', r.nomeSugerido === 'landing-page.json');
    }

    // G. validarNomeArquivo — extensão presente mas errada, e nome já kebab.
    {
        const r = validarNomeArquivo('blog.txt');
        assert('validarNomeArquivo extensão errada: ok true', r.ok === true);
        assert('validarNomeArquivo extensão errada: aviso de extensão', r.avisos.some((a) => a.includes('extensão')));
        assert('validarNomeArquivo extensão errada: sem aviso de kebab (base já é kebab)', !r.avisos.some((a) => a.includes('kebab-case')));
        assert('validarNomeArquivo extensão errada: sugere .json', r.nomeSugerido === 'blog.json');
    }

    // H. validarNomeArquivo — extensão .json presente mas nome com maiúscula/acento
    // (achado real: Documentação.json).
    {
        const r = validarNomeArquivo('Documentação.json');
        assert('validarNomeArquivo("Documentação.json") ok true', r.ok === true);
        assert('validarNomeArquivo("Documentação.json") sem aviso de extensão (já é .json)', !r.avisos.some((a) => a.includes('sem extensão') || a.includes('esperada')));
        assert('validarNomeArquivo("Documentação.json") aponta não-kebab', r.avisos.some((a) => a.includes('kebab-case')));
        assert('validarNomeArquivo("Documentação.json") sugere nome correto', r.nomeSugerido === 'documentacao.json');
    }

    // I. validarNomeArquivo — entrada vazia/inválida não lança, retorna ok false.
    {
        assert('validarNomeArquivo("") ok false', validarNomeArquivo('').ok === false);
        assert('validarNomeArquivo(null) ok false', validarNomeArquivo(null).ok === false);
    }

    // J. normalizarDiretorioRag — dry-run (aplicar:false) não toca disco.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-rag-kebab-test-'));
        fs.writeFileSync(path.join(dir, 'Agência'), '{"id":"agencia-digital"}');
        fs.writeFileSync(path.join(dir, 'landing-page.json'), '{"id":"landing-page"}');
        fs.writeFileSync(path.join(dir, '.gitkeep'), '');

        const relatorio = normalizarDiretorioRag({ dir, aplicar: false });
        assert('normalizarDiretorioRag dry-run: relatório cobre só os 2 arquivos de catálogo', relatorio.length === 2);
        const itemAgencia = relatorio.find((r) => r.arquivoOriginal === 'Agência');
        assert('normalizarDiretorioRag dry-run: item de "Agência" não foi aplicado', itemAgencia.aplicado === false);
        assert('normalizarDiretorioRag dry-run: "Agência" ainda existe em disco (não renomeou)', fs.existsSync(path.join(dir, 'Agência')));
        assert('normalizarDiretorioRag dry-run: "agencia.json" NÃO foi criado', !fs.existsSync(path.join(dir, 'agencia.json')));

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // K. normalizarDiretorioRag — aplicar:true renomeia de verdade e preserva conteúdo.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-rag-kebab-test-'));
        fs.writeFileSync(path.join(dir, 'Agência'), '{"id":"agencia-digital"}');
        fs.writeFileSync(path.join(dir, 'Documentação.json'), '{"id":"documentacao"}');
        fs.writeFileSync(path.join(dir, 'landing-page.json'), '{"id":"landing-page"}');

        const relatorio = normalizarDiretorioRag({ dir, aplicar: true });
        const itemAgencia = relatorio.find((r) => r.arquivoOriginal === 'Agência');
        const itemDoc     = relatorio.find((r) => r.arquivoOriginal === 'Documentação.json');
        const itemLanding = relatorio.find((r) => r.arquivoOriginal === 'landing-page.json');

        assert('normalizarDiretorioRag aplicar: "Agência" foi renomeado', itemAgencia.aplicado === true);
        assert('normalizarDiretorioRag aplicar: "agencia.json" existe em disco', fs.existsSync(path.join(dir, 'agencia.json')));
        assert('normalizarDiretorioRag aplicar: "Agência" não existe mais', !fs.existsSync(path.join(dir, 'Agência')));
        assert('normalizarDiretorioRag aplicar: conteúdo preservado', fs.readFileSync(path.join(dir, 'agencia.json'), 'utf8') === '{"id":"agencia-digital"}');

        assert('normalizarDiretorioRag aplicar: "Documentação.json" foi renomeado', itemDoc.aplicado === true);
        assert('normalizarDiretorioRag aplicar: "documentacao.json" existe', fs.existsSync(path.join(dir, 'documentacao.json')));

        assert('normalizarDiretorioRag aplicar: arquivo já correto não é tocado', itemLanding.aplicado === false);
        assert('normalizarDiretorioRag aplicar: "landing-page.json" continua existindo', fs.existsSync(path.join(dir, 'landing-page.json')));

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // L. normalizarDiretorioRag — conflito de destino já existente não sobrescreve.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-rag-kebab-test-'));
        fs.writeFileSync(path.join(dir, 'Blog'), '{"id":"blog-velho"}');
        fs.writeFileSync(path.join(dir, 'blog.json'), '{"id":"blog-real"}');

        const relatorio = normalizarDiretorioRag({ dir, aplicar: true });
        const itemBlog = relatorio.find((r) => r.arquivoOriginal === 'Blog');
        assert('normalizarDiretorioRag conflito: não aplica', itemBlog.aplicado === false);
        assert('normalizarDiretorioRag conflito: ok vira false', itemBlog.ok === false);
        assert('normalizarDiretorioRag conflito: erro explícito', itemBlog.erros.some((e) => e.includes('conflito')));
        assert('normalizarDiretorioRag conflito: "Blog" original não foi apagado', fs.existsSync(path.join(dir, 'Blog')));
        assert('normalizarDiretorioRag conflito: "blog.json" original preservado', fs.readFileSync(path.join(dir, 'blog.json'), 'utf8') === '{"id":"blog-real"}');

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // M. listarArquivosDeCatalogo — ignora PASTA_RASCUNHOS (drafts/),
    // nunca tenta ler seu conteúdo nem entra nela.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-rag-kebab-test-'));
        fs.writeFileSync(path.join(dir, 'blog.json'), '{"id":"blog"}');
        fs.mkdirSync(path.join(dir, 'drafts'));
        fs.writeFileSync(path.join(dir, 'drafts', 'rascunho.json'), '{"algo":"sem id"}');

        const nomes = listarArquivosDeCatalogo(dir);
        assert('listarArquivosDeCatalogo ignora conteúdo de "drafts"', !nomes.some((n) => n.includes('rascunho')));
        assert('listarArquivosDeCatalogo lista o arquivo real', nomes.includes('blog.json'));
        assert('listarArquivosDeCatalogo: só 1 arquivo (drafts/ não conta)', nomes.length === 1);

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // M2. listarArquivosDeCatalogo — QUALQUER OUTRA subpasta (ex.:
    // "bootstrap5/", ver ragOrganizerWorker.js) é percorrida 1 nível,
    // arquivo dentro dela entra como "pasta/arquivo.json".
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-rag-kebab-test-'));
        fs.writeFileSync(path.join(dir, 'flask.json'), '{"id":"flask"}');
        fs.mkdirSync(path.join(dir, 'bootstrap5'));
        fs.writeFileSync(path.join(dir, 'bootstrap5', 'bootstrap5-navbar.json'), '{"id":"bootstrap5-navbar"}');
        fs.writeFileSync(path.join(dir, 'bootstrap5', 'bootstrap5.json'), '{"id":"bootstrap5"}');

        const nomes = listarArquivosDeCatalogo(dir);
        assert('listarArquivosDeCatalogo: 3 arquivos ao todo (1 solto + 2 dentro do grupo)', nomes.length === 3, JSON.stringify(nomes));
        assert('listarArquivosDeCatalogo: arquivo solto entra como está', nomes.includes('flask.json'));
        assert('listarArquivosDeCatalogo: arquivo dentro do grupo entra com prefixo de pasta', nomes.includes(path.join('bootstrap5', 'bootstrap5-navbar.json')));

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // M3. validarNomeArquivo preserva o prefixo de pasta ao sugerir
    // correção — nunca trata o "/" como parte do nome-base a kebab-casear.
    {
        const nomeComPasta = path.join('bootstrap5', 'Navbar');
        const r = validarNomeArquivo(nomeComPasta);
        assert('validarNomeArquivo: ok true mesmo com prefixo de pasta', r.ok === true);
        assert('validarNomeArquivo: nomeSugerido preserva a pasta', r.nomeSugerido === path.join('bootstrap5', 'navbar.json'), r.nomeSugerido);
    }

    // N. auditarCatalogo — nome do arquivo diverge do id interno.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-rag-kebab-test-'));
        fs.writeFileSync(path.join(dir, 'bootstrap5.json'), '{"id":"bootstrap","slug":"bootstrap","categoria":"framework","descricao":"x"}');

        const { arquivos } = auditarCatalogo({ dir });
        const item = arquivos.find((a) => a.arquivo === 'bootstrap5.json');
        assert('auditarCatalogo: nome÷id divergente vira aviso', item.avisos.some((a) => a.includes('diverge do id interno')));
        assert('auditarCatalogo: divergência de nome não é erro bloqueante', item.ok === true && item.erros.length === 0);

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // O. auditarCatalogo — nome coerente com id não gera aviso de divergência.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-rag-kebab-test-'));
        fs.writeFileSync(path.join(dir, 'bootstrap5.json'), '{"id":"bootstrap5","slug":"bootstrap5","categoria":"framework","descricao":"x"}');

        const { arquivos } = auditarCatalogo({ dir });
        const item = arquivos.find((a) => a.arquivo === 'bootstrap5.json');
        assert('auditarCatalogo: nome coerente com id, sem aviso de divergência', !item.avisos.some((a) => a.includes('diverge do id interno')));

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // P. auditarCatalogo — campos recomendados ausentes viram aviso (não erro).
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-rag-kebab-test-'));
        fs.writeFileSync(path.join(dir, 'flask.json'), '{"id":"flask"}');

        const { arquivos } = auditarCatalogo({ dir });
        const item = arquivos.find((a) => a.arquivo === 'flask.json');
        assert('auditarCatalogo: falta "slug" vira aviso', item.avisos.some((a) => a.includes('"slug"')));
        assert('auditarCatalogo: falta "categoria" vira aviso', item.avisos.some((a) => a.includes('"categoria"')));
        assert('auditarCatalogo: falta "descricao" vira aviso', item.avisos.some((a) => a.includes('"descricao"')));
        assert('auditarCatalogo: campo ausente não bloqueia (ok true)', item.ok === true);

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // Q. auditarCatalogo — id duplicado entre dois arquivos vira erro nos dois.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-rag-kebab-test-'));
        fs.writeFileSync(path.join(dir, 'bootstrap5.json'), '{"id":"bootstrap5","slug":"bootstrap5","categoria":"framework","descricao":"x"}');
        fs.writeFileSync(path.join(dir, 'bootstrap.json'), '{"id":"bootstrap5","slug":"bootstrap5","categoria":"framework","descricao":"y"}');

        const { arquivos, duplicados } = auditarCatalogo({ dir });
        assert('auditarCatalogo: duplicados reporta o id certo', duplicados.length === 1 && duplicados[0].id === 'bootstrap5');
        assert('auditarCatalogo: duplicados lista os 2 arquivos', duplicados[0].arquivos.sort().join(',') === 'bootstrap.json,bootstrap5.json');
        const item1 = arquivos.find((a) => a.arquivo === 'bootstrap5.json');
        const item2 = arquivos.find((a) => a.arquivo === 'bootstrap.json');
        assert('auditarCatalogo: item1 marcado ok=false por duplicidade', item1.ok === false && item1.erros.some((e) => e.includes('duplicado')));
        assert('auditarCatalogo: item2 marcado ok=false por duplicidade', item2.ok === false && item2.erros.some((e) => e.includes('duplicado')));

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // R. auditarCatalogo — arquivo sem "id" é rascunho: aviso informativo, não erro.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-rag-kebab-test-'));
        fs.writeFileSync(path.join(dir, 'rascunho.json'), '{"nome-framework":"flask"}');

        const { arquivos, duplicados } = auditarCatalogo({ dir });
        const item = arquivos.find((a) => a.arquivo === 'rascunho.json');
        assert('auditarCatalogo: sem "id" vira aviso de rascunho', item.avisos.some((a) => a.includes('rascunho')));
        assert('auditarCatalogo: sem "id" não é erro', item.ok === true && item.erros.length === 0);
        assert('auditarCatalogo: rascunho não entra na checagem de duplicado', duplicados.length === 0);

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // S. auditarCatalogo — JSON inválido vira erro explícito, não lança.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-rag-kebab-test-'));
        fs.writeFileSync(path.join(dir, 'quebrado.json'), '{ isso não é json');

        let lancou = false;
        let resultado = null;
        try { resultado = auditarCatalogo({ dir }); } catch (_) { lancou = true; }
        assert('auditarCatalogo: JSON inválido não lança', !lancou);
        const item = resultado.arquivos.find((a) => a.arquivo === 'quebrado.json');
        assert('auditarCatalogo: JSON inválido vira erro', item.ok === false && item.erros.some((e) => e.includes('JSON inválido')));

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // T. validarEntradaGerada — entrada válida passa sem erro.
    {
        const entrada = {
            id: 'bootstrap5-accordion', slug: 'bootstrap5-accordion', categoria: 'topico',
            descricao: 'O componente Accordion do Bootstrap 5 organiza conteúdo em painéis expansíveis, um de cada vez ou vários simultâneos.',
            componentes: ['accordion-item', 'accordion-button'], keywords: ['sanfona'],
        };
        const r = validarEntradaGerada(entrada);
        assert('validarEntradaGerada: entrada válida ok=true', r.ok === true && r.erros.length === 0);
    }

    // U. validarEntradaGerada — slug divergente do id vira erro.
    {
        const r = validarEntradaGerada({ id: 'a-b', slug: 'a-c', categoria: 'x', descricao: 'x'.repeat(40), componentes: ['x'], keywords: [] });
        assert('validarEntradaGerada: slug divergente vira erro', r.ok === false && r.erros.some((e) => e.includes('slug')));
    }

    // V. validarEntradaGerada — descricao curta demais vira erro.
    {
        const r = validarEntradaGerada({ id: 'a-b', slug: 'a-b', categoria: 'x', descricao: 'curta', componentes: ['x'], keywords: [] });
        assert('validarEntradaGerada: descricao curta vira erro', r.ok === false && r.erros.some((e) => e.includes('descricao')));
    }

    // W. validarEntradaGerada — sem componentes E sem exemplos vira erro.
    {
        const r = validarEntradaGerada({ id: 'a-b', slug: 'a-b', categoria: 'x', descricao: 'x'.repeat(40), componentes: [], exemplos: [], keywords: ['x'] });
        assert('validarEntradaGerada: sem substância técnica vira erro', r.ok === false && r.erros.some((e) => e.includes('substância')));
    }

    // X. validarEntradaGerada — keywords vazio é só aviso, não bloqueia.
    {
        const r = validarEntradaGerada({ id: 'a-b', slug: 'a-b', categoria: 'x', descricao: 'x'.repeat(40), componentes: ['x'], keywords: [] });
        assert('validarEntradaGerada: keywords vazio não bloqueia', r.ok === true);
        assert('validarEntradaGerada: keywords vazio vira aviso', r.avisos.some((a) => a.includes('keywords')));
    }

    // Y. validarEntradaGerada — id já existente no catálogo vira erro.
    {
        const r = validarEntradaGerada(
            { id: 'bootstrap5-modal', slug: 'bootstrap5-modal', categoria: 'x', descricao: 'x'.repeat(40), componentes: ['x'], keywords: [] },
            { idsExistentes: ['bootstrap5-modal', 'bootstrap5-navbar'] },
        );
        assert('validarEntradaGerada: id duplicado no catálogo vira erro', r.ok === false && r.erros.some((e) => e.includes('já existe')));
    }

    // Z. validarEntradaGerada — id fora de kebab-case vira erro; entrada não-objeto não lança.
    {
        const r = validarEntradaGerada({ id: 'Bootstrap5_Modal', slug: 'Bootstrap5_Modal', categoria: 'x', descricao: 'x'.repeat(40), componentes: ['x'], keywords: [] });
        assert('validarEntradaGerada: id fora de kebab-case vira erro', r.ok === false && r.erros.some((e) => e.includes('kebab-case')));

        let lancou = false;
        try { validarEntradaGerada(null); } catch (_) { lancou = true; }
        assert('validarEntradaGerada(null) não lança', !lancou);
        assert('validarEntradaGerada(null) ok=false', validarEntradaGerada(null).ok === false);
    }
}

run();
console.log(`\n${failed === 0 ? '✅' : '❌'} ragKebabWorker: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
