# Pilot: straight jeans + a tee simulated on the realistic male avatar with Blender's cloth solver, rendered in Cycles.
# Run: Blender -b human_base_meshes_bundle.blend --python garment_pilot.py -- <out_dir>
import bpy, bmesh, math, sys, os, time
from mathutils import Vector

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else '/tmp'
FAB = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'fabric')
HDRI = os.path.join(os.path.dirname(__file__), '..', 'public', 'assets', 'studio_small_08_1k.hdr')
t0 = time.time()

# ---------- the avatar ----------
BODY = 'GEO-body_male_realistic'
for o in list(bpy.data.objects):
    if o.name != BODY: bpy.data.objects.remove(o)
body = bpy.data.objects[BODY]
for c in bpy.data.collections: c.hide_render = c.hide_viewport = False
body.hide_render = body.hide_viewport = False
bpy.context.view_layer.objects.active = body
for m in body.modifiers:
    if m.type == 'MULTIRES': m.levels = 0; m.render_levels = 2
# centre the avatar on the origin, feet on the floor at z = 0
ws = [body.matrix_world @ v.co for v in body.data.vertices]
cx0 = (max(v.x for v in ws) + min(v.x for v in ws)) / 2; cy0 = (max(v.y for v in ws) + min(v.y for v in ws)) / 2; z00 = min(v.z for v in ws)
body.location -= Vector((cx0, cy0, z00)); bpy.context.view_layer.update()
print('avatar moved by', round(cx0, 3), round(cy0, 3), round(z00, 3))
verts = [body.matrix_world @ v.co for v in body.data.vertices]
zmin = min(v.z for v in verts); zmax = max(v.z for v in verts)
H = zmax - zmin
print('avatar height', round(H, 3))

def slice_at(z, band=0.012, side=None):
    pts = [v for v in verts if abs(v.z - z) < band and (side is None or (v.x > 0.02 if side > 0 else v.x < -0.02))]
    return pts
def leg_ring(z, side):
    pts = [v for v in slice_at(z, side=side) if abs(v.x) < 0.25]  # ignore hands
    if not pts: return None
    cx = sum(p.x for p in pts) / len(pts); cy = sum(p.y for p in pts) / len(pts)
    r = max(math.hypot(p.x - cx, p.y - cy) for p in pts)
    return cx, cy, r
def torso_ring(z):
    pts = [v for v in slice_at(z) if abs(v.x) < 0.24]
    xs = [p.x for p in pts]; ys = [p.y for p in pts]
    return (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, (max(xs) - min(xs)) / 2, (max(ys) - min(ys)) / 2

# landmarks as fractions of height (standard proportions), checked against the mesh
z_waist = zmin + H * 0.59; z_crotch = zmin + H * 0.47; z_knee = zmin + H * 0.285; z_ankle = zmin + H * 0.045
print('landmarks', [round(z, 3) for z in (z_waist, z_crotch, z_knee, z_ankle)])

# ---------- trousers: cut from the avatar's own surface (clean quads, exact fit), then given extra fabric ----------
z_top = zmin + H * 0.555    # mid-rise
hem = z_ankle - 0.005       # to the ankle bone: a slight break on the foot
src = body.copy(); src.data = body.data.copy(); src.modifiers.clear(); bpy.context.scene.collection.objects.link(src)
src.name = 'jeans'
bm = bmesh.new(); bm.from_mesh(src.data); bm.transform(src.matrix_world)
region = lambda v: hem - 0.05 < v.co.z < z_top + 0.06 and abs(v.co.x) < (0.25 if v.co.z < z_crotch + 0.05 else 0.21)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not region(v)], context='VERTS')
bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=True)   # ~1.5 cm squares
bmesh.ops.delete(bm, geom=[f for f in bm.faces if not (hem < f.calc_center_median().z < z_top)], context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bm.normal_update()
for v in bm.verts: v.co += v.normal * (0.012 if v.co.z < z_crotch + 0.04 and abs(v.co.x) < 0.05 else 0.007)  # just outside the skin (more at the crotch)
# the cut: ease over the thigh, then a straight leg ~19 cm across from the knee down
for v in bm.verts:
    z = v.co.z
    if z > z_crotch - 0.02: continue
    side = 1 if v.co.x > 0 else -1
    lr = leg_ring(max(z, z_ankle + 0.02), side)
    if not lr: continue
    cx, cy, r = lr
    dx, dy = v.co.x - cx, v.co.y - cy
    d = math.hypot(dx, dy) or 1e-6
    t = min(1.0, (z_crotch - 0.02 - z) / 0.12)           # blend in below the crotch
    target = max(d + 0.012, 0.066 if z < z_knee + 0.12 else d + 0.02)   # straight leg: ~41 cm around the hem
    k = 1 + (target / d - 1) * t
    v.co.x = cx + dx * k; v.co.y = cy + dy * k
bm.to_mesh(src.data); bm.free()
src.matrix_world = __import__('mathutils').Matrix.Identity(4)
jeans = src
for v in jeans.data.vertices: pass
print('jeans verts', len(jeans.data.vertices))
pin = jeans.vertex_groups.new(name='pin')
pin.add([v.index for v in jeans.data.vertices if v.co.z > z_top - 0.025], 1.0, 'REPLACE')
# where the cloth is cut bigger than the body: hips 0 → lower leg 1 (straight leg)
grow = jeans.vertex_groups.new(name='grow')
for v in jeans.data.vertices:
    t = min(1.0, max(0.0, (z_crotch - v.co.z) / (z_crotch - z_knee)))
    grow.add([v.index], 0.15 + 0.85 * t, 'REPLACE')

# ---------- physics ----------
col = body.modifiers.new('collision', 'COLLISION'); body.collision.thickness_outer = 0.004; body.collision.cloth_friction = 4
floor = bpy.data.objects.new('floor', bpy.data.meshes.new('floor'))
bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1.0); bm.to_mesh(floor.data); bm.free()
floor.location.z = zmin + 0.035; bpy.context.scene.collection.objects.link(floor); floor.modifiers.new('collision', 'COLLISION')
cl = jeans.modifiers.new('cloth', 'CLOTH'); s = cl.settings
s.quality = 12; s.mass = 0.5; s.tension_stiffness = 160; s.compression_stiffness = 160; s.shear_stiffness = 100; s.bending_stiffness = 45
s.air_damping = 1.5; s.vertex_group_mass = 'pin'

