'use strict';
interface AppConfigRequest { session: { user?: unknown } }
interface AppConfigResponse { json(body: { user: unknown; firebaseConfig: { apiKey?: string; appId?: string }; features: { mpCheckoutUrl: string } }): unknown }
declare const require: (id: string) => unknown;
declare const module: { exports: unknown };
const express = (require('express') as { Router(): { get(path: string, handler: (req: AppConfigRequest, res: AppConfigResponse) => unknown): unknown } });
const router = express.Router();

// Contract: Provides the React frontend with context previously injected via res.locals
router.get('/api/app-config', (req: AppConfigRequest, res: AppConfigResponse) => {
    res.json({
        user: req.session.user || null,
        firebaseConfig: {
            apiKey: process.env.FIREBASE_API_KEY,
            appId: process.env.FIREBASE_APP_ID,
        },
        features: {
            mpCheckoutUrl: process.env.MP_CHECKOUT_URL || '#'
        }
    });
});

module.exports = router;

export {};
