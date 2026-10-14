# A shoe must point the way the outfit faces (the body's front is -y). Some of the downloaded shoes were modelled facing
# the other way (the pumps and the riding boots: the toe is the low end of a shoe, the heel or the shaft the high end).
# Such a shoe is turned 180 degrees about its own vertical axis (a pair about its middle), in place, and rewritten.
# Run: Blender -b --factory-startup --python orient_shoes.py -- <public/models>
import bpy, sys, os, json, math
import numpy as np
from mathutils import Matrix
G = os.path.join(sys.argv[sys.argv.index('--') + 1], 'garments')
cat = json.load(open(os.path.join(G, 'garments.json')))
for key, info in cat.items():
    if info['slot'] != 'shoes': continue
    path = os.path.join(G, info['file'])
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    for m in meshes:
        m.data.transform(m.matrix_world); m.matrix_world = Matrix.Identity(4)
    vs = np.array([v.co[:] for m in meshes for v in m.data.vertices])
    one = vs[vs[:, 0] > 0.01] if info.get('pair') else vs
    y0, y1 = one[:, 1].min(), one[:, 1].max(); L = y1 - y0
    front, back = one[one[:, 1] < y0 + L * 0.25], one[one[:, 1] > y1 - L * 0.25]
    if front[:, 2].mean() < back[:, 2].mean():
        print('ORIENT', key, 'already faces the front'); continue
    xc = 0.0 if info.get('pair') else (one[:, 0].min() + one[:, 0].max()) / 2; yc = (y0 + y1) / 2
    turn = Matrix.Translation((xc, yc, 0)) @ Matrix.Rotation(math.pi, 4, 'Z') @ Matrix.Translation((-xc, -yc, 0))
    for m in meshes: m.data.transform(turn)
    bpy.ops.object.select_all(action='DESELECT')
    for m in meshes: m.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_draco_mesh_compression_enable=True,
                              export_draco_mesh_compression_level=6, export_image_format='JPEG', export_jpeg_quality=88)
    print('ORIENT', key, 'turned around')
