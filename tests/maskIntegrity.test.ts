import test from 'node:test';
import assert from 'node:assert/strict';
import { recolorMaskedPixels, verifyMaskedPixelDiff } from '../src/services/maskIntegrity.ts';
const frame = () => new Uint8ClampedArray([200,40,30,255, 200,40,30,128, 200,40,30,255]);
test('recolor respects mask holes, input and alpha', () => {
 const before=frame(), original=before.slice();
 const {pixels,verification}=recolorMaskedPixels(before,new Uint8Array([1,0,1]),[20,90,220]);
 assert.deepEqual(before,original);
 assert.deepEqual(pixels.slice(4,8),original.slice(4,8));
 assert.equal(pixels[3],255); assert.equal(pixels[11],255);
 assert.deepEqual(verification,{selectedPixels:2,changedInside:2,changedOutside:0,passed:true});
});
test('detects outside RGB and alpha changes', () => {
 for(const channel of [4,7]) {
  const before=frame(),after=before.slice(); after[channel]--;
  const report=verifyMaskedPixelDiff(before,after,new Uint8Array([1,0,1]));
  assert.equal(report.passed,false); assert.equal(report.changedOutside,1);
 }
});
test('rejects malformed masks and dimensions', () => {
 assert.throws(()=>verifyMaskedPixelDiff(frame(),frame(),new Uint8Array([1])));
 assert.throws(()=>verifyMaskedPixelDiff(frame(),frame(),new Uint8Array([1,2,0])));
});
test('empty selection and uneditable pixels cannot report correction', () => {
 assert.throws(()=>recolorMaskedPixels(frame(),new Uint8Array([0,0,0]),[20,90,220]));
 assert.throws(()=>recolorMaskedPixels(new Uint8ClampedArray([100,100,100,255]),new Uint8Array([1]),[20,90,220]));
});
test('transparent selected pixels remain unchanged', () => {
 const before=frame();before[3]=0;
 const {pixels}=recolorMaskedPixels(before,new Uint8Array([1,0,1]),[20,90,220]);
 assert.deepEqual(pixels.slice(0,4),before.slice(0,4));
});
