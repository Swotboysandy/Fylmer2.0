import {DREAM, validateAssets, type DreamAssets, type Pixels} from './dreamTransition';
export type Point = {x:number;y:number};
export type CupSelection = {
  photo: Pixels;
  mask: Uint8Array;
  name: string;
  revision: number;
  source?: 'local-manual-photo' | 'sam-3.1-photo';
  provenance?: string;
  confidence?: number;
  maskRef?: string;
};
export function polygonMask(width:number,height:number,points:Point[]) {
  const mask=new Uint8Array(width*height);
  if(points.length<3)return mask;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let inside=false;
    for(let i=0,j=points.length-1;i<points.length;j=i++) {
      const a=points[i],b=points[j];
      if((a.y>y+0.5)!==(b.y>y+0.5) && x+0.5<(b.x-a.x)*(y+0.5-a.y)/(b.y-a.y)+a.x)inside=!inside;
    }
    if(inside)mask[y*width+x]=1;
  }
  return mask;
}
export function brushMask(mask:Uint8Array,w:number,h:number,from:Point,to:Point,radius:number,add:boolean) {
  const result=mask.slice(),distance=Math.hypot(to.x-from.x,to.y-from.y);
  const steps=Math.max(1,Math.ceil(distance/Math.max(1,radius/2)));
  for(let step=0;step<=steps;step++){
    const cx=from.x+(to.x-from.x)*step/steps,cy=from.y+(to.y-from.y)*step/steps;
    for(let y=Math.max(0,Math.floor(cy-radius));y<Math.min(h,Math.ceil(cy+radius));y++)
      for(let x=Math.max(0,Math.floor(cx-radius));x<Math.min(w,Math.ceil(cx+radius));x++)
        if((x+0.5-cx)**2+(y+0.5-cy)**2<=radius**2)result[y*w+x]=add?1:0;
  }
  return result;
}
export function applyCupSelection(base:DreamAssets,selection:CupSelection,placement={centerX:250,bottom:360,maxWidth:200,maxHeight:190}):DreamAssets {
  const {photo,mask}=selection;
  if(mask.length!==photo.width*photo.height || photo.data.length!==mask.length*4 || mask.some(v=>v!==0&&v!==1))throw new Error('Invalid photo mask.');
  let left=photo.width,top=photo.height,right=-1,bottom=-1,count=0;
  for(let i=0;i<mask.length;i++)if(mask[i] && photo.data[i*4+3]===255){
    const x=i%photo.width,y=Math.floor(i/photo.width);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);count++;
  }
  if(count<16)throw new Error('Select at least 16 opaque photo pixels before applying.');
  const cropW=right-left+1,cropH=bottom-top+1,scale=Math.min(placement.maxWidth/cropW,placement.maxHeight/cropH);
  const width=Math.max(1,Math.round(cropW*scale)),height=Math.max(1,Math.round(cropH*scale));
  const targetMask=new Uint8Array(DREAM.width*DREAM.height),anchor=base.kitchen.data.slice();
  const x0=placement.centerX-Math.floor(width/2),y0=placement.bottom-height;
  if(![x0,y0,width,height].every(Number.isInteger)||x0<0||y0<0||x0+width>DREAM.width||y0+height>DREAM.height)throw new Error('Object placement must fit the dream frame.');
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const sx=left+Math.min(cropW-1,Math.floor(x/width*cropW)),sy=top+Math.min(cropH-1,Math.floor(y/height*cropH));
    const source=sy*photo.width+sx,target=(y0+y)*DREAM.width+x0+x;
    if(mask[source] && photo.data[source*4+3]===255){targetMask[target]=1;anchor.set(photo.data.subarray(source*4,source*4+4),target*4);}
  }
  const result = {
    ...base,
    mask: targetMask,
    anchor: {width: DREAM.width, height: DREAM.height, data: anchor},
    selectionInfo: {
      source: (selection.source ?? 'local-manual-photo') as 'local-manual-photo' | 'sam-3.1-photo',
      name: selection.name,
      revision: selection.revision,
      sourceSelectedPixels: count,
      provenance: selection.provenance,
      confidence: selection.confidence,
      maskRef: selection.maskRef,
    },
  };
  validateAssets(result);
  return result;
}

