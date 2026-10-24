"""Render every gallery family/style with real production Scene Composer V4.

Usage: python -m visitor_forge_2d.gallery_preview --output out/gallery
"""
import argparse
import json
from pathlib import Path
from PIL import Image, ImageDraw
from .component_gallery import load_component_gallery
from .core.scene_composer_v4 import render_scene


def render_gallery(output: Path) -> dict:
    gallery=load_component_gallery()
    items=[item for item in gallery['items'] if '_md_000' in item['id']]
    output.mkdir(parents=True,exist_ok=True)
    board=Image.new('RGB',(960,((len(items)+7)//8)*104),'#242D36')
    draw=ImageDraw.Draw(board); records=[]
    for index,item in enumerate(items):
        recipe={'contract':'CH_2D_SCENE_RECIPE_V4','id':item['id'],'canvas':[100,76],
                'anchor':[50,70],'seed':43,
                'finish':{'edgeBreakupPx':0,'surfaceVariation':0,'brushStamps':0},
                'layers':[{'type':'component','componentId':item['id'],
                           'transform':{'translate':[50,38],'scale':[1.6,1.6]}}]}
        frame,metadata=render_scene(recipe)
        assert frame.getchannel('A').getbbox(),item['id']
        assert metadata['componentInstanceCount']==1
        bounds=metadata['bounds']
        assert bounds[0]>0 and bounds[1]>0 and bounds[2]<100 and bounds[3]<76,item['id']
        frame.save(output/(item['id']+'.png'))
        x=index%8*120;y=index//8*104
        board.paste(frame,(x+10,y),frame)
        draw.text((x+3,y+77),item['family'],fill='white')
        draw.text((x+3,y+89),item['style'],fill='#ACBDC8')
        records.append({'id':item['id'],'family':item['family'],'style':item['style'],
                        'bounds':bounds,'artApproved':False,'runtimePromotion':False})
    board.save(output/'gallery.png')
    report={'componentVariants':gallery['currentCount'],'families':len(gallery['familyDefinitions']),
            'renderedStyles':len(items),'seed':43,'scale':1.6,'records':records,
            'artApproved':False,'runtimePromotion':False}
    (output/'gallery_report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    return report


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    report=render_gallery(args.output)
    print(json.dumps({k:v for k,v in report.items() if k!='records'}))


if __name__=='__main__':
    main()
