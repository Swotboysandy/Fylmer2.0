import express from 'express';
import {spawn, type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import type {Plugin} from 'vite';

const ID = /^[a-f0-9-]{36}$/;
const assets = new Set(['generated-image.png', 'generated-video.mp4', 'contact-sheet.png', 'inference-report.json']);
type Job = {id: string; kind: 'image'|'video'; prompt: string; seed: number; status: string; message: string; createdAt: string; report?: Record<string, any>; error?: string};

export function createLocalAi(root: string, launch = spawn) {
  const runtime = path.join(root, '.artifacts/local-ai');
  const output = path.join(runtime, 'ui-jobs');
  const python = path.join(runtime, 'venv/Scripts/python.exe');
  mkdirSync(output, {recursive: true});
  const jobs = new Map<string, Job>();
  let active: {job: Job; child: ChildProcess} | undefined;
  const save = (job: Job) => writeFileSync(path.join(output, job.id, 'job.json'), JSON.stringify(job));
  for (const id of readdirSync(output).filter(id => ID.test(id))) {
    try {
      const job: Job = JSON.parse(readFileSync(path.join(output, id, 'job.json'), 'utf8'));
      if (job.id !== id) continue;
      if (job.status === 'running') {
        job.status = 'failed'; job.error = 'Local server restarted. Run generation again.'; save(job);
      }
      jobs.set(id, job);
    } catch { /* Ignore incomplete metadata, never infer success from media alone. */ }
  }
  const requirements = [python, path.join(root, 'scripts/run_local_ai.py'),
    path.join(runtime, 'models/sd15/download-manifest.json'),
    path.join(runtime, 'models/animatediff-lightning/download-manifest.json')];
  const app = express();
  app.use((req, res, next) => {
    const host = req.headers.host || '';
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) ||
      (req.headers.origin && req.headers.origin !== `http://${host}`)) {
      res.status(403).json({error: 'Local same-origin requests only.'}); return;
    }
    if (req.method === 'POST' && (req.headers['x-anchorshot-local'] !== '1' || !req.is('application/json'))) {
      res.status(403).json({error: 'Local JSON request required.'}); return;
    }
    res.setHeader('Cache-Control', 'no-store'); next();
  });
  app.use(express.json({limit: '8kb'}));
  app.get('/health', (_req, res) => res.json({ready: requirements.every(p => existsSync(p)), activeJobId: active?.job.id || null}));
  app.get('/jobs', (_req, res) => res.json([...jobs.values()].sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0,20)));
  app.get('/jobs/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) { res.status(404).json({error: 'Job not found.'}); return; }
    res.json(job);
  });
  app.get('/jobs/:id/assets/:file', (req, res) => {
    const {id, file} = req.params;
    if (!ID.test(id) || !jobs.has(id) || !assets.has(file) || jobs.get(id)?.status !== 'completed') {
      res.status(404).end(); return;
    }
    res.sendFile(path.resolve(output, id, file), {dotfiles: 'allow'}, (err) => {
      if (err && !res.headersSent) res.status(404).end();
    });
  });
  function stop(reason: string) {
    if (!active) return;
    const {job, child} = active;
    job.status = 'cancelled'; job.message = reason; save(job);
    // Windows venv and Python supervisor both spawn children; stop this job's tree only.
    if (child.pid && process.platform === 'win32') spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true});
    else child.kill('SIGTERM');
    // Keep the GPU busy until close confirms the worker has actually exited.
  }
  app.post('/jobs/:id/cancel', (req, res) => {
    if (!active || active.job.id !== req.params.id) { res.status(409).json({error: 'This job is no longer running.'}); return; }
    const job = active.job; stop('Cancelled by you.'); res.json(job);
  });
  app.post('/jobs', (req, res) => {
    const {kind, prompt, seed = 42} = req.body || {};
    if (!['image','video'].includes(kind) || typeof prompt !== 'string' || !prompt.trim() || prompt.length > 1500 ||
        !Number.isInteger(seed) || seed < 0 || seed > 2147483647) {
      res.status(400).json({error: 'Choose image or video, a prompt of 1–1500 characters, and an integer seed from 0 to 2147483647.'}); return;
    }
    if (active) { res.status(409).json({error: 'Another GPU job is still running. Wait or cancel it.'}); return; }
    if (!requirements.every(p => existsSync(p))) { res.status(503).json({error: 'Local models are not installed. Run scripts/setup_local_ai.ps1 first.'}); return; }
    const job: Job = {id: randomUUID(), kind, prompt: prompt.trim(), seed, status: 'running', message: 'Loading local model…', createdAt: new Date().toISOString()};
    const folder = path.join(output, job.id);
    mkdirSync(folder); jobs.set(job.id, job); save(job);
    const child = launch(python, ['-u', path.join(root, 'scripts/run_local_ai.py'), kind, '--prompt', job.prompt,
      '--seed', String(seed), '--output', folder], {cwd: root, windowsHide: true, shell: false});
    active = {job, child};
    let log = '';
    const timer = setTimeout(() => stop('Stopped after 10 minutes. Check local GPU availability and retry.'), 600000);
    const capture = (chunk: Buffer) => {
      log = (log + chunk.toString()).slice(-16000);
      const steps = [...log.matchAll(/CUDA denoising pass (\d+)/g)];
      if (job.status === 'running' && log.includes('Preparing local disk offload') && !steps.length) job.message = 'Preparing local disk offload cache…';
      if (job.status === 'running' && steps.length) {
        job.message = `Denoising pass ${steps.at(-1)![1]} / ${kind === 'image' ? 21 : 4} on local GPU`;
      }
    };
    child.stdout?.on('data', capture); child.stderr?.on('data', capture);
    child.on('error', error => {job.error = error.message;});
    child.on('close', code => {
      clearTimeout(timer);
      writeFileSync(path.join(folder, 'worker.log'), log);
      if (job.status !== 'cancelled') {
        try {
          const report = JSON.parse(readFileSync(path.join(folder, 'inference-report.json'), 'utf8'));
          if (code !== 0 || !['technical_pass','passed'].includes(report.status)) throw new Error(report.error || `Worker exited (${code}).`);
          if (!existsSync(path.join(folder, kind === 'image' ? 'generated-image.png' : 'generated-video.mp4'))) throw new Error('Generated media is missing.');
          job.report = report; job.status = 'completed'; job.message = 'Generated locally. Review visual quality.';
        } catch (error) {
          job.status = 'failed'; job.error ||= error instanceof Error ? error.message : 'Local generation failed.';
          job.message = 'Generation failed. No cloud fallback was used.';
        }
      }
      save(job); active = undefined;
    });
    res.status(202).json(job);
  });
  app.use((error: any, _req: any, res: any, _next: any) => res.status(error.status || 500).json({error: error.status === 413 ? 'Request too large.' : 'Invalid local request.'}));
  return {app, stop};
}

export function localAiPlugin(): Plugin {
  return {name: 'anchorshot-local-ai', configureServer(server) {
    if (server.config.server.middlewareMode) return;
    const service = createLocalAi(server.config.root);
    server.middlewares.use('/api/local-ai', service.app);
    server.httpServer?.once('close', () => service.stop('Local server stopped.'));
  }};
}
