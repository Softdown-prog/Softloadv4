'use strict';
const express     = require('express');
const router      = express.Router();
const { exigirLogin } = require('../../middlewares/authGuard');

router.get('/dashboard/configuracoes', exigirLogin, (req, res) => {
    res.render('pages/react-test', {
        activePage: 'configuracoes',
        user: req.session.user
    });
});

module.exports = router;
