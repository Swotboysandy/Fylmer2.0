"""Measure an exported offline storyboard and encode it on NVIDIA hardware.
No network, models, downloads or CPU encoder fallback.
Requires local Python with numpy/Pillow and ffmpeg/ffprobe/nvidia-smi on PATH.
"""
import argparse, base64, io, json, math, subprocess, time, threading
from pathlib import Path
import numpy as np
from PIL import Image

def run(args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout

def decode(url):
    if not url.startswith("data:image/png;base64,"):
        raise ValueError("Only embedded local PNG frames are accepted")
    image = Image.open(io.BytesIO(base64.b64decode(url.split(",",1)[1], validate=True)))
    if image.width * image.height > 24000000:
        raise ValueError("Frame too large")
    return np.array(image.convert("RGBA"))

def frame_at(frames, masks, durations, time_sec, enabled):
    start = 0
    for index, duration in enumerate(durations):
        if time_sec < start + duration or index == len(frames)-1:
            progress = max(0, min(1, (time_sec-(start+duration-min(1,duration/2))) / min(1,duration/2))) if enabled and index+1<len(frames) else 0
            source = frames[index][...,:3]
            if progress == 0:
                return source.copy(), index, progress
            mixed = source.astype(float)*(1-progress)+frames[index+1][...,:3]*progress
            if masks[index] is not None:
                hold = 1-max(0,min(1,(progress-.75)/.25))
                selected = masks[index]
                mixed[selected] = source[selected]*hold+mixed[selected]*(1-hold)
            return np.rint(mixed).astype(np.uint8), index, progress
        start += duration
    raise ValueError("Empty timeline")

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("bundle",type=Path)
    parser.add_argument("--output",type=Path,default=Path(".artifacts/local-validation"))
    args=parser.parse_args()
    project=json.loads(args.bundle.read_text(encoding="utf-8-sig"))
    if project.get("mode")!="offline-fixture": raise ValueError("Expected an offline test bundle")
    shots=project["shots"]
    if not 1<=len(shots)<=30: raise ValueError("Expected 1-30 shots")
    durations=[float(s["durationSeconds"]) for s in shots]
    if any(not math.isfinite(d) or not 0<d<=60 for d in durations): raise ValueError("Invalid duration")
    frames=[decode(s["currentImageUrl"]) for s in shots]
    if any(f.shape!=frames[0].shape for f in frames): raise ValueError("Frame sizes differ")
    if any(np.any(f[...,3]!=255) for f in frames): raise ValueError("This video test requires opaque source frames")
    masks=[decode(s["mask"]["maskBase64"])[...,3]>0 if s.get("mask") else None for s in shots]
    if any(m is not None and m.shape!=frames[0].shape[:2] for m in masks): raise ValueError("Mask sizes differ")
    args.output.mkdir(parents=True,exist_ok=True)
    report={"mode":"offline-fixture","modelCalls":0,"aiGeneration":"NOT TESTED",
            "semanticQuality":"NOT SCORED: no reference or evaluator",
            "gpu":run(["nvidia-smi","--query-gpu=name,memory.total,driver_version","--format=csv,noheader"]).strip(),
            "images":[],"corrections":[],"transitions":[]}
    for shot,frame,mask in zip(shots,frames,masks):
        report["images"].append({"shot":shot["shotNumber"],"width":frame.shape[1],"height":frame.shape[0],
            "nonblank":bool(frame[...,:3].std()>1),"lumaStd":round(float(frame[...,:3].mean(axis=2).std()),3)})
        revisions=shot.get("revisions",[])
        for i,revision in enumerate(revisions):
            if i==0 or not revision.get("pixelVerification"): continue
            if mask is None: raise ValueError("Correction has no verification mask")
            before=decode(revisions[i-1]["imageUrl"]); after=decode(revision["imageUrl"])
            changed=np.any(before!=after,axis=2)
            outside=int(np.count_nonzero(changed & ~mask))
            inside=int(np.count_nonzero(changed & mask))
            report["corrections"].append({"shot":shot["shotNumber"],"revision":i+1,
                "changedOutside":outside,"changedInside":inside,
                "outsidePreservedPercent":100*(1-outside/max(1,int(np.count_nonzero(~mask)))),
                "pass":outside==0 and inside>0})
    enabled=project.get("transitionsEnabled",True)
    boundary=0
    for i,duration in enumerate(durations[:-1]):
        boundary+=duration
        at=boundary-min(1,duration/2)/2
        rendered,_,progress=frame_at(frames,masks,durations,at,enabled)
        mask=masks[i]
        held=bool(np.array_equal(rendered[mask],frames[i][...,:3][mask])) if mask is not None else None
        report["transitions"].append({"fromShot":i+1,"toShot":i+2,"midpointProgress":progress,
            "selectedPixelsPreservedAtMidpoint":held,"durationSeconds":min(1,duration/2) if enabled else 0})
        Image.fromarray(rendered).save(args.output/f"transition-{i+1}.png")
    fps=30; count=math.ceil(sum(durations)*fps); h,w=frames[0].shape[:2]
    video=args.output/"storyboard-nvenc.mp4"; log_path=args.output/"ffmpeg.log"
    samples=[]; stop=threading.Event()
    def sample():
        while not stop.is_set():
            try:
                values=run(["nvidia-smi","--query-gpu=memory.used,utilization.gpu","--format=csv,noheader,nounits"]).strip()
                samples.append(values)
            except (OSError,subprocess.CalledProcessError): pass
            stop.wait(.5)
    monitor=threading.Thread(target=sample,daemon=True);monitor.start()
    started=time.perf_counter()
    command=["ffmpeg","-hide_banner","-y","-f","rawvideo","-pix_fmt","rgb24","-s",f"{w}x{h}",
        "-r",str(fps),"-i","pipe:0","-an","-c:v","h264_nvenc","-preset","p4",
        "-pix_fmt","yuv420p","-movflags","+faststart",str(video)]
    with log_path.open("w") as log:
        process=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.DEVNULL,stderr=log)
        try:
            for number in range(count):
                frame,_,_=frame_at(frames,masks,durations,number/fps,enabled)
                process.stdin.write(frame.tobytes())
            process.stdin.close()
            code=process.wait(timeout=120)
            if code: raise RuntimeError(f"NVIDIA encode failed ({code}); see {log_path}")
        finally:
            if process.poll() is None: process.kill();process.wait()
            stop.set();monitor.join(timeout=3)
    elapsed=time.perf_counter()-started
    probe=json.loads(run(["ffprobe","-v","error","-count_frames","-show_streams","-show_format","-of","json",str(video)]))
    stream=probe["streams"][0]
    # Decode and compare every compressed frame against the intended composition.
    decoder=subprocess.Popen(["ffmpeg","-v","error","-xerror","-i",str(video),
        "-f","rawvideo","-pix_fmt","rgb24","pipe:1"],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    squared=0.0; absolute=0.0; decoded=0; frame_bytes=w*h*3
    try:
        while True:
            data=decoder.stdout.read(frame_bytes)
            if not data: break
            if len(data)!=frame_bytes: raise ValueError("Truncated decoded frame")
            actual=np.frombuffer(data,dtype=np.uint8).reshape(h,w,3)
            expected,_,_=frame_at(frames,masks,durations,decoded/fps,enabled)
            diff=actual.astype(np.float32)-expected.astype(np.float32)
            squared+=float(np.sum(diff*diff,dtype=np.float64))
            absolute+=float(np.sum(np.abs(diff),dtype=np.float64))
            decoded+=1
        if decoder.wait(timeout=30): raise RuntimeError("Full video decode failed")
    finally:
        if decoder.poll() is None: decoder.kill();decoder.wait()
    samples_count=max(1,decoded*frame_bytes)
    mse=squared/samples_count
    duration=float(probe["format"]["duration"])
    report["video"]={"encoder":"h264_nvenc","composition":"CPU numpy; hardware NVIDIA video encoding",
        "expectedFrames":count,"decodedFrames":int(stream["nb_read_frames"]),"fps":fps,"width":w,"height":h,
        "durationSeconds":duration,"expectedDurationSeconds":sum(durations),"encodeWallSeconds":round(elapsed,3),
        "pipelineFramesPerSecond":round(count/elapsed,2),"gpuSamplesMemoryMiBUtilizationPercent":samples,
        "fullDecodePass":decoded==count,"comparedFrames":decoded,
        "meanAbsoluteChannelError":round(absolute/samples_count,3),
        "psnrDb":round(10*math.log10(255*255/mse),3) if mse else None,"audio":"NOT TESTED: browser speech is not an audio track"}
    report["pass"]=all(i["nonblank"] for i in report["images"]) and all(c["pass"] for c in report["corrections"]) and all(t["selectedPixelsPreservedAtMidpoint"] is not False for t in report["transitions"]) and decoded==count and count==int(stream["nb_read_frames"]) and abs(duration-sum(durations))<=1/fps+.001
    (args.output/"scores.json").write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))
    if not report["pass"]: raise SystemExit(1)

if __name__=="__main__": main()
