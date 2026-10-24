"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FRAMEWORKS_DETECTAVEIS = exports.FRAMEWORKS_VALIDOS = void 0;
exports.detectarFramework = detectarFramework;
// ============================================================
// SOLARIS FRAMEWORK DETECTOR (Fase 2 do upload — ver README,
// "Botão de anexo... fica pronto pro detector de framework entrar
// depois")
// ============================================================
// Determinístico, zero IA — decide o framework de um projeto
// enviado (upload) só a partir de SINAIS ESTRUTURAIS reais: nome de
// arquivo característico (manage.py), dependência declarada
// (package.json/composer.json) ou trecho de código inequívoco
// (`from flask import`). Nunca lê "vibe" do conteúdo pra adivinhar —
// mesmo princípio de ragOrganizerWorker.js (decisão só por sinal
// estruturado, nunca regex-sobre-texto-livre tentando entender
// significado).
//
// Decoupled da mecânica de upload de propósito: recebe uma lista já
// extraída de `{caminho, conteudo}` (arquivo texto — binário como
// imagem entra com conteudo:null/vazio e é ignorado pelas regras),
// nunca lê disco nem lida com zip/multipart. `tools/fileTools.js.
// extrairZip()` ainda não existe (aguardando o resto do fluxo de
// upload, ver README) — quando existir, é só ele que alimenta este
// detector, sem acoplamento nenhum entre os dois.
//
// Cada framework tem uma lista de regras com peso — score final é a
// soma dos pesos das regras que bateram. Ganha o de maior score;
// empate ou nenhum sinal retorna null (nunca força um palpite sem
// evidência). Sempre devolve as evidências junto — o pipeline nunca
// aceita a detecção sem poder mostrar POR QUE decidiu aquilo.
// ============================================================
const { FRAMEWORKS_VALIDOS } = require('../manifest/manifestSchema');
exports.FRAMEWORKS_VALIDOS = FRAMEWORKS_VALIDOS;
// Cada regra: { peso, testar(arquivos) => evidencia|null }. `arquivos`
// é o array completo — regra decide sozinha se quer olhar nome de
// caminho, conteúdo, ou os dois.
const REGRAS_POR_FRAMEWORK = {
    django: [
        { peso: 10, motivo: 'arquivo "manage.py" na raiz', testar: (fs) => fs.some((f) => /(^|\/)manage\.py$/.test(f.caminho)) },
        { peso: 8, motivo: 'arquivo "settings.py" presente', testar: (fs) => fs.some((f) => /(^|\/)settings\.py$/.test(f.caminho)) },
        { peso: 6, motivo: 'conteúdo Python cita "INSTALLED_APPS" ou "django.setup"', testar: (fs) => fs.some((f) => /INSTALLED_APPS|django\.setup\(/.test(f.conteudo || '')) },
        { peso: 4, motivo: 'código Python importa "django"', testar: (fs) => fs.some((f) => /\bimport\s+django\b|\bfrom\s+django\b/.test(f.conteudo || '')) },
    ],
    flask: [
        { peso: 8, motivo: 'código Python instancia "Flask(__name__)"', testar: (fs) => fs.some((f) => /Flask\(__name__\)/.test(f.conteudo || '')) },
        { peso: 6, motivo: 'código Python importa "flask"', testar: (fs) => fs.some((f) => /\bfrom\s+flask\s+import\b/.test(f.conteudo || '')) },
        { peso: 3, motivo: 'arquivo "requirements.txt" cita "flask"', testar: (fs) => fs.some((f) => /requirements\.txt$/.test(f.caminho) && /flask/i.test(f.conteudo || '')) },
    ],
    php: [
        { peso: 6, motivo: 'algum arquivo ".php" presente', testar: (fs) => fs.some((f) => f.caminho.endsWith('.php')) },
        { peso: 4, motivo: 'arquivo "composer.json" presente', testar: (fs) => fs.some((f) => /(^|\/)composer\.json$/.test(f.caminho)) },
    ],
    'node-express': [
        { peso: 8, motivo: '"package.json" declara dependência "express"', testar: (fs) => fs.some((f) => /(^|\/)package\.json$/.test(f.caminho) && _packageJsonTemDependencia(f.conteudo, 'express')) },
        { peso: 4, motivo: 'código JS importa/requer "express"', testar: (fs) => fs.some((f) => /require\(\s*['"]express['"]\s*\)|from\s+['"]express['"]/.test(f.conteudo || '')) },
    ],
    ejs: [
        { peso: 6, motivo: 'algum arquivo ".ejs" presente', testar: (fs) => fs.some((f) => f.caminho.endsWith('.ejs')) },
        { peso: 3, motivo: '"package.json" declara dependência "ejs"', testar: (fs) => fs.some((f) => /(^|\/)package\.json$/.test(f.caminho) && _packageJsonTemDependencia(f.conteudo, 'ejs')) },
    ],
    bootstrap5: [
        { peso: 6, motivo: 'HTML referencia "bootstrap" em link/script', testar: (fs) => fs.some((f) => (f.caminho.endsWith('.html') || f.caminho.endsWith('.ejs')) && /bootstrap(\.min)?\.(css|js)/i.test(f.conteudo || '')) },
        { peso: 2, motivo: '"package.json" declara dependência "bootstrap"', testar: (fs) => fs.some((f) => /(^|\/)package\.json$/.test(f.caminho) && _packageJsonTemDependencia(f.conteudo, 'bootstrap')) },
    ],
    html5: [
        // Sinal mais fraco de propósito — é o fallback quando nada mais
        // específico bate; um projeto Flask também tem HTML, mas o
        // score dele já ganharia pelas regras mais fortes acima.
        { peso: 2, motivo: 'algum arquivo ".html" presente', testar: (fs) => fs.some((f) => f.caminho.endsWith('.html')) },
        { peso: 1, motivo: 'conteúdo declara "<!DOCTYPE html>"', testar: (fs) => fs.some((f) => /<!DOCTYPE\s+html>/i.test(f.conteudo || '')) },
    ],
};
function _packageJsonTemDependencia(conteudo, nomePacote) {
    if (!conteudo)
        return false;
    try {
        const pkg = JSON.parse(conteudo);
        return Boolean((pkg.dependencies && pkg.dependencies[nomePacote]) || (pkg.devDependencies && pkg.devDependencies[nomePacote]));
    }
    catch (_) {
        return false;
    }
}
/**
 * Detecta o framework mais provável de um projeto já extraído — puro,
 * sem tocar disco, nunca lança. `arquivos`: array de
 * `{ caminho: string, conteudo: string|null }` (conteudo null/vazio
 * pra binário — regras que dependem de conteúdo simplesmente não
 * batem, não é tratado como erro).
 *
 * @returns {{ melhorPalpite: string|null, candidatos: Array<{framework, score, evidencias: string[]}> }}
 */
function detectarFramework(arquivos) {
    if (!Array.isArray(arquivos) || arquivos.length === 0) {
        return { melhorPalpite: null, candidatos: [] };
    }
    const candidatos = [];
    for (const framework of Object.keys(REGRAS_POR_FRAMEWORK)) {
        let score = 0;
        const evidencias = [];
        for (const regra of REGRAS_POR_FRAMEWORK[framework]) {
            let bateu = false;
            try {
                bateu = Boolean(regra.testar(arquivos));
            }
            catch (_) {
                bateu = false;
            }
            if (bateu) {
                score += regra.peso;
                evidencias.push(regra.motivo);
            }
        }
        if (score > 0)
            candidatos.push({ framework, score, evidencias });
    }
    candidatos.sort((a, b) => b.score - a.score);
    // Só declara um palpite se houver um vencedor CLARO — empate no
    // topo (dois frameworks com o mesmo score) não força escolha,
    // deixa pra quem está usando decidir (mesmo princípio de nunca
    // fingir confiança que os dados não sustentam).
    const empateNoTopo = candidatos.length >= 2 && candidatos[0].score === candidatos[1].score;
    const melhorPalpite = (candidatos.length > 0 && !empateNoTopo) ? candidatos[0].framework : null;
    return { melhorPalpite, candidatos };
}
exports.FRAMEWORKS_DETECTAVEIS = Object.keys(REGRAS_POR_FRAMEWORK);
