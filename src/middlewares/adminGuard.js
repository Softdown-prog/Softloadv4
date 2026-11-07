"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { decideAccess } = require('./accessPolicy.cjs');
function exigirSuperAdmin(req, res, next) {
    if (decideAccess('admin', req).allow)
        return next();
    res.status(404).render('pages/404');
}
module.exports = { exigirSuperAdmin };
