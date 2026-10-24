'use strict';

/**
 * Testes da biblioteca de peças — parte determinística.
 *
 * buscarNaBiblioteca()/registrarNaBiblioteca() são Firestore-backed —
 * sem credenciais reais neste ambiente de teste, então este arquivo
 * cobre _gerarPalavrasChave() e _melhorCandidato() (ambas puras, sem
 * I/O), que são exatamente a lógica de matching que decide o resultado
 * da busca. A cobertura de integração completa (registrar → buscar via
 * Firestore de verdade) é feita indiretamente por pecaOrchestrator.test.js,
 * que mocka a camada de I/O desta biblioteca — ver esse arquivo.
 *
 * Execute: node src/core/compilerEngine/bibliotecaPecas.test.js
 */

const { _gerarPalavrasChave, _melhorCandidato } = require('./bibliotecaPecas');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// A. _gerarPalavrasChave — extrai palavras de nicho/descrição/id.
{
    const kws = _gerarPalavrasChave('Widget Trending Posts com destaque dos mais lidos', 'viral-magazine', 'trending-posts-widget');
    assert('inclui palavra da descrição', kws.includes('widget'));
    assert('inclui palavra do id', kws.includes('trending'));
    assert('inclui o nichoTema inteiro', kws.includes('viral-magazine'));
    assert('não inclui palavra curta demais (com/dos)', !kws.includes('com') && !kws.includes('dos'));
}
{
    const kws = _gerarPalavrasChave('', null, null);
    assert('entradas vazias não lançam, devolve array vazio', Array.isArray(kws) && kws.length === 0);
}

// B. _melhorCandidato — keyword-match puro contra uma lista em memória.
{
    const itens = [
        { id: 'a', palavras_chave: ['countdown', 'promocional', 'widget'] },
        { id: 'b', palavras_chave: ['cookie', 'banner', 'lgpd'] },
    ];
    const { melhor, melhorScore, melhorHits } = _melhorCandidato('quero um widget de contagem regressiva promocional', itens);
    assert('encontra o item certo por keyword', melhor && melhor.id === 'a', JSON.stringify(melhor));
    assert('score positivo quando encontra', melhorScore > 0);
    assert('reporta quantidade de palavras batidas (2: widget + promocional)', melhorHits === 2, String(melhorHits));
}
{
    const itens = [{ id: 'a', palavras_chave: ['countdown', 'promocional'] }];
    const { melhor, melhorScore } = _melhorCandidato('gerador de fatura em pdf com assinatura digital', itens);
    assert('sem relação nenhuma: não encontra', melhor === null && melhorScore === 0);
}
{
    const { melhor } = _melhorCandidato('qualquer pedido', []);
    assert('lista vazia: não lança, devolve null', melhor === null);
}

// C. Regressão do bug: 1 palavra genérica coincidindo por acaso com a
// descrição de uma peça de OUTRO nicho não pode "resolver" um pedido —
// _melhorCandidato ainda RETORNA o candidato (é só ranking puro), mas
// melhorHits precisa refletir que é um match fraco (1), pra o chamador
// (buscarNaBiblioteca) decidir não aceitar o match e seguir pra geração via IA.
{
    const itens = [{ id: 'chat-ao-vivo-tech', palavras_chave: ['tecnologia', 'chat', 'vivo', 'suporte'] }];
    const { melhor, melhorHits } = _melhorCandidato('quero um placar de futebol ao vivo com os times', itens);
    assert('match fraco: ainda acha o candidato (ranking puro)', melhor && melhor.id === 'chat-ao-vivo-tech');
    assert('match fraco: só 1 palavra bateu (vivo) — hits=1, abaixo do piso de reaproveitamento', melhorHits === 1, String(melhorHits));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} bibliotecaPecas: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
