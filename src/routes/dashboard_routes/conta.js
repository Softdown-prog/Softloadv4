'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const router = express.Router();
const { exigirLogin } = require('../../middlewares/authGuard');
const { db, auth } = require('../../services/firebase');
const { deletarTodosArquivos } = require('../../services/storageService');
router.post('/dashboard/conta/excluir', exigirLogin, async (req, res) => {
    const { confirmacao } = req.body;
    const user = req.session.user;
    if (confirmacao !== 'EXCLUIR') {
        return res.redirect('/dashboard/configuracoes?erro=confirmacao');
    }
    try {
        const email = user.email.toLowerCase();
        await deletarTodosArquivos(user.uid).catch(() => { });
        await auth.deleteUser(user.uid);
        const q = await db.collection('clientes_premium')
            .where('email', '==', email)
            .limit(1)
            .get();
        if (!q.empty)
            await q.docs[0].ref.delete();
        await db.collection('usuarios').doc(email).delete().catch(() => { });
        req.session.destroy(() => {
            res.redirect('/?conta=apagada');
        });
    }
    catch (err) {
        console.error('[DELETE ACCOUNT]', err.message);
        res.redirect('/dashboard/configuracoes?erro=exclusao');
    }
});
module.exports = router;
