import { createHash, randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import sharp from 'sharp';
import {
  decodeMaskToRaster,
  parseImageStream,
  recordsOfKind,
  type ResponsesEvent,
} from '@meta-sam/parser';
import {
  MAX_EDGE,
  MAX_PIXELS,
  type ContinuityEvidenceStatus,
  type ObjectMask,
  type SamCheckEvidence,
  type SegmentationResult,
  type StoredMaskTrack,
} from '../src/types';

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
  revision = 1,
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
  const normalizedConcept = input.concept.toLowerCase().replace(/\s+/g, '-');
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
    const maskRef = `sam-3.1:${normalizedConcept}:${record.objectId}:v${revision}`;
    return {
      id: `${requestId}:${record.objectId}`,
      maskRef,
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
  const check = evaluateSamContinuityCheck(objects, input.concept);
  return {
    requestId,
    sourceHash: input.sourceHash,
    objects,
    maskRef: check.maskRef ?? undefined,
    selectedObjectId: check.selectedObjectId,
    ambiguityStatus: check.status,
    evidence: check.explanation,
    provenance: 'live-sam-3.1',
  };
}

/**
 * Role 2 Deliverable: Neutral Object Selection & Ambiguity Handling.
 * Ranks candidate SAM 3.1 masks without color bias, detects multi-object or low-IoU
 * ambiguity (`uncertain`), and evaluates attribute continuity (`consistent` vs `mismatch`).
 */
export function evaluateSamContinuityCheck(
  objects: ObjectMask[],
  concept: string,
  options?: {
    expectedValue?: string;
    observedValue?: string;
    minConfidence?: number;
    ambiguityMargin?: number;
  },
): SamCheckEvidence {
  const minConfidence = options?.minConfidence ?? 0.8;
  const ambiguityMargin = options?.ambiguityMargin ?? 0.08;

  if (objects.length === 0) {
    return {
      status: 'uncertain',
      maskRef: null,
      selectedObjectId: null,
      candidateCount: 0,
      confidence: 0,
      expectedValue: options?.expectedValue,
      observedValue: options?.observedValue,
      explanation: `SAM 3.1 found 0 candidate masks for "${concept}". Confirm object visibility or refine prompt.`,
      isAmbiguous: true,
    };
  }

  // Neutral ranking: sort by confidence descending, then by bounding-box area descending
  const ranked = [...objects].sort((a, b) => {
    const confA = a.confidence ?? 0.95;
    const confB = b.confidence ?? 0.95;
    if (Math.abs(confB - confA) > 0.001) return confB - confA;
    const areaA = (a.bounds.right - a.bounds.left) * (a.bounds.bottom - a.bounds.top);
    const areaB = (b.bounds.right - b.bounds.left) * (b.bounds.bottom - b.bounds.top);
    return areaB - areaA;
  });

  const primary = ranked[0];
  const primaryConf = primary.confidence ?? 0.95;
  const primaryMaskRef =
    primary.maskRef ?? `sam-3.1:${concept.toLowerCase()}:${primary.objectId}:v1`;

  // Check 1: Low IoU confidence (e.g., partial occlusion)
  if (primaryConf < minConfidence) {
    return {
      status: 'uncertain',
      maskRef: primaryMaskRef,
      selectedObjectId: primary.objectId,
      candidateCount: objects.length,
      confidence: primaryConf,
      expectedValue: options?.expectedValue,
      observedValue: options?.observedValue,
      explanation: `Low SAM 3.1 confidence (${(primaryConf * 100).toFixed(1)}% < ${(
        minConfidence * 100
      ).toFixed(0)}%) on "${concept}" (${primaryMaskRef}); partial occlusion or ambiguity requires confirmation.`,
      isAmbiguous: true,
    };
  }

  // Check 2: Multiple competing candidates with nearly identical confidence
  if (ranked.length > 1) {
    const runnerUpConf = ranked[1].confidence ?? 0.95;
    if (Math.abs(primaryConf - runnerUpConf) < ambiguityMargin) {
      return {
        status: 'uncertain',
        maskRef: primaryMaskRef,
        selectedObjectId: primary.objectId,
        candidateCount: objects.length,
        confidence: primaryConf,
        expectedValue: options?.expectedValue,
        observedValue: options?.observedValue,
        explanation: `Ambiguous selection: ${objects.length} candidate "${concept}" instances detected (${primary.objectId} vs ${ranked[1].objectId}). Select target object ID to lock continuity.`,
        isAmbiguous: true,
      };
    }
  }

  // Check 3: Attribute comparison (if expectedValue and observedValue are provided)
  if (
    options?.expectedValue &&
    options?.observedValue &&
    options.expectedValue.toLowerCase().trim() !== options.observedValue.toLowerCase().trim()
  ) {
    return {
      status: 'mismatch',
      maskRef: primaryMaskRef,
      selectedObjectId: primary.objectId,
      candidateCount: objects.length,
      confidence: primaryConf,
      expectedValue: options.expectedValue,
      observedValue: options.observedValue,
      explanation: `SAM 3.1 isolated "${concept}" (${primaryMaskRef}, ${(
        primaryConf * 100
      ).toFixed(1)}% IoU): observed "${options.observedValue}" conflicts with expected rule "${
        options.expectedValue
      }".`,
      isAmbiguous: false,
    };
  }

  return {
    status: 'consistent',
    maskRef: primaryMaskRef,
    selectedObjectId: primary.objectId,
    candidateCount: objects.length,
    confidence: primaryConf,
    expectedValue: options?.expectedValue,
    observedValue: options?.observedValue ?? options?.expectedValue,
    explanation: `SAM 3.1 verified "${concept}" via ${primaryMaskRef} (${(
      primaryConf * 100
    ).toFixed(1)}% IoU).`,
    isAmbiguous: false,
  };
}

/**
 * Role 2 Deliverable: Versioned Mask & Cross-Shot Track Storage (`MaskTrackStore`).
 */
export class MaskTrackStore {
  private tracks = new Map<string, StoredMaskTrack>();
  private revisionCounters = new Map<string, number>();

  public nextRevision(shotNumber: number, concept: string): number {
    const key = `shot-${shotNumber}:${concept.toLowerCase().trim()}`;
    const next = (this.revisionCounters.get(key) ?? 0) + 1;
    this.revisionCounters.set(key, next);
    return next;
  }

  public recordTrack(entry: StoredMaskTrack): StoredMaskTrack {
    this.tracks.set(entry.maskRef, entry);
    return entry;
  }

  public getTrack(maskRef: string): StoredMaskTrack | undefined {
    return this.tracks.get(maskRef);
  }

  public listTracks(concept?: string, shotNumber?: number): StoredMaskTrack[] {
    const all = Array.from(this.tracks.values());
    return all.filter((t) => {
      if (concept && t.concept.toLowerCase() !== concept.toLowerCase()) return false;
      if (shotNumber !== undefined && t.shotNumber !== shotNumber) return false;
      return true;
    });
  }

  public disambiguate(
    maskRef: string,
    selectedObjectId: string,
    resolvedStatus: ContinuityEvidenceStatus = 'consistent',
  ): StoredMaskTrack | null {
    const existing = this.tracks.get(maskRef);
    if (!existing) return null;
    const updated: StoredMaskTrack = {
      ...existing,
      objectId: selectedObjectId,
      status: resolvedStatus,
      evidence: `Director disambiguated object "${selectedObjectId}" for ${maskRef}; status locked as ${resolvedStatus}.`,
    };
    this.tracks.set(maskRef, updated);
    return updated;
  }

  /**
   * Invalidates stale tracks for a shot when the underlying frame `sourceHash`
   * or `ruleRevision` changes (per BUILD_NOTES.md invariant).
   */
  public invalidateBySourceOrRule(
    shotNumber: number,
    newSourceHash?: string,
    newRuleRevision?: number,
  ): number {
    let removed = 0;
    for (const [key, track] of this.tracks.entries()) {
      if (track.shotNumber !== shotNumber) continue;
      const hashChanged = Boolean(newSourceHash && track.sourceHash !== newSourceHash);
      const revChanged = Boolean(
        newRuleRevision !== undefined && track.revision < newRuleRevision,
      );
      if (hashChanged || revChanged) {
        this.tracks.delete(key);
        removed++;
      }
    }
    return removed;
  }
}

const OFFLINE_SAM_WIRE =
  "<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|><|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>";

export async function* createOfflineSamWireEvents(): AsyncGenerator<ResponsesEvent> {
  const lane = { item_id: 'msg-offline-sam', output_index: 0, content_index: 0 };
  yield { type: 'response.output_text.delta', delta: OFFLINE_SAM_WIRE.slice(0, 48), ...lane };
  yield { type: 'response.output_text.delta', delta: OFFLINE_SAM_WIRE.slice(48), ...lane };
  yield { type: 'response.output_text.done', text: OFFLINE_SAM_WIRE, ...lane };
  yield { type: 'response.completed' };
}

/**
 * Decodes an offline SAM 3.1 segmentation using the real `@meta-sam/parser` stream parser
 * when dimensions fit the wire fixture, or synthesizes a bounded mask for tiny test images.
 */
export async function decodeOfflineSamSelection(
  input: CheckedInput,
  revision = 1,
  confidence = 0.984,
): Promise<SegmentationResult> {
  if (input.width >= 271 && input.height >= 255) {
    const decoded = await decodeSelection(createOfflineSamWireEvents(), input, revision);
    decoded.objects = decoded.objects.map((obj) => ({
      ...obj,
      source: 'sample' as const,
      confidence,
    }));
    decoded.provenance = 'offline-fixture';
    return decoded;
  }
  const requestId = randomUUID();
  const normalizedConcept = input.concept.toLowerCase().replace(/\s+/g, '-');
  const maskRef = `sam-3.1:${normalizedConcept}:0:v${revision}`;
  const rw = Math.max(1, Math.floor(input.width / 2));
  const rh = Math.max(1, Math.floor(input.height / 2));
  const raster = new Uint8Array(rw * rh).fill(1);
  const obj: ObjectMask = {
    id: `${requestId}:0`,
    maskRef,
    objectId: '0',
    label: `${input.concept} 0`,
    source: 'sample',
    sourceHash: input.sourceHash,
    width: input.width,
    height: input.height,
    bounds: { left: 0, top: 0, right: rw, bottom: rh },
    rasterWidth: rw,
    rasterHeight: rh,
    rasterBase64: Buffer.from(raster).toString('base64'),
    confidence,
  };
  const check = evaluateSamContinuityCheck([obj], input.concept);
  return {
    requestId,
    sourceHash: input.sourceHash,
    objects: [obj],
    maskRef,
    selectedObjectId: '0',
    ambiguityStatus: check.status,
    evidence: check.explanation,
    provenance: 'offline-fixture',
  };
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
