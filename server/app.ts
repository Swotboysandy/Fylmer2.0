import { randomBytes } from 'node:crypto';
import express, { type ErrorRequestHandler } from 'express';
import { checkInput, requestSam, UserError, type CheckedInput } from './sam';
import type { SegmentationResult } from '../src/types';

interface Settings {
  key: string;
  requestLimit: number;
}
interface Options {
  settings: () => Settings;
  segment?: (input: CheckedInput, key: string, signal: AbortSignal) => Promise<SegmentationResult>;
}

export function createApp(options: Options) {
  const app = express();
  const sessionToken = randomBytes(24).toString('hex');
  let requestsUsed = 0;
  let active = false;
  app.disable('x-powered-by');
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['127.0.0.1', 'localhost'].includes(req.hostname))
      return res.status(403).json({ error: 'This prototype accepts local requests only.' });
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`)
      return res.status(403).json({ error: 'Open this app on its local address.' });
    next();
  });
  app.get('/api/health', (_req, res) => {
    const settings = options.settings();
    res.json({
      configured: Boolean(settings.key),
      model: 'sam-3.1',
      sessionToken,
      requestsUsed,
      requestLimit: settings.requestLimit,
    });
  });
  app.use('/api', express.json({ limit: '12mb' }));
  app.post('/api/segment', async (req, res, next) => {
    if (req.headers['x-framelock-session'] !== sessionToken)
      return res.status(403).json({ error: 'Refresh the page before selecting an object.' });
    const settings = options.settings();
    if (!settings.key)
      return res.status(503).json({
        error: 'SAM is not connected. Add META_API_KEY to .env.local, or use the offline sample.',
      });
    if (active)
      return res
        .status(409)
        .json({ error: 'A selection is already running. Wait for it to finish.' });
    if (requestsUsed >= settings.requestLimit)
      return res
        .status(429)
        .json({ error: 'The session request limit has been reached. No further call was sent.' });
    active = true;
    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      const input = await checkInput(req.body);
      if (controller.signal.aborted) return;
      requestsUsed++;
      const result = await (options.segment ?? requestSam)(input, settings.key, controller.signal);
      if (!controller.signal.aborted) res.json(result);
    } catch (error) {
      if (!controller.signal.aborted) next(error);
    } finally {
      active = false;
    }
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));
  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof UserError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    const status =
      typeof error === 'object' && error !== null && 'status' in error ? Number(error.status) : 500;
    const message =
      status === 401 || status === 403
        ? 'Meta could not authorize this key. Check its SAM access.'
        : status === 429
          ? 'Meta is rate limiting requests. Wait before trying again.'
          : status === 413
            ? 'The image is too large. Upload an image under 8 MB.'
            : status === 400
              ? 'The request could not be read. Try loading the frame again.'
              : 'The selection service did not complete. No correction was applied. Try again when connected.';
    res.status([400, 401, 403, 413, 429].includes(status) ? status : 502).json({ error: message });
  };
  app.use(errorHandler);
  return app;
}
