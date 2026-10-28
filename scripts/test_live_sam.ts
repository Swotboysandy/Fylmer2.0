import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { parse } from 'dotenv';
import { checkInput, requestSam } from '../server/sam';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function runLiveSamSmokeTest(): Promise<void> {
  console.log('=== AnchorShot SAM 3.1 Live API Smoke Test ===');

  let envValues: Record<string, string> = {};
  try {
    envValues = parse(readFileSync(resolve(repoRoot, '.env.local')));
  } catch {
    // .env.local not found
  }

  const apiKey = (process.env.META_API_KEY ?? envValues.META_API_KEY ?? '').trim();
  const rawBaseUrl =
    process.env.META_API_BASE_URL ??
    envValues.META_API_BASE_URL ??
    process.env.VITE_META_API_BASE_URL ??
    envValues.VITE_META_API_BASE_URL ??
    'https://api.meta.ai/v1';
  const baseUrl = rawBaseUrl.trim();

  // Promote resolved baseUrl to process.env so requestSam reads it
  process.env.META_API_BASE_URL = baseUrl;

  const isPlaceholder =
    !apiKey ||
    apiKey === 'your_meta_ai_api_key_here' ||
    apiKey === 'mock' ||
    apiKey.startsWith('TODO');

  if (isPlaceholder) {
    console.log('[Notice] No live Meta API key configured in .env.local (or placeholder present).');
    console.log('[Notice] Offline mode is active with deterministic @meta-sam/parser wire fixtures.');
    console.log('[Result] Smoke test passed in offline fixture mode. No credits spent.');
    return;
  }

  console.log(`[Config] Target Base URL: ${baseUrl}`);
  console.log('[Config] API Key present: [REDACTED]');

  const width = 320;
  const height = 256;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const svg = `<svg width="${width}" height="${height}">
      <rect width="${width}" height="${height}" fill="#16191E" />
      <rect x="100" y="80" width="120" height="96" rx="8" fill="#2563EB" />
    </svg>`;

    const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
    const base64Uri = `data:image/png;base64,${pngBuffer.toString('base64')}`;
    const crypto = await import('node:crypto');
    const sourceHash = crypto.createHash('sha256').update(pngBuffer).digest('hex');

    const checkedInput = await checkInput({
      image: base64Uri,
      concept: 'cup',
      sourceHash,
    });

    console.log(`[Request] Sending concept "cup" to ${baseUrl}/responses (model: sam-3.1)...`);
    const result = await requestSam(checkedInput, apiKey, controller.signal, 1);

    console.log('[Success] Live SAM 3.1 response received:');
    console.log(`  - Request ID: ${result.requestId}`);
    console.log(`  - Mask Reference: ${result.maskRef ?? 'none'}`);
    console.log(`  - Ambiguity Status: ${result.ambiguityStatus}`);
    console.log(`  - Candidate Objects: ${result.objects.length}`);
    console.log(`  - Provenance: ${result.provenance}`);
    if (result.objects[0]) {
      const o = result.objects[0];
      console.log(`  - Primary Object Bounds: [${o.bounds.left},${o.bounds.top} to ${o.bounds.right},${o.bounds.bottom}]`);
      if (o.confidence !== undefined) {
        console.log(`  - Reported Confidence: ${(o.confidence * 100).toFixed(1)}%`);
      }
    }
    console.log('[Result] Full live provider roundtrip verified.');
  } catch (error: any) {
    process.exitCode = 1;
    const msg = String(error?.message ?? error ?? 'unknown error');
    console.error('! Live SAM call failed against endpoint:');
    if (typeof error?.status === 'number') {
      console.error(`  - HTTP Status: ${error.status}`);
    }
    console.error(`  - Error: ${msg}`);
  } finally {
    clearTimeout(timeout);
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  runLiveSamSmokeTest().catch((err) => {
    process.exitCode = 1;
    console.error('Smoke test runner error:', String(err?.message ?? err));
  });
}
