import { createHash } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import type { ResponsesEvent } from '@meta-sam/parser';
import { createApp } from '../server/app';
import { checkInput, decodeSelection, requestSam, type CheckedInput } from '../server/sam';

let body: { image: string; concept: string; sourceHash: string };
afterEach(() => vi.unstubAllGlobals());
beforeAll(async () => {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#cc5533' } })
    .png()
    .toBuffer();
  body = {
    image: `data:image/png;base64,${bytes.toString('base64')}`,
    concept: 'cup',
    sourceHash: createHash('sha256').update(bytes).digest('hex'),
  };
});

describe('local SAM boundary', () => {
  it('validates the actual image and hash before spending a request', async () => {
    expect((await checkInput(body)).width).toBe(2);
    await expect(checkInput({ ...body, image: 'http://127.0.0.1/private' })).rejects.toThrow(
      'Upload',
    );
    await expect(checkInput({ ...body, sourceHash: 'stale' })).rejects.toThrow('changed');
    await expect(checkInput({ ...body, concept: 'cup\nchair' })).rejects.toThrow('short');
  });
  it('reports missing configuration and makes no model call', async () => {
    const segment = vi.fn();
    const app = createApp({ settings: () => ({ key: '', requestLimit: 10 }), segment });
    const health = await request(app).get('/api/health');
    expect(health.body.configured).toBe(false);
    const response = await request(app)
      .post('/api/segment')
      .set('X-Framelock-Session', health.body.sessionToken)
      .send(body);
    expect(response.status).toBe(503);
    expect(segment).not.toHaveBeenCalled();
  });
  it('blocks cross-origin, invalid-host and tokenless paid requests', async () => {
    const segment = vi.fn();
    const app = createApp({ settings: () => ({ key: 'test-key', requestLimit: 10 }), segment });
    expect((await request(app).get('/api/health').set('Host', 'untrusted.example')).status).toBe(
      403,
    );
    expect(
      (await request(app).get('/api/health').set('Origin', 'https://untrusted.example')).status,
    ).toBe(403);
    expect((await request(app).post('/api/segment').send(body)).status).toBe(403);
    expect(segment).not.toHaveBeenCalled();
  });
  it('limits provider attempts and does not return the key', async () => {
    const segment = vi.fn(async () => ({
      requestId: 'test',
      sourceHash: body.sourceHash,
      objects: [],
    }));
    const app = createApp({
      settings: () => ({ key: 'private-test-secret', requestLimit: 1 }),
      segment,
    });
    const health = await request(app).get('/api/health');
    expect(JSON.stringify(health.body)).not.toContain('private-test-secret');
    const send = () =>
      request(app)
        .post('/api/segment')
        .set('X-Framelock-Session', health.body.sessionToken)
        .send(body);
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(429);
    expect(segment).toHaveBeenCalledTimes(1);
  });
  it('does not count invalid input and does not leak upstream error text', async () => {
    const segment = vi.fn(async () => {
      throw { status: 401, message: 'private-upstream-secret' };
    });
    const app = createApp({ settings: () => ({ key: 'test-key', requestLimit: 2 }), segment });
    const health = await request(app).get('/api/health');
    const send = (data: object) =>
      request(app)
        .post('/api/segment')
        .set('X-Framelock-Session', health.body.sessionToken)
        .send(data);
    expect((await send({ ...body, sourceHash: 'bad' })).status).toBe(400);
    expect((await request(app).get('/api/health')).body.requestsUsed).toBe(0);
    const result = await send(body);
    expect(result.status).toBe(401);
    expect(result.text).not.toContain('private-upstream-secret');
  });
});

// The tiny wire example is from Meta's published SAM output documentation, not a live project request.
const wire =
  "<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|><|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>";
const input: CheckedInput = {
  image: '',
  concept: 'button',
  sourceHash: 'test-source',
  width: 320,
  height: 334,
};
async function* events(text: string, complete = true): AsyncGenerator<ResponsesEvent> {
  const lane = { item_id: 'msg-test', output_index: 0, content_index: 0 };
  if (text) {
    yield { type: 'response.output_text.delta', delta: text.slice(0, 47), ...lane };
    yield { type: 'response.output_text.delta', delta: text.slice(47), ...lane };
  }
  // An empty match set has no deltas, but still finalizes the output-text lane.
  yield { type: 'response.output_text.done', text, ...lane };
  if (complete) yield { type: 'response.completed' };
}
describe('actual Meta parser integration using a documented fixture', () => {
  it('decodes a fragmented stream into a cropped binary mask with source coordinates', async () => {
    const result = await decodeSelection(events(wire), input);
    expect(result.objects).toHaveLength(1);
    const mask = result.objects[0];
    expect(mask.bounds).toEqual({ left: 211, top: 228, right: 271, bottom: 255 });
    const raster = Buffer.from(mask.rasterBase64, 'base64');
    expect(raster.length).toBe(60 * 27);
    expect([...raster].every((value) => value === 0 || value === 1)).toBe(true);
    expect(mask.sourceHash).toBe('test-source');
  });
  it('accepts a completed zero-match response', async () => {
    expect((await decodeSelection(events(''), input)).objects).toEqual([]);
  });
  it('rejects truncated or malformed output rather than calling it success', async () => {
    await expect(decodeSelection(events(wire, false), input)).rejects.toThrow('incomplete');
    await expect(decodeSelection(events('<0f>invalid'), input)).rejects.toThrow();
  });
});

describe('SDK request contract with a stubbed HTTP transport; no live API', () => {
  it('sends SAM to the documented endpoint and consumes its streamed mask', async () => {
    const chunks: ResponsesEvent[] = [];
    for await (const event of events(wire)) chunks.push(event);
    const fetchStub = vi.fn(
      async () =>
        new Response(
          chunks.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n',
          { headers: { 'Content-Type': 'text/event-stream' } },
        ),
    );
    vi.stubGlobal('fetch', fetchStub);
    const result = await requestSam(input, 'test-key', new AbortController().signal);
    expect(result.objects).toHaveLength(1);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toBe('https://api.meta.ai/v1/responses');
    const payload = JSON.parse(init.body as string);
    expect(payload.model).toBe('sam-3.1');
    expect(payload.stream).toBe(true);
    expect(payload.metadata).toEqual({ mask_encoding: 'one_bit', include_confidence: 'true' });
    expect(payload.input[0].content[0]).toEqual({ type: 'input_text', text: 'button' });
  });
  it('does not retry a provider rate limit automatically', async () => {
    const fetchStub = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: 'test rate limit' } }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchStub);
    await expect(requestSam(input, 'test-key', new AbortController().signal)).rejects.toThrow();
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
});
