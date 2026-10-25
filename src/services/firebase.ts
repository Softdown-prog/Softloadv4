interface FirebaseAdmin {
    initializeApp(options: { projectId: string }): unknown;
    app(): unknown;
    auth(): unknown;
    storage(): { bucket(name: string): unknown };
}
declare const require: (id: string) => unknown;
declare const process: { env: Record<string, string | undefined> };
declare const module: { exports: unknown };

const admin = require('firebase-admin') as FirebaseAdmin;
const { getFirestore } = require('firebase-admin/firestore') as { getFirestore(app: unknown, databaseId: string): unknown };

admin.initializeApp({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || 'loyal-road-395203'
});

const db = getFirestore(admin.app(), 'loyal-road-395203');

const auth = admin.auth();

const bucket = admin.storage().bucket(process.env.GCS_BUCKET_NAME || 'softload-compilacoes');

console.log('🔥 Firebase: Conexão Industrial estabelecida com sucesso.');

module.exports = { db, auth, admin, bucket };

export {};
