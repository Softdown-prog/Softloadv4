'use strict';
const express = require('express');
const router  = express.Router();

router.use(require('./home'));
router.use(require('./compiler'));
router.use(require('./historico'));
router.use(require('./configuracoes'));
router.use(require('./upgrade'));
router.use(require('./conta'));
router.use(require('./chat'));
router.use(require('./workspace'));
router.use(require('./workspaceChat'));
router.use(require('./solaris'));

router.use(require('./reactTest'));
module.exports = router;
