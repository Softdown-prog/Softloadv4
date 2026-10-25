"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function exigirWorkerAccess(req, res, next) {
    const email = req.session?.user?.email || '';
    if (email.toLowerCase() === 'softloady@gmail.com')
        return next();
    res.status(404).render('pages/404');
}
module.exports = { exigirWorkerAccess };
