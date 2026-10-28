import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const child = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts', '--production'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: '0' },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const deadline = setTimeout(() => child.kill(), 30_000);
try {
  const url = await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const match = output.match(/Frame lab: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) resolve(match[1]);
    });
    child.on('error', reject);
    child.on('exit', (code) => reject(new Error(`Server stopped before readiness (${code}).`)));
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
  });
  const health = await (await fetch(`${url}/api/health`)).json();
  assert.equal(health.model, 'sam-3.1');
  assert.equal(health.requestsUsed, 0);
  const html = await (await fetch(url)).text();
  assert.match(html, /<div id="root"><\/div>/);
  const jsPath = html.match(/src="([^\"]+\.js)"/)[1];
  const bundle = await fetch(new URL(jsPath, url));
  assert.equal(bundle.status, 200);
  assert.match(bundle.headers.get('content-type'), /javascript/);
  assert.equal((await fetch(`${url}/api/not-an-endpoint`)).status, 404);
  console.log(
    'Production smoke passed: local server, health endpoint, HTML and built JavaScript. No Meta call.',
  );
} finally {
  clearTimeout(deadline);
  child.kill();
}
