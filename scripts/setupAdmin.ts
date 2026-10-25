/**
 * Utilitário administrativo executado manualmente para conceder super_admin.
 * Uso: node scripts/setupAdmin.js seu@email.com
 * Não registrar como rota HTTP nem executar em CI com credenciais.
 */
export interface AdminDocument {
    exists: boolean;
}
export interface AdminDocumentRef {
    get(): Promise<AdminDocument>;
    update(data: { is_super_admin: true }): Promise<unknown>;
}
export interface AdminFirestore {
    collection(name: 'clientes_premium'): { doc(email: string): AdminDocumentRef };
}
declare const __dirname: string;
declare const require: (id: string) => unknown;
declare const process: { argv: string[]; exit(code: number): never };

(require('dotenv') as { config(options: { path: string }): void }).config({
    path: (require('path') as { join(...parts: string[]): string }).join(__dirname, '../.env'),
});
const { db } = require('../src/services/firebase') as { db: AdminFirestore };
const email = process.argv[2]?.toLowerCase().trim();

if (!email) {
    console.error('❌ Forneça o e-mail: node scripts/setupAdmin.js seu@email.com');
    process.exit(1);
}

(async () => {
    try {
        const ref = db.collection('clientes_premium').doc(email);
        const doc = await ref.get();
        if (!doc.exists) {
            console.error(`❌ Usuário "${email}" não encontrado na coleção clientes_premium.`);
            process.exit(1);
            return;
        }
        await ref.update({ is_super_admin: true });
        console.log(`✅ "${email}" agora é super_admin.`);
        console.log('⚠️  Faça logout + login novamente para ativar o acesso a /eu.');
        process.exit(0);
    } catch (err) {
        console.error('❌ Erro:', (err as Error).message);
        process.exit(1);
    }
})();
