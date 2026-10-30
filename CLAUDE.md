# Softload Blogger

Node.js + TypeScript + EJS. Procedural Blogger XML only. No AI services.

Authoritative .ts files have committed CommonJS .js mirrors. Run `npm run sync:typescript` after edits.
Keep Firebase account identifiers, customer storage prefixes and Mercado Pago payment receipts compatible. Never delete production data during source cleanup.

Before publishing: `npm ci --legacy-peer-deps`, `npm run typecheck`, `npm run typecheck:workers`, `npm test`, `npm run build`, Docker build and smoke. Linux CI runs receiver/socket/transport checks. Deploy protocol: `softload-deploy:v3:app`.
