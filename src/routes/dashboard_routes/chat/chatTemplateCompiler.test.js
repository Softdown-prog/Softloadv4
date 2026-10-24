'use strict';

/**
 * Testes de chatTemplateCompiler.js — _blueprintParaManifesto().
 *
 * Cobre 2 achados reais desta sessão (auditoria "chat não usa o que o
 * usuário pediu"):
 *   1. `description` (resumo do que o usuário descreveu sobre o negócio)
 *      nunca chegava no manifesto — só servia pra escolher o nichoTema e
 *      era descartada. Agora é extraída e persistida (via `manifesto`
 *      completo no snapshot).
 *   2. `moduleOverrides` só aceitava desligar (`false`) um módulo — pedido
 *      de funcionalidade extra ("quero formulário de contato") era sempre
 *      ignorado mesmo sendo um toggle genérico e seguro de chassis. Agora
 *      `comOverride` honra `true` também.
 *
 * Execute: node src/routes/dashboard_routes/chat/chatTemplateCompiler.test.js
 */

const { _blueprintParaManifesto } = require('./chatTemplateCompiler');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// A. description é extraída e truncada a 240 chars.
{
    const manifesto = _blueprintParaManifesto({
        siteName: 'Doce Encanto',
        nichoTema: 'culinaria-boutique-gourmet',
        description: 'Confeitaria artesanal em SP especializada em bolos personalizados para festas de aniversário infantil',
    });
    assert('description presente no manifesto', manifesto.description === 'Confeitaria artesanal em SP especializada em bolos personalizados para festas de aniversário infantil');
}
{
    const manifesto = _blueprintParaManifesto({ siteName: 'Blog Sem Descrição', nichoTema: 'gamer-playerone' });
    assert('description ausente vira null (não quebra)', manifesto.description === null);
}
{
    const textoLongo = 'X'.repeat(300);
    const manifesto = _blueprintParaManifesto({ siteName: 'Blog X', nichoTema: 'gamer-playerone', description: textoLongo });
    assert('description truncada a 240 chars', manifesto.description.length === 240);
}

// B. moduleOverrides — comOverride honra true (liga) e false (desliga).
{
    const manifesto = _blueprintParaManifesto({
        siteName: 'Doce Encanto',
        nichoTema: 'culinaria-boutique-gourmet', // não tem contactForm por default
        moduleOverrides: { contactForm: true },
    });
    assert('moduleOverrides.contactForm=true liga o módulo mesmo fora do default do nicho',
        manifesto.modules.contactForm === true);
}
{
    const manifesto = _blueprintParaManifesto({
        siteName: 'Loja Gamer',
        nichoTema: 'gamer-playerone', // statsWidget=true por default (ver nichoModuleDefaults.js)
        moduleOverrides: { statsWidget: false },
    });
    assert('moduleOverrides.statsWidget=false desliga o módulo mesmo com default true',
        manifesto.modules.statsWidget === false);
}
{
    const manifesto = _blueprintParaManifesto({ siteName: 'Blog Sem Overrides', nichoTema: 'gamer-playerone' });
    assert('sem moduleOverrides: módulos caem no default do nicho normalmente',
        typeof manifesto.modules.contactForm === 'boolean');
}

// C. siteName técnico continua rejeitado (regressão — não deve mudar).
{
    let lancou = false;
    try {
        _blueprintParaManifesto({ siteName: 'gamer-playerone', nichoTema: 'gamer-playerone' });
    } catch (e) {
        lancou = true;
    }
    assert('siteName técnico ainda lança erro', lancou);
}

console.log(`\n${failed === 0 ? '✅' : '❌'} chatTemplateCompiler: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
