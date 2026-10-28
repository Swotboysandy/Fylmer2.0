import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brand } from '../src/brand';
import { verifyMaskedPixelDiff } from '../src/services/canvasEngine';
import { evaluateSamContinuityCheck, MaskTrackStore, type StoredMaskTrack } from '../server/sam';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface EvidenceItem {
  shotNumber: number;
  concept: string;
  maskRef: string;
  status: 'consistent' | 'mismatch' | 'uncertain';
  ruleRevision: number;
  confidence: number;
  outsideDriftPixels: number;
  outsideDriftPercent: number;
  changedInsidePixels: number;
  provenance: 'offline-fixture' | 'live-sam-3.1';
  explanation: string;
}

interface EvidenceBundle {
  brand: string;
  version: string;
  generatedAt: string;
  environment: string;
  overallContinuity: 'VERIFIED' | 'DISCREPANCY_FLAGGED' | 'AMBIGUITY_DETECTED';
  totalShots: number;
  verifiedZeroOutsideDrift: boolean;
  shots: EvidenceItem[];
  storedTracks: StoredMaskTrack[];
}

export function generateEvidenceBundle(): EvidenceBundle {
  const width = 80;
  const height = 45;
  const store = new MaskTrackStore();

  // Test sequence: Shot 1 consistent, Shot 2 intentional mismatch (repaired with rev 2),
  // Shot 3 consistent, Shot 4 uncertain ambiguity (partial occlusion)
  const shotScenarios = [
    { shotNumber: 1, concept: 'cup', color: 'blue', expectedColor: 'blue', confidence: 0.988, revision: 1 },
    { shotNumber: 2, concept: 'cup', color: 'red', expectedColor: 'blue', confidence: 0.984, revision: 2 },
    { shotNumber: 3, concept: 'cup', color: 'blue', expectedColor: 'blue', confidence: 0.976, revision: 1 },
    { shotNumber: 4, concept: 'cup', color: 'blue', expectedColor: 'blue', confidence: 0.724, revision: 1 },
  ];

  const items: EvidenceItem[] = [];

  for (const s of shotScenarios) {
    const maskRef = `sam-3.1:${s.concept}:0:v${s.revision}`;
    // 800x450 canvas: bounds [200, 90 to 400, 270] -> percentage box: x=25%, y=20%, w=25%, h=40%
    const box = { x: 25, y: 20, width: 25, height: 40 };

    const check = evaluateSamContinuityCheck(
      [
        {
          id: `eval-${s.shotNumber}`,
          maskRef,
          objectId: '0',
          label: `${s.concept} 0`,
          source: 'sample',
          sourceHash: 'sha256-mock-frame-hash',
          width: 800,
          height: 450,
          bounds: { left: 200, top: 90, right: 400, bottom: 270 },
          rasterWidth: 800,
          rasterHeight: 450,
          rasterBase64: '',
          confidence: s.confidence,
        },
      ],
      s.concept,
      {
        expectedValue: s.expectedColor,
        observedValue: s.color,
        minConfidence: 0.8,
        revision: s.revision,
      },
    );

    // On 80x45 buffer: percentage box [25%, 20%, 25%, 40%] maps to px: x=[20..40], y=[9..27]
    const before = new Uint8ClampedArray(width * height * 4).fill(30);
    const after = before.slice();
    for (let y = 10; y < 25; y++) {
      for (let x = 22; x < 38; x++) {
        const idx = (y * width + x) * 4;
        after[idx] = 37;
        after[idx + 1] = 99;
        after[idx + 2] = 235;
      }
    }

    const verification = verifyMaskedPixelDiff(
      before,
      after,
      width,
      height,
      box,
      maskRef,
      s.revision,
    );

    store.recordTrack({
      maskRef,
      concept: s.concept,
      shotNumber: s.shotNumber,
      revision: s.revision,
      objectId: '0',
      bounds: { left: 200, top: 90, right: 400, bottom: 270 },
      confidence: s.confidence,
      sourceHash: 'sha256-mock-frame-hash',
      status: check.status,
      evidence: check.explanation,
      provenance: 'offline-fixture',
      createdAt: Date.now(),
    });

    items.push({
      shotNumber: s.shotNumber,
      concept: s.concept,
      maskRef,
      status: check.status,
      ruleRevision: s.revision,
      confidence: s.confidence,
      outsideDriftPixels: verification.changedOutsideMask,
      outsideDriftPercent: verification.outsideDriftPercent,
      changedInsidePixels: verification.changedInsideMask,
      provenance: 'offline-fixture',
      explanation: check.explanation,
    });
  }

  const hasMismatch = items.some((i) => i.status === 'mismatch');
  const hasUncertain = items.some((i) => i.status === 'uncertain');
  const overallContinuity =
    hasMismatch && hasUncertain
      ? 'DISCREPANCY_AND_AMBIGUITY_DETECTED'
      : hasMismatch
        ? 'DISCREPANCY_FLAGGED'
        : hasUncertain
          ? 'AMBIGUITY_DETECTED'
          : 'VERIFIED';

  return {
    brand: brand.name,
    version: '0.1.0',
    generatedAt: new Date().toISOString(),
    environment: 'Node.js / AnchorShot local engine',
    overallContinuity,
    totalShots: items.length,
    verifiedZeroOutsideDrift: items.every((i) => i.outsideDriftPixels === 0),
    shots: items,
    storedTracks: store.listTracks(),
  };
}

