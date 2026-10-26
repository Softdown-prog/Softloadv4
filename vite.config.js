import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
export default defineConfig({
    plugins: [react()],
    // publicDir desligado de propósito — achado real: o default do Vite é
    // copiar `public/` pro outDir a cada build, mas `outDir` (public/dist)
    // já fica DENTRO de `public/`, então o próprio Vite alertava "The public
    // directory feature may not work correctly" e um asset real
    // (public/css/sl-utils.css) nunca chegava a ser copiado pro build
    // commitado. Não tem necessidade nenhuma dessa cópia de qualquer forma:
    // server.js já serve `public/` inteiro via express.static (todo o resto
    // de public/css, public/js, public/favicon.svg chega ao navegador direto
    // dali, nunca passou pelo Vite) — outDir só precisa do bundle JS/CSS que
    // o próprio Vite gera a partir de frontend/main.tsx.
    publicDir: false,
    build: {
        outDir: path.resolve(__dirname, 'public/dist'),
        emptyOutDir: true,
        rollupOptions: {
            input: path.resolve(__dirname, 'frontend/main.tsx'),
            output: {
                entryFileNames: 'assets/[name].js',
                // Chunks recebem hash do conteúdo: com Cache-Control immutable
                // e maxAge=1y, nomes estáveis faziam navegadores reutilizarem
                // versões antigas de partes do React após um novo deploy.
                chunkFileNames: 'assets/[name]-[hash].js',
                assetFileNames: 'assets/[name]-[hash].[ext]'
            }
        },
    },
});
