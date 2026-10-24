#!/usr/bin/env python3
"""A7 Audio Lab - migrated from City Horizon CH Audio Lab V1.

The lab deliberately separates generation from runtime mastering:

    prompt -> generator/provider -> master source -> audio_asset_worker.py
           -> review/runtime OGG -> validation reports

Provider types:
- source: ingest an existing audio file;
- synthetic_smoke: deterministic built-in generator for CI/tool validation;
- command: external/local AI provider invoked as an argument array.

The command provider is the stable integration seam for MusicGen, AudioCraft,
Stable Audio, hosted APIs wrapped by a small CLI, or future CH workers. Secrets
never belong in the JSON job; providers should read them from their environment.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import re
import shutil
import struct
import subprocess
import sys
import wave
from pathlib import Path
from typing import Any


CONTRACT = "CH_AUDIO_GENERATION_V1"
REPORT_CONTRACT = "CH_AUDIO_LAB_REPORT_V1"
SAMPLE_RATE = 48_000
REPO_ROOT = Path(__file__).resolve().parents[2]


def repo_path(value: str | Path) -> Path:
    path = Path(value)
    return path if path.is_absolute() else REPO_ROOT / path


def safe_id(value: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9._-]+", "_", value).strip("._")
    if not cleaned:
        raise SystemExit("audio job id must contain at least one safe character")
    return cleaned


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def clamp(value: float, lo: float = -1.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, value))


def write_pcm16_wav(path: Path, samples: list[tuple[float, ...]], channels: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        frames = bytearray()
        for frame in samples:
            if len(frame) != channels:
                raise ValueError("synthetic frame channel count mismatch")
            for value in frame:
                frames += struct.pack("<h", int(clamp(value) * 32767.0))
        wav.writeframes(bytes(frames))


def synthetic_ui_click(duration: float, channels: int, rng: random.Random) -> list[tuple[float, ...]]:
    total = max(1, int(duration * SAMPLE_RATE))
    result: list[tuple[float, ...]] = []
    for i in range(total):
        t = i / SAMPLE_RATE
        env = math.exp(-t * 34.0)
        tone = math.sin(2.0 * math.pi * (1100.0 - 320.0 * t) * t)
        transient = (rng.random() * 2.0 - 1.0) * math.exp(-t * 95.0)
        value = 0.52 * env * tone + 0.18 * transient
        result.append(tuple(value for _ in range(channels)))
    return result


def synthetic_steam_hiss(duration: float, channels: int, rng: random.Random) -> list[tuple[float, ...]]:
    total = max(1, int(duration * SAMPLE_RATE))
    low_l = low_r = 0.0
    result: list[tuple[float, ...]] = []
    for i in range(total):
        t = i / SAMPLE_RATE
        attack = min(1.0, t / 0.25)
        release = min(1.0, max(0.0, (duration - t) / 0.35))
        env = attack * release * (0.82 + 0.12 * math.sin(2 * math.pi * 0.31 * t))
        white_l = rng.random() * 2.0 - 1.0
        white_r = rng.random() * 2.0 - 1.0
        low_l += 0.11 * (white_l - low_l)
        low_r += 0.11 * (white_r - low_r)
        left = env * (0.38 * white_l + 0.42 * low_l)
        right = env * (0.38 * white_r + 0.42 * low_r)
        if channels == 1:
            result.append(((left + right) * 0.5,))
        else:
            result.append((left, right))
    return result


def synthetic_mechanical_loop(duration: float, channels: int, rng: random.Random) -> list[tuple[float, ...]]:
    total = max(1, int(duration * SAMPLE_RATE))
    result: list[tuple[float, ...]] = []
    clack_period = 0.58
    for i in range(total):
        t = i / SAMPLE_RATE
        hum = 0.13 * math.sin(2 * math.pi * 72.0 * t) + 0.07 * math.sin(2 * math.pi * 144.0 * t)
        phase = t % clack_period
        clack_env = math.exp(-phase * 42.0)
        clack = clack_env * (0.18 * math.sin(2 * math.pi * 760.0 * phase) + 0.08 * (rng.random() * 2 - 1))
        value = hum + clack
        if channels == 1:
            result.append((value,))
        else:
            pan = 0.08 * math.sin(2 * math.pi * 0.17 * t)
            result.append((value * (1.0 - pan), value * (1.0 + pan)))
    return result


def synthetic_rain(duration: float, channels: int, rng: random.Random) -> list[tuple[float, ...]]:
    total = max(1, int(duration * SAMPLE_RATE))
    low_l = low_r = 0.0
    drop_l = drop_r = 0.0
    result: list[tuple[float, ...]] = []
    for _ in range(total):
        w_l = rng.random() * 2.0 - 1.0
        w_r = rng.random() * 2.0 - 1.0
        low_l += 0.035 * (w_l - low_l)
        low_r += 0.035 * (w_r - low_r)
        if rng.random() < 0.0007:
            drop_l = 0.6 + rng.random() * 0.25
        if rng.random() < 0.0007:
            drop_r = 0.6 + rng.random() * 0.25
        drop_l *= 0.992
        drop_r *= 0.992
        left = 0.20 * w_l + 0.30 * low_l + drop_l * 0.08
        right = 0.20 * w_r + 0.30 * low_r + drop_r * 0.08
        if channels == 1:
            result.append(((left + right) * 0.5,))
        else:
            result.append((left, right))
    return result


def synthetic_thunder(duration: float, channels: int, rng: random.Random) -> list[tuple[float, ...]]:
    total = max(1, int(duration * SAMPLE_RATE))
    low = 0.0
    result: list[tuple[float, ...]] = []
    for i in range(total):
        t = i / SAMPLE_RATE
        env = min(1.0, t / 0.08) * math.exp(-max(0.0, t - 0.10) * 0.72)
        noise = rng.random() * 2.0 - 1.0
        low += 0.008 * (noise - low)
        rumble = math.sin(2 * math.pi * 43.0 * t) + 0.45 * math.sin(2 * math.pi * 61.0 * t)
        value = env * (0.28 * rumble + 0.56 * low)
        if channels == 1:
            result.append((value,))
        else:
            result.append((value * 0.96, value))
    return result


def synthetic_recorded_pop_noisy(duration: float, channels: int, rng: random.Random) -> list[tuple[float, ...]]:
    """Small mouth/cork-like pop buried in steady room noise for cleanup CI."""
    total = max(1, int(duration * SAMPLE_RATE))
    result: list[tuple[float, ...]] = []
    event_time = min(0.28, max(0.08, duration * 0.25))
    for i in range(total):
        t = i / SAMPLE_RATE
        # Deliberately include mains-like hum and broadband room hiss.
        room = 0.018 * math.sin(2 * math.pi * 60.0 * t) + 0.012 * (rng.random() * 2.0 - 1.0)
        dt = t - event_time
        pop = 0.0
        if 0.0 <= dt <= 0.30:
            env = math.exp(-dt * 22.0)
            pop = env * (
                0.60 * math.sin(2 * math.pi * 145.0 * dt)
                + 0.20 * math.sin(2 * math.pi * 420.0 * dt)
                + 0.10 * (rng.random() * 2.0 - 1.0)
            )
        value = clamp(room + pop)
        result.append(tuple(value for _ in range(channels)))
    return result


def synthetic_ambient_pad(duration: float, channels: int, rng: random.Random) -> list[tuple[float, ...]]:
    del rng
    total = max(1, int(duration * SAMPLE_RATE))
    notes = (130.81, 164.81, 196.00, 246.94)
    result: list[tuple[float, ...]] = []
    for i in range(total):
        t = i / SAMPLE_RATE
        fade = min(1.0, t / 1.5, max(0.0, duration - t) / 1.5 if duration > 1.5 else 1.0)
        base = sum(math.sin(2 * math.pi * f * t + idx * 0.7) for idx, f in enumerate(notes)) / len(notes)
        shimmer = 0.18 * math.sin(2 * math.pi * 392.0 * t + 0.4 * math.sin(2 * math.pi * 0.12 * t))
        value = fade * (0.20 * base + 0.06 * shimmer)
        if channels == 1:
            result.append((value,))
        else:
            side = 0.025 * math.sin(2 * math.pi * 0.09 * t)
            result.append((value - side, value + side))
    return result


SYNTHETIC_PROFILES = {
    "ui_click": synthetic_ui_click,
    "steam_hiss": synthetic_steam_hiss,
    "mechanical_loop": synthetic_mechanical_loop,
    "rain": synthetic_rain,
    "thunder": synthetic_thunder,
    "ambient_pad": synthetic_ambient_pad,
    "recorded_pop_noisy": synthetic_recorded_pop_noisy,
}


def generate_synthetic(provider: dict[str, Any], duration: float, output: Path) -> dict[str, Any]:
    profile = str(provider.get("profile", "ui_click"))
    if profile not in SYNTHETIC_PROFILES:
        raise SystemExit(f"unknown synthetic_smoke profile: {profile}")
    channels = int(provider.get("channels", 2 if profile in {"rain", "ambient_pad", "mechanical_loop"} else 1))
    if channels not in {1, 2}:
        raise SystemExit("synthetic_smoke channels must be 1 or 2")
    seed = int(provider.get("seed", 1337))
    rng = random.Random(seed)
    samples = SYNTHETIC_PROFILES[profile](duration, channels, rng)
    write_pcm16_wav(output, samples, channels)
    return {"type": "synthetic_smoke", "profile": profile, "seed": seed, "channels": channels}


def expand_command(parts: list[Any], replacements: dict[str, str]) -> list[str]:
    expanded: list[str] = []
    for raw in parts:
        value = str(raw)
        for key, replacement in replacements.items():
            value = value.replace("{" + key + "}", replacement)
        expanded.append(value)
    return expanded


def generate_with_command(provider: dict[str, Any], prompt: str, duration: float, prompt_file: Path, output: Path) -> dict[str, Any]:
    command = provider.get("command")
    if not isinstance(command, list) or not command:
        raise SystemExit("command provider requires a non-empty command array")
    replacements = {
        "prompt": prompt,
        "prompt_file": str(prompt_file),
        "output": str(output),
        "duration": f"{duration:.6f}",
        "repo": str(REPO_ROOT),
    }
    argv = expand_command(command, replacements)
    subprocess.run(argv, cwd=str(REPO_ROOT), check=True)
    if not output.is_file() or output.stat().st_size == 0:
        raise SystemExit(f"command provider did not produce output: {output}")
    return {"type": "command", "argv": argv}


def generate_source(provider: dict[str, Any], output_dir: Path) -> tuple[Path, dict[str, Any]]:
    source_value = provider.get("source")
    if not source_value:
        raise SystemExit("source provider requires source")
    source = repo_path(str(source_value))
    if not source.is_file():
        raise SystemExit(f"source provider file not found: {source}")
    copied = output_dir / ("source" + source.suffix.lower())
    shutil.copy2(source, copied)
    return copied, {"type": "source", "source": str(source)}


def run_lab(job_path: Path) -> dict[str, Any]:
    job_path = repo_path(job_path)
    job = json.loads(job_path.read_text(encoding="utf-8"))
    if job.get("contract") != CONTRACT:
        raise SystemExit(f"unsupported contract: {job.get('contract')}")

    job_id = safe_id(str(job.get("id", "")))
    kind = str(job.get("kind", "effect"))
    if kind not in {"effect", "ambient", "music"}:
        raise SystemExit(f"unsupported audio kind: {kind}")

    prompt = str(job.get("prompt", "")).strip()
    if not prompt:
        raise SystemExit("CH_AUDIO_GENERATION_V1 requires prompt")
    duration = float(job.get("durationSeconds", 0.0) or 0.0)
    if duration <= 0 or duration > 600:
        raise SystemExit("durationSeconds must be > 0 and <= 600")

    output_dir = repo_path(job.get("outputDir", f"out/a7-audio-lab/{job_id}"))
    output_dir.mkdir(parents=True, exist_ok=True)
    prompt_file = output_dir / "generation_request.json"
    prompt_file.write_text(json.dumps({
        "contract": CONTRACT,
        "id": job_id,
        "kind": kind,
        "prompt": prompt,
        "durationSeconds": duration,
        "negativePrompt": job.get("negativePrompt"),
        "tags": job.get("tags", []),
    }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    provider = dict(job.get("provider") or {})
    provider_type = str(provider.get("type", "synthetic_smoke"))
    generated_source = output_dir / "master.wav"

    if provider_type == "synthetic_smoke":
        provider_report = generate_synthetic(provider, duration, generated_source)
    elif provider_type == "command":
        provider_report = generate_with_command(provider, prompt, duration, prompt_file, generated_source)
    elif provider_type == "source":
        generated_source, provider_report = generate_source(provider, output_dir)
    else:
        raise SystemExit(f"unsupported provider type: {provider_type}")

    target = dict(job.get("target") or {})
    register = bool(target.get("register", False))
    review_output = repo_path(target.get("output", str(output_dir / "review.ogg")))
    asset_report = output_dir / "asset_report.json"
    worker_job_path = output_dir / "asset_job_resolved.json"

    worker_job: dict[str, Any] = {
        "contract": "CH_AUDIO_ASSET_JOB_V1",
        "source": str(generated_source),
        "output": str(review_output),
        "kind": kind,
        "mode": str(target.get("mode", "replace" if kind == "music" else "append")),
        "register": register,
        "report": str(asset_report),
        "mastering": dict(job.get("mastering") or {}),
        "cleanup": dict(job.get("cleanup") or {}),
        "durationSeconds": duration,
    }
    if register:
        worker_job["catalog"] = str(repo_path(target.get("catalog", "tools/a7_audio_lab/audio_catalog.json")))
        if kind == "music":
            worker_job["slot"] = target.get("slot")
        else:
            worker_job["event"] = target.get("event")

    worker_job_path.write_text(json.dumps(worker_job, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    subprocess.run([sys.executable, str(REPO_ROOT / "tools/a7_audio_lab/audio_asset_worker.py"), str(worker_job_path)], cwd=str(REPO_ROOT), check=True)
    asset_payload = json.loads(asset_report.read_text(encoding="utf-8"))

    report = {
        "contract": REPORT_CONTRACT,
        "status": "ok",
        "id": job_id,
        "kind": kind,
        "prompt": prompt,
        "durationSeconds": duration,
        "provider": provider_report,
        "generatedSource": str(generated_source),
        "generatedSourceSha256": sha256_file(generated_source),
        "output": str(review_output),
        "outputSha256": sha256_file(review_output),
        "registered": register,
        "generationRequest": str(prompt_file),
        "assetReport": str(asset_report),
        "cleanup": asset_payload.get("cleanup"),
        "cleanMaster": asset_payload.get("cleanMaster"),
        "cleanMasterSha256": asset_payload.get("cleanMasterSha256"),
    }
    (output_dir / "audio_lab_report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate and master A7 Forge audio from a CH Audio Lab job")
    parser.add_argument("job", type=Path)
    args = parser.parse_args()
    run_lab(args.job)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
