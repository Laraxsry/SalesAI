import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: { port: 5174 },
    build: {
        chunkSizeWarningLimit: 550,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes('livekit-client')) return 'livekit-core';
                    if (id.includes('@livekit/components')) return 'livekit-ui';
                    if (id.includes('react-dom') || id.includes('/react/')) return 'react-vendor';
                }
            }
        }
    }
});
