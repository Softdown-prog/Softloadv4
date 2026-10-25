"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');

admin.initializeApp({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || 'loyal-road-395203'
});

const db = getFirestore(admin.app(), 'loyal-road-395203');

const auth = admin.auth();

const bucket = admin.storage().bucket(process.env.GCS_BUCKET_NAME || 'softload-compilacoes');

console.log('🔥 Firebase: Conexão Industrial estabelecida com sucesso.');

module.exports = { db, auth, admin, bucket };
