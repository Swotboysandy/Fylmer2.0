export const MAX_EDGE = 1600;
export const MAX_PIXELS = MAX_EDGE * MAX_EDGE;

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface ObjectMask {
  id: string;
  objectId: string;
  label: string;
  source: 'sample' | 'sam';
  sourceHash: string;
  width: number;
  height: number;
  bounds: Bounds;
  rasterWidth: number;
  rasterHeight: number;
  rasterBase64: string;
  confidence?: number;
}
export interface FrameAsset {
  id: string;
  hash: string;
  name: string;
  kind: 'sample' | 'upload';
  width: number;
  height: number;
  dataUrl: string;
  pixels: Uint8ClampedArray;
}
export interface PixelReport {
  selected: number;
  changedInside: number;
  changedOutside: number;
}
export interface Correction {
  id: string;
  sourceHash: string;
  selectionId: string;
  color: string;
  dataUrl: string;
  report: PixelReport;
}
export interface ServiceStatus {
  configured: boolean;
  model: string;
  sessionToken: string;
  requestsUsed: number;
  requestLimit: number;
}
export interface SegmentationResult {
  requestId: string;
  sourceHash: string;
  objects: ObjectMask[];
}
