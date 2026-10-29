"""After playwright dream.spec.ts: verify the actual downloaded WebM, not a mocked encoder.
Run with the local AI venv (NumPy/Pillow) and ffmpeg/ffprobe on PATH.
"""
import json, subprocess
from pathlib import Path
import numpy as np
from PIL import Image
root = Path('.artifacts/dream-tests')
# Three uncompressed frames agree on the protected cup. Use the exact authored mask
# exported by the browser test, avoiding guesses based on frame differences.
mask = np.frombuffer((root/'mask.bin').read_bytes(), dtype=np.uint8).reshape(450,800)>0
reference = np.array(Image.open(root/'kitchen.png').convert('RGB')).astype(float)
rows=[]
for t in [0,3,6,9,11.8]:
    data=subprocess.run(['ffmpeg','-v','error','-ss',str(t),'-i',str(root/'dream.webm'),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],check=True,capture_output=True).stdout
    frame=np.frombuffer(data,dtype=np.uint8).reshape(450,800,3).astype(float)
    error=np.abs(frame[mask]-reference[mask])
    rows.append({'time':t,'protectedRegionMAE':round(float(error.mean()),3),'protectedRegionP99ChannelError':round(float(np.percentile(error,99)),3)})
    assert error.mean()<5, 'Encoded cup differs excessively from the preview'
probe=json.loads(subprocess.run(['ffprobe','-v','error','-count_frames','-show_entries','stream=codec_name,width,height,nb_read_frames:format=duration','-of','json',str(root/'dream.webm')],check=True,capture_output=True,text=True).stdout)
assert abs(float(probe['format']['duration'])-12)<0.2
assert probe['streams'][0]['width']==800 and probe['streams'][0]['height']==450
assert (root/'ocean.png').read_bytes()==(root/'ocean-overlay.png').read_bytes()
subprocess.run(['ffmpeg','-v','error','-xerror','-i',str(root/'dream.webm'),'-f','null','-'],check=True)
result={'decodedVideo':probe,'cupEncodingError':rows,'maskOverlayExcludedFromPNG':True,'scope':'Decoded lossy WebM compared with uncompressed cup reference. Not exact zero drift.'}
(root/'export-verification.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
