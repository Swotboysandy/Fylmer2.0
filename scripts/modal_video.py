import modal
from fastapi import FastAPI, Response
from pydantic import BaseModel
import io

app = modal.App("anchorshot-video")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "fastapi[standard]>=0.111.0",
        "pydantic>=2.0",
        "torch>=2.2.0",
        "diffusers>=0.27.0",
        "transformers>=4.40.0",
        "accelerate>=0.29.0",
        "imageio[ffmpeg]>=2.34.0",
        "safetensors>=0.4.0",
    )
)

class VideoPromptRequest(BaseModel):
    prompt: str
    negative_prompt: str = "bad quality, deformed, blurry"
    num_frames: int = 16
    fps: int = 8
    seed: int = 42

@app.function(
    image=image,
    gpu="A10G",
    timeout=600,
)
@modal.fastapi_endpoint(method="POST")
def generate(req: VideoPromptRequest):
    import torch
    from diffusers import AnimateDiffPipeline, MotionAdapter, EulerDiscreteScheduler
    from diffusers.utils import export_to_video
    import numpy as np

    adapter = MotionAdapter.from_pretrained("ByteDance/AnimateDiff-Lightning", torch_dtype=torch.float16)
    pipe = AnimateDiffPipeline.from_pretrained("runwayml/stable-diffusion-v1-5", motion_adapter=adapter, torch_dtype=torch.float16)
    pipe.scheduler = EulerDiscreteScheduler.from_config(pipe.scheduler.config, timestep_spacing="trailing", beta_schedule="linear")
    pipe.enable_vae_slicing()
    pipe.to("cuda")

    generator = torch.Generator("cuda").manual_seed(req.seed)
    output = pipe(
        prompt=req.prompt,
        negative_prompt=req.negative_prompt,
        num_inference_steps=4,
        guidance_scale=1.0,
        num_frames=req.num_frames,
        generator=generator,
    )
    frames = output.frames[0]
    
    # Save video to buffer
    import tempfile, os
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp_path = tmp.name
    
    export_to_video(frames, tmp_path, fps=req.fps)
    with open(tmp_path, "rb") as f:
        video_bytes = f.read()
    os.remove(tmp_path)

    return Response(content=video_bytes, media_type="video/mp4")
