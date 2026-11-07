"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { decideAccess } = require('./accessPolicy.cjs');
function exigirWorkerAccess(req, res, next) {
    if (decideAccess('worker', req).allow)
        return next();
    res.status(404).render('pages/404');
}
module.exports = { exigirWorkerAccess };
