'use strict';

/**
 * Testes de xmlPatchWorker.js — aplica edições estruturais em XML de
 * tema Blogger via patch JSON, sem precisar reescrever o arquivo inteiro.
 *
 * Execute: node src/workers/xmlPatchWorker.test.js
 */

const { aplicarPatch, findBlock } = require('./xmlPatchWorker');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

const FIXTURE = `<html>
  <b:section id='main' showelement='yes'>
    <b:widget id='Blog1' type='Blog' title='Postagens'>
      <b:includable id='main'>conteudo original</b:includable>
    </b:widget>
    <b:widget id='HTML5' type='HTML' title='Aviso'>
      <b:widget-settings><b:widget-setting name='content'>texto velho</b:widget-setting></b:widget-settings>
    </b:widget>
  </b:section>
  <b:section id='sidebar' showelement='yes'/>
  <b:section id='footer' showelement='yes'>
    <b:widget id='LinkList1' type='LinkList' title='Links'/>
  </b:section>
</html>`;

// A. findBlock — localiza bloco por id, com e sem self-closing
{
    const b1 = findBlock(FIXTURE, 'b:widget', 'Blog1');
    assert('findBlock acha b:widget Blog1', !!b1);
    assert('findBlock não confunde com HTML5', FIXTURE.slice(b1.start, b1.end).includes('conteudo original'));

    const sidebar = findBlock(FIXTURE, 'b:section', 'sidebar');
    assert('findBlock marca section vazia como selfClosing', sidebar && sidebar.selfClosing === true);

    const inexistente = findBlock(FIXTURE, 'b:widget', 'NaoExiste');
    assert('findBlock retorna null pra id inexistente', inexistente === null);
}

// B. replaceWidget
{
    const { xml, resultados } = aplicarPatch(FIXTURE, {
        ops: [{ op: 'replaceWidget', id: 'Blog1', xml: "<b:widget id='Blog1' type='Blog'>NOVO</b:widget>" }],
    });
    assert('replaceWidget ok', resultados[0].ok);
    assert('replaceWidget troca o conteúdo', xml.includes('NOVO') && !xml.includes('conteudo original'));
    assert('replaceWidget preserva o resto do documento', xml.includes("id='HTML5'") && xml.includes("id='LinkList1'"));
}

// C. removeWidget
{
    const { xml, resultados } = aplicarPatch(FIXTURE, { ops: [{ op: 'removeWidget', id: 'HTML5' }] });
    assert('removeWidget ok', resultados[0].ok);
    assert('removeWidget remove só o widget certo', !xml.includes("id='HTML5'") && xml.includes("id='Blog1'"));
}

// D. insertIntoSection — em section vazia (self-closing) e em section com conteúdo
{
    const { xml: x1, resultados: r1 } = aplicarPatch(FIXTURE, {
        ops: [{ op: 'insertIntoSection', sectionId: 'sidebar', position: 'append', xml: "<b:widget id='Novo1' type='HTML'/>" }],
    });
    assert('insertIntoSection ok (section antes vazia)', r1[0].ok);
    assert('insertIntoSection insere dentro da section certa', /id='sidebar'[\s\S]*id='Novo1'[\s\S]*<\/b:section>/.test(x1));

    const { xml: x2, resultados: r2 } = aplicarPatch(FIXTURE, {
        ops: [{ op: 'insertIntoSection', sectionId: 'footer', position: 'append', xml: "<b:widget id='Novo2' type='HTML'/>" }],
    });
    assert('insertIntoSection ok (section com conteúdo)', r2[0].ok);
    assert('insertIntoSection append fica depois do widget existente', x2.indexOf("id='LinkList1'") < x2.indexOf("id='Novo2'"));
}

// E. insertRelativeToWidget — before/after
{
    const { xml, resultados } = aplicarPatch(FIXTURE, {
        ops: [{ op: 'insertRelativeToWidget', anchorId: 'HTML5', position: 'after', xml: "<b:widget id='Depois1' type='HTML'/>" }],
    });
    assert('insertRelativeToWidget ok', resultados[0].ok);
    assert('insertRelativeToWidget after fica depois do âncora', xml.indexOf("id='HTML5'") < xml.indexOf("id='Depois1'"));
}

// F. findReplace — global e escopado a um widget
{
    const { xml, resultados } = aplicarPatch(FIXTURE, {
        ops: [{ op: 'findReplace', find: 'texto velho', replace: 'texto novo', scopeWidgetId: 'HTML5' }],
    });
    assert('findReplace escopado ok', resultados[0].ok);
    assert('findReplace troca o texto certo', xml.includes('texto novo') && !xml.includes('texto velho'));
}

// G. erro claro quando id não existe, e continueOnError=false para no primeiro erro
{
    const { resultados } = aplicarPatch(FIXTURE, { ops: [{ op: 'replaceWidget', id: 'NaoExiste', xml: '<x/>' }] });
    assert('erro reportado sem lançar exceção', resultados[0].ok === false && /não encontrado/.test(resultados[0].erro));

    const { xml, resultados: r2 } = aplicarPatch(FIXTURE, {
        ops: [
            { op: 'removeWidget', id: 'HTML5' },
            { op: 'replaceWidget', id: 'NaoExiste', xml: '<x/>' },
            { op: 'removeWidget', id: 'Blog1' },
        ],
    });
    assert('para no primeiro erro (3ª op não roda)', r2.length === 2);
    assert('xml reflete só as ops até o erro (Blog1 ainda presente)', xml.includes("id='Blog1'") && !xml.includes("id='HTML5'"));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} xmlPatchWorker: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
