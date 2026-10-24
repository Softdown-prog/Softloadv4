"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.criarHandlerUploadSolaris = criarHandlerUploadSolaris;
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { calcularDebitoInspecaoSolaris } = require('./solarisBilling');
const { validarSessaoSolaris } = require('./solarisHttpProtocol');
const UPLOAD_MAX_BYTES = 15 * 1024 * 1024; // matches the Multer limit configured by the router
function criarHandlerUploadSolaris(deps) {
    const { upload, chatStorage, extrairZipViaSandbox, criarArquivo, listarProjeto, lerArquivo, detectarFramework, inspecionarProjeto, modelRouter, debitarCreditos, salvarProjeto } = deps;
    return (req, res) => {
        upload.single('arquivo')(req, res, async (errUpload) => {
            if (errUpload) {
                const msg = errUpload.code === 'LIMIT_FILE_SIZE'
                    ? `Arquivo grande demais — limite de ${Math.floor(UPLOAD_MAX_BYTES / 1024 / 1024)}MB.`
                    : (errUpload.message || 'Falha ao processar o upload.');
                return res.status(400).json({ error: msg });
            }
            if (!req.file) {
                return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
            }
            const uid = req.session.user?.uid;
            const email = req.session.user?.email || '';
            const sessaoCliente = validarSessaoSolaris(req.body.sessionId);
            if (!sessaoCliente.ok)
                return res.status(400).json({ error: sessaoCliente.erro });
            const sessionId = sessaoCliente.sessionId || chatStorage.newSessionId();
            const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-upload-'));
            try {
                const { arquivos: arquivosExtraidos } = await extrairZipViaSandbox(req.file.buffer);
                for (const arquivo of arquivosExtraidos) {
                    // Escopo: projeto de texto, mesmo critério já documentado em
                    // agent/src/capabilities/archive.js — binário fica de fora
                    // (frameworkDetector.js só lê texto de qualquer forma).
                    if (arquivo.binario)
                        continue;
                    criarArquivo(baseDir, arquivo.caminho, arquivo.conteudo);
                }
                const caminhos = listarProjeto(baseDir);
                const arquivos = caminhos.map((caminho) => {
                    const r = lerArquivo(baseDir, caminho);
                    return { caminho, conteudo: r.ok ? r.conteudo : null };
                });
                const { melhorPalpite, candidatos } = detectarFramework(arquivos);
                // Inspeção por IA (Fase 2b) — roda DENTRO desta mesma requisição,
                // contra o baseDir que ainda está de pé (apagado no finally
                // logo abaixo, nunca sobrevive além deste request — ver
                // pipeline/projectInspector.js). Nunca lança por contrato; uma
                // falha (cota, chave, timeout) só significa analiseIA:null — a
                // detecção determinística de framework acima nunca depende
                // disso pra responder.
                const inspecao = await inspecionarProjeto({ baseDir, framework: melhorPalpite, arquivos: caminhos, modelRouter });
                if (!inspecao.ok) {
                    console.warn(`[SOLARIS-UPLOAD] inspeção de projeto indisponível: ${inspecao.motivo}`);
                }
                const debitoInspecao = inspecao.ok ? calcularDebitoInspecaoSolaris(inspecao.tokens) : null;
                if (email && debitoInspecao) {
                    debitarCreditos(email, debitoInspecao.input, debitoInspecao.output)
                        .catch((e) => console.error(`[BILLING] solaris-upload debit err: ${e.message}`));
                }
                // Fase 2c: persiste o projeto no GCS sob a sessão de chat (ver
                // tools/projectStorage.js) — permite que um turno de chat
                // SEGUINTE pergunte sobre um arquivo específico. Substitui
                // qualquer projeto anterior da mesma sessão (nunca acumula
                // mais de um por sessão). Nunca bloqueia a resposta de upload
                // — se a cota estourar ou o GCS falhar, o usuário ainda recebe
                // a detecção de framework e a análise normalmente, só sem o
                // anexo persistido (próxima pergunta cai no chat normal, sem
                // contexto de arquivo).
                let temProjeto = false;
                if (uid) {
                    try {
                        await salvarProjeto({ uid, email, plano: req.session.user?.plano || 'free', sessionId, framework: melhorPalpite, arquivos });
                        temProjeto = true;
                    }
                    catch (e) {
                        console.warn(`[SOLARIS-UPLOAD] não foi possível persistir o projeto: ${e.message}`);
                    }
                }
                res.json({
                    ok: true,
                    framework: melhorPalpite,
                    candidatos: candidatos.map((c) => ({ framework: c.framework, score: c.score, evidencias: c.evidencias })),
                    totalArquivos: arquivos.length,
                    arquivos: caminhos.slice(0, 50), // amostra — nunca devolve conteúdo, só nome
                    analiseIA: inspecao.ok ? inspecao.resumo : null,
                    sessionId,
                    temProjeto,
                });
            }
            catch (err) {
                // extrairZipViaSandbox só rejeita por motivo de entrada do
                // usuário (zip inválido, zip-slip, tamanho/contagem acima do
                // limite — validado pelo serviço isolado sandbox-efemoro/) OU
                // por falha de infraestrutura (serviço indisponível/config
                // ausente) — em ambos os casos, 400 aqui: nunca vaza detalhe de
                // path/infra do servidor pro usuário.
                console.warn(`[SOLARIS-UPLOAD] rejeitado: ${err.message}`);
                res.status(400).json({ error: 'Não foi possível processar o arquivo — confira se é um .zip válido e dentro dos limites de tamanho.' });
            }
            finally {
                fs.rmSync(baseDir, { recursive: true, force: true });
            }
        });
    };
}
