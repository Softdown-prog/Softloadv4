#!/usr/bin/env python3
"""Local Stable Audio 3 CPU provider for CH Audio Lab.

Runs Stability AI's official Stable Audio 3 LiteRT/TFLite backend inside the
current machine (including GitHub-hosted ubuntu-latest runners). No paid audio
API is used. Official model weights are downloaded from the public
`stabilityai/stable-audio-3-optimized` Hugging Face repository by the upstream
runtime and cached by the caller/environment when available.

The upstream source is pinned to a verified commit for reproducibility. Model
weights remain external development dependencies and are never committed to the
City Horizon repository or shipped with the game runtime.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


UPSTREAM_URL = "https://github.com/Stability-AI/stable-audio-3.git"
UPSTREAM_COMMIT = "3a82c807b69cf4b7c5c05270011a5d5e47abac18"
DEFAULT_CACHE_ROOT = Path.home() / ".cache" / "a7-audio-lab" / "stable-audio-3"
SUPPORTED_MODELS = {"sm-sfx", "sm-music"}
SUPPORTED_DIT_PRECISIONS = {"fp32", "w16a32", "w8a32", "w8a8-dyn"}
SUPPORTED_CODEC_PRECISIONS = {"fp32", "w8a8"}
MAX_SMALL_DURATION_SECONDS = 120.0


def run(argv: list[str], *, cwd: Path | None = None) -> None:
    subprocess.run(argv, cwd=str(cwd) if cwd else None, check=True)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def ensure_checkout(cache_root: Path) -> Path:
    cache_root.parent.mkdir(parents=True, exist_ok=True)
    git_dir = cache_root / ".git"
    if not git_dir.is_dir():
        if cache_root.exists():
            shutil.rmtree(cache_root)
        run(["git", "clone", "--filter=blob:none", "--no-checkout", UPSTREAM_URL, str(cache_root)])

    # Fetch exactly the pinned upstream commit. This keeps CI deterministic even
    # when Stability AI moves main forward.
    run(["git", "-C", str(cache_root), "fetch", "--depth", "1", "origin", UPSTREAM_COMMIT])
    run(["git", "-C", str(cache_root), "checkout", "--detach", "--force", "FETCH_HEAD"])
    return cache_root / "optimized" / "tflite"


def runtime_ready() -> bool:
    modules = ("ai_edge_litert", "numpy", "sentencepiece", "soundfile", "huggingface_hub")
    return all(importlib.util.find_spec(name) is not None for name in modules)


def ensure_runtime_dependencies(tflite_root: Path) -> None:
    if runtime_ready():
        return
    requirements = tflite_root / "requirements.txt"
    if not requirements.is_file():
        raise SystemExit(f"Stable Audio 3 requirements missing: {requirements}")
    run([sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "-r", str(requirements)])
    if not runtime_ready():
        raise SystemExit("Stable Audio 3 LiteRT runtime dependencies did not install correctly")


def load_prompt(prompt: str | None, prompt_file: Path | None) -> tuple[str, str | None]:
    negative: str | None = None
    if prompt_file:
        data = json.loads(prompt_file.read_text(encoding="utf-8"))
        prompt = str(data.get("prompt", prompt or "")).strip()
        raw_negative = data.get("negativePrompt")
        if raw_negative is not None:
            negative = str(raw_negative).strip() or None
    prompt = (prompt or "").strip()
    if not prompt:
        raise SystemExit("local Stable Audio provider requires a non-empty prompt")
    return prompt, negative


def generate(
    *,
    prompt: str,
    negative_prompt: str | None,
    duration: float,
    output: Path,
    model: str,
    dit_precision: str,
    decoder_precision: str,
    threads: int,
    seed: int,
    cfg: float,
    cache_root: Path,
) -> dict[str, Any]:
    if model not in SUPPORTED_MODELS:
        raise SystemExit(f"unsupported local Stable Audio model: {model}")
    if dit_precision not in SUPPORTED_DIT_PRECISIONS:
        raise SystemExit(f"unsupported DiT precision: {dit_precision}")
    if decoder_precision not in SUPPORTED_CODEC_PRECISIONS:
        raise SystemExit(f"unsupported decoder precision: {decoder_precision}")
    if duration <= 0 or duration > MAX_SMALL_DURATION_SECONDS:
        raise SystemExit(f"duration must be > 0 and <= {MAX_SMALL_DURATION_SECONDS:g} seconds")
    if threads < 1 or threads > 16:
        raise SystemExit("threads must be between 1 and 16")
    if cfg <= 0:
        raise SystemExit("cfg must be > 0")

    tflite_root = ensure_checkout(cache_root)
    ensure_runtime_dependencies(tflite_root)
    script = tflite_root / "scripts" / "sa3_tflite.py"
    if not script.is_file():
        raise SystemExit(f"Stable Audio 3 TFLite entrypoint missing: {script}")

    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    argv = [
        sys.executable,
        str(script),
        "--prompt", prompt,
        "--dit", model,
        "--decoder", "same-s",
        "--dit-precision", dit_precision,
        "--decoder-precision", decoder_precision,
        "--seconds", f"{duration:.6f}",
        "--steps", "8",
        "--seed", str(seed),
        "--threads", str(threads),
        "--cfg", f"{cfg:.6f}",
        "--out", str(output),
    ]
    if negative_prompt and cfg != 1.0:
        argv.extend(["--negative-prompt", negative_prompt])
    # With dynamic int8, sequential CFG is the deterministic path if CFG is on.
    if cfg != 1.0 and dit_precision == "w8a8-dyn":
        argv.append("--no-cfg-batched")

    run(argv, cwd=tflite_root)
    if not output.is_file() or output.stat().st_size < 44:
        raise SystemExit(f"Stable Audio 3 did not produce a valid WAV candidate: {output}")
    with output.open("rb") as handle:
        header = handle.read(12)
    if not (header.startswith(b"RIFF") and header[8:12] == b"WAVE"):
        raise SystemExit("Stable Audio 3 local provider output is not WAV")

    return {
        "provider": "stable-audio-3-local-tflite",
        "upstream": UPSTREAM_URL,
        "upstreamCommit": UPSTREAM_COMMIT,
        "model": model,
        "ditPrecision": dit_precision,
        "decoderPrecision": decoder_precision,
        "durationSeconds": duration,
        "threads": threads,
        "seed": seed,
        "cfg": cfg,
        "generationApiUsed": False,
        "huggingFaceTokenConfigured": bool(os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")),
        "output": str(output),
        "bytes": output.stat().st_size,
        "sha256": sha256_file(output),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate City Horizon audio locally with Stable Audio 3 TFLite/CPU")
    parser.add_argument("--prompt")
    parser.add_argument("--prompt-file", type=Path)
    parser.add_argument("--duration", required=True, type=float)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--model", choices=sorted(SUPPORTED_MODELS), default="sm-sfx")
    parser.add_argument("--dit-precision", choices=sorted(SUPPORTED_DIT_PRECISIONS), default="w8a8-dyn")
    parser.add_argument("--decoder-precision", choices=sorted(SUPPORTED_CODEC_PRECISIONS), default="w8a8")
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--seed", type=int, default=20260929)
    parser.add_argument("--cfg", type=float, default=1.0)
    parser.add_argument("--cache-root", type=Path, default=Path(os.environ.get("CH_AUDIO_LOCAL_CACHE", DEFAULT_CACHE_ROOT)))
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    prompt, negative_prompt = load_prompt(args.prompt, args.prompt_file)
    report = generate(
        prompt=prompt,
        negative_prompt=negative_prompt,
        duration=args.duration,
        output=args.output,
        model=args.model,
        dit_precision=args.dit_precision,
        decoder_precision=args.decoder_precision,
        threads=args.threads,
        seed=args.seed,
        cfg=args.cfg,
        cache_root=args.cache_root,
    )

    report_path = args.report or (args.output.parent / "local_provider_report.json")
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
