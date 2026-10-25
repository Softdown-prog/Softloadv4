"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require('dotenv').config({
    path: require('path').join(__dirname, '../.env'),
});
const { db } = require('../src/services/firebase');
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
    }
    catch (err) {
        console.error('❌ Erro:', err.message);
        process.exit(1);
    }
})();
