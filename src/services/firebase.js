"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Admin SDK v14 requires modular entry points. Keep a minimal admin facade
// for callers that still use the previous exported helpers while migrating.
const { initializeApp, getApp } = require('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp, FieldPath } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { getStorage } = require('firebase-admin/storage');
const app = initializeApp({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || 'loyal-road-395203'
});
const db = getFirestore(app, 'loyal-road-395203');
const auth = getAuth(app);
const storage = getStorage(app);
const bucket = storage.bucket(process.env.GCS_BUCKET_NAME || 'softload-compilacoes');
// Preserve the legacy public module surface without relying on removed
// firebase-admin namespace exports. Do not call firebase-admin root in v14.
const admin = {
    initializeApp,
    app: getApp,
    auth: () => auth,
    storage: () => storage,
    firestore: Object.assign(() => db, { FieldValue, Timestamp, FieldPath }),
};
console.log('🔥 Firebase: Conexão Industrial estabelecida com sucesso.');
module.exports = { db, auth, admin, bucket };