export function writeEvidenceArtifacts(): void {
  const bundle = generateEvidenceBundle();
  const artifactsDir = resolve(repoRoot, '.artifacts');
  mkdirSync(artifactsDir, { recursive: true });

  const jsonPath = resolve(artifactsDir, 'evidence-bundle.json');
  writeFileSync(jsonPath, JSON.stringify(bundle, null, 2), 'utf-8');

  const mdContent = `# ${bundle.brand} Continuity & SAM 3.1 Verification Evidence Bundle

- Generated At: ${bundle.generatedAt}
- Environment: ${bundle.environment}
- Overall Status: ${bundle.overallContinuity}
- Zero Outside-Mask Drift Verified: ${bundle.verifiedZeroOutsideDrift ? 'YES (0 px across all repairs)' : 'NO'}

## Shot Audit & Mask Provenance

| Shot | Concept | Mask Reference | Status | Confidence | Inside Edited (px) | Outside Drift (px) | Provenance |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
${bundle.shots
  .map(
    (s) =>
      `| Shot ${s.shotNumber} | \`${s.concept}\` | \`${s.maskRef}\` | **${s.status}** | ${(
        s.confidence * 100
      ).toFixed(1)}% | ${s.changedInsidePixels} | ${s.outsideDriftPixels} (${s.outsideDriftPercent}%) | \`${s.provenance}\` |`,
  )
  .join('\n')}

## Detailed Audit Explanations
${bundle.shots.map((s) => `- Shot ${s.shotNumber} (${s.maskRef}): ${s.explanation}`).join('\n')}

## Stored Mask Tracks
${bundle.storedTracks.map((t) => `- Track: ${t.maskRef} (Shot ${t.shotNumber}, Rev ${t.revision}, status: ${t.status})`).join('\n')}

---
AnchorShot Review Evidence Bundle - generated under strict Role 2 deliverable invariants.
`;

  const mdPath = resolve(artifactsDir, 'EVIDENCE.md');
  writeFileSync(mdPath, mdContent, 'utf-8');

  console.log('Evidence bundle written to:');
  console.log(`  - ${jsonPath}`);
  console.log(`  - ${mdPath}`);
  console.log(`Zero outside-mask drift proof: ${bundle.verifiedZeroOutsideDrift ? 'PASSED (0 px)' : 'FAILED'}`);
  if (!bundle.verifiedZeroOutsideDrift) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  writeEvidenceArtifacts();
}
