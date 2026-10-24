'use strict';
const express     = require('express');
const router      = express.Router();
const { exigirLogin } = require('../../middlewares/authGuard');

// Redirect legado — URLs antigas do compilador manual vão direto pro chat
// (que é onde /dashboard/blogger-ai também redireciona hoje, ver server.js —
// apontar direto evita o duplo-redirect pra quem ainda usa esses bookmarks).
router.get('/dashboard/compiler', exigirLogin, (req, res) => {
    res.redirect(301, '/dashboard/chat');
});
router.get('/dashboard/compiler-blogger-xml', exigirLogin, (req, res) => {
    res.redirect(301, '/dashboard/chat');
});

module.exports = router;
