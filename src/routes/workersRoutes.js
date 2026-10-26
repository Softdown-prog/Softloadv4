"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const archiver = require('archiver');
const router = express.Router();
const { exigirWorkerAccess } = require('../middlewares/workerGuard');
const { exigirLogin } = require('../middlewares/authGuard');
const sentinelWorker = require('../services/sentinelWorker');
const errorLogWorker = require('../services/errorLogWorker');
// ==========================================
// GET /workers — Dashboard principal
// ==========================================
router.get('/workers', exigirLogin, exigirWorkerAccess, (req, res) => {
    res.render('pages/workers/worker_health', {
        user: req.session.user,
        titulo: 'Workers — Sentinel Health Dashboard'
    });
});
// ==========================================
// GET /workerlog — Dashboard isolado do Error Log 24h
// ==========================================
router.get('/workerlog', exigirLogin, exigirWorkerAccess, (req, res) => {
    res.render('pages/workers/workerlog', {
        user: req.session.user,
        titulo: 'Error Log 24h — Softload Engine'
    });
});
// ==========================================
// API SENTINEL — Dados em tempo real
// ==========================================
router.get('/workers/api/status', exigirLogin, exigirWorkerAccess, (req, res) => {
    try {
        res.json(sentinelWorker.getStatus());
    }
    catch (err) {
        res.status(500).json({ erro: 'Falha ao carregar status.' });
    }
});
router.get('/workers/api/scores', exigirLogin, exigirWorkerAccess, (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit || '') || 20, 100);
        res.json(sentinelWorker.getHistoryScores(limit));
    }
    catch (err) {
        res.status(500).json({ erro: 'Falha ao carregar scores.' });
    }
});
// ==========================================
// API ERROR LOG — Captura de erros silenciosos (24h)
// ==========================================
router.get('/workers/api/errors', exigirLogin, exigirWorkerAccess, (req, res) => {
    try {
        const { stats, logs } = errorLogWorker.getLogsAndStats();
        res.json({ stats, logs });
    }
    catch (err) {
        res.status(500).json({ erro: 'Falha ao ler log de erros.' });
    }
});
router.get('/workers/api/errors/download', exigirLogin, exigirWorkerAccess, (req, res) => {
    try {
        const { stats, logs } = errorLogWorker.getLogsAndStats();
        const format = (req.query.format || 'zip').toLowerCase();
        const payload = JSON.stringify({
            exportedAt: new Date().toISOString(),
            stats,
            logs,
        }, null, 2);
        const date = new Date().toISOString().slice(0, 10);
        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="error-log-${date}.json"`);
            return res.send(payload);
        }
        const filename = `error-log-${date}.zip`;
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        const archive = archiver('zip', { zlib: { level: 6 } });
        archive.on('error', (err) => {
            console.error('[ERROR-LOG][DOWNLOAD] archiver error:', err.message);
        });
        archive.pipe(res);
        archive.append(payload, { name: 'error-log.json' });
        archive.finalize();
    }
    catch (err) {
        console.error('[ERROR-LOG][DOWNLOAD]', err.message);
        res.status(500).json({ erro: 'Falha ao gerar download.' });
    }
});
module.exports = router;