cl.collision_settings.use_self_collision = True; cl.collision_settings.self_distance_min = 0.004; cl.collision_settings.distance_min = 0.004
cl.collision_settings.collision_quality = 3
scn = bpy.context.scene; scn.frame_start = 1; scn.frame_end = 50; cl.point_cache.frame_end = 50
for f in range(1, 51): scn.frame_set(f)
print('simulated in', round(time.time() - t0, 1), 's')
bpy.context.view_layer.objects.active = jeans
bpy.ops.object.modifier_apply(modifier='cloth')
sub = jeans.modifiers.new('sub', 'SUBSURF'); sub.levels = 1; sub.render_levels = 1
jeans.modifiers.new('solid', 'SOLIDIFY').thickness = 0.0015
bpy.ops.object.shade_smooth()

# ---------- materials, light, camera ----------
def img(n): return bpy.data.images.load(os.path.join(FAB, n))
def fabric_mat(name, color, fab, scale):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord'); mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (scale, scale, scale)
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])   # metres: the weave at its real size
    det = nt.nodes.new('ShaderNodeTexImage'); det.image = img(f'{fab}_diff.jpg'); det.image.colorspace_settings.name = 'Non-Color'
    nor = nt.nodes.new('ShaderNodeTexImage'); nor.image = img(f'{fab}_nor.jpg'); nor.image.colorspace_settings.name = 'Non-Color'
    rou = nt.nodes.new('ShaderNodeTexImage'); rou.image = img(f'{fab}_rough.jpg'); rou.image.colorspace_settings.name = 'Non-Color'
    for t in (det, nor, rou): nt.links.new(mp.outputs['Vector'], t.inputs['Vector']); t.projection = 'BOX'; t.projection_blend = 0.3
    mix = nt.nodes.new('ShaderNodeMixRGB'); mix.blend_type = 'MULTIPLY'; mix.inputs['Fac'].default_value = 0.6
    mix.inputs['Color1'].default_value = color; nt.links.new(det.outputs['Color'], mix.inputs['Color2'])
    nt.links.new(mix.outputs['Color'], b.inputs['Base Color'])
    nm = nt.nodes.new('ShaderNodeNormalMap'); nt.links.new(nor.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    nt.links.new(rou.outputs['Color'], b.inputs['Roughness'])
    b.inputs['Sheen Weight'].default_value = 0.3
    return m
jeans.data.materials.clear(); jeans.data.materials.append(fabric_mat('denim', (0.1, 0.17, 0.33, 1), 'denim', 9))
skin = bpy.data.materials.new('mannequin'); skin.use_nodes = True
skin.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.82, 0.8, 0.77, 1)
skin.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.45
body.data.materials.clear(); body.data.materials.append(skin)
world = scn.world or bpy.data.worlds.new('w'); scn.world = world; world.use_nodes = True
env = world.node_tree.nodes.new('ShaderNodeTexEnvironment'); env.image = bpy.data.images.load(HDRI)
world.node_tree.links.new(env.outputs['Color'], world.node_tree.nodes['Background'].inputs['Color'])
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scn.collection.objects.link(cam)
cam.location = (0.5, -2.5, zmin + H * 0.3); cam.rotation_euler = (math.radians(90), 0, math.radians(11)); cam.data.lens = 60
scn.camera = cam
floor.hide_render = True
scn.render.engine = 'CYCLES'; scn.cycles.samples = 64; scn.cycles.use_denoising = True
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences; prefs.compute_device_type = 'METAL'; prefs.get_devices()
    for d in prefs.devices: d.use = True
    scn.cycles.device = 'GPU'
except Exception as e: print('GPU not available', e)
scn.render.resolution_x = 900; scn.render.resolution_y = 1200
scn.render.film_transparent = False
scn.render.filepath = os.path.join(OUT, 'pilot_jeans.png')
bpy.ops.render.render(write_still=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'pilot.blend'))
print('done in', round(time.time() - t0, 1), 's')
