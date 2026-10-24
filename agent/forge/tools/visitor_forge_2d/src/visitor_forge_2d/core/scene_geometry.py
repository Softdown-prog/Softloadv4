"""Shared bounded contours and non-wrapping shifts for scene compositors."""
import math
from PIL import Image


def box_contour(node, label):
    box = node.get('box')
    if not isinstance(box, list) or len(box) != 4:
        raise ValueError(f'{label}.box must be [x0,y0,x1,y1]')
    x0, y0, x1, y1 = map(float, box)
    if not all(math.isfinite(v) for v in (x0,y0,x1,y1)) or x1 <= x0 or y1 <= y0:
        raise ValueError(f'{label}.box must have finite positive extents')
    kind = node['primitive']
    if kind == 'rect':
        return [(x0,y0),(x1,y0),(x1,y1),(x0,y1)]
    if kind == 'ellipse':
        cx,cy=(x0+x1)/2,(y0+y1)/2
        return [(cx+(x1-x0)/2*math.cos(i*math.tau/128),cy+(y1-y0)/2*math.sin(i*math.tau/128)) for i in range(128)]
    radius = abs(float(node.get('radius', min(x1-x0,y1-y0)/2 if kind == 'capsule' else 4)))
    if not math.isfinite(radius):
        raise ValueError(f'{label}.radius must be finite')
    radius = min(radius,(x1-x0)/2,(y1-y0)/2)
    points=[]
    for cx,cy,start in [(x1-radius,y0+radius,-90),(x1-radius,y1-radius,0),(x0+radius,y1-radius,90),(x0+radius,y0+radius,180)]:
        for i in range(33):
            a=math.radians(start+i*90/32)
            points.append((cx+radius*math.cos(a),cy+radius*math.sin(a)))
    return points


def shift_mask(mask, dx, dy):
    """Shift with transparent padding; pixels never reappear at the other edge."""
    result=Image.new(mask.mode,mask.size,0)
    result.paste(mask,(dx,dy))
    return result


def stroke_scale(transform):
    # Isotropic strokes under an anisotropic transform use the area scale.
    sx,sy=transform.get('scale',[1,1])
    return math.sqrt(abs(sx*sy))
