'use strict';
interface DeleteAccountUser { uid: string; email: string }
interface DeleteAccountRequest {
    body: {confirmacao?: unknown};
    session: {user: DeleteAccountUser; destroy(callback: () => void): void};
}
interface DeleteAccountResponse { redirect(url: string): void }
type DeleteAccountHandler = (req: DeleteAccountRequest, res: DeleteAccountResponse) => Promise<void>;
interface DeleteAccountRouter { post(path: string, middleware: unknown, handler: DeleteAccountHandler): void }
interface QueryDocument { ref: {delete(): Promise<void>} }
interface AccountCollection {
    where(field: string, operator: string, value: string): {
        limit(count: number): {get(): Promise<{empty: boolean; docs: QueryDocument[]}>}
    };
    doc(id: string): {delete(): Promise<void>};
}
interface AccountsDB {collection(name: string): AccountCollection}
interface AccountsAuth {deleteUser(uid: string): Promise<void>}
declare const require: (id: string) => unknown;
declare const module: {exports: unknown};

const express = require('express') as {Router(): DeleteAccountRouter};
const router      = express.Router();
const { exigirLogin } = require('../../middlewares/authGuard') as {exigirLogin: unknown};
const { db, auth } = require('../../services/firebase') as {db: AccountsDB; auth: AccountsAuth};
const { deletarTodosArquivos } = require('../../services/storageService') as {deletarTodosArquivos(uid: string): Promise<unknown>};

router.post('/dashboard/conta/excluir', exigirLogin, async (req, res) => {
    const { confirmacao } = req.body;
    const user = req.session.user;

    if (confirmacao !== 'EXCLUIR') {
        return res.redirect('/dashboard/configuracoes?erro=confirmacao');
    }

    try {
        const email = user.email.toLowerCase();

        await deletarTodosArquivos(user.uid).catch(() => {});
        await auth.deleteUser(user.uid);

        const q = await db.collection('clientes_premium')
            .where('email', '==', email)
            .limit(1)
            .get();
        if (!q.empty) await q.docs[0].ref.delete();

        await db.collection('usuarios').doc(email).delete().catch(() => {});

        req.session.destroy(() => {
            res.redirect('/?conta=apagada');
        });
    } catch (err) {
        console.error('[DELETE ACCOUNT]', (err as Error).message);
        res.redirect('/dashboard/configuracoes?erro=exclusao');
    }
});

module.exports = router;

export {};
