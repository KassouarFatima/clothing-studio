# Prepares the downloaded CC-BY garments (Sketchfab) for the MODE store:
# keeps only the garment, fixes its orientation and real size, places it on one shared body frame (so a top, a bottom
# and shoes from different authors line up into one outfit), lightens it for the web, and exports a compressed GLB.
# Run: Blender -b --factory-startup --python prepare_garments.py -- <out_dir> [preview_dir]
import bpy, bmesh, sys, os, math, json
from mathutils import Vector, Matrix

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = ARGS[0] if ARGS else '/tmp/garments'
HERE = os.path.dirname(__file__)
os.makedirs(OUT, exist_ok=True)

# The shared body frame (metres, z up, feet at 0, facing -y): a 1.75 m person.
NECK_Z, WAIST_Z, FEET_X = 1.47, 0.98, 0.1
# slot, kind, how to size (z extent in metres, after rotation), where it goes, mesh names to drop, extra turn (degrees)
ASSETS = {
  'tshirt':      dict(slot='top', name='T-shirt', height=0.70, anchor='top', at=NECK_Z + 0.01, tint=True),
  'mens_shirt':  dict(slot='top', name='Dress shirt', height=0.80, anchor='top', at=NECK_Z + 0.03, tint=True),
  'flannel':     dict(slot='top', name='Plaid flannel shirt', height=0.80, anchor='top', at=NECK_Z + 0.03, tint=False),
  'hoodie':      dict(slot='outer', name='Zip hoodie', height=0.86, anchor='top', at=NECK_Z + 0.2, tint=True),
  # 'suit' retired: a low-detail game model that looks bloated on the realistic avatar
  # 'suit':        dict(slot='suit', name='Two-piece suit', height=1.42, anchor='top', at=NECK_Z + 0.02, tint=True),
  'cargo_jeans': dict(slot='bottom', name='Wide cargo jeans', height=0.98, anchor='top', at=WAIST_Z + 0.02, tint=True),
  'baggy_jeans': dict(slot='bottom', name='Baggy jeans', drop=['body'], height=0.99, anchor='top', at=WAIST_Z + 0.02, tint=False, keepWith='Pants'),
  'short_jeans': dict(slot='bottom', name='Denim shorts', height=0.33, anchor='top', at=WAIST_Z, tint=False),
  'plaid_skirt': dict(slot='bottom', name='Plaid pleated mini skirt', height=0.42, anchor='top', at=WAIST_Z + 0.02, tint=False),
  'converse':    dict(slot='shoes', name='High-top canvas sneakers', length=0.29, tint=True),
  'adidas':      dict(slot='shoes', name='Leopard running sneakers', length=0.28, tint=False),
  # 'puffer' retired: the original model's arms are posed unevenly; the padded parka replaces it
  # 'puffer':      dict(slot='outer', name='Black puffer jacket', height=0.78, anchor='top', at=NECK_Z + 0.1, closed=True, tint=True, upright=True),
  'evening_dress': dict(slot='dress', name='Draped maxi dress', height=1.42, at=NECK_Z - 0.03, tint=True),
  'red_dress':   dict(slot='dress', name='Cocktail dress', height=1.12, at=NECK_Z - 0.03, tint=True),
  'black_dress': dict(slot='dress', name='Black dress with bolero', height=1.0, at=NECK_Z + 0.02, tint=False),
  'overcoat':    dict(slot='outer', name='Double-breasted coat', height=1.0, at=NECK_Z + 0.04, closed=True, tint=True),
  'parka':       dict(slot='outer', name='Padded parka', height=1.18, at=NECK_Z + 0.22, closed=True, tint=True),
  'pumps':       dict(slot='shoes', name='Pointed pumps', length=0.25, tint=True, pair=True, turn=90),
  'heels':       dict(slot='shoes', name='Strappy heels', length=0.25, tint=False, pair=True),
  'chelsea':     dict(slot='shoes', name='Chelsea boots', length=0.27, tint=True),
  'riding_boot': dict(slot='shoes', name='Quilted riding boots', length=0.28, tint=True),
  'bucket_hat':  dict(slot='hat', name='Bucket hat', width=0.34, bottom=1.62, tint=True),
  'cap':         dict(slot='hat', name='Baseball cap', width=0.27, bottom=1.64, tint=True),
  'handbag':     dict(slot='bag', name='Leather handbag', width=0.36, place=(0.36, 0.0, 0.72), tint=False),
}
ONLY = ARGS[2].split(',') if len(ARGS) > 2 else None
credits = json.load(open(os.path.join(HERE, 'sketchfab', 'credits.json')))
report = {}

def clear():
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)
    for b in (bpy.data.meshes, bpy.data.materials, bpy.data.images): [b.remove(x) for x in list(b) if not x.users]

def world_verts(objs):
    return [o.matrix_world @ v.co for o in objs for v in o.data.vertices]

