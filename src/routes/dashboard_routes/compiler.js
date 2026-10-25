'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const router = express.Router();
const { exigirLogin } = require('../../middlewares/authGuard');
// Redirecionamentos antigos do compilador continuam apontando para o chat.
router.get('/dashboard/compiler', exigirLogin, (_req, res) => {
    res.redirect(301, '/dashboard/chat');
});
router.get('/dashboard/compiler-blogger-xml', exigirLogin, (_req, res) => {
    res.redirect(301, '/dashboard/chat');
});
module.exports = router;
