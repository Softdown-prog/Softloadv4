'use strict';
const express = require('express');
const router = express.Router();

// Contract: Provides the React frontend with context previously injected via res.locals
router.get('/api/app-config', (req, res) => {
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
