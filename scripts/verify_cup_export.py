"""Validate the real-photo browser export after tests/browser/cup.spec.ts."""
import json,subprocess
from pathlib import Path
import numpy as np
from PIL import Image
root=Path('.artifacts/cup-tests')
mask=np.asarray(Image.open(root/'mask.png').convert('L'))>0
first=np.asarray(Image.open(root/'first.png').convert('RGB')).astype(float)
last=np.asarray(Image.open(root/'last.png').convert('RGB')).astype(float)
assert mask.sum()>0 and np.array_equal(first[mask],last[mask])
assert np.mean(np.abs(first[~mask]-last[~mask]))>10
probe=json.loads(subprocess.run(['ffprobe','-v','error','-count_frames','-show_entries','stream=codec_name,width,height,nb_read_frames:format=duration','-of','json',str(root/'cup.webm')],check=True,capture_output=True,text=True).stdout)
assert abs(float(probe['format']['duration'])-12)<0.25
subprocess.run(['ffmpeg','-v','error','-xerror','-i',str(root/'cup.webm'),'-fps_mode','passthrough','-enc_time_base','1:1000000','-f','null','-'],check=True)
timestamps=[float(v.split(",")[0]) for v in subprocess.run(['ffprobe','-v','error','-select_streams','v:0','-show_entries','packet=pts_time','-of','csv=p=0',str(root/'cup.webm')],check=True,capture_output=True,text=True).stdout.splitlines()]
assert all(b>a for a,b in zip(timestamps,timestamps[1:])), 'Non-monotonic encoded frame timestamps'
rows=[]
for t in [0,3,6,9,11.7]:
 raw=subprocess.run(['ffmpeg','-v','error','-ss',str(t),'-i',str(root/'cup.webm'),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],check=True,capture_output=True).stdout
 frame=np.frombuffer(raw,dtype=np.uint8).reshape(450,800,3).astype(float)
 mae=float(np.abs(frame[mask]-first[mask]).mean());assert mae<5
 rows.append({'seconds':t,'protectedRegionMeanChannelError':round(mae,3)})
result={'passed':True,'timestampsStrictlyIncreasing':True,'protectedPixels':int(mask.sum()),'changedProtectedPixelsPNG':0,'video':probe,'lossyEncodingSamples':rows,'note':'Exact protection applies to uncompressed output. WebM is lossy.'}
(root/'export.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
