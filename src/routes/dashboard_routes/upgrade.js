'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const router = express.Router();
const { exigirLogin } = require('../../middlewares/authGuard');
router.get('/dashboard/upgrade', exigirLogin, (req, res) => {
    res.render('pages/plano-essencial', {
        activePage: 'plano-essencial',
        user: req.session.user,
        checkoutEnabled: process.env.BLOGGER_ESSENCIAL_CHECKOUT_ENABLED === 'true'
    });
});
router.get('/dashboard/plano-essencial', exigirLogin, (req, res) => {
    res.render('pages/plano-essencial', {
        activePage: 'plano-essencial',
        user: req.session.user,
        checkoutEnabled: process.env.BLOGGER_ESSENCIAL_CHECKOUT_ENABLED === 'true'
    });
});
module.exports = router;
