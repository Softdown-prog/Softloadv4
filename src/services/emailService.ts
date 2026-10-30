/**
 * Correio transacional SMTP. Este módulo apenas prepara e envia mensagens
 * pelo transporte já configurado; testes injetam um transporte simulado.
 */
export interface EmailSendOptions {
    from: string;
    to: string;
    subject: string;
    html: string;
}
export interface SmtpTransporter {
    sendMail(message: EmailSendOptions): Promise<unknown>;
}
interface SmtpSettings {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string | undefined };
}
interface NodemailerApi {
    createTransport(settings: SmtpSettings): SmtpTransporter;
}
declare function require(id: string): unknown;
declare const process: { env: Record<string, string | undefined> };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const nodemailer = require('nodemailer') as NodemailerApi;

const FROM = `"${process.env.EMAIL_FROM_NAME || 'Softload Engine'}" <${process.env.EMAIL_FROM || 'contato@softload.analysepro.com'}>`;
const BASE  = process.env.BASE_URL || 'https://softload.analysepro.com';

export const transporter: SmtpTransporter = nodemailer.createTransport({
    host:   'smtp.resend.com',
    port:   465,
    secure: true,
    auth: { user: 'resend', pass: process.env.RESEND_API_KEY },
});

// ── Layout base de email ──────────────────────────────────────────────────
function layout(titulo: string, corpo: string): string {
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${titulo}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif">
  <div style="max-width:580px;margin:40px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 32px rgba(0,0,0,0.08)">

    <!-- Header -->
    <div style="background:#0f172a;padding:28px 32px;text-align:center">
      <a href="${BASE}" style="text-decoration:none">
        <span style="font-size:20px;font-weight:900;color:#ffffff;letter-spacing:-0.03em">Soft<span style="color:#0ea5e9">load</span></span>
      </a>
    </div>

    <!-- Corpo -->
    <div style="padding:40px 32px;color:#1e293b">
      ${corpo}
    </div>

    <!-- Footer -->
    <div style="background:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0">
      <p style="margin:0 0 4px;font-size:11px;color:#94a3b8">
        © ${new Date().getFullYear()} Softload Engine ·
        <a href="${BASE}" style="color:#0ea5e9;text-decoration:none">${BASE.replace(/^https?:\/\//, '')}</a>
      </p>
      <p style="margin:0;font-size:11px;color:#cbd5e1">
        Este email foi enviado automaticamente — não é necessário responder.
      </p>
    </div>

  </div>
</body>
</html>`;
}

function btnPrimario(url: string, texto: string): string {
    return `<a href="${url}" style="display:inline-block;margin:24px 0;background:#0ea5e9;color:#ffffff;font-weight:700;font-size:14px;text-transform:uppercase;letter-spacing:0.08em;padding:14px 32px;border-radius:8px;text-decoration:none">${texto}</a>`;
}

function divisor(): string {
    return '<hr style="border:none;border-top:1px solid #e2e8f0;margin:28px 0">';
}

// ── Templates ─────────────────────────────────────────────────────────────

function templateBoasVindas(nome: string): string {
    const corpo = `
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0f172a;letter-spacing:-0.02em">
        Bem-vindo ao Softload Engine, ${nome}!
      </h2>
      <p style="margin:0 0 20px;color:#475569;line-height:1.7">
        Sua conta foi criada com sucesso. Personalize seu template Blogger e experimente o gerador gratuitamente, sem cartão.
      </p>
      <div style="background:#f0f9ff;border-left:4px solid #0ea5e9;padding:16px 20px;border-radius:0 8px 8px 0;margin:0 0 24px">
        <p style="margin:0;font-size:13px;color:#0369a1;line-height:1.6">
          <strong>O que você pode fazer agora:</strong><br>
          → Escolher nichos, cores, fontes e layouts<br>
          → Gerar e baixar templates XML para Blogger<br>
          → Compilar seu primeiro template no painel
        </p>
      </div>
      ${btnPrimario(`${BASE}/dashboard`, 'Acessar o painel')}
      ${divisor()}
      <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6">
        O plano Essencial custa R$ 5 e libera o gerador por 30 dias.
        Para uso contínuo, confira os <a href="${BASE}/dashboard/upgrade" style="color:#0ea5e9">planos disponíveis</a>.
      </p>
    `;
    return layout('Bem-vindo ao Softload Engine', corpo);
}

function templateRecuperacaoSenha(nome: string | null | undefined, resetLink: string): string {
    const corpo = `
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0f172a;letter-spacing:-0.02em">
        Redefinição de senha
      </h2>
      <p style="margin:0 0 20px;color:#475569;line-height:1.7">
        Olá${nome ? `, ${nome}` : ''}. Recebemos uma solicitação para redefinir a senha da sua conta.
        Clique no botão abaixo para criar uma nova senha.
      </p>
      ${btnPrimario(resetLink, 'Redefinir minha senha')}
      ${divisor()}
      <p style="margin:0 0 8px;font-size:12px;color:#94a3b8;line-height:1.6">
        <strong>Não solicitou a redefinição?</strong> Ignore este email — sua senha continua a mesma.
      </p>
      <p style="margin:0;font-size:12px;color:#94a3b8">
        O link expira em <strong>1 hora</strong> por segurança.
      </p>
    `;
    return layout('Redefinição de senha — Softload Engine', corpo);
}

function templatePlanoAtivado(nome: string | null | undefined, plano: string, expiraEm: string | number | Date | null | undefined): string {
    const planoLabel = plano.charAt(0).toUpperCase() + plano.slice(1);
    const dataExp    = expiraEm ? new Date(expiraEm).toLocaleDateString('pt-BR') : '30 dias';
    const corpo = `
      <h2 style="margin:0 0 8px;font-size:22px;font-weight:800;color:#0f172a;letter-spacing:-0.02em">
        Plano ${planoLabel} ativado!
      </h2>
      <p style="margin:0 0 20px;color:#475569;line-height:1.7">
        Olá${nome ? `, ${nome}` : ''}! Seu pagamento foi confirmado e o plano
        <strong>${planoLabel}</strong> já está ativo na sua conta.
      </p>
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px 24px;margin:0 0 24px">
        <table style="width:100%;border-collapse:collapse;font-size:14px">
          <tr>
            <td style="padding:6px 0;color:#475569">Plano</td>
            <td style="padding:6px 0;font-weight:700;color:#0f172a;text-align:right">${planoLabel}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#475569">Válido até</td>
            <td style="padding:6px 0;font-weight:700;color:#0f172a;text-align:right">${dataExp}</td>
          </tr>
        </table>
      </div>
      ${btnPrimario(`${BASE}/dashboard`, 'Ir para o painel')}
      ${divisor()}
      <p style="margin:0;font-size:12px;color:#94a3b8;line-height:1.6">
        O acesso é válido por 30 dias. O plano não renova automaticamente —
        você decide se quer continuar no próximo mês.
      </p>
    `;
    return layout(`Plano ${planoLabel} ativado — Softload Engine`, corpo);
}

// ── Funções públicas ──────────────────────────────────────────────────────

async function enviar(to: string, subject: string, html: string): Promise<void> {
    try {
        await transporter.sendMail({ from: FROM, to, subject, html });
        console.log(`[EMAIL] Enviado: "${subject}" → ${to}`);
    } catch (err) {
        console.error(`[EMAIL] Falha ao enviar para ${to}:`, (err as Error).message);
        throw err;
    }
}

export async function enviarBoasVindas(email: string, nome: string): Promise<void> {
    await enviar(email, 'Bem-vindo ao Softload Engine!', templateBoasVindas(nome));
}

export async function enviarRecuperacaoSenha(email: string, nome: string | null | undefined, resetLink: string): Promise<void> {
    await enviar(email, 'Redefinição de senha — Softload Engine', templateRecuperacaoSenha(nome, resetLink));
}

export async function enviarPlanoAtivado(email: string, nome: string | null | undefined, plano: string, expiraEm: string | number | Date | null | undefined): Promise<void> {
    await enviar(
        email,
        `Plano ${plano.charAt(0).toUpperCase() + plano.slice(1)} ativado! — Softload Engine`,
        templatePlanoAtivado(nome, plano, expiraEm)
    );
}

// Transporter reutilizável para o formulário de contato (contatoRoutes.js).
