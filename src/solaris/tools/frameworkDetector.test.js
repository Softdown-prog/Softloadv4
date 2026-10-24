'use strict';

/**
 * Testes de frameworkDetector.js — puro, sem I/O (recebe arquivos já
 * extraídos em memória).
 *
 * Execute: node src/solaris/tools/frameworkDetector.test.js
 */

const { detectarFramework, FRAMEWORKS_DETECTAVEIS } = require('./frameworkDetector');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

function run() {
    // A. Django — manage.py + settings.py.
    {
        const r = detectarFramework([
            { caminho: 'manage.py', conteudo: '#!/usr/bin/env python\nimport django' },
            { caminho: 'projeto/settings.py', conteudo: 'INSTALLED_APPS = []' },
        ]);
        assert('Django detectado como melhor palpite', r.melhorPalpite === 'django', r.melhorPalpite);
        const django = r.candidatos.find((c) => c.framework === 'django');
        assert('Django tem evidências reais', django.evidencias.length >= 2, JSON.stringify(django));
    }

    // B. Flask — Flask(__name__) + import.
    {
        const r = detectarFramework([
            { caminho: 'app.py', conteudo: 'from flask import Flask\napp = Flask(__name__)' },
        ]);
        assert('Flask detectado', r.melhorPalpite === 'flask', r.melhorPalpite);
    }

    // C. PHP — arquivo .php presente.
    {
        const r = detectarFramework([{ caminho: 'index.php', conteudo: '<?php echo "oi"; ?>' }]);
        assert('PHP detectado', r.melhorPalpite === 'php', r.melhorPalpite);
    }

    // D. Node/Express — package.json com dependência "express".
    {
        const r = detectarFramework([
            { caminho: 'package.json', conteudo: JSON.stringify({ dependencies: { express: '^4.0.0' } }) },
            { caminho: 'server.js', conteudo: "const express = require('express');" },
        ]);
        assert('Node-Express detectado', r.melhorPalpite === 'node-express', r.melhorPalpite);
    }

    // E. EJS — arquivo .ejs presente.
    {
        const r = detectarFramework([{ caminho: 'views/index.ejs', conteudo: '<h1><%= titulo %></h1>' }]);
        assert('EJS detectado', r.melhorPalpite === 'ejs', r.melhorPalpite);
    }

    // F. Bootstrap5 — HTML referencia bootstrap.min.css.
    {
        const r = detectarFramework([
            { caminho: 'index.html', conteudo: '<link rel="stylesheet" href="bootstrap.min.css"><div class="container"></div>' },
        ]);
        assert('Bootstrap5 detectado', r.melhorPalpite === 'bootstrap5', r.melhorPalpite);
    }

    // G. HTML5 puro — só .html, sem nenhum sinal de framework mais forte.
    {
        const r = detectarFramework([{ caminho: 'index.html', conteudo: '<!DOCTYPE html><html><body>Olá</body></html>' }]);
        assert('HTML5 puro detectado (fallback)', r.melhorPalpite === 'html5', r.melhorPalpite);
    }

    // H. Flask ganha de HTML5 quando o projeto tem os dois sinais — sinal
    // mais forte e específico vence o fallback genérico.
    {
        const r = detectarFramework([
            { caminho: 'app.py', conteudo: 'from flask import Flask\napp = Flask(__name__)' },
            { caminho: 'templates/index.html', conteudo: '<!DOCTYPE html><html></html>' },
        ]);
        assert('Flask vence HTML5 quando os dois têm sinal', r.melhorPalpite === 'flask', r.melhorPalpite);
    }

    // I. Sem nenhum sinal — melhorPalpite null, candidatos vazio, nunca lança.
    {
        const r = detectarFramework([{ caminho: 'README.md', conteudo: '# Projeto sem sinal nenhum' }]);
        assert('sem sinal: melhorPalpite null', r.melhorPalpite === null);
        assert('sem sinal: candidatos vazio', r.candidatos.length === 0);
    }

    // J. Entrada inválida (array vazio/null) não lança.
    {
        assert('array vazio: melhorPalpite null', detectarFramework([]).melhorPalpite === null);
        assert('null: melhorPalpite null, não lança', detectarFramework(null).melhorPalpite === null);
        assert('undefined: melhorPalpite null, não lança', detectarFramework(undefined).melhorPalpite === null);
    }

    // K. package.json malformado (JSON inválido) não lança, regra
    // simplesmente não bate.
    {
        let lancou = false;
        let r = null;
        try {
            r = detectarFramework([{ caminho: 'package.json', conteudo: '{ isso não é json' }]);
        } catch (_) { lancou = true; }
        assert('package.json malformado não lança', !lancou);
        assert('package.json malformado: sem detecção de node-express', r.melhorPalpite !== 'node-express');
    }

    // L. Empate exato no topo não força palpite.
    {
        const r = detectarFramework([
            { caminho: 'index.php', conteudo: '<?php ?>' },      // php: 6
            { caminho: 'views/index.ejs', conteudo: '<h1></h1>' }, // ejs: 6
        ]);
        assert('empate no topo: melhorPalpite null', r.melhorPalpite === null, JSON.stringify(r.candidatos));
        assert('empate no topo: ambos aparecem como candidatos', r.candidatos.some((c) => c.framework === 'php') && r.candidatos.some((c) => c.framework === 'ejs'));
    }

    // M. FRAMEWORKS_DETECTAVEIS bate com as chaves reais das regras
    // (documentação viva — nunca desalinha silenciosamente).
    {
        assert('FRAMEWORKS_DETECTAVEIS inclui os 7 frameworks conhecidos', FRAMEWORKS_DETECTAVEIS.length === 7, JSON.stringify(FRAMEWORKS_DETECTAVEIS));
    }
}

run();
console.log(`\n${failed === 0 ? '✅' : '❌'} frameworkDetector: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
