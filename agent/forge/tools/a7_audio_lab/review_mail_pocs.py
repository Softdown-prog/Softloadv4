#!/usr/bin/env python3
"""Clean the author's newest 'poc' recording via A7 Audio Lab and select one alert.

This deliberately does not confuse earlier soda takes with the new mail effect.
Original M4A files are read-only; only derived OGG and review reports are produced.
"""
from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
import wave

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
CONVERT = ROOT / "games/lan_house_simulator/assets/Convert"
OUT = ROOT / "out/lhs-mail-poc-review"
PUBLISH = ROOT / "games/lan_house_simulator/assets/audio/mail_notification_01.ogg"
RATE = 48_000


def run(*args: object) -> None:
    subprocess.run([str(arg) for arg in args], cwd=ROOT, check=True)


def probe(path: Path) -> dict:
    raw = subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "a:0",
        "-show_entries", "stream=codec_name,channels,sample_rate:format=duration",
        "-of", "json", str(path)], text=True)
    return json.loads(raw)


def decode(path: Path) -> np.ndarray:
    raw = subprocess.check_output([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(path),
        "-vn", "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-"])
    return np.frombuffer(raw, dtype="<f4").copy()


def write_wav(path: Path, samples: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pcm = np.clip(samples, -0.999, 0.999)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(RATE)
        wf.writeframes((pcm * 32767).astype("<i2").tobytes())


def frame_rms(data: np.ndarray, milliseconds: int = 10) -> np.ndarray:
    stride = RATE * milliseconds // 1000
    padded = np.pad(data, (0, (-len(data)) % stride))
    frames = padded.reshape((-1, stride)).astype(np.float64)
    return np.sqrt(np.mean(frames**2, axis=1) + 1e-12)


def regions(data: np.ndarray) -> tuple[list[tuple[int, int]], float, dict]:
    rms = frame_rms(data)
    smooth = np.convolve(rms, np.ones(5) / 5, mode="same")
    floor = float(np.percentile(smooth, 22))
    active90 = float(np.percentile(smooth, 90))
    threshold = max(floor * 2.7, active90 * 0.21, 0.00035)
    mask = smooth >= threshold
    # Collect events; short gaps in one 'poc' are part of the same transient.
    idx = np.flatnonzero(mask)
    if not len(idx):
        return [], floor, {"noiseFloorRms": floor, "threshold": threshold}
    bounds = []
    a = int(idx[0])
    b = a
    for k in idx[1:]:
        k = int(k)
        if k - b > 24: # 240ms quiet space => a distinct 'poc'
            bounds.append((a, b))
            a = k
        b = k
    bounds.append((a, b))
    candidate_bounds = []
    for a, b in bounds:
        if b - a < 2:
            continue
        start = max(0, round((a * 0.01 - .060) * RATE))
        stop = min(len(data), round((b * 0.01 + .200) * RATE))
        if stop - start > RATE * 1.4:
            # Long background segments are not short mailbox notifications.
            stop = min(len(data), start + round(1.4 * RATE))
        segment = data[start:stop]
        if segment.size < RATE * .13 or float(np.max(np.abs(segment))) < .006:
            continue
        candidate_bounds.append((start, stop))
    candidate_bounds.sort()
    # If clipping/noise formed a long region, take top isolated envelope peaks.
    if not candidate_bounds:
        order = np.argsort(smooth)[::-1]
        centers = []
        for i in order:
            t = float(i) * .01
            if all(abs(t - x) >= .55 for x in centers):
                centers.append(t)
            if len(centers) >= 5:
                break
        candidate_bounds = [(max(0, round((x-.05)*RATE)),
            min(len(data), round((x+.65)*RATE))) for x in sorted(centers)]
    return candidate_bounds[:12], floor, {"noiseFloorRms": round(floor, 7),
        "thresholdRms": round(threshold, 7), "rawRegions": len(bounds)}


def process_candidate(data: np.ndarray, start: int, stop: int, floor: float) -> tuple[np.ndarray, dict]:
    samples = data[start:stop].copy()
    if not len(samples):
        raise ValueError("Empty candidate")
    if len(samples) > int(1.25 * RATE):
        samples = samples[:int(1.25 * RATE)]
    env = frame_rms(samples)
    peak = float(np.max(np.abs(samples)))
    power = float(np.sqrt(np.mean(samples.astype(np.float64)**2)))
    contrast = 20 * math.log10(max(1e-7, float(np.percentile(env, 90))) / max(floor, 1e-7))
    # Tail noise is more unpleasant for repeated notifications than raw loudness.
    tail = samples[int(len(samples)*.75):]
    tail_rms = float(np.sqrt(np.mean(tail.astype(np.float64)**2))) if len(tail) else 0.
    tail_db = 20 * math.log10(max(tail_rms, 1e-8) / max(power, 1e-8))
    # Penalize high-frequency harshness without completely dulling the 'poc'.
    fft = np.abs(np.fft.rfft(samples[::2].astype(np.float64)))**2
    freq = np.fft.rfftfreq(len(samples[::2]), 2/RATE)
    hf = float(np.sum(fft[freq > 6500]) / max(np.sum(fft), 1e-12))
    clipped = float(np.mean(np.abs(samples) > .985))
    duration = len(samples)/RATE
    # Favor clear single transients, clean decay and compact UI sound.
    score = (min(40., max(0., contrast)) * 1.2
             - 17. * hf
             - 80. * clipped
             - 8. * abs(duration-.58)
             - 8. * max(0., (tail_db+13.)/13.))
    # Keep the original attack; only gentle leading and ending envelope.
    attack_n = min(round(.011*RATE), len(samples)//4)
    release_n = min(round(.105*RATE), len(samples)//3)
    if attack_n:
        samples[:attack_n] *= np.sin(np.linspace(0, math.pi/2, attack_n))**2
    if release_n:
        samples[-release_n:] *= np.cos(np.linspace(0, math.pi/2, release_n))**2
    # All candidates are compared at the same safe peak, without a hard limiter.
    max_peak = float(np.max(np.abs(samples)))
    if max_peak > 0:
        samples *= min(16., .62 / max_peak)
    return samples, {
        "startSeconds": round(start/RATE, 3),
        "durationSeconds": round(duration, 3),
        "rawPeak": round(peak, 5),
        "rawRms": round(power, 5),
        "contrastDb": round(contrast, 2),
        "tailRelativeDb": round(tail_db, 2),
        "highBandFraction": round(hf, 5),
        "clippingFraction": round(clipped, 5),
        "score": round(score, 4)
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    matches = list(CONVERT.glob("7 de out. 18.05*.m4a"))
    if len(matches) != 1:
        raise SystemExit(f"Expected exactly one new user-owned mail recording, got: {matches}")
    original = matches[0]
    sha = hashlib.sha256(original.read_bytes()).hexdigest()
    job = {
        "source": str(original),
        "output": str(OUT / "full_cleanup_review.ogg"),
        "kind": "effect",
        "register": False,
        "report": str(OUT / "full_worker_report.json"),
        "cleanup": {"enabled": True, "profile": "recorded_sfx_cleanup",
                    "noiseReductionDb": 9, "noiseFloorDb": -55, "trackNoise": True,
                    "highpassHz": 110, "lowpassHz": 9000, "trimSilence": False,
                    "output": str(OUT / "full_clean_master.wav")},
        "mastering": {"channels": 1, "quality": 5, "normalize": False}
    }
    jobpath = OUT / "cleanup_job.json"
    jobpath.write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding="utf-8")
    run(sys.executable, ROOT / "tools/a7_audio_lab/audio_asset_worker.py", jobpath)
    samples = decode(OUT / "full_clean_master.wav")
    if len(samples) < RATE // 5 or len(samples) > RATE * 180:
        raise SystemExit("Invalid input length for a short user-recorded SFX")
    candidates, floor, detection = regions(samples)
    if not candidates:
        raise SystemExit("No distinct sound candidates; preserving existing runtime.")
    report = {
        "contract": "LHS_MAIL_POC_AUTHOR_RECORDING_REVIEW_V1",
        "source": str(original.relative_to(ROOT)),
        "sourceSha256": sha,
        "sourceDurationSeconds": round(len(samples)/RATE, 3),
        "cleanup": detection,
        "registered": False,
        "candidates": []
    }
    scored = []
    for index, (a, b) in enumerate(candidates, 1):
        wave_data, metrics = process_candidate(samples, a, b, floor)
        if float(np.max(np.abs(wave_data))) < .03:
            continue
        name = f"poc_candidate_{index:02d}"
        wav = OUT / (name + ".wav")
        ogg = OUT / (name + ".ogg")
        write_wav(wav, wave_data)
        run("ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", wav, "-ar", RATE, "-ac", "1", "-c:a", "libvorbis", "-q:a", 6, ogg)
        report["candidates"].append({"name": name, **metrics})
        scored.append((metrics["score"], name, wav))
    if not scored:
        raise SystemExit("No sufficiently audible 'poc' candidates")
    _, winner, wav = max(scored, key=lambda v: (v[0], v[1]))
    # Master selected clip through the same A7 worker (normalizing is pre-controlled).
    finaljob = {
        "source": str(wav),
        "output": str(PUBLISH),
        "kind": "effect",
        "register": False,
        "report": str(OUT / "final_asset_report.json"),
        "mastering": {"channels": 1, "quality": 6, "normalize": False}
    }
    finalpath = OUT / "final_job.json"
    finalpath.write_text(json.dumps(finaljob, ensure_ascii=False, indent=2), encoding="utf-8")
    run(sys.executable, ROOT / "tools/a7_audio_lab/audio_asset_worker.py", finalpath)
    output = probe(PUBLISH)
    stream = output["streams"][0]
    assert stream["codec_name"] == "vorbis" and int(stream["sample_rate"]) == RATE
    assert int(stream["channels"]) == 1 and PUBLISH.stat().st_size > 1000
    assert .13 < float(output["format"]["duration"]) < 1.6
    report["selected"] = winner
    report["selectedAsset"] = str(PUBLISH.relative_to(ROOT))
    report["sha256"] = hashlib.sha256(PUBLISH.read_bytes()).hexdigest()
    report["registered"] = True
    # Permanent, compact provenance report; full raw reviews remain Actions artifacts.
    published = ROOT / "games/lan_house_simulator/assets/audio/mail_notification_provenance.json"
    published.write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    (OUT / "review.json").write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    print(json.dumps({"source": report["source"],
                      "originalDuration": report["sourceDurationSeconds"],
                      "candidateCount": len(report["candidates"]),
                      "selected": winner,
                      "selectedReport": next(c for c in report["candidates"] if c["name"]==winner),
                      "file": report["selectedAsset"], "sha256": report["sha256"]},
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
