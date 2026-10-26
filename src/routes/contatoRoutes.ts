interface ContactReq {
  session?: { user?: unknown };
  query: { erro?: unknown; sucesso?: unknown };
  body: { nome?: string; email?: string; mensagem?: string };
}
interface ContactRes {
  redirect(url: string): unknown;
  render(view: string, locals: {user: unknown; erro: unknown; sucesso: unknown}): unknown;
}
type ContactHandler = (req: ContactReq, res: ContactRes) => unknown;
interface ContactRouter {get(path: string, handler: ContactHandler): unknown;post(path: string, middleware: unknown, handler: ContactHandler): unknown}
interface ExpressFactory { Router(): ContactRouter }
interface ContactRateLimiterConfig {
  windowMs: number; max: number; standardHeaders: boolean; legacyHeaders: boolean; handler: ContactHandler;
}
interface MailTransport { sendMail(options: {from: string; to: string; subject: string; html: string}): Promise<unknown> }
declare const require: (id: string) => unknown;
declare const module: { exports: unknown };
const express = require('express') as ExpressFactory;
const router = express.Router();
const rateLimit = require('express-rate-limit') as (config: ContactRateLimiterConfig) => unknown;
const { transporter } = require('../services/emailService') as {transporter: MailTransport};

// Rate limiter: 1 envio por minuto por IP
const contatoLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 1,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        res.redirect('/contato?erro=Aguarde 1 minuto antes de enviar outra mensagem.');
    }
});

// Letras (acentuadas), números, espaços e pontuação básica.
// Inclui . , ! ? ( ) @ - " : ; / + & % # ' para permitir mensagens naturais (URLs simples, emails citados, etc).
const REGEX_MENSAGEM = /^[a-zA-ZÀ-ÿ0-9\s.,!?()@\-":;/+&%#'\n\r]+$/;
const REGEX_NOME     = /^[a-zA-ZÀ-ÿ\s'.\-]+$/;
const REGEX_EMAIL    = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function contarPalavras(texto: string): number {
    return texto.trim().split(/\s+/).filter(p => p.length > 0).length;
}

router.get('/contato', (req, res) => {
    res.render('pages/contato', {
        user: req.session ? req.session.user : null,
        erro: req.query.erro || null,
        sucesso: req.query.sucesso || null
    });
});

router.post('/contato', contatoLimiter, async (req, res) => {
    try {
        const nome     = (req.body.nome     || '').trim();
        const email    = (req.body.email    || '').trim();
        const mensagem = (req.body.mensagem || '').trim();

        if (!nome || !email || !mensagem) {
            return res.redirect('/contato?erro=Todos os campos são obrigatórios.');
        }

        if (!REGEX_NOME.test(nome)) {
            return res.redirect('/contato?erro=Nome inválido. Use apenas letras e espaços.');
        }

        if (!REGEX_EMAIL.test(email)) {
            return res.redirect('/contato?erro=E-mail inválido. Verifique o endereço digitado.');
        }

        if (!REGEX_MENSAGEM.test(mensagem)) {
            return res.redirect('/contato?erro=A mensagem contém caracteres não permitidos. Use texto e pontuação comum, sem código HTML.');
        }

        if (contarPalavras(mensagem) > 100) {
            return res.redirect('/contato?erro=A mensagem deve ter no máximo 100 palavras.');
        }

        await transporter.sendMail({
            from:    '"Softload Contato" <contato@softload.analysepro.com>',
            to:      'softload@proton.me',
            subject: `[Contato] Nova mensagem de ${nome}`,
            html: `
                <h2 style="font-family:sans-serif;">Nova mensagem via formulário de contato</h2>
                <table style="font-family:sans-serif;border-collapse:collapse;">
                    <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">Nome:</td><td>${nome}</td></tr>
                    <tr><td style="padding:4px 12px 4px 0;font-weight:bold;">E-mail:</td><td>${email}</td></tr>
                </table>
                <p style="font-family:sans-serif;margin-top:16px;"><strong>Mensagem:</strong><br>${mensagem.replace(/\n/g, '<br>')}</p>
            `
        });

        console.log(`[CONTATO] Email enviado — ${nome} <${email}>`);
        res.redirect('/contato?sucesso=Mensagem enviada com sucesso! Retornaremos em breve.');

    } catch (error) {
        console.error('[CONTATO] Erro ao enviar email:', (error as Error).message);
        res.redirect('/contato?erro=Falha ao enviar a mensagem. Tente novamente.');
    }
});

module.exports = router;

export {};
