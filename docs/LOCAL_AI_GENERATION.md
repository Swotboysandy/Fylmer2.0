# Free local neural generation

This is separate from the offline Canvas fixtures and NVIDIA video-encoding test.
The UI is unchanged. No hackathon model endpoint or credit is used.

## Models
- Stable Diffusion 1.5 mirror: https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5
- AnimateDiff-Lightning 4-step motion adapter: https://huggingface.co/ByteDance/AnimateDiff-Lightning

Both model cards declare CreativeML OpenRAIL-M. Keep their use restrictions and notices when redistributing. These are pretrained models; this test does not train or fine-tune weights.
Exact revisions, file sizes and SHA-256 hashes are saved beside downloaded weights.

## Setup on this Windows/Python 3.10 machine
Run scripts/setup_local_ai.ps1 from PowerShell.
It uses an isolated environment and cache under .artifacts/local-ai on F:.
The first setup downloads several GB from official PyTorch and Hugging Face locations. Subsequent inference is offline.
The setup is pinned to the Windows CPython 3.10 CUDA 12.4 PyTorch wheel. It does not replace the system Python.
Do not run setup and inference concurrently.

## Run after setup
    .artifacts/local-ai/venv/Scripts/python.exe scripts/run_local_ai.py image
    .artifacts/local-ai/venv/Scripts/python.exe scripts/run_local_ai.py video

Outputs are saved under .artifacts/local-ai/outputs/image and /video. Each has an inference-report.json.
The image uses 512x512, 20 steps and sequential CPU offload.
The video uses 512x512, 16 frames, 4 Lightning steps and sequential CPU offload. It is text-to-video, not image-conditioned or a transition between two supplied images.
Both use seed 42 and the same blue-mug/ocean-window prompt.
The 2-second video is a hardware feasibility test, not a production-quality benchmark. The two commands generate independently; the image is not supplied to the video model.

## Evidence required
- CUDA available and denoiser output tensors observed on CUDA.
- Inference time and PyTorch peak allocated/reserved GPU memory.
- Nonblank image and individually saved video frames.
- Multiple unique video frames and measured adjacent-frame differences.
- MP4 frame count and full decode.
- Human visual inspection for prompt relevance, deformation and temporal artifacts.

A technical pass is not a claim of semantic quality, continuity, or suitability for the final hackathon demo.
No CPU-only inference or paid service fallback is implemented.


## Verified on 29 October 2026 (local date)
RTX 3050 Laptop, 4 GB dedicated VRAM. Actual denoiser forward outputs were CUDA tensors.

| Test | Output | Inference seconds | Peak PyTorch allocated MiB | MP4 PSNR vs generated frames |
| --- | --- | ---: | ---: | ---: |
| SD1.5 image | 512x512 | 19.787 | 1201.09 | n/a |
| Mug video | 512x512, 16 frames, 8 fps | 43.777 | 1053.12 | 36.99 dB |
| Ocean video | 512x512, 16 frames, 8 fps | 43.786 | 1053.12 | 34.61 dB |

Timing excludes model loading and video encoding. GPU values are PyTorch allocation peaks, not total board memory or a guarantee for other workloads. This run also used CPU offload, system RAM and the Windows pagefile. PSNR measures encoding fidelity only, not model quality. Adjacent-frame pixel differences are recorded in raw reports; motion, flicker and deformation can all increase them. No invented semantic score is reported.

Image visual review: convincing blue mug, but the ocean part of the prompt was missed. Mug video: recognizable subject throughout, slight motion and noticeable lighting variation. Ocean video: changing waves/foam with some rock-detail deformation and exposure variation. All 16 frames of both successful clips were inspected. Both MP4s fully decoded with exactly 16 frames and 2-second duration. These results do not validate SAM, mask preservation, image-conditioned generation or scene morphing.

Local evidence folders:
- .artifacts/local-ai/outputs/image-final
- .artifacts/local-ai/outputs/video-512-chunked
- .artifacts/local-ai/outputs/video-ocean

Each contains raw inference-report.json and generated PNG/MP4/GIF as applicable. Compact results are checked in as LOCAL_AI_RESULTS.json; weights and media stay ignored.

Reproduce the ocean test:

    .artifacts/local-ai/venv/Scripts/python.exe scripts/run_local_ai.py video --prompt "Ocean waves crashing onto a rocky shore, white foam washing across wet rocks, fixed camera, cinematic nature footage, daylight" --output .artifacts/local-ai/outputs/ocean-repeat

## Failure cases and required settings
- Whole-model offload exhausted available CUDA memory on the image test. Sequential offload worked.
- Earlier Windows native tensor-loading crashes are retained in local logs. The isolated worker now uses SafeTensors 0.8.0 with its supported pread backend; a supervisor records native failures instead of leaving a report running indefinitely.
- The motion UNet is assembled with empty-weight initialization and strict state assignment to avoid a temporary duplicate model allocation. It is explicitly converted to fp16/eval, with chunked feed-forward processing and one-frame VAE decoding.
- The initial 256x256 video was visually rejected despite encoding successfully. Do not use that result as a quality pass.
- 512x512 without feed-forward chunking ran out of CUDA memory. Chunk size 16 and sequential offload completed both 512x512 clips. The optional 384 setting uses chunk size 4 for divisibility but has not been validated end to end.
- An experimental chunk-size-1 run was stopped for excessive latency; the supervisor recorded failure.

Default reports say technical_pass and visualReview pending. A person must inspect results before claiming quality. No UI integration was added: Masakazu's existing interface still uses its offline flow. The scripts have no paid-service fallback, and inference uses only local weights with Hugging Face/Transformers offline mode. Downloading packages and weights requires internet during setup.
