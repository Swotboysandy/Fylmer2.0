"""Validate browser-exported independent masks and two-anchor transition."""
import json, subprocess
from pathlib import Path
import numpy as np
from PIL import Image
root=Path('.artifacts/two-anchors')
first=np.asarray(Image.open(root/'first.png').convert('RGBA'))
last=np.asarray(Image.open(root/'last.png').convert('RGBA'))
masks={name:np.asarray(Image.open(root/f'{name}.png').convert('L'))>0 for name in ['cup','umbrella']}
assert not np.any(masks['cup'] & masks['umbrella'])
objects={}
for name,mask in masks.items():
 assert mask.any() and np.array_equal(first[mask],last[mask])
 objects[name]={'protectedPixels':int(mask.sum()),'changedPixelsPNG':0}
union=masks['cup']|masks['umbrella']
assert np.any(first[~union]!=last[~union])
probe=json.loads(subprocess.run(['ffprobe','-v','error','-count_frames','-show_entries','stream=codec_name,width,height,nb_read_frames:format=duration','-of','json',str(root/'dream.webm')],check=True,capture_output=True,text=True).stdout)
assert abs(float(probe['format']['duration'])-12)<0.25
subprocess.run(['ffmpeg','-v','error','-xerror','-i',str(root/'dream.webm'),'-fps_mode','passthrough','-enc_time_base','1:1000000','-f','null','-'],check=True)
pts=[float(v.split(',')[0]) for v in subprocess.run(['ffprobe','-v','error','-select_streams','v:0','-show_entries','packet=pts_time','-of','csv=p=0',str(root/'dream.webm')],check=True,capture_output=True,text=True).stdout.splitlines()]
assert all(b>a for a,b in zip(pts,pts[1:]))
for name in objects:objects[name]['lossyVideoMeanChannelErrors']=[]
for t in [0,3,6,9,11.7]:
 raw=subprocess.run(['ffmpeg','-v','error','-ss',str(t),'-i',str(root/'dream.webm'),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],check=True,capture_output=True).stdout
 frame=np.frombuffer(raw,dtype=np.uint8).reshape(450,800,3)
 for name,mask in masks.items():objects[name]['lossyVideoMeanChannelErrors'].append(round(float(np.abs(frame[mask].astype(float)-first[:,:,:3][mask]).mean()),3))
result={'passed':True,'objects':objects,'video':probe,'timestampsStrictlyIncreasing':True,'scope':'Exact protection in PNG/uncompressed frames; video is lossy, variable frame rate.'}
(root/'export.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
