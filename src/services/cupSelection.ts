import {DREAM, validateAssets, type DreamAssets, type Pixels} from './dreamTransition';
export type Point = {x:number;y:number};
export type CupSelection = {photo:Pixels; mask:Uint8Array; name:string; revision:number};
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
export function applyCupSelection(base:DreamAssets,selection:CupSelection):DreamAssets {
  const {photo,mask}=selection;
  if(mask.length!==photo.width*photo.height || photo.data.length!==mask.length*4 || mask.some(v=>v!==0&&v!==1))throw new Error('Invalid photo mask.');
  let left=photo.width,top=photo.height,right=-1,bottom=-1,count=0;
  for(let i=0;i<mask.length;i++)if(mask[i] && photo.data[i*4+3]===255){
    const x=i%photo.width,y=Math.floor(i/photo.width);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);count++;
  }
  if(count<16)throw new Error('Select at least 16 opaque photo pixels before applying.');
  const cropW=right-left+1,cropH=bottom-top+1,scale=Math.min(200/cropW,190/cropH);
  const width=Math.max(1,Math.round(cropW*scale)),height=Math.max(1,Math.round(cropH*scale));
  const targetMask=new Uint8Array(DREAM.width*DREAM.height),anchor=base.kitchen.data.slice();
  const x0=250-Math.floor(width/2),y0=360-height;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const sx=left+Math.min(cropW-1,Math.floor(x/width*cropW)),sy=top+Math.min(cropH-1,Math.floor(y/height*cropH));
    const source=sy*photo.width+sx,target=(y0+y)*DREAM.width+x0+x;
    if(mask[source] && photo.data[source*4+3]===255){targetMask[target]=1;anchor.set(photo.data.subarray(source*4,source*4+4),target*4);}
  }
  const result={...base,mask:targetMask,anchor:{width:DREAM.width,height:DREAM.height,data:anchor},
    selectionInfo:{source:'local-manual-photo' as const,name:selection.name,revision:selection.revision,sourceSelectedPixels:count}};
  validateAssets(result);return result;
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
