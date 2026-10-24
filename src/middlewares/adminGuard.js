function exigirSuperAdmin(req, res, next) {
    if (req.session?.user?.is_super_admin === true) return next();
    res.status(404).render('pages/404');
}

module.exports = { exigirSuperAdmin };
