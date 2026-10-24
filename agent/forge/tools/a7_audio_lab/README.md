# A7 Audio Lab — port from City Horizon CH Audio Lab

The source is `Softdown-prog/City-horizon-`, `tools/ch_audio_lab/` plus `tools/audio_asset_worker.py`. This is a **copied, independently maintained** subset. Nothing modifies the City Horizon repository. The original `CH_AUDIO_GENERATION_V1`, `CH_AUDIO_LAB_REPORT_V1`, and `CH_AUDIO_ASSET_REPORT_V1` contracts remain supported to avoid unnecessary recipe breakage.

## Structure

- `audio_lab.py` — orchestration, synthetic tests, file ingestion, external command generator.
- `audio_asset_worker.py` — optional noise cleanup, mastering, OGG Vorbis 48 kHz and validation.
- `providers/stable_audio_local.py` — official Stable Audio 3 TFLite CPU provider (downloads code and weights into an **external cache** on demand).
- `providers/stability_audio.py` — optional hosted API provider; uses `STABILITY_API_KEY` from environment.
- `jobs/` — recipes belonging to the A7 authoring tool, **not** Magic Castle assets.

## Quick test

Requires Python 3.11+ and `ffmpeg` / `ffprobe`:

```bash
python tools/a7_audio_lab/audio_lab.py tools/a7_audio_lab/jobs/smoke_ui_click.json
```

Expected output: `out/a7-audio-lab/a7_ui_click_smoke/review.ogg` plus `master.wav`, `asset_report.json` and `audio_lab_report.json`.

For a real generative output, use a job with provider `type: "command"`. Example:

```json
"provider": {
  "type": "command",
  "command": ["python", "tools/a7_audio_lab/providers/stable_audio_local.py",
    "--prompt-file", "{prompt_file}", "--duration", "{duration}",
    "--output", "{output}", "--model", "sm-sfx", "--threads", "4"]
}
```

Local provider requires a compatible environment and fetches potentially large model weights; do not run automatically on ordinary commits. The hosted provider is optional and requires an API credential.

**Default rule: generate for review only.** Set `target.register=false`; no game-specific catalog, no automatic promotion. This module belongs to A7 tools, not `games/magic_castle/`. The future Magic Castle repository may consume only approved exported OGG files.

Maintain model licensing/provenance checks and review any generated audio before commercial distribution. The smoke synth is deterministic for functional tests, not an artistic audio generator.
