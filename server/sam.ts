import { createHash, randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import sharp from 'sharp';
import {
  decodeMaskToRaster,
  parseImageStream,
  recordsOfKind,
  type ResponsesEvent,
} from '@meta-sam/parser';
import { MAX_EDGE, MAX_PIXELS, type SegmentationResult } from '../src/types';

export class UserError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export interface SegmentInput {
  image: string;
  concept: string;
  sourceHash: string;
}
export interface CheckedInput extends SegmentInput {
  width: number;
  height: number;
}

export async function checkInput(body: unknown): Promise<CheckedInput> {
  if (!body || typeof body !== 'object')
    throw new UserError('Choose an image and an object first.');
  const { image, concept, sourceHash } = body as Partial<SegmentInput>;
  if (
    typeof concept !== 'string' ||
    !concept.trim() ||
    concept.length > 100 ||
    /[\r\n<>|]/.test(concept)
  ) {
    throw new UserError('Use one short object name, such as cup.');
  }
  if (
    typeof image !== 'string' ||
    image.length > 11_200_000 ||
    !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)
  ) {
    throw new UserError('Upload a PNG or JPEG image up to 8 MB.');
  }
  const bytes = Buffer.from(image.slice(image.indexOf(',') + 1), 'base64');
  if (bytes.length > 8 * 1024 * 1024)
    throw new UserError('The image is too large. Try a smaller image.');
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== sourceHash)
    throw new UserError('The image changed. Load it again before selecting.');
  try {
    const metadata = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).metadata();
    const { width, height, format, pages, orientation } = metadata;
    if (
      !width ||
      !height ||
      width > MAX_EDGE ||
      height > MAX_EDGE ||
      width * height > MAX_PIXELS ||
      !['png', 'jpeg'].includes(format ?? '') ||
      (pages ?? 1) > 1 ||
      (orientation ?? 1) !== 1
    ) {
      throw new Error('Unsupported dimensions or orientation.');
    }
    // A metadata header alone does not prove the image decodes successfully.
    await sharp(bytes, { limitInputPixels: MAX_PIXELS }).raw().toBuffer();
    return { image, concept: concept.trim(), sourceHash: hash, width, height };
  } catch {
    throw new UserError(
      'This image could not be decoded. Upload a PNG or JPEG up to 1600 pixels on each edge.',
    );
  }
}

export async function decodeSelection(
  events: AsyncIterable<ResponsesEvent>,
  input: CheckedInput,
): Promise<SegmentationResult> {
  const result = await parseImageStream(events).finalResult;
  if (result.outcome.status !== 'completed' || result.diagnostics.length > 0) {
    throw new UserError(
      'SAM returned an incomplete selection. No mask was applied; try selecting again.',
      502,
    );
  }
  const requestId = randomUUID();
  const records = recordsOfKind(result.records, 'mask');
  if (records.length > 16)
    throw new UserError('Too many matching objects. Use a more specific object name.', 422);
  const objects = records.map((record) => {
    const { bounds, mask } = record;
    if (
      (record.frame?.frameIndex ?? 0) !== 0 ||
      bounds.left < 0 ||
      bounds.top < 0 ||
      bounds.right > input.width ||
      bounds.bottom > input.height ||
      bounds.right <= bounds.left ||
      bounds.bottom <= bounds.top ||
      mask.width * mask.height > MAX_PIXELS
    ) {
      throw new UserError(
        'SAM returned a selection outside this frame. No correction was applied.',
        502,
      );
    }
    const raster = decodeMaskToRaster(mask);
    return {
      id: `${requestId}:${record.objectId}`,
      objectId: record.objectId,
      label: `${input.concept} ${record.objectId}`,
      source: 'sam' as const,
      sourceHash: input.sourceHash,
      width: input.width,
      height: input.height,
      bounds,
      rasterWidth: mask.width,
      rasterHeight: mask.height,
      rasterBase64: Buffer.from(raster).toString('base64'),
      ...(record.confidence === undefined ? {} : { confidence: record.confidence }),
    };
  });
  return { requestId, sourceHash: input.sourceHash, objects };
}

export async function requestSam(
  input: CheckedInput,
  key: string,
  signal: AbortSignal,
): Promise<SegmentationResult> {
  const client = new OpenAI({
    apiKey: key,
    baseURL: 'https://api.meta.ai/v1',
    maxRetries: 0,
    timeout: 60_000,
  });
  const events = await client.responses.create(
    {
      model: 'sam-3.1',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [
            { type: 'input_text', text: input.concept },
            { type: 'input_image', image_url: input.image, detail: 'auto' },
          ],
        },
      ],
      stream: true,
      metadata: { mask_encoding: 'one_bit', include_confidence: 'true' },
    },
    { signal },
  );
  return decodeSelection(events as AsyncIterable<ResponsesEvent>, input);
}
