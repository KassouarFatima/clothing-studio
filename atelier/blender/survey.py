import bpy, sys, os, math, glob
from mathutils import Vector
OUT = sys.argv[sys.argv.index('--') + 1]
ONLY = sys.argv[sys.argv.index('--') + 2:]
files = sorted(f for f in glob.glob(os.path.join(os.path.dirname(__file__), 'sketchfab', '*.glb')) if not ONLY or os.path.basename(f)[:-4] in ONLY)
scn = bpy.context.scene
scn.render.engine = 'BLENDER_EEVEE_NEXT'; scn.render.resolution_x = 360; scn.render.resolution_y = 480
scn.eevee.taa_render_samples = 16
for f in files:
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)
    bpy.ops.import_scene.gltf(filepath=f)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))); hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    size = hi - lo; c = (hi + lo) / 2
    names = sorted({o.name[:18] for o in meshes})[:8]
    print(f"SURVEY {os.path.basename(f):18s} meshes={len(meshes):3d} tris={tris:8d} size=({size.x:.2f},{size.y:.2f},{size.z:.2f}) {names}")
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scn.collection.objects.link(cam)
    d = max(size.x, size.z) * 1.6 + size.y
    cam.location = (c.x, c.y - d, c.z); cam.rotation_euler = (math.radians(90), 0, 0); cam.data.lens = 40; scn.camera = cam
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); scn.collection.objects.link(sun); sun.rotation_euler = (math.radians(40), 0, math.radians(20)); sun.data.energy = 4
    w = scn.world or bpy.data.worlds.new('w'); scn.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.8, 0.8, 0.82, 1); w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
    scn.render.filepath = os.path.join(OUT, 'survey_' + os.path.basename(f).replace('.glb', '.png'))
    bpy.ops.render.render(write_still=True)
