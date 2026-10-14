# Checks the fitted garments: renders each one on its avatar (front and three-quarter views), several per image.
# Run: Blender -b --factory-startup --python render_fit.py -- <public/models> <gender> <out.png> <garment,…> [front|side]
import bpy, sys, os, math, json, base64
import numpy as np
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:]
MODELS, GENDER, OUT, KEYS = ARGS[0], ARGS[1], ARGS[2], ARGS[3].split(',')
VIEW = ARGS[4] if len(ARGS) > 4 else 'front'
for o in list(bpy.data.objects): bpy.data.objects.remove(o)

def load(path, dx):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    for o in bpy.data.objects:
        if o not in before and o.parent is None: o.location.x += dx
    return [o for o in bpy.data.objects if o not in before]

skin = bpy.data.materials.new('skin'); skin.diffuse_color = (0.82, 0.66, 0.57, 1)
cover = json.load(open(os.path.join(MODELS, 'garments', GENDER, 'cover.json')))
rig = json.load(open(os.path.join(MODELS, 'avatars', f'{GENDER}-arms.json')))
W = np.frombuffer(base64.b64decode(rig['w']), np.uint8) / 255; Jx, Jz = rig['joint'][0], rig['joint'][1]
cat = json.load(open(os.path.join(MODELS, 'garments', 'garments.json')))
for i, group in enumerate(KEYS):
    dx = i * 0.9
    keys = [k for k in group.split('+') if k and not k.startswith('base:')]
    # the look's arm angle: the outer garment's sleeves, else the top's, else the dress's (as the browser does)
    order = {'outer': 0, 'top': 1, 'dress': 2}
    arms = sorted((order.get(cat[k]['slot'], 9), cover[k]['arm']) for k in keys if k in cover and cover[k].get('arm'))
    angle = arms[0][1] if arms else None
    masks = [np.unpackbits(np.frombuffer(base64.b64decode(cover[k]['mask']), np.uint8), bitorder='little') for k in keys if k in cover]
    for o in load(os.path.join(MODELS, 'avatars', f'{GENDER}.glb'), dx):
        if o.type != 'MESH': continue
        o.data.materials.clear(); o.data.materials.append(skin)
        co = np.array([v.co[:] for v in o.data.vertices])   # local coordinates (the object itself is moved by dx)
        if angle is not None:
            sg = np.sign(co[:, 0]); a = math.radians(angle - rig['angle']) * W * sg
            ddx = co[:, 0] - sg * Jx; ddz = co[:, 2] - Jz
            co[:, 0], co[:, 2] = sg * Jx + ddx * np.cos(a) - ddz * np.sin(a), Jz + ddx * np.sin(a) + ddz * np.cos(a)
        o.data.vertices.foreach_set('co', co.ravel()); o.data.update()
        if masks:
            covered = np.any(masks, 0)[:len(co)].astype(bool)
            import bmesh
            bm = bmesh.new(); bm.from_mesh(o.data)
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if all(covered[v.index] for v in f.verts)], context='FACES_ONLY')
            bm.to_mesh(o.data); bm.free()
    for key in group.split('+'):
        if key.startswith('street:'): load(os.path.join(MODELS, 'garments', 'street', f'{key[7:]}.glb'), dx)
        elif key.startswith('base:'): load(os.path.join(MODELS, 'garments', f'{key[5:]}.glb'), dx)   # the garment as prepared, before fitting
        elif key: load(os.path.join(MODELS, 'garments', GENDER, f'{key}.glb'), dx)

scn = bpy.context.scene
scn.render.engine = 'BLENDER_WORKBENCH'
sh = scn.display.shading; sh.light = 'STUDIO'; sh.color_type = 'TEXTURE'; sh.show_cavity = True; sh.show_shadows = False
ZOOM = os.environ.get('ZOOM')   # "x,z,scale": look at one spot, orthographic, front view
n = len(KEYS); w = (n - 1) * 0.9
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scn.collection.objects.link(cam)
cam.data.type = 'ORTHO'; cam.data.ortho_scale = max(2.0, n * 0.9)
if VIEW == 'profile':   # one avatar, from its right side
    cam.location = (6, 0, 0.9); cam.rotation_euler = (math.radians(90), 0, math.radians(90))
elif VIEW == 'side':   # every avatar seen from its right, three-quarter
    cam.location = (w / 2 + 6 * math.sin(math.radians(40)), -6 * math.cos(math.radians(40)), 0.9); cam.rotation_euler = (math.radians(90), 0, math.radians(40))
else:
    cam.location = (w / 2, -6, 0.9); cam.rotation_euler = (math.radians(90), 0, 0)
if ZOOM:
    zx, zz, sc = map(float, ZOOM.split(',')); cam.data.ortho_scale = sc
    cam.location = (w / 2 + zx, -6, zz); cam.rotation_euler = (math.radians(90), 0, 0)
scn.camera = cam
scn.render.resolution_x = int(260 * n); scn.render.resolution_y = int(260 * n * 2.0 / cam.data.ortho_scale) if n * 0.9 > 2 else 600
scn.render.resolution_x = max(scn.render.resolution_x, 300)
if ZOOM: scn.render.resolution_x = 500 * n; scn.render.resolution_y = 500
scn.render.filepath = OUT
bpy.ops.render.render(write_still=True)
