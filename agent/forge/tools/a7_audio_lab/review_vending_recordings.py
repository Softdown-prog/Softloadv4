#!/usr/bin/env python3
"""Review original soda-vending recordings using the existing A7/CH Audio Lab.

Original recordings and active game audio are never modified. Output is review-only.
"""
from __future__ import annotations

from array import array
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
CONVERT = ROOT / "games/lan_house_simulator/assets/Convert"
OUT = ROOT / "out/lhs-vending-review"
RATE = 48000

def execute(*args: object) -> None:
    subprocess.run([str(arg) for arg in args], cwd=ROOT, check=True)

def details(path: Path) -> dict:
    result = subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries",
        "stream=codec_name,sample_rate,channels:format=duration",
        "-of", "json", str(path)
    ], text=True)
    return json.loads(result)

def impact_window(wav: Path, desired: float = 4.0) -> tuple[float, float, dict]:
    """Locate a high-contrast four-second passage; never claim semantic separation."""
    decoded = subprocess.check_output([
        "ffmpeg", "-v", "error", "-i", str(wav),
        "-f", "s16le", "-ac", "1", "-ar", str(RATE), "-"
    ])
    samples = array("h")
    samples.frombytes(decoded)
    if sys.byteorder != "little":
        samples.byteswap()
    frame = RATE // 50
    rms = []
    for offset in range(0, len(samples), frame):
        part = samples[offset:offset+frame]
        if part:
            rms.append(math.sqrt(sum(float(value)**2 for value in part) / len(part)))
    if not rms:
        raise RuntimeError("Audio source has no audible frames")
    sorted_rms = sorted(rms)
    floor = sorted_rms[int(.20 * (len(sorted_rms)-1))]
    p90 = sorted_rms[int(.90 * (len(sorted_rms)-1))]
    length = len(samples)/RATE
    seconds = min(desired, length)
    width = max(1, round(seconds*50))
    prominence = [max(0.0, value-1.7*floor) for value in rms]
    running = sum(prominence[:width])
    best_sum, best_index = running, 0
    for j in range(width, len(prominence)):
        running += prominence[j] - prominence[j-width]
        if running > best_sum:
            best_sum, best_index = running, j-width+1
    start = min(max(0.0, best_index / 50 - .12), max(0.0, length-seconds))
    analysis = {
        "originalCleanDurationSeconds": round(length, 3),
        "backgroundRms": round(floor, 2),
        "loudRmsP90": round(p90, 2),
        "contrastRatio": round(p90 / max(floor, 1.0), 2),
        "selection": "highest transient-energy window; not speech separation",
    }
    return start, seconds, analysis

def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    files = sorted(CONVERT.glob("7 de out. 17.*.m4a"))
    if len(files) != 2:
        raise RuntimeError(f"Expected 2 approved user recordings, found {len(files)}: {files}")
    previews: list[Path] = []
    report = {"contract": "LHS_VENDING_RECORDING_REVIEW_V1", "registered": False, "takes": []}
    for index, source in enumerate(files, 1):
        name = f"vending_{index:02d}"
        work = OUT / name
        work.mkdir(exist_ok=True)
        lab_output = work / "lab_clean.ogg"
        clean_wav = work / "clean_master.wav"
        job = {
            "source": str(source),
            "output": str(lab_output),
            "kind": "effect",
            "register": False,
            "report": str(work / "lab_report.json"),
            "cleanup": {
                "enabled": True, "profile": "recorded_sfx_cleanup",
                "noiseReductionDb": 11, "noiseFloorDb": -53,
                "trackNoise": True, "highpassHz": 85,
                "lowpassHz": 11000, "trimSilence": False,
                "output": str(clean_wav)
            },
            "mastering": {"channels": 1, "quality": 6, "normalize": False},
        }
        jobpath = work / "job.json"
        jobpath.write_text(json.dumps(job, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
        execute(sys.executable, ROOT/"tools/a7_audio_lab/audio_asset_worker.py", jobpath)
        begin, seconds, analysis = impact_window(clean_wav)
        full = OUT / f"{name}_completo.ogg"
        focus = OUT / f"{name}_foco.ogg"
        execute("ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-i", clean_wav, "-af", "loudnorm=I=-21:TP=-3:LRA=12",
                "-ar", RATE, "-ac", 1, "-c:a", "libvorbis", "-q:a", 5, full)
        clip_filter = ("agate=threshold=0.0012:ratio=2.3:attack=2:release=160,"
                       "afade=t=in:st=0:d=0.022,"
                       f"afade=t=out:st={max(.0,seconds-.10):.3f}:d=0.10,"
                       "loudnorm=I=-21:TP=-3:LRA=12")
        execute("ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                "-ss", f"{begin:.3f}", "-t", f"{seconds:.3f}", "-i", clean_wav,
                "-af", clip_filter,
                "-ar", RATE, "-ac", 1, "-c:a", "libvorbis", "-q:a", 5, focus)
        for output in (full, focus):
            meta = details(output)
            codec = meta["streams"][0]
            assert codec["codec_name"] == "vorbis" and codec["channels"] == 1
            assert codec["sample_rate"] == str(RATE)
            assert output.stat().st_size > 1000
        previews.append(focus)
        report["takes"].append({
            "source": source.name,
            "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "full": full.name,
            "focused": focus.name,
            "focusedStartSeconds": round(begin, 3),
            "focusedDurationSeconds": round(seconds, 3),
            **analysis
        })
    montage = OUT / "refrigerante_comparacao.ogg"
    execute("ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", previews[0], "-i", previews[1],
            "-filter_complex",
            "[0:a]asetpts=PTS-STARTPTS,apad=pad_dur=0.35[a];"
            "[1:a]asetpts=PTS-STARTPTS[b];"
            "[a][b]concat=n=2:v=0:a=1[out]",
            "-map", "[out]", "-c:a", "libvorbis", "-q:a", 5, montage)
    assert montage.stat().st_size > 1000
    report["montage"] = montage.name
    report["promotion"] = "review_only_preserve_current_vending_effect"
    (OUT/"report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
