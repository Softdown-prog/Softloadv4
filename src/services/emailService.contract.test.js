'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'emailService.js'), 'utf8');
function harness(env = {}, sendError = null) {
    const sends = [];
    const logs = [];
    const errors = [];
    const factories = [];
    const module = {exports:{}};
    const transport = {async sendMail(message) {
        sends.push(message);
        if (sendError) throw sendError;
        return {accepted:[message.to]};
    }};
    vm.runInNewContext(source, {
        module, exports:module.exports,
        process:{env},
        require(id) {
            assert.equal(id, 'nodemailer', 'não pode carregar o Nodemailer real');
            return {createTransport(settings) {
                factories.push(settings);
                return transport;
            }};
        },
        console:{
            log(...args) {logs.push(args);},
            error(...args) {errors.push(args);},
        },
        Date,
    }, {filename:'emailService.js'});
    return {api:module.exports,transport,sends,logs,errors,factories};
}

test('importar o módulo não envia emails e configura Resend SMTP seguro uma vez', async () => {
    const h=harness({RESEND_API_KEY:'mock-resend',EMAIL_FROM:'oi@example.test',EMAIL_FROM_NAME:'Equipe',BASE_URL:'https://softload.test'});
    assert.equal(h.factories.length,1);
    assert.equal(h.factories[0].host,'smtp.resend.com');
    assert.equal(h.factories[0].port,465);
    assert.equal(h.factories[0].secure,true);
    assert.equal(h.factories[0].auth.user,'resend');
    assert.equal(h.factories[0].auth.pass,'mock-resend');
    assert.equal(h.sends.length,0);
    assert.equal(h.api.transporter,h.transport);
    assert.equal(typeof h.api.enviarBoasVindas,'function');
    assert.equal(typeof h.api.enviarRecuperacaoSenha,'function');
    assert.equal(typeof h.api.enviarPlanoAtivado,'function');
});

test('boas-vindas preserva remetente, idioma, cinco créditos e links personalizados', async () => {
    const h=harness({RESEND_API_KEY:'dummy',EMAIL_FROM:'oi@example.test',EMAIL_FROM_NAME:'Equipe',BASE_URL:'https://softload.test'});
    await h.api.enviarBoasVindas('destino@example.test','Ana');
    assert.equal(h.sends.length,1);
    const mail=h.sends[0];
    assert.equal(mail.from,'"Equipe" <oi@example.test>');
    assert.equal(mail.to,'destino@example.test');
    assert.equal(mail.subject,'Bem-vindo ao Softload Engine!');
    assert.match(mail.html,/lang="pt-BR"/);
    assert.match(mail.html,/Bem-vindo ao Softload Engine, Ana/);
    assert.match(mail.html,/gerador gratuitamente/);
    assert.match(mail.html,/https:\/\/softload\.test\/dashboard/);
    assert.match(mail.html,/https:\/\/softload\.test\/dashboard\/upgrade/);
    assert.equal(h.logs.length,1);
    assert.equal(h.errors.length,0);
});

test('recuperação usa link do próprio usuário e continua informando validade de 1 hora', async () => {
    const h=harness({});
    const reset='https://softload.example.test/reset?token=abc-123';
    await h.api.enviarRecuperacaoSenha('usuario@example.test',null,reset);
    assert.equal(h.sends.length,1);
    assert.equal(h.sends[0].from,'"Softload Engine" <contato@softload.analysepro.com>');
    assert.equal(h.sends[0].subject,'Redefinição de senha — Softload Engine');
    assert.ok(h.sends[0].html.includes(reset));
    assert.match(h.sends[0].html,/1 hora/);
    assert.match(h.sends[0].html,/https:\/\/softload\.analysepro\.com/);
    assert.match(h.sends[0].html,/Não solicitou a redefinição/);
});

test('email de plano conserva nome, créditos, tokens e prazo, sem cobrança externa', async () => {
    const h=harness({RESEND_API_KEY:'not-real'});
    await h.api.enviarPlanoAtivado('pagante@example.test','Leo','essencial','2026-11-25T12:00:00Z');
    assert.equal(h.sends.length,1);
    const msg=h.sends[0];
    assert.equal(msg.subject,'Plano Essencial ativado! — Softload Engine');
    assert.match(msg.html,/Plano Essencial ativado!/);
    assert.doesNotMatch(msg.html,/créditos de IA|Tokens disponíveis/);
    assert.match(msg.html,/25\/11\/2026/);
    assert.match(msg.html,/não renova automaticamente/);
});

test('erro do SMTP é registrado e propagado; nenhuma entrega é declarada', async () => {
    const err=new Error('SMTP indisponível');
    const h=harness({},err);
    await assert.rejects(h.api.enviarBoasVindas('falha@example.test','Cliente'),/SMTP indisponível/);
    assert.equal(h.sends.length,1);
    assert.equal(h.logs.length,0);
    assert.equal(h.errors.length,1);
    assert.match(h.errors[0][0],/Falha ao enviar para falha@example\.test/);
    assert.equal(h.errors[0][1],'SMTP indisponível');
});
