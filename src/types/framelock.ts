export type RuleStatus = 'consistent' | 'mismatch' | 'uncertain';

export interface ContinuityRule {
  id: string;
  scope: 'all_shots' | 'single_shot';
  targetObject: string; // e.g. "cup"
  property: string;     // e.g. "color"
  expectedValue: string; // e.g. "blue"
  revision: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SamMask {
  id: string;
  objectId: string;
  maskBase64: string; // Binary/RLE mask canvas data
  box: BoundingBox;
  confidence: number;
}

export interface StoryboardShot {
  id: string;
  shotNumber: number;
  durationSeconds: number;
  promptDescription: string;
  spokenDescription: string;
  currentImageUrl: string;
  originalImageUrl: string;
  status: RuleStatus;
  discrepancyMessage?: string;
  proposedFix?: {
    action: 'recolor' | 'replace';
    targetObject: string;
    targetColor: string;
    mask?: SamMask;
  };
  revisions: Array<{
    revisionId: string;
    timestamp: number;
    imageUrl: string;
    actionApplied: string;
  }>;
}

export interface ProjectState {
  projectId: string;
  title: string;
  transcript: string;
  isRecording: boolean;
  rules: ContinuityRule[];
  shots: StoryboardShot[];
  activeShotId: string | null;
  isPlayingAnimatic: boolean;
  isProcessing: boolean;
  statusAnnouncement: string; // for screen readers (aria-live)
}

export type MetaModelName =
  | 'muse-voice-transcribe-1.0'
  | 'muse-spark-1.3'
  | 'muse-image-1.0'
  | 'sam-3.1';

export interface ModelInvocationRecord {
  id: string;
  model: MetaModelName;
  operation: string;
  timestamp: number;
  summary: string;
}

export interface DirectorPresetScenario {
  id: string;
  title: string;
  genre: string;
  transcript: string;
  description: string;
}
