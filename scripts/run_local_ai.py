"""Actual local neural inference. Download weights first; this command never uses the network."""
import os
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / ".artifacts/local-ai"
for name in ("HF_HOME", "HF_HUB_CACHE"):
    os.environ[name] = str(RUNTIME / "cache")
os.environ["TORCH_HOME"] = str(RUNTIME / "cache/torch")
os.environ["CUDA_CACHE_PATH"] = str(RUNTIME / "cache/cuda")
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["DO_NOT_TRACK"] = "1"
os.environ["TEMP"] = os.environ["TMP"] = str(RUNTIME / "temp")
import argparse, gc, hashlib, importlib.metadata, json, subprocess, time, traceback
from datetime import datetime, timezone

PROMPT = "A single blue ceramic coffee mug on a wooden table beside a window, ocean waves outside the window, warm morning sunlight, cinematic photograph, detailed, gentle camera movement"
NEGATIVE = "text, watermark, blurry, distorted, low quality"

def manifest(folder):
    return json.loads((RUNTIME / "models" / folder / "download-manifest.json").read_text())

def main():
    import numpy as np
    import torch
    import safetensors
    import safetensors.torch
    # Scope the supported non-mapped backend to this isolated worker.
    # Set it before Diffusers/Transformers import and bind their safe_open references.
    original_reader = safetensors.safe_open
    def safe_reader(*args, **kwargs):
        kwargs["backend"] = "pread"
        return original_reader(*args, **kwargs)
    safetensors.safe_open = safe_reader
    safetensors.torch.safe_open = safe_reader
    from PIL import Image
    from diffusers import StableDiffusionPipeline, AnimateDiffPipeline, MotionAdapter, EulerDiscreteScheduler, UNet2DConditionModel, UNetMotionModel
    from accelerate import init_empty_weights
    from safetensors.torch import load_file
    parser=argparse.ArgumentParser()
    parser.add_argument("kind", choices=["image","video"])
    parser.add_argument("--output",type=Path)
    parser.add_argument("--seed",type=int,default=42)
    parser.add_argument("--prompt",default=PROMPT)
    parser.add_argument("--size",type=int,choices=[256,384,512])
    parser.add_argument("--offload",choices=["model","sequential"],default="sequential")
    args=parser.parse_args()
    out=args.output or RUNTIME/"outputs"/args.kind
    out.mkdir(parents=True,exist_ok=True)
    report={"kind":args.kind,"prompt":args.prompt,"negativePrompt":NEGATIVE,"seed":args.seed,
        "network":"disabled: local_files_only + HF offline","weightLoader":"safetensors pread","paidApiCalls":0,
        "versions":{name:importlib.metadata.version(name) for name in ["torch","diffusers","transformers","accelerate","safetensors"]},
        "status":"running","startedAt":datetime.now(timezone.utc).isoformat()}
    report_path=out/"inference-report.json"
    def save(): report_path.write_text(json.dumps(report,indent=2))
    save()
    try:
        if not torch.cuda.is_available(): raise RuntimeError("CUDA unavailable; refusing CPU-only inference")
        report["gpu"]=torch.cuda.get_device_name(0)
        report["gpuTotalMiB"]=round(torch.cuda.get_device_properties(0).total_memory/2**20)
        report["baseModel"]={k:manifest("sd15")[k] for k in ["repository","revision"]}
        torch.set_num_threads(4)
        started=time.perf_counter()
        base=RUNTIME/"models/sd15"
        print(f"Loading {args.kind} pipeline on {report['gpu']} with CPU offload", flush=True)
        if args.kind=="image":
            pipe=StableDiffusionPipeline.from_pretrained(str(base),torch_dtype=torch.float16,
                variant="fp16",use_safetensors=True,local_files_only=True)
            width=height=args.size or 512;steps=20
        else:
            report["motionModel"]={k:manifest("animatediff-lightning")[k] for k in ["repository","revision"]}
            # Build the combined model without allocating a second random-weight copy.
            base_unet=UNet2DConditionModel.from_pretrained(str(base),subfolder="unet",
                torch_dtype=torch.float16,variant="fp16",use_safetensors=True,local_files_only=True)
            with init_empty_weights():
                adapter=MotionAdapter()
            adapter.load_state_dict(load_file(str(RUNTIME/"models/animatediff-lightning/animatediff_lightning_4step_diffusers.safetensors")),assign=True)
            with init_empty_weights():
                motion_unet=UNetMotionModel.from_unet2d(base_unet,adapter,load_weights=False)
            weights={**base_unet.state_dict(),**adapter.state_dict()}
            motion_unet.load_state_dict(weights,strict=True,assign=True)
            motion_unet.to(dtype=torch.float16).eval()
            motion_unet.enable_forward_chunking(chunk_size=4 if args.size == 384 else 16, dim=1)
            del weights, base_unet, adapter
            gc.collect()
            pipe=AnimateDiffPipeline.from_pretrained(str(base),unet=motion_unet,
                torch_dtype=torch.float16,variant="fp16",use_safetensors=True,local_files_only=True)
            pipe.scheduler=EulerDiscreteScheduler.from_config(pipe.scheduler.config,
                timestep_spacing="trailing",beta_schedule="linear")
            width=height=args.size or 512;steps=4
        if args.offload=="sequential": pipe.enable_sequential_cpu_offload()
        else: pipe.enable_model_cpu_offload()
        pipe.enable_vae_slicing()
        report["loadSeconds"]=round(time.perf_counter()-started,3)
        report.update(width=width,height=height,steps=steps,offload=args.offload,
            forwardChunkSize=(4 if args.size == 384 else 16) if args.kind == "video" else None)
        forward_devices=[]
        def observe(module,inputs,output):
            sample=getattr(output,"sample",output[0] if isinstance(output,tuple) else None)
            if sample is not None: forward_devices.append(str(sample.device))
        hook=pipe.unet.register_forward_hook(observe)
        def step_callback(pipeline, step, timestep, kwargs):
            print(f"CUDA denoising pass {step+1}",flush=True)
            return kwargs
        torch.cuda.empty_cache();torch.cuda.reset_peak_memory_stats()
        torch.cuda.synchronize();started=time.perf_counter()
        options=dict(prompt=args.prompt,negative_prompt=NEGATIVE,width=width,height=height,
            num_inference_steps=steps,generator=torch.Generator("cpu").manual_seed(args.seed),
            callback_on_step_end=step_callback)
        if args.kind=="video": options.update(num_frames=16,guidance_scale=1.0,decode_chunk_size=1)
        else: options.update(guidance_scale=7.5)
        print(f"Generating {width}x{height}, {steps} steps, seed {args.seed}", flush=True)
        with torch.inference_mode():
            result=pipe(**options)
        torch.cuda.synchronize()
        report["inferenceSeconds"]=round(time.perf_counter()-started,3)
        report["cudaPeakAllocatedMiB"]=round(torch.cuda.max_memory_allocated()/2**20,2)
        report["cudaPeakReservedMiB"]=round(torch.cuda.max_memory_reserved()/2**20,2)
        report["denoiserForwardDevices"]=sorted(set(forward_devices))
        report["denoiserForwardCount"]=len(forward_devices)
        if not forward_devices or any(not d.startswith("cuda") for d in forward_devices):
            raise RuntimeError("Could not prove denoiser ran on CUDA")
        hook.remove()
        frames=result.images if args.kind=="image" else result.frames[0]
        arrays=[np.array(frame.convert("RGB")) for frame in frames]
        report["frames"]=len(frames)
        report["lumaStd"]=[round(float(a.mean(axis=2).std()),3) for a in arrays]
        report["nonblank"]=all(float(a.mean(axis=2).std())>1 for a in arrays)
        if not report["nonblank"]: raise RuntimeError("Blank generated output")
        for i,frame in enumerate(frames): frame.save(out/f"frame-{i:03}.png")
        if args.kind=="image":
            frames[0].save(out/"generated-image.png")
            report["safetyFlagged"]=result.nsfw_content_detected
        else:
            changes=[float(np.abs(a.astype(float)-b.astype(float)).mean()) for a,b in zip(arrays,arrays[1:])]
            report["adjacentFrameMeanAbsoluteDifference"]=changes
            report["uniqueFrames"]=len({hashlib.sha256(a.tobytes()).hexdigest() for a in arrays})
            if report["uniqueFrames"]<2: raise RuntimeError("Static output; no video motion")
            sheet=Image.new("RGB",(width*4,height))
            for column,index in enumerate([0,4,8,12]): sheet.paste(frames[index],(column*width,0))
            sheet.save(out/"contact-sheet.png")
            all_frames=Image.new("RGB",(width*4,height*4))
            for index,frame in enumerate(frames):
                all_frames.paste(frame,((index%4)*width,(index//4)*height))
            all_frames.save(out/"all-frames.png")
            frames[0].save(out/"generated-video.gif",save_all=True,append_images=frames[1:],duration=125,loop=0)
            command=["ffmpeg","-v","error","-y","-framerate","8","-i",str(out/"frame-%03d.png"),
                "-c:v","h264_nvenc","-pix_fmt","yuv420p","-movflags","+faststart",str(out/"generated-video.mp4")]
            subprocess.run(command,check=True)
            probe=subprocess.run(["ffprobe","-v","error","-count_frames","-show_streams",
                "-show_format","-of","json",str(out/"generated-video.mp4")],check=True,capture_output=True,text=True)
            report["videoProbe"]=json.loads(probe.stdout)
            subprocess.run(["ffmpeg","-v","error","-xerror","-i",str(out/"generated-video.mp4"),"-f","null","-"],check=True)
            if int(report["videoProbe"]["streams"][0]["nb_read_frames"])!=16:
                raise RuntimeError("Encoded frame count mismatch")
            decoded=subprocess.run(["ffmpeg","-v","error","-i",str(out/"generated-video.mp4"),
                "-f","rawvideo","-pix_fmt","rgb24","pipe:1"],check=True,capture_output=True).stdout
            reference=np.stack(arrays).astype(np.float32)
            if len(decoded)!=reference.size: raise RuntimeError("Decoded video dimensions mismatch")
            decoded_array=np.frombuffer(decoded,dtype=np.uint8).reshape(reference.shape).astype(np.float32)
            mse=float(np.mean((decoded_array-reference)**2))
            report["encodingMeanAbsoluteError"]=float(np.mean(np.abs(decoded_array-reference)))
            report["encodingPSNRdB"]=float(10*np.log10(255**2/mse)) if mse else None
            duration=float(report["videoProbe"]["format"]["duration"])
            if abs(duration-2)>1/8: raise RuntimeError("Video duration mismatch")
        report["status"]="technical_pass"
        report["visualReview"]={"status":"pending", "productionReady":False}
        report["qualityNote"]="Technical inference proof only. Visual prompt adherence and temporal quality require inspection."
        save();print(json.dumps(report,indent=2),flush=True)
        del pipe;gc.collect();torch.cuda.empty_cache()
    except Exception as error:
        report["status"]="failed";report["error"]=str(error)
        if torch.cuda.is_initialized():
            report["cudaPeakAllocatedMiB"]=round(torch.cuda.max_memory_allocated()/2**20,2)
            report["cudaPeakReservedMiB"]=round(torch.cuda.max_memory_reserved()/2**20,2)
        save()
        traceback.print_exc()
        raise SystemExit(1)

if __name__=="__main__":
    import sys
    if "--worker" in sys.argv:
        sys.argv.remove("--worker")
        main()
    else:
        # A native library crash cannot be caught in the inference process.
        # Supervise it so the report cannot remain falsely marked as running.
        completed=subprocess.run([sys.executable,"-X","faulthandler",__file__,*sys.argv[1:],"--worker"])
        if completed.returncode:
            parser=argparse.ArgumentParser(add_help=False)
            parser.add_argument("kind",nargs="?")
            parser.add_argument("--output",type=Path)
            known,_=parser.parse_known_args()
            report_path=(known.output or RUNTIME/"outputs"/str(known.kind))/"inference-report.json"
            if report_path.exists():
                report=json.loads(report_path.read_text())
                if report.get("status")=="running":
                    report.update(status="failed",error=f"Inference worker exited with code {completed.returncode}; see native fault output.")
                    report_path.write_text(json.dumps(report,indent=2))
            raise SystemExit(1)
