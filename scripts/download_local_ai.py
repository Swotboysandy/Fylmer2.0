"""Download pinned, free model weights. Inference is a separate offline command."""
import hashlib, json, urllib.request, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / ".artifacts/local-ai/models"
BASE_REPO = "stable-diffusion-v1-5/stable-diffusion-v1-5"
BASE_REVISION = "451f4fe16113bff5a5d2269ed5ad43b0592e9a14"
MOTION_REPO = "ByteDance/AnimateDiff-Lightning"
MOTION_REVISION = "027c893eec01df7330f5d4b733bc9485ee02e8b2"
BASE_FILES = [
    "README.md", "model_index.json", "scheduler/scheduler_config.json",
    "feature_extractor/preprocessor_config.json", "safety_checker/config.json",
    "safety_checker/model.fp16.safetensors", "text_encoder/config.json",
    "text_encoder/model.fp16.safetensors", "tokenizer/merges.txt",
    "tokenizer/special_tokens_map.json", "tokenizer/tokenizer_config.json",
    "tokenizer/vocab.json", "unet/config.json",
    "unet/diffusion_pytorch_model.fp16.safetensors", "vae/config.json",
    "vae/diffusion_pytorch_model.fp16.safetensors",
]
def download(repo, revision, files, folder):
    request = f"https://huggingface.co/api/models/{repo}/revision/{revision}?blobs=true"
    with urllib.request.urlopen(request, timeout=60) as response:
        metadata = json.load(response)
    entries = {item["rfilename"]: item for item in metadata["siblings"]}
    manifest = []
    for name in files:
        entry = entries[name]
        destination = MODELS / folder / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        expected = entry.get("lfs", {}).get("sha256")
        if not destination.exists():
            url = f"https://huggingface.co/{repo}/resolve/{revision}/{name}"
            partial = destination.with_name(destination.name + ".partial")
            print(f"Downloading {folder}/{name}", flush=True)
            subprocess.run(["curl.exe", "--location", "--fail", "--retry", "8",
                "--retry-all-errors", "--retry-delay", "2", "--connect-timeout", "30",
                "--speed-limit", "1024", "--speed-time", "60", "--continue-at", "-",
                "--output", str(partial), url], check=True)
            if entry.get("size") and partial.stat().st_size != entry["size"]:
                raise ValueError(f"Incomplete download: {name}")
            partial.replace(destination)
        digest = hashlib.sha256()
        with destination.open("rb") as source:
            while chunk := source.read(4 * 1024 * 1024): digest.update(chunk)
        if expected and digest.hexdigest() != expected:
            raise ValueError(f"Model checksum mismatch: {destination}")
        manifest.append({"file": name, "bytes": destination.stat().st_size, "sha256": digest.hexdigest()})
        print(f"Verified {folder}/{name}", flush=True)
    (MODELS / folder / "download-manifest.json").write_text(json.dumps({
        "repository": repo, "revision": revision, "files": manifest
    }, indent=2))

if __name__ == "__main__":
    download(BASE_REPO, BASE_REVISION, BASE_FILES, "sd15")
    download(MOTION_REPO, MOTION_REVISION, [
        "README.md", "LICENSE.md", "animatediff_lightning_4step_diffusers.safetensors"
    ], "animatediff-lightning")
