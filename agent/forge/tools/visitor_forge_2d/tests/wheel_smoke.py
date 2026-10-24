"""Install the built wheel into a temporary target and render outside the source checkout."""
import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from zipfile import ZipFile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--wheel-dir', type=Path, required=True)
    parser.add_argument('--recipe', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    wheels = list(args.wheel_dir.glob('*.whl'))
    if len(wheels) != 1:
        raise ValueError('wheel smoke requires exactly one wheel')
    with ZipFile(wheels[0]) as archive:
        tips = [n for n in archive.namelist() if '/brush_library/' in n and n.endswith('.png')]
        assert len(tips) >= 10, 'portable package lost its brush library'
        assert any(n.endswith('third_party/libmypaint/NOTICE.txt') for n in archive.namelist()), 'upstream notice missing'
    with tempfile.TemporaryDirectory() as directory:
        target = Path(directory) / 'installed'
        subprocess.run([sys.executable, '-m', 'pip', 'install', '--no-deps', '--target', str(target), str(wheels[0].resolve())], check=True)
        code = r'''import json,sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
import visitor_forge_2d
from visitor_forge_2d.core.brush_engine_v2 import BRUSH_LIBRARY, load_brush_tip
from visitor_forge_2d.graph_worker import run_graph_workers
assert Path(visitor_forge_2d.__file__).resolve().is_relative_to(Path(sys.argv[1]).resolve())
for path in BRUSH_LIBRARY.rglob('*.png'):
 tip=load_brush_tip(path)
 assert tip.mode == 'RGBA' and tip.getchannel('A').getbbox()
from visitor_forge_2d.component_gallery import load_component_gallery
from visitor_forge_2d.core.scene_composer_v4 import render_scene
assert load_component_gallery()['currentCount']==704
frame,metadata=render_scene({'contract':'CH_2D_SCENE_RECIPE_V4','id':'portable_anchor','canvas':[64,64],'anchor':[32,60],'layers':[{'type':'component','componentId':'marine_anchor_anchor_md_000','transform':{'translate':[32,32]}}],'finish':{'edgeBreakupPx':0,'brushStamps':0,'surfaceVariation':0}})
assert frame.getchannel('A').getbbox() and metadata['componentInstanceCount']==1
result=run_graph_workers(Path(sys.argv[2]),Path(sys.argv[3]))
print(json.dumps({'installedPackage':True,'brushCount':len(list(BRUSH_LIBRARY.rglob('*.png'))),'status':result['status'],'png':result['png']}))
'''
        subprocess.run([sys.executable, '-I', '-c', code, str(target), str(args.recipe.resolve()), str(args.output.resolve())],
                       cwd=directory, check=True)


if __name__ == '__main__':
    main()