export function unpackRasterMask(
  bounds: { left: number; top: number; right: number; bottom: number },
  rw: number,
  rh: number,
  raster: Uint8Array,
  targetWidth: number,
  targetHeight: number,
): Uint8Array {
  const full = new Uint8Array(targetWidth * targetHeight);
  if (
    !bounds ||
    !Number.isInteger(rw) ||
    !Number.isInteger(rh) ||
    rw <= 0 ||
    rh <= 0 ||
    raster.length !== rw * rh ||
    !Object.values(bounds).every(Number.isFinite) ||
    raster.some(v => v !== 0 && v !== 1)
  ) {
    return full;
  }
  const left = Math.max(0, Math.min(targetWidth, Math.floor(bounds.left || 0)));
  const right = Math.max(left, Math.min(targetWidth, Math.floor(bounds.right || 0)));
  const top = Math.max(0, Math.min(targetHeight, Math.floor(bounds.top || 0)));
  const bottom = Math.max(top, Math.min(targetHeight, Math.floor(bounds.bottom || 0)));
  const bw = right - left;
  const bh = bottom - top;
  if (bw <= 0 || bh <= 0) return full;
  for (let y = top; y < bottom; y++) {
    const my = Math.min(rh - 1, Math.floor(((y - top) * rh) / bh));
    for (let x = left; x < right; x++) {
      const mx = Math.min(rw - 1, Math.floor(((x - left) * rw) / bw));
      full[y * targetWidth + x] = raster[my * rw + mx] ?? 0;
    }
  }
  return full;
}

export async function requestSamCupCutout(
  photo: Pixels,
  concept = 'cup',
  options: {allowLive?: boolean; signal?: AbortSignal} = {},
): Promise<{ mask: Uint8Array; provenance: string; confidence: number; maskRef?: string }> {
  try {
    if (options.allowLive && typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = photo.width;
      canvas.height = photo.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const img = ctx.createImageData(photo.width, photo.height);
        img.data.set(photo.data);
        ctx.putImageData(img, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        const b64 = dataUrl.split(',')[1];
        if (b64 && typeof crypto !== 'undefined' && crypto.subtle) {
          const binStr = atob(b64);
          const bytes = new Uint8Array(binStr.length);
          for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
          const digest = await crypto.subtle.digest('SHA-256', bytes);
          const hash = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');

          const healthRes = await fetch('/api/health', {signal: options.signal ?? AbortSignal.timeout(30000)});
          const health = healthRes.ok ? await healthRes.json() : null;
          const token = health?.sessionToken || '';

          const res = await fetch('/api/segment/check', {
            method: 'POST',
            signal: options.signal ?? AbortSignal.timeout(30000),
            headers: {
              'Content-Type': 'application/json',
              'X-Framelock-Session': token,
              'X-Anchorshot-Session': token,
            },
            body: JSON.stringify({
              image: dataUrl,
              concept,
              sourceHash: hash,
            }),
          });
          if (res.ok) {
            const data = await res.json();
            const primary = data.objects?.find((o: any) => o.objectId === data.selectedObjectId) ?? data.objects?.[0];
            if (
              primary &&
              primary.bounds &&
              Number.isFinite(primary.rasterWidth) &&
              Number.isFinite(primary.rasterHeight) &&
              primary.rasterWidth > 0 &&
              primary.rasterHeight > 0 &&
              typeof primary.rasterBase64 === 'string'
            ) {
              const rBin = atob(primary.rasterBase64);
              const raster = new Uint8Array(rBin.length);
              for (let i = 0; i < rBin.length; i++) raster[i] = rBin.charCodeAt(i);
              const mask = unpackRasterMask(
                primary.bounds,
                primary.rasterWidth,
                primary.rasterHeight,
                raster,
                photo.width,
                photo.height,
              );
              if (mask.some(Boolean)) {
                return {
                  mask,
                  provenance: data.provenance === 'live-sam-3.1' ? 'live-sam-3.1' : 'offline-fixture',
                  confidence: typeof primary.confidence === 'number' && Number.isFinite(primary.confidence) ? Math.max(0, Math.min(1, primary.confidence)) : 0,
                  maskRef: data.maskRef,
                };
              }
            }
          }
        }
      }
    }
  } catch (error) {
    if (options.allowLive) throw error;
  }
  if (options.allowLive) throw new Error('SAM returned no valid mask. Your current selection was preserved.');

  const mask = new Uint8Array(photo.width * photo.height);
  const cx = photo.width * 0.5, cy = photo.height * 0.5;
  const rx = photo.width * 0.28, ry = photo.height * 0.35;
  for (let y = 0; y < photo.height; y++) {
    for (let x = 0; x < photo.width; x++) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) {
        mask[y * photo.width + x] = 1;
      }
    }
  }
  return {
    mask,
    provenance: 'offline-fixture',
    confidence: 0,
    maskRef: `sam-3.1:${concept}:0:offline`,
  };
}
export async function decodeCupPhoto(blob:Blob):Promise<Pixels> {
  if(!['image/png','image/jpeg','image/webp'].includes(blob.type))throw new Error('Choose a PNG, JPEG or WebP image.');
  if(blob.size>8*1024*1024)throw new Error('Choose an image smaller than 8 MB.');
  const bitmap=await createImageBitmap(blob);
  try {
    if(bitmap.width*bitmap.height>24_000_000)throw new Error('Choose an image below 24 megapixels.');
    const scale=Math.min(1,800/bitmap.width,600/bitmap.height),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const ctx=canvas.getContext('2d')!;ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
    return ctx.getImageData(0,0,canvas.width,canvas.height);
  }finally{bitmap.close();}
}

