#!/usr/bin/env python3
"""Stable Audio provider for CH Audio Lab.

This adapter calls Stability AI's official text-to-audio API and writes a WAV
master for the existing CH Audio Lab mastering/validation pipeline.

Credentials are read only from the environment (STABILITY_API_KEY by default).
They are never accepted in job JSON and are never written to reports.
"""

from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
import uuid
from pathlib import Path
from urllib import error, request


DEFAULT_ENDPOINT = "https://api.stability.ai/v2beta/audio/stable-audio-2/text-to-audio"
DEFAULT_MODEL = "stable-audio-2.5"
MAX_DURATION_SECONDS = 190.0


def _multipart(fields: dict[str, str]) -> tuple[bytes, str]:
    boundary = f"----CHAudioLab{uuid.uuid4().hex}"
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.append(f"--{boundary}\r\n".encode("utf-8"))
        chunks.append(
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8")
        )
        chunks.append(str(value).encode("utf-8"))
        chunks.append(b"\r\n")

    # Stability's multipart endpoint expects a files section even for text-only
    # requests. An empty field is sufficient and mirrors the official example.
    chunks.append(f"--{boundary}\r\n".encode("utf-8"))
    chunks.append(b'Content-Disposition: form-data; name="none"; filename=""\r\n')
    chunks.append(b"Content-Type: application/octet-stream\r\n\r\n")
    chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode("utf-8"))
    return b"".join(chunks), boundary


def _read_error(exc: error.HTTPError) -> str:
    try:
        payload = exc.read().decode("utf-8", errors="replace")
    except Exception:
        return f"HTTP {exc.code}"
    if len(payload) > 4000:
        payload = payload[:4000] + "..."
    return f"HTTP {exc.code}: {payload}"


def generate(
    *,
    prompt: str,
    duration: float,
    output: Path,
    model: str,
    seed: int,
    endpoint: str,
    api_key_env: str,
    timeout: float,
) -> dict[str, object]:
    if not prompt.strip():
        raise SystemExit("Stable Audio provider requires a non-empty prompt")
    if duration <= 0 or duration > MAX_DURATION_SECONDS:
        raise SystemExit(
            f"Stable Audio text-to-audio duration must be > 0 and <= {MAX_DURATION_SECONDS:g} seconds"
        )
    if seed < 0 or seed > 4_294_967_294:
        raise SystemExit("seed must be between 0 and 4294967294")

    api_key = os.environ.get(api_key_env, "").strip()
    if not api_key:
        raise SystemExit(
            f"missing {api_key_env}; configure it as an environment variable or GitHub Actions secret"
        )

    fields = {
        "prompt": prompt.strip(),
        "output_format": "wav",
        "duration": f"{duration:.6f}",
        "model": model,
    }
    if seed:
        fields["seed"] = str(seed)

    body, boundary = _multipart(fields)
    req = request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Accept": "audio/*",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "User-Agent": "City-Horizon-CH-Audio-Lab/1.0",
        },
    )

    try:
        with request.urlopen(req, timeout=timeout) as response:
            payload = response.read()
            status = int(getattr(response, "status", 200))
            content_type = response.headers.get("Content-Type", "")
            request_id = (
                response.headers.get("x-request-id")
                or response.headers.get("request-id")
                or ""
            )
    except error.HTTPError as exc:
        raise SystemExit(_read_error(exc)) from exc
    except error.URLError as exc:
        raise SystemExit(f"Stable Audio request failed: {exc.reason}") from exc

    if status != 200:
        raise SystemExit(f"Stable Audio returned unexpected HTTP status {status}")
    if not payload:
        raise SystemExit("Stable Audio returned an empty response")

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(payload)

    # The endpoint is requested as WAV. Keep a defensive check so a JSON/error
    # body can never silently enter the mastering pipeline as audio.
    if output.stat().st_size < 44:
        output.unlink(missing_ok=True)
        raise SystemExit("Stable Audio response is too small to be a valid WAV")
    with output.open("rb") as handle:
        header = handle.read(12)
    if not (header.startswith(b"RIFF") and header[8:12] == b"WAVE"):
        sample = payload[:500].decode("utf-8", errors="replace")
        output.unlink(missing_ok=True)
        raise SystemExit(
            "Stable Audio did not return WAV data"
            + (f": {sample}" if sample else "")
        )

    return {
        "provider": "stability",
        "model": model,
        "endpoint": endpoint,
        "durationSeconds": duration,
        "seed": seed,
        "httpStatus": status,
        "contentType": content_type,
        "requestId": request_id or None,
        "output": str(output),
        "bytes": len(payload),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate a WAV master with Stable Audio for CH Audio Lab"
    )
    parser.add_argument("--prompt")
    parser.add_argument("--prompt-file", type=Path)
    parser.add_argument("--duration", required=True, type=float)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    parser.add_argument("--api-key-env", default="STABILITY_API_KEY")
    parser.add_argument("--timeout", type=float, default=360.0)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    prompt = args.prompt or ""
    if args.prompt_file:
        data = json.loads(args.prompt_file.read_text(encoding="utf-8"))
        prompt = str(data.get("prompt", ""))

    report = generate(
        prompt=prompt,
        duration=args.duration,
        output=args.output,
        model=args.model,
        seed=args.seed,
        endpoint=args.endpoint,
        api_key_env=args.api_key_env,
        timeout=args.timeout,
    )
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(
            json.dumps(report, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
    print(json.dumps(report, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