for key, cfg in ASSETS.items():
    if ONLY and key not in ONLY: continue
    clear()
    bpy.ops.import_scene.gltf(filepath=os.path.join(HERE, 'sketchfab', f'{key}.glb'))
    # first bake every parent's transform (Sketchfab keeps units and a 90° turn on parent nodes) into the meshes
    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
        if o.data.users > 1: o.data = o.data.copy()
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    if cfg.get('keepWith'): meshes = [o for o in meshes if cfg['keepWith'].lower() in (o.name + ''.join(m.name for m in o.data.materials if m)).lower()] or meshes
    for o in list(bpy.data.objects):
        if o not in meshes or any(d in o.name.lower() for d in cfg.get('drop', [])): bpy.data.objects.remove(o)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    # bake every transform (armatures, parents, glTF's own axis turn) into the vertices, then join
    for o in meshes:
        for m in list(o.modifiers):
            if m.type == 'ARMATURE': o.modifiers.remove(m)
        o.parent = None if o.parent is None else o.parent
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw; o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1: bpy.ops.object.join()
    g = bpy.context.view_layer.objects.active; g.name = key
    for o in list(bpy.data.objects):
        if o != g: bpy.data.objects.remove(o)
    def extents(pts, q=0.005):
        cut = lambda vals: sorted(vals)[int(q * (len(vals) - 1))], lambda vals: sorted(vals)[int((1 - q) * (len(vals) - 1))]
        lo = Vector([cut[0]([p[i] for p in pts]) for i in range(3)]); hi = Vector([cut[1]([p[i] for p in pts]) for i in range(3)])
        return lo, hi
    if cfg.get('upright'): # modelled turned: face its widest side to the front (principal axis of the footprint → x)
        pts = world_verts([g]); mx = sum(p.x for p in pts) / len(pts); my = sum(p.y for p in pts) / len(pts)
        cxx = sum((p.x - mx) ** 2 for p in pts); cyy = sum((p.y - my) ** 2 for p in pts); cxy = sum((p.x - mx) * (p.y - my) for p in pts)
        ang = 0.5 * math.atan2(2 * cxy, cxx - cyy)
        g.data.transform(Matrix.Rotation(-ang + math.radians(cfg.get('turn', 0)), 4, 'Z'))
        print('turned', key, round(math.degrees(-ang), 1))
    pts = world_verts([g]); lo, hi = extents(pts); size = hi - lo
    if cfg['slot'] == 'shoes':
        # longest horizontal side = the shoe's length; it should point forward (-y). A pair: its length is along y.
        if cfg.get('turn'): g.data.transform(Matrix.Rotation(math.radians(cfg['turn']), 4, 'Z'))
        elif size.x > size.y and not cfg.get('pair'): g.data.transform(Matrix.Rotation(math.radians(90), 4, 'Z'))
        pts = world_verts([g]); lo, hi = extents(pts); size = hi - lo
        s = cfg['length'] / (size.y if cfg.get('pair') else max(size.x, size.y))
    elif 'width' in cfg:
        s = cfg['width'] / max(size.x, size.y)
    else:
        s = cfg['height'] / size.z
    g.data.transform(Matrix.Translation(-(lo + hi) / 2 * Vector((1, 1, 0)) - Vector((0, 0, lo.z))))
    g.data.transform(Matrix.Scale(s, 4))
    pts = world_verts([g]); top = extents(pts)[1].z
    if cfg['slot'] == 'shoes':
        g.data.transform(Matrix.Translation((0 if cfg.get('pair') else FEET_X, -0.04, 0)))   # one shoe: the right foot (the viewer mirrors it)
    elif 'bottom' in cfg:
        g.data.transform(Matrix.Translation((0, 0, cfg['bottom'])))
    elif 'place' in cfg:
        g.data.transform(Matrix.Translation(cfg['place']))
    else:
        g.data.transform(Matrix.Translation((0, 0, cfg['at'] - top)))
    # lighter for the web: at most ~70k triangles, textures at most 1024 px
    tris = sum(len(p.vertices) - 2 for p in g.data.polygons)
    target = 70000 if cfg['slot'] != 'shoes' else 30000
    if tris > target:
        dm = g.modifiers.new('decimate', 'DECIMATE'); dm.ratio = target / tris
        bpy.context.view_layer.objects.active = g; bpy.ops.object.modifier_apply(modifier='decimate')
    for img in bpy.data.images:
        if img.size[0] > 1024: img.scale(1024, int(img.size[1] * 1024 / img.size[0]))
    bpy.ops.object.shade_smooth() if False else None
    pts = world_verts([g]); lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))); hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    out = os.path.join(OUT, f'{key}.glb')
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=False, export_draco_mesh_compression_enable=True,
                              export_draco_mesh_compression_level=6, export_image_format='JPEG', export_jpeg_quality=85, export_apply=True)
    c = credits.get(key, {})
    report[key] = dict(file=f'{key}.glb', slot=cfg['slot'], name=cfg['name'], tint=cfg['tint'], pair=bool(cfg.get('pair')), closed=bool(cfg.get('closed')), tris=sum(len(p.vertices) - 2 for p in g.data.polygons),
                       box=[[round(v, 3) for v in lo], [round(v, 3) for v in hi]], kb=os.path.getsize(out) // 1024,
                       credit=dict(title=c.get('title'), author=c.get('author'), username=c.get('username'), license=c.get('license'), url=c.get('url')))
    print('PREPARED', key, report[key]['tris'], 'tris', report[key]['kb'], 'KB', report[key]['box'])
prev = {}
try: prev = json.load(open(os.path.join(OUT, 'garments.json')))
except Exception: pass
if ONLY: prev.update(report); report = prev
json.dump(report, open(os.path.join(OUT, 'garments.json'), 'w'), indent=1)
