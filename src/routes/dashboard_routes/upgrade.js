'use strict';
const express     = require('express');
const router      = express.Router();
const { exigirLogin } = require('../../middlewares/authGuard');

router.get('/dashboard/upgrade', exigirLogin, (req, res) => {
    res.render('pages/react-test', {
        activePage: 'upgrade',
        user: req.session.user
    });
});

module.exports = router;
