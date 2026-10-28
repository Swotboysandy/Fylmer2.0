import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

function anchorShotSamApiPlugin(): Plugin {
  return {
    name: 'anchorshot-sam-api',
    async configureServer(server) {
      const { createApp } = await import('./server/app');
      const apiApp = createApp({
        settings: () => ({
          key: (process.env.META_API_KEY ?? process.env.VITE_META_AI_API_KEY ?? '').trim(),
          requestLimit: Number(process.env.SAM_MAX_REQUESTS ?? 25),
        }),
      });
      server.middlewares.use(apiApp);
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss(), anchorShotSamApiPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
