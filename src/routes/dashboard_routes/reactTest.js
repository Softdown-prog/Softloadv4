'use strict';
const express = require('express');
const router = express.Router();
const { exigirLogin } = require('../../middlewares/authGuard');

router.get('/react-test', (req, res) => {
    res.render('pages/react-test');
});

module.exports = router;
