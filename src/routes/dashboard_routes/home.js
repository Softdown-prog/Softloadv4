'use strict';
const express         = require('express');
const router          = express.Router();
const { exigirLogin } = require('../../middlewares/authGuard');

// Home do dashboard — antes renderizava 'pages/dashboard' (EJS/Bootstrap
// antigo, com sua própria sidebar em partials/dashboard-sidebar.ejs).
// Migrado para o app React (frontend/pages/DashboardHome.jsx), que já
// existe e já busca seus próprios dados via GET /api/dashboard/stats
// (ver src/routes/apiRoutes.js). Por isso o cálculo de créditos/projetos
// que existia aqui foi removido: ele agora vive só no endpoint da API,
// evitando ter a mesma lógica duplicada em dois lugares.
//
// 'pages/react-test' é a mesma view-ponte usada por todas as outras
// rotas do dashboard (chat, historico, workspace, solaris,
// configuracoes, upgrade) — ela só monta a div#react-root e carrega o
// bundle /dist/assets/main.js; quem decide o que renderizar dentro é o
// React Router em frontend/App.jsx.
router.get('/dashboard', exigirLogin, (req, res) => {
    res.render('pages/react-test', {
        activePage: 'home',
        user: req.session.user,
    });
});

module.exports = router;
