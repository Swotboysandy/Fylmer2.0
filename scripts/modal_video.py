import modal
from fastapi import FastAPI, Response, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import io
import os
import tempfile

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
        "huggingface_hub>=0.21.0",
    )
)

web_app = FastAPI(title="AnchorShot Video Generation")
web_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class VideoPromptRequest(BaseModel):
    prompt: str
    negative_prompt: str = "bad quality, deformed, blurry"
    num_frames: int = 16
    fps: int = 8
    seed: int = 42

# Global cached pipeline
cached_pipe = None

def get_pipeline():
    global cached_pipe
    if cached_pipe is not None:
        return cached_pipe

    import torch
    from diffusers import AnimateDiffPipeline, MotionAdapter, EulerDiscreteScheduler
    from huggingface_hub import hf_hub_download
    from safetensors.torch import load_file

    repo = "ByteDance/AnimateDiff-Lightning"
    ckpt = "animatediff_lightning_4step_diffusers.safetensors"
    base = "runwayml/stable-diffusion-v1-5"

    adapter = MotionAdapter().to(torch.float16)
    adapter_path = hf_hub_download(repo, ckpt)
    adapter.load_state_dict(load_file(adapter_path))

    pipe = AnimateDiffPipeline.from_pretrained(
        base,
        motion_adapter=adapter,
        torch_dtype=torch.float16,
    )
    pipe.scheduler = EulerDiscreteScheduler.from_config(
        pipe.scheduler.config,
        timestep_spacing="trailing",
        beta_schedule="linear",
    )
    pipe.to("cuda")

    cached_pipe = pipe
    return cached_pipe

@web_app.get("/")
def health():
    return {
        "status": "online",
        "service": "AnchorShot Serverless Cloud Video Generator",
        "partner": "modal.com",
        "gpu": "NVIDIA A10G",
        "pipeline": "AnimateDiff-Lightning (4-step)",
        "ready": True
    }

@web_app.post("/")
@web_app.post("/generate")
def generate_video(req: VideoPromptRequest):
    import torch
    from diffusers.utils import export_to_video

    pipe = get_pipeline()
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

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        export_to_video(frames, tmp_path, fps=req.fps)
        with open(tmp_path, "rb") as f:
            video_bytes = f.read()
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)

    return Response(
        content=video_bytes,
        media_type="video/mp4",
        headers={"Content-Disposition": 'inline; filename="generated-video.mp4"'},
    )

@app.function(
    image=image,
    gpu="A10G",
    timeout=600,
    scaledown_window=300,
)
@modal.asgi_app()
def fastapi_app():
    return web_app
