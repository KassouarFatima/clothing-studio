import bpy, sys, os
from mathutils import Vector
for key in sys.argv[sys.argv.index('--') + 1:]:
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)
    bpy.ops.import_scene.gltf(filepath=os.path.join(os.path.dirname(__file__), 'sketchfab', key + '.glb'))
    rows = []
    for o in bpy.data.objects:
        if o.type != 'MESH': continue
        pts = [o.matrix_world @ v.co for v in o.data.vertices]
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))); hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        rows.append((len(o.data.vertices), o.name[:24], [o.data.materials[0].name[:20] if o.data.materials else ''], tuple(round(v, 2) for v in lo), tuple(round(v, 2) for v in hi)))
    rows.sort(reverse=True)
    print('PARTS', key, len(rows))
    for r in rows[:9]: print('PARTS  ', r)
