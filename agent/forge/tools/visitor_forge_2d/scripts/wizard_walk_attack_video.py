"""Assemble an MP4 validation reel from already-generated A7 wizard art.

No new character art is authored here. Every sprite is loaded from the canonical
render-pixel-character output. Requires ffmpeg in PATH.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from PIL import Image, ImageDraw

FPS = 20
STAGE = (448, 448)
DIRECTIONS = ("south", "east", "north", "west")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if shutil.which("ffmpeg") is None:
        raise SystemExit("ffmpeg is required for MP4 validation output")
    source = args.source.resolve()
    manifest_path = next(source.glob("*.pixel_character.json"))
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("archetype") != "wizard":
        raise SystemExit("Expected canonical wizard output")
    args.output.mkdir(parents=True, exist_ok=True)
    id_ = manifest["id"]
    reel: list[Image.Image] = []

    def hold(frame: Image.Image, count: int) -> None:
        reel.extend([frame.copy() for _ in range(count)])

    def walk_image(direction: str, pose: str) -> Image.Image:
        filename = source / "frames" / f"{id_}_{direction}_{pose}.png"
        with Image.open(filename) as image:
            sprite = image.convert("RGBA")
        stage = Image.new("RGBA", (112, 112), (245, 245, 245, 255))
        stage.alpha_composite(sprite, (56 - sprite.width // 2, 56 - sprite.height // 2))
        return stage.resize(STAGE, Image.Resampling.NEAREST).convert("RGB")

    with tempfile.TemporaryDirectory(prefix="a7_wizard_video_") as temp:
        for direction in DIRECTIONS:
            hold(walk_image(direction, "idle"), 10)
            for _ in range(3):
                for pose in ("walk_0", "walk_1", "walk_2", "walk_3"):
                    hold(walk_image(direction, pose), 3)
            hold(walk_image(direction, "idle"), 7)

            attack_gif = source / "full_attack" / f"{id_}_{direction}_full_attack.gif"
            with Image.open(attack_gif) as gif:
                for index in range(gif.n_frames):
                    gif.seek(index)
                    frame = gif.convert("RGB")
                    if frame.size != STAGE:
                        raise ValueError(f"Unexpected attack frame size: {frame.size}")
                    hold(frame, max(1, round(int(gif.info.get("duration", 110)) * FPS / 1000)))
            hold(walk_image(direction, "idle"), 10)

        for index, frame in enumerate(reel):
            frame.save(Path(temp) / f"{index:05d}.png")
        movie = args.output / f"{id_}_walk_attack_4directions.mp4"
        subprocess.run([
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-framerate", str(FPS), "-i", str(Path(temp) / "%05d.png"),
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18",
            "-movflags", "+faststart", str(movie)
        ], check=True)

    summary = {
        "id": id_, "type": "walk-attack-four-directions-validation",
        "directions": list(DIRECTIONS), "fps": FPS, "frameCount": len(reel),
        "durationSeconds": len(reel) / FPS, "video": movie.name,
        "artApproved": False, "runtimePromotion": False,
    }
    (args.output / "validation.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
