/**
 * Worker Guard — Restringe acesso ao dashboard de workers ao usuário softloady@gmail.com
 */

function exigirWorkerAccess(req, res, next) {
    const email = req.session?.user?.email || '';
    if (email.toLowerCase() === 'softloady@gmail.com') return next();
    res.status(404).render('pages/404');
}

module.exports = { exigirWorkerAccess };
