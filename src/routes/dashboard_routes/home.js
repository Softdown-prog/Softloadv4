'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const router = express.Router();
const { exigirLogin } = require('../../middlewares/authGuard');
// Entrada simples, renderizada no servidor. O gerador Blogger também é EJS.
// As rotas React legadas continuam disponíveis para preservar projetos,
// históricos e contratos enquanto cada tela é migrada de maneira segura.
router.get('/dashboard', exigirLogin, (req, res) => {
    res.render('pages/dashboard-simples', {
        activePage: 'home',
        user: req.session.user,
    });
});
module.exports = router;
