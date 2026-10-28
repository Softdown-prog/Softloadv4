'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'firebase.js'), 'utf8');

test('Firebase inicializa uma instância e preserva nomes de projeto, banco e bucket', () => {
    const events = [], app = { name: 'test-app' }, firestore = { name: 'firestore' },
        auth = { name: 'auth' }, bucket = { name: 'bucket' };
    const admin = {
        initializeApp(options) { events.push(['initializeApp', options.projectId]); return app; },
        getApp() { events.push(['getApp']); return app; },
        getAuth(actualApp) { assert.equal(actualApp, app); events.push(['getAuth']); return auth; },
        getStorage(actualApp) { assert.equal(actualApp, app); events.push(['getStorage']); return {
            bucket(name) { events.push(['bucket', name]); return bucket; }
        }; },
    };
    const m = { exports: {} };
    const scope = {
        module: m, exports: {},
        process: { env: { GOOGLE_CLOUD_PROJECT: 'project-test', GCS_BUCKET_NAME: 'bucket-test' } },
        console: { log(message) { events.push(['log', message]); } },
        require(id) {
            if (id === 'firebase-admin/app') return { initializeApp: admin.initializeApp, getApp: admin.getApp };
            if (id === 'firebase-admin/auth') return { getAuth: admin.getAuth };
            if (id === 'firebase-admin/storage') return { getStorage: admin.getStorage };
            if (id === 'firebase-admin/firestore') return {
                FieldValue: { serverTimestamp: () => 'server-time', delete: () => 'deleted' },
                Timestamp: { fromDate: date => date }, FieldPath: { documentId: () => '__name__' },
                getFirestore(actualApp, databaseId) {
                    assert.equal(actualApp, app);
                    events.push(['getFirestore', databaseId]);
                    return firestore;
                }
            };
            throw Error('Módulo inesperado: ' + id);
        },
    };
    vm.runInNewContext(source, scope, { filename: 'firebase.js' });
    assert.equal(typeof m.exports.admin.auth, 'function');
    assert.equal(typeof m.exports.admin.firestore, 'function');
    assert.equal(typeof m.exports.admin.firestore.FieldValue.serverTimestamp, 'function');
    assert.equal(m.exports.db, firestore);
    assert.equal(m.exports.auth, auth);
    assert.equal(m.exports.bucket, bucket);
    assert.deepEqual(Array.from(events, item => Array.from(item)), [
        ['initializeApp','project-test'], ['getFirestore','loyal-road-395203'],
        ['getAuth'],['getStorage'],['bucket','bucket-test'],
        ['log','🔥 Firebase: Conexão Industrial estabelecida com sucesso.']
    ]);
});