export function applyDreamSelections(base:DreamAssets,cup:CupSelection|null,umbrella:CupSelection|null):DreamAssets {
  if(!cup&&!umbrella)return base;
  const cupLayer=cup?applyCupSelection(base,cup):base;
  const layers=[{id:'cup',name:cup?.name??'Illustrated cup',revision:cup?.revision??0,assets:cupLayer}];
  if(umbrella)layers.push({id:'umbrella',name:umbrella.name,revision:umbrella.revision,assets:applyCupSelection(base,umbrella,{centerX:600,bottom:380,maxWidth:250,maxHeight:300})});
  const mask=new Uint8Array(base.mask.length),data=base.kitchen.data.slice();
  for(const layer of layers)for(let i=0;i<mask.length;i++)if(layer.assets.mask[i]){
    if(mask[i])throw new Error('Protected objects overlap. Use separate placements.');
    mask[i]=1;data.set(layer.assets.anchor.data.subarray(i*4,i*4+4),i*4);
  }
  const result:DreamAssets={...cupLayer,mask,anchor:{width:base.kitchen.width,height:base.kitchen.height,data},anchors:layers.map(l=>({id:l.id,name:l.name,revision:l.revision,mask:l.assets.mask.slice()}))};
  validateAssets(result);return result;
}

// Authored offline illustration, not a photograph or model segmentation.
export function umbrellaSample() {
  const canvas=document.createElement('canvas');canvas.width=400;canvas.height=400;
  const ctx=canvas.getContext('2d')!;
  ctx.strokeStyle='#262626';ctx.lineWidth=12;ctx.lineCap='round';
  ctx.beginPath();ctx.moveTo(200,65);ctx.lineTo(200,310);ctx.bezierCurveTo(200,355,145,355,145,315);ctx.stroke();
  ctx.fillStyle='#dca92c';ctx.beginPath();ctx.moveTo(40,180);ctx.bezierCurveTo(65,15,335,15,360,180);
  ctx.quadraticCurveTo(320,150,280,180);ctx.quadraticCurveTo(240,150,200,180);ctx.quadraticCurveTo(160,150,120,180);ctx.quadraticCurveTo(80,150,40,180);ctx.fill();
  ctx.strokeStyle='#6b5010';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(200,56);ctx.quadraticCurveTo(135,80,120,177);ctx.moveTo(200,56);ctx.quadraticCurveTo(265,80,280,177);ctx.stroke();
  const cut=ctx.getImageData(0,0,400,400),mask=Uint8Array.from({length:160000},(_,i)=>cut.data[i*4+3]>128?1:0);
  ctx.globalCompositeOperation='destination-over';ctx.fillStyle='#eeeeee';ctx.fillRect(0,0,400,400);
  return {photo:ctx.getImageData(0,0,400,400),mask};
}
