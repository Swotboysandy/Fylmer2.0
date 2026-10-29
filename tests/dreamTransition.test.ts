import {describe,it,expect} from 'vitest';
import {DREAM,dreamProgress,renderDreamFrame,measureAnchor,validateAssets,type DreamAssets} from '../src/services/dreamTransition';
function fixture():DreamAssets {
  const width=16,height=9;
  const image=(n:number)=>({width,height,data:Uint8ClampedArray.from({length:width*height*4},(_,i)=>i%4===3?255:(i+n)%256)});
  const mask=new Uint8Array(width*height);mask[0]=1;mask[55]=1;mask[57]=1;mask[width*height-1]=1;
  return {kitchen:image(0),ocean:image(100),anchor:image(200),mask};
}
describe('protected dream compositor',()=>{
  it('preserves every RGBA channel across the complete sequence and reverse scrubs',()=>{
    const a=fixture(),out=new Uint8ClampedArray(a.kitchen.data.length),before=a.kitchen.data.slice();
    validateAssets(a);
    for(let frame=0;frame<=DREAM.duration*DREAM.fps;frame++) {
      renderDreamFrame(a,out,frame/DREAM.fps);
      expect(measureAnchor(a,out).changedProtectedPixels).toBe(0);
    }
    for(const time of [12,6,0,8,2,10,4]) {
      renderDreamFrame(a,out,time);const copy=out.slice();renderDreamFrame(a,out,12-time);renderDreamFrame(a,out,time);
      expect(out).toEqual(copy);
    }
    expect(a.kitchen.data).toEqual(before);
  });
  it('lands exactly on both backgrounds outside the mask including holes',()=>{
    const a=fixture(),out=new Uint8ClampedArray(a.kitchen.data.length);
    for(const [t,expected] of [[0,a.kitchen],[12,a.ocean]] as const) {
      renderDreamFrame(a,out,t);
      for(let p=0;p<a.mask.length;p++)expect(out.slice(p*4,p*4+4)).toEqual((a.mask[p]?a.anchor:expected).data.slice(p*4,p*4+4));
    }
  });
  it('does not fade or reset at the start/end of the morph',()=>{
    expect(dreamProgress(0)).toBe(0);expect(dreamProgress(2)).toBe(0);
    expect(dreamProgress(6)).toBe(0.5);expect(dreamProgress(10)).toBe(1);expect(dreamProgress(12)).toBe(1);
    expect(dreamProgress(-1)).toBe(0);expect(dreamProgress(NaN)).toBe(0);expect(dreamProgress(99)).toBe(1);
    expect(dreamProgress(5.99,true)).toBe(0);expect(dreamProgress(6,true)).toBe(1);
  });
  it('detects altered protected pixels rather than assuming success',()=>{
    const a=fixture(),out=new Uint8ClampedArray(a.kitchen.data.length);renderDreamFrame(a,out,5);
    out[55*4+2]^=255;expect(measureAnchor(a,out).changedProtectedPixels).toBe(1);
  });
  it('rejects mismatched or empty masks and aliased output',()=>{
    const a=fixture();expect(()=>validateAssets({...a,mask:new Uint8Array(1)})).toThrow();
    expect(()=>validateAssets({...a,mask:new Uint8Array(a.mask.length)})).toThrow();
    expect(()=>validateAssets({...a,ocean:{...a.ocean,width:17}})).toThrow();
    expect(()=>renderDreamFrame(a,a.kitchen.data,0)).toThrow();
  });
});
