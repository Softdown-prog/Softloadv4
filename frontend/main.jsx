import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyAccessibilityPrefs } from './utils/accessibilityPrefs';

// Aplicado antes do primeiro render pra evitar flash de tamanho/fonte
// errados no dashboard -- mesma lógica de qualquer página (o efeito só
// aparece onde o CSS de public/css/softload.css o escopa, `.sl-dash-wrapper`).
applyAccessibilityPrefs();

const container = document.getElementById('react-root');

if (container) {
    const root = createRoot(container);

    root.render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );
}
