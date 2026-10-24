"""Restricted adapter over the vendored A7 renderers. Never runs model code."""
from __future__ import annotations
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
WORK = Path.cwd().resolve()
sys.path.insert(0, str(ROOT / 'tools/visitor_forge_2d/src'))
sys.path.insert(0, str(ROOT / 'tools/a7_audio_lab'))

# Recipes are data, not Python. Limits also contain malformed/expensive geometry.
if os.name == 'posix':
    import resource
    resource.setrlimit(resource.RLIMIT_CPU, (75, 75))
    resource.setrlimit(resource.RLIMIT_AS, (1024**3, 1024**3))
    resource.setrlimit(resource.RLIMIT_FSIZE, (32 * 1024**2, 32 * 1024**2))
    resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))

def inside(p: Path, root: Path) -> bool:
    return p == root or root in p.parents

def audit(event, args):
    # Trusted renderers sometimes accept source-image paths in recipes. Confine
    # those reads too; validating only the top-level recipe path is insufficient.
    if event == 'open' and isinstance(args[0], (str, bytes, os.PathLike)):
        p = Path(os.fsdecode(args[0])).resolve()
        if p == Path('/dev/null'):
            return
        mode, flags = args[1], args[2]
        writing = (isinstance(mode, str) and any(c in mode for c in 'wax+')) or (flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT))
        if writing and not inside(p, WORK):
            raise PermissionError('Forge write outside job directory')
        if not writing and not any(inside(p, r) for r in [WORK, ROOT, Path(sys.prefix) / 'lib', Path(sys.base_prefix) / 'lib', Path('/usr/lib'), Path('/usr/share/fonts'), Path('/etc/fonts')]):
            raise PermissionError('Forge read outside allowed resources')
    if event.startswith('socket.') or event in {'os.system', 'os.posix_spawn', 'os.posix_spawnp'}:
        raise PermissionError('Network and arbitrary commands are disabled')
    if event == 'subprocess.Popen':
        argv = args[1]
        # Only the bundled audio worker may launch ffmpeg, with a job constructed
        # here. Provider commands and credentials never come from model input.
        if not (len(argv) == 3 and Path(argv[0]).resolve() == Path(sys.executable).resolve()
                and Path(argv[1]).resolve() == ROOT / 'tools/a7_audio_lab/audio_asset_worker.py'
                and inside(Path(argv[2]).resolve(), WORK)):
            raise PermissionError('Arbitrary subprocess disabled')

sys.addaudithook(audit)

def main():
    task = json.load(sys.stdin)
    command, recipe = task['command'], task['recipe']
    output = WORK / 'out'
    output.mkdir()
    recipe_path = WORK / 'recipe.json'
    recipe_path.write_text(json.dumps(recipe), encoding='utf8')
    if command == 'draw-graph':
        from visitor_forge_2d.graph_worker import run_graph_workers
        result = run_graph_workers(recipe_path, output)
    elif command == 'draw-recipe':
        from visitor_forge_2d.core.shape_recipe import export_shape_recipe
        result = export_shape_recipe(recipe_path, output)
    elif command == 'run-workers':
        from visitor_forge_2d.workers import run_workers
        result = run_workers(recipe_path, output)
    elif command == 'plan-plant':
        from visitor_forge_2d.plant_planner_worker import run_plant_planner
        result = run_plant_planner(recipe_path, output)
    elif command == 'render-pixel-character':
        from visitor_forge_2d.pixel_character import render_pixel_character
        result = render_pixel_character(recipe_path, output)
    elif command == 'author-art':
        from visitor_forge_2d.art_author import run_art_author
        result = run_art_author(recipe, output)
    elif command == 'author-prop':
        from visitor_forge_2d.prop_author import run_prop_author
        result = run_prop_author(recipe, output)
    elif command == 'pack-animation':
        from visitor_forge_2d.animation import package_animation
        result = package_animation(recipe_path, output)
    elif command == 'audio-synth':
        from audio_lab import generate_synthetic
        import subprocess
        provider = recipe.get('provider', {})
        if provider.get('type', 'synthetic_smoke') != 'synthetic_smoke':
            raise ValueError('Only deterministic synthetic audio is enabled')
        duration = float(recipe.get('durationSeconds', 0.45))
        if not 0 < duration <= 30:
            raise ValueError('Audio duration must be in (0,30] seconds')
        generated = generate_synthetic(provider, duration, output / 'master.wav')
        mastering = recipe.get('mastering', {})
        job = {'source': str(output / 'master.wav'), 'output': str(output / 'review.ogg'),
               'report': str(output / 'asset_report.json'), 'kind': 'effect', 'register': False,
               'durationSeconds': duration, 'mastering': {k: mastering[k] for k in ['normalize', 'channels', 'quality'] if k in mastering}}
        job_path = WORK / 'audio_job.json'
        job_path.write_text(json.dumps(job), encoding='utf8')
        subprocess.run([sys.executable, str(ROOT / 'tools/a7_audio_lab/audio_asset_worker.py'), str(job_path)], check=True, stdout=subprocess.DEVNULL)
        result = {'status': 'review_ready', 'provider': generated}
    else:
        raise ValueError('Unknown Forge command')
    # Do not expose temporary host paths in the tool response or shipped reports.
    def portable(value):
        if isinstance(value, dict): return {k: portable(v) for k, v in value.items()}
        if isinstance(value, list): return [portable(v) for v in value]
        if isinstance(value, str): return value.replace(str(WORK) + '/', '').replace(str(ROOT) + '/', 'forge/')
        return value
    for report in output.rglob('*.json'):
        report.write_text(json.dumps(portable(json.loads(report.read_text())), indent=2), encoding='utf8')
    print(json.dumps({'status': 'review_ready', 'result': portable(result)}))

if __name__ == '__main__':
    main()
