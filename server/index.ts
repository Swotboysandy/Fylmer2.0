import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import express from 'express';
import { parse } from 'dotenv';
import { createApp } from './app';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function localSettings() {
  let values: Record<string, string> = {};
  try {
    values = parse(readFileSync(resolve(root, '.env.local')));
  } catch {
    /* Keyless offline mode is supported. */
  }
  const limit = Number(process.env.SAM_MAX_REQUESTS ?? values.SAM_MAX_REQUESTS ?? 10);
  return {
    key: (process.env.META_API_KEY ?? values.META_API_KEY ?? '').trim(),
    requestLimit: Number.isInteger(limit) && limit >= 0 && limit <= 100 ? limit : 10,
    port: Number(process.env.PORT ?? values.PORT ?? 4317),
  };
}
const app = createApp({ settings: localSettings });
const server = createServer(app);
if (process.argv.includes('--production')) {
  app.use(express.static(resolve(root, 'dist')));
  app.use((_req, res) => res.sendFile(resolve(root, 'dist/index.html')));
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    root,
    server: { middlewareMode: true, ws: { server } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}
const port = localSettings().port;
server.once('error', (error) => {
  console.error(`Could not start the local server: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  const address = server.address();
  const actualPort = address && typeof address !== 'string' ? address.port : port;
  console.log(`Frame lab: http://127.0.0.1:${actualPort} (local only)`);
});
