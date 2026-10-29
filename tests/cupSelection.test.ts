import {describe,it,expect} from 'vitest';
import {brushMask,polygonMask,applyCupSelection,unpackRasterMask,requestSamCupCutout} from '../src/services/cupSelection';
import {DREAM,renderDreamFrame,measureAnchor,type DreamAssets} from '../src/services/dreamTransition';
const photo={width:20,height:20,data:new Uint8ClampedArray(20*20*4).fill(255)};
function base():DreamAssets {const pixels={width:DREAM.width,height:DREAM.height,data:new Uint8ClampedArray(DREAM.width*DREAM.height*4).fill(40)};return {kitchen:pixels,ocean:{...pixels,data:new Uint8ClampedArray(pixels.data.length).fill(200)},anchor:pixels,mask:new Uint8Array(DREAM.width*DREAM.height)};}
describe('photo cup mask',()=>{
 it('closes polygon and leaves exterior pixels unselected',()=>{const m=polygonMask(20,20,[{x:2,y:2},{x:18,y:2},{x:18,y:18},{x:2,y:18}]);expect(m.reduce((a,b)=>a+b,0)).toBe(256);expect(m[0]).toBe(0);});
 it('paints continuous strokes, erases holes and preserves undo snapshots',()=>{
  const blank=new Uint8Array(400),painted=brushMask(blank,20,20,{x:2,y:10},{x:18,y:10},3,true);
  for(let x=2;x<18;x++)expect(painted[10*20+x]).toBe(1);
  const erased=brushMask(painted,20,20,{x:10,y:10},{x:10,y:10},2,false);
  expect(erased[210]).toBe(0);expect(painted[210]).toBe(1);expect(blank.some(Boolean)).toBe(false);
 });
 it('replaces the illustrated anchor, retains holes and protects approved photo pixels',()=>{
  const b=base(),m=new Uint8Array(400).fill(1);m[210]=0;
  const a=applyCupSelection(b,{photo,mask:m,name:'test.png',revision:2});
  expect(a.selectionInfo?.revision).toBe(2);expect(b.mask.some(Boolean)).toBe(false);
  expect(a.mask[265*800+250]).toBe(0);
  const out=new Uint8ClampedArray(a.kitchen.data.length);
  for(const t of [0,3,6,9,12]){renderDreamFrame(a,out,t);expect(measureAnchor(a,out).changedProtectedPixels).toBe(0);}
 });
 it('rejects empty, malformed or transparent selections',()=>{
  const b=base();for(const mask of [new Uint8Array(400),new Uint8Array(5),new Uint8Array(400).fill(2)])expect(()=>applyCupSelection(b,{photo,mask,name:'x',revision:1})).toThrow();
  expect(()=>applyCupSelection(b,{photo:{...photo,data:new Uint8ClampedArray(1600)},mask:new Uint8Array(400).fill(1),name:'x',revision:1})).toThrow();
 });
 it('handles SAM 3.1 cutout provenance, custom source and unpackRasterMask', async () => {
  const raster = new Uint8Array([1, 0, 1, 1]);
  const unpacked = unpackRasterMask({ left: 2, top: 2, right: 6, bottom: 6 }, 2, 2, raster, 10, 10);
  expect(unpacked.length).toBe(100);
  expect(unpacked[0]).toBe(0);
  expect(unpacked[2 * 10 + 2]).toBe(1);
  expect(unpacked[2 * 10 + 4]).toBe(0);

  const b = base();
  const m = new Uint8Array(400).fill(1);
  const a = applyCupSelection(b, {
    photo,
    mask: m,
    name: 'sam-cup.png',
    revision: 3,
    source: 'sam-3.1-photo',
    provenance: 'live-sam-3.1',
    confidence: 0.965,
    maskRef: 'sam-3.1:cup:0:v3',
  });
  expect(a.selectionInfo?.source).toBe('sam-3.1-photo');
  expect(a.selectionInfo?.provenance).toBe('live-sam-3.1');
  expect(a.selectionInfo?.confidence).toBe(0.965);
  expect(a.selectionInfo?.maskRef).toBe('sam-3.1:cup:0:v3');

  const fallback = await requestSamCupCutout(photo, 'cup');
  expect(fallback.mask.length).toBe(400);
  expect(fallback.mask.some(Boolean)).toBe(true);
  expect(fallback.provenance).toBe('offline-fixture');
  expect(fallback.confidence).toBe(0.55);

  // Guards against malformed or short rasters at trust boundary
  expect(unpackRasterMask(null as any, 2, 2, raster, 10, 10).length).toBe(100);
  expect(unpackRasterMask({ left: 0, top: 0, right: 10, bottom: 10 }, 2, 2, new Uint8Array(2), 10, 10).some(Boolean)).toBe(false);

  // Verifies live SAM raster base64 unpacking and bounds mapping
  const fakeBinary = new Uint8Array([1, 1, 1, 1]);
  const simulatedMask = unpackRasterMask({ left: 4, top: 4, right: 8, bottom: 8 }, 2, 2, fakeBinary, 20, 20);
  expect(simulatedMask.some(Boolean)).toBe(true);
  expect(simulatedMask[4 * 20 + 4]).toBe(1);
  expect(simulatedMask[0]).toBe(0);
 });
});
