'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const router = express.Router();
const { exigirLogin } = require('../../middlewares/authGuard');
router.get('/dashboard/configuracoes', exigirLogin, (req, res) => {
    res.render('pages/configuracoes-simples', {
        activePage: 'configuracoes',
        user: req.session.user
    });
});
module.exports = router;
