"""Render the flowering reference intent and verify semantics on actual pixels."""
from pathlib import Path
import colorsys
import json
import sys

from PIL import Image
from visitor_forge_2d.plant_planner_worker import run_plant_planner
from visitor_forge_2d.core.plant_visual_critic import _crown_field


def crown_color_shares(recipe, frame):
    zone=_crown_field(recipe)
    yellow=green=visible=0
    for y in range(frame.height):
        for x in range(frame.width):
            r,g,b,a=frame.getpixel((x,y))
            if a<64 or zone.getpixel((x,y))<42:
                continue
            visible+=1
            h,s,v=colorsys.rgb_to_hsv(r/255,g/255,b/255)
            yellow+=int(.10<=h<=.19 and s>=.45 and v>=.25)
            green+=int(.20<=h<=.48 and s>=.25 and v>=.15)
    return {'goldShare':round(yellow/max(1,visible),4),'greenShare':round(green/max(1,visible),4)}


if __name__=='__main__':
    intent,output=map(Path,sys.argv[1:3])
    report=run_plant_planner(intent,output)
    measurements={}
    for view,details in report['views'].items():
        recipe=json.loads(Path(details['recipe']).read_text())
        measurements[view]=crown_color_shares(recipe,Image.open(details['png']).convert('RGBA'))
        assert measurements[view]['goldShare']>=.70, (view,measurements[view])
        assert measurements[view]['greenShare']<=.10, (view,measurements[view])
    assert report['criticPassed'],report['visualCritic']['selected']
    (output/'flowering_color_metrics.json').write_text(json.dumps(measurements,indent=2)+'\n')
    print(json.dumps(measurements))
