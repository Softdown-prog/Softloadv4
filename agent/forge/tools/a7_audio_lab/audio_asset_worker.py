#!/usr/bin/env python3
"""Prepare one City Horizon audio asset and optionally register it in audio_catalog.json.

Legacy jobs remain supported. CH Audio Lab V1 adds:
- effect / ambient / music mastering presets;
- optional recorded-SFX cleanup (rumble cut, spectral denoise, air-band cut and silence trim);
- optional loudness normalization and fades;
- deterministic ffprobe validation;
- SHA-256 proof and JSON report;
- review-only jobs that do not mutate the runtime catalog.

Runtime audio remains OGG/Vorbis at 48 kHz.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
from pathlib import Path
from typing import Any


CONTRACT = "CH_AUDIO_ASSET_REPORT_V1"
SUPPORTED_KINDS = {"effect", "ambient", "music"}


def run_checked(command: list[str], *, capture: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        check=True,
        text=True,
        capture_output=capture,
    )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def probe_audio(path: Path) -> dict[str, Any]:
    result = run_checked([
        "ffprobe", "-v", "error", "-select_streams", "a:0",
        "-show_entries", "stream=codec_name,sample_rate,channels,duration:format=duration",
        "-of", "json", str(path),
    ], capture=True)
    payload = json.loads(result.stdout)
    streams = payload.get("streams", [])
    if not streams:
        raise SystemExit(f"no audio stream found in {path}")
    stream = streams[0]
    duration_raw = stream.get("duration") or payload.get("format", {}).get("duration") or 0
    try:
        duration = float(duration_raw)
    except (TypeError, ValueError):
        duration = 0.0
    return {
        "codec": str(stream.get("codec_name", "")),
        "sampleRate": int(stream.get("sample_rate", 0) or 0),
        "channels": int(stream.get("channels", 0) or 0),
        "durationSeconds": round(duration, 6),
    }


def default_mastering(kind: str) -> dict[str, Any]:
    if kind == "music":
        return {"channels": 2, "quality": 5, "targetLufs": -16.0, "truePeakDb": -1.5}
    if kind == "ambient":
        return {"channels": 2, "quality": 5, "targetLufs": -20.0, "truePeakDb": -2.0}
    return {"channels": 1, "quality": 4, "targetLufs": -18.0, "truePeakDb": -1.5}


def build_cleanup_filter(job: dict[str, Any]) -> tuple[str | None, dict[str, Any]]:
    """Build a conservative cleanup chain for user-recorded SFX.

    This is intentionally spectral cleanup, not source separation. It targets
    steady room/fan/hiss noise and low-frequency handling rumble while keeping
    short transients such as coins, pops, corks and liquid attacks intact.
    """
    cleanup = dict(job.get("cleanup") or {})
    profile_value = str(cleanup.get("profile", "")).strip()
    enabled = bool(cleanup.get("enabled", bool(profile_value)))
    if not enabled:
        return None, {"enabled": False}

    profile = profile_value or "recorded_sfx_cleanup"
    if profile != "recorded_sfx_cleanup":
        raise SystemExit(f"unsupported cleanup profile: {profile}")

    highpass_hz = float(cleanup.get("highpassHz", 55.0))
    lowpass_hz = float(cleanup.get("lowpassHz", 19000.0))
    noise_reduction_db = float(cleanup.get("noiseReductionDb", 10.0))
    noise_floor_db = float(cleanup.get("noiseFloorDb", -50.0))
    track_noise = bool(cleanup.get("trackNoise", True))
    trim_silence = bool(cleanup.get("trimSilence", True))
    trim_threshold_db = float(cleanup.get("trimThresholdDb", -50.0))
    start_silence = float(cleanup.get("startSilenceSeconds", 0.02))
    stop_silence = float(cleanup.get("stopSilenceSeconds", 0.08))

    if not 20.0 <= highpass_hz <= 400.0:
        raise SystemExit("cleanup highpassHz must be between 20 and 400 Hz")
    if not 4000.0 <= lowpass_hz <= 24000.0:
        raise SystemExit("cleanup lowpassHz must be between 4000 and 24000 Hz")
    if highpass_hz >= lowpass_hz:
        raise SystemExit("cleanup highpassHz must be lower than lowpassHz")
    if not 0.0 <= noise_reduction_db <= 30.0:
        raise SystemExit("cleanup noiseReductionDb must be between 0 and 30 dB")
    if not -80.0 <= noise_floor_db <= -20.0:
        raise SystemExit("cleanup noiseFloorDb must be between -80 and -20 dB")
    if not -80.0 <= trim_threshold_db <= -20.0:
        raise SystemExit("cleanup trimThresholdDb must be between -80 and -20 dB")
    if not 0.0 <= start_silence <= 2.0 or not 0.0 <= stop_silence <= 2.0:
        raise SystemExit("cleanup silence padding must be between 0 and 2 seconds")

    filters: list[str] = [f"highpass=f={highpass_hz:g}"]
    if noise_reduction_db > 0.0:
        filters.append(
            f"afftdn=nr={noise_reduction_db:g}:nf={noise_floor_db:g}:tn={1 if track_noise else 0}"
        )
    filters.append(f"lowpass=f={lowpass_hz:g}")

    if trim_silence:
        filters.append(
            "silenceremove="
            f"start_periods=1:start_duration=0.01:start_threshold={trim_threshold_db:g}dB:"
            f"start_silence={start_silence:g}:"
            f"stop_periods=1:stop_duration=0.04:stop_threshold={trim_threshold_db:g}dB:"
            f"stop_silence={stop_silence:g}"
        )

    report = {
        "enabled": True,
        "profile": profile,
        "highpassHz": highpass_hz,
        "lowpassHz": lowpass_hz,
        "noiseReductionDb": noise_reduction_db,
        "noiseFloorDb": noise_floor_db,
        "trackNoise": track_noise,
        "trimSilence": trim_silence,
        "trimThresholdDb": trim_threshold_db,
        "startSilenceSeconds": start_silence,
        "stopSilenceSeconds": stop_silence,
        "filter": ",".join(filters),
    }
    return ",".join(filters), report


def build_audio_filter(job: dict[str, Any], kind: str) -> str | None:
    preset = default_mastering(kind)
    mastering = dict(job.get("mastering") or {})
    normalize = bool(mastering.get("normalize", job.get("normalize", False)))
    filters: list[str] = []

    if normalize:
        target_lufs = float(mastering.get("targetLufs", preset["targetLufs"]))
        true_peak = float(mastering.get("truePeakDb", preset["truePeakDb"]))
        lra = float(mastering.get("lra", 11.0))
        filters.append(f"loudnorm=I={target_lufs}:TP={true_peak}:LRA={lra}")

    fade_in = float(mastering.get("fadeInSeconds", 0.0) or 0.0)
    if fade_in > 0:
        filters.append(f"afade=t=in:st=0:d={fade_in}")

    fade_out = float(mastering.get("fadeOutSeconds", 0.0) or 0.0)
    requested_duration = float(job.get("durationSeconds", 0.0) or 0.0)
    if fade_out > 0 and requested_duration > fade_out:
        start = max(0.0, requested_duration - fade_out)
        filters.append(f"afade=t=out:st={start}:d={fade_out}")

    return ",".join(filters) if filters else None


def update_catalog(job: dict[str, Any], output: Path, kind: str, key: str, mode: str) -> None:
    catalog_path = Path(job.get("catalog", "tools/a7_audio_lab/audio_catalog.json"))
    if not catalog_path.is_file():
        raise SystemExit(f"catalog not found: {catalog_path}")

    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    audio_root = catalog_path.parent
    try:
        relative = output.resolve().relative_to(audio_root.resolve()).as_posix()
    except ValueError as exc:
        raise SystemExit("registered audio output must live under the catalog audio directory") from exc

    if kind in {"effect", "ambient"}:
        events = catalog.setdefault("events", {})
        if key not in events:
            raise SystemExit(f"unknown audio event: {key}")
        if mode == "replace":
            events[key] = [relative]
        elif mode == "append":
            if relative not in events[key]:
                events[key].append(relative)
        else:
            raise SystemExit(f"unsupported effect mode: {mode}")
    else:
        music = catalog.setdefault("music", {})
        if mode != "replace":
            raise SystemExit("music jobs currently support only replace mode")
        music[key] = relative

    catalog_path.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("job", type=Path)
    args = parser.parse_args()

    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        raise SystemExit("ffmpeg and ffprobe are required")

    job = json.loads(args.job.read_text(encoding="utf-8"))
    source = Path(job["source"])
    output = Path(job["output"])
    kind = str(job.get("kind", "effect"))
    key = str(job.get("event") if kind in {"effect", "ambient"} else job.get("slot"))
    mode = str(job.get("mode", "append" if kind in {"effect", "ambient"} else "replace"))
    register = bool(job.get("register", True))
    report_path = Path(job.get("report", str(output.with_suffix(".audio_report.json"))))

    if not source.is_file():
        raise SystemExit(f"source not found: {source}")
    if output.suffix.lower() != ".ogg":
        raise SystemExit("runtime/review output must use .ogg")
    if kind not in SUPPORTED_KINDS:
        raise SystemExit(f"unsupported kind: {kind}")
    if register and (not key or key == "None"):
        raise SystemExit("registered audio job requires event for effects/ambient or slot for music")

    preset = default_mastering(kind)
    mastering = dict(job.get("mastering") or {})
    channels = int(mastering.get("channels", preset["channels"]))
    quality = int(mastering.get("quality", preset["quality"]))
    if channels not in {1, 2}:
        raise SystemExit("mastering channels must be 1 or 2")
    if not 0 <= quality <= 10:
        raise SystemExit("Vorbis quality must be between 0 and 10")

    output.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)

    requested_duration = float(job.get("durationSeconds", 0.0) or 0.0)
    cleanup_filter, cleanup_report = build_cleanup_filter(job)
    encoding_source = source
    clean_master_path: Path | None = None
    clean_master_probe: dict[str, Any] | None = None

    if cleanup_filter:
        cleanup = dict(job.get("cleanup") or {})
        clean_master_path = Path(
            cleanup.get("output") or (report_path.parent / "clean_master.wav")
        )
        clean_master_path.parent.mkdir(parents=True, exist_ok=True)
        cleanup_command = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(source), "-vn",
        ]
        if requested_duration > 0:
            cleanup_command += ["-t", f"{requested_duration:.6f}"]
        cleanup_command += [
            "-af", cleanup_filter,
            "-ac", str(channels), "-ar", "48000",
            "-c:a", "pcm_s24le",
            str(clean_master_path),
        ]
        run_checked(cleanup_command)
        clean_master_probe = probe_audio(clean_master_path)
        if clean_master_probe["sampleRate"] != 48000:
            raise SystemExit(f"unexpected clean master sample rate: {clean_master_probe['sampleRate']}")
        if clean_master_probe["channels"] != channels:
            raise SystemExit(f"unexpected clean master channel count: {clean_master_probe['channels']}")
        if clean_master_probe["durationSeconds"] <= 0:
            raise SystemExit("clean master has zero duration")
        encoding_source = clean_master_path

    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(encoding_source), "-vn",
    ]
    if requested_duration > 0 and not cleanup_filter:
        command += ["-t", f"{requested_duration:.6f}"]

    audio_filter = build_audio_filter(job, kind)
    if audio_filter:
        command += ["-af", audio_filter]

    command += [
        "-ac", str(channels), "-ar", "48000",
        "-c:a", "libvorbis", "-q:a", str(quality),
        str(output),
    ]
    run_checked(command)

    probe = probe_audio(output)
    if probe["codec"] != "vorbis":
        raise SystemExit(f"unexpected runtime codec: {probe['codec']}")
    if probe["sampleRate"] != 48000:
        raise SystemExit(f"unexpected runtime sample rate: {probe['sampleRate']}")
    if probe["channels"] != channels:
        raise SystemExit(f"unexpected runtime channel count: {probe['channels']}")
    if probe["durationSeconds"] <= 0:
        raise SystemExit("generated runtime audio has zero duration")

    if register:
        update_catalog(job, output, kind, key, mode)

    report = {
        "contract": CONTRACT,
        "status": "ok",
        "kind": kind,
        "key": key if register else None,
        "registered": register,
        "mode": mode,
        "source": str(source),
        "output": str(output),
        "sourceSha256": sha256_file(source),
        "outputSha256": sha256_file(output),
        "cleanMaster": str(clean_master_path) if clean_master_path else None,
        "cleanMasterSha256": sha256_file(clean_master_path) if clean_master_path else None,
        "cleanMasterProbe": clean_master_probe,
        "cleanup": cleanup_report,
        "probe": probe,
        "mastering": {
            "channels": channels,
            "sampleRate": 48000,
            "vorbisQuality": quality,
            "normalize": bool(mastering.get("normalize", job.get("normalize", False))),
            "filter": audio_filter,
        },
    }
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
