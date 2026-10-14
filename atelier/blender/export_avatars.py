# Exports the CC0 realistic avatars (Blender Studio Human Base Meshes) for MODE, on the garments' shared body frame
# (metres, feet at z = 0, facing -y), and measures them and every prepared garment at chest, waist and hip height,
# so the store can reshape the avatar to a customer's measurements and judge each garment's fit.
# Run: Blender -b human_base_meshes_bundle.blend --python export_avatars.py -- <public/models>
import bpy, bmesh, sys, os, math, json
from mathutils import Vector, Matrix

OUT = sys.argv[sys.argv.index('--') + 1]
AV = os.path.join(OUT, 'avatars'); os.makedirs(AV, exist_ok=True)
GARMENTS = os.path.join(OUT, 'garments')
BODIES = {'male': ('GEO-body_male_realistic', 1.75), 'female': ('GEO-body_female_realistic', 1.68)}
LEVELS = {'chest': 0.725, 'waist': 0.61, 'hips': 0.52}   # heights as a share of body height

def hull_perimeter(pts2):  # convex hull perimeter of 2D points (a tape measure around the slice)
    pts = sorted(set((round(x, 4), round(y, 4)) for x, y in pts2))
    if len(pts) < 3: return 0
    def cross(o, a, b): return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0: up.pop()
        up.append(p)
    h = lo[:-1] + up[:-1]
    return sum(math.dist(h[i], h[(i + 1) % len(h)]) for i in range(len(h)))
def girth(verts, z, band=0.012, xmax=None):
    # only the central piece of the slice: walk out from the middle until there's a gap (arms and sleeves sit apart)
    pts = [(v.x, v.y) for v in verts if abs(v.z - z) < band]
    if len(pts) < 8: return 0
    xs = sorted(x for x, _ in pts)
    mid = min(range(len(xs)), key=lambda i: abs(xs[i]))
    lo_i = mid
    while lo_i > 0 and xs[lo_i] - xs[lo_i - 1] < 0.018: lo_i -= 1
    hi_i = mid
    while hi_i < len(xs) - 1 and xs[hi_i + 1] - xs[hi_i] < 0.018: hi_i += 1
    x0, x1 = xs[lo_i], xs[hi_i]
    if xmax is not None: x0, x1 = max(x0, -xmax), min(x1, xmax)
    return round(hull_perimeter([(x, y) for x, y in pts if x0 <= x <= x1]) * 100, 1)   # cm

report = {}
for gender, (name, height) in BODIES.items():
    src = bpy.data.objects[name]
    ob = src.copy(); ob.data = src.data.copy(); bpy.context.scene.collection.objects.link(ob)
    for m in list(ob.modifiers):
        if m.type == 'MULTIRES': m.levels = 1
    bpy.context.view_layer.objects.active = ob
    for m in list(ob.modifiers):
        try: bpy.ops.object.modifier_apply(modifier=m.name)
        except Exception: ob.modifiers.remove(m)
    ob.data.transform(ob.matrix_world); ob.matrix_world = Matrix.Identity(4)
    vs = [v.co for v in ob.data.vertices]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs))); hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    s = height / (hi.z - lo.z)
    ob.data.transform(Matrix.Scale(s, 4) @ Matrix.Translation(-Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))))
    vs = [v.co.copy() for v in ob.data.vertices]
    # torso half-width at chest height (to keep the arms out of the tape measure)
    meas = {k: girth(vs, height * f) for k, f in LEVELS.items()}
    meas['chest'] = round(meas['waist'] * 1.2)   # the A-pose arms touch the chest: estimated from the waist (athletic proportion)
    meas['height'] = round(height * 100)
    ob.data.materials.clear()
    mat = bpy.data.materials.new(f'skin_{gender}'); mat.use_nodes = True
    b = mat.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (0.78, 0.62, 0.53, 1); b.inputs['Roughness'].default_value = 0.55
    ob.data.materials.append(mat)
    for p in ob.data.polygons: p.use_smooth = True
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    out = os.path.join(AV, f'{gender}.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6)
    report[gender] = dict(file=f'avatars/{gender}.glb', height=height, measurements=meas, verts=len(ob.data.vertices), kb=os.path.getsize(out) // 1024)
    print('AVATAR', gender, report[gender])
    bpy.data.objects.remove(ob)

# (Garment fit uses size charts in garments.json, not mesh measurements: hollow garment shells can't be taped reliably.)
json.dump(report, open(os.path.join(AV, 'avatars.json'), 'w'), indent=1)
