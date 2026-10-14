# Lighter copies of the garments for the street's MODE store (mannequins and wall racks, seen from a few metres, a few
# hundred pixels tall): the shop-floor scene is drawn three times a frame (sun shadows, depth/normals for the outlines
# and ambient occlusion, and the picture), and 70,000 triangles per garment was most of it. The MODE viewer, where a
# garment fills the screen, keeps the full models. Output: public/models/garments/street/<garment>.glb
# Run: Blender -b --factory-startup --python decimate_street.py -- <public/models>
import bpy, sys, os, json
MODELS = sys.argv[sys.argv.index('--') + 1]
G = os.path.join(MODELS, 'garments'); OUT = os.path.join(G, 'street'); os.makedirs(OUT, exist_ok=True)
cat = json.load(open(os.path.join(G, 'garments.json')))
TARGET = {'top': 20000, 'outer': 24000, 'bottom': 22000, 'dress': 22000, 'shoes': 9000, 'hat': 6000, 'bag': 9000}
for key, info in cat.items():
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)
    bpy.ops.import_scene.gltf(filepath=os.path.join(G, info['file']))
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    tris = sum(len(p.vertices) - 2 for m in meshes for p in m.data.polygons)
    ratio = min(1.0, TARGET.get(info['slot'], 20000) / max(1, tris))
    if ratio >= 0.97:   # already light: the street uses the original
        print('STREET', key, tris, 'kept'); continue
    if True:
        for m in meshes:
            bpy.context.view_layer.objects.active = m
            d = m.modifiers.new('d', 'DECIMATE'); d.decimate_type = 'COLLAPSE'; d.ratio = ratio; d.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier=d.name)
            for p in m.data.polygons: p.use_smooth = True
    bpy.ops.object.select_all(action='DESELECT')
    for m in meshes: m.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, info['file']), export_format='GLB', use_selection=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6, export_image_format='JPEG', export_jpeg_quality=85)
    after = sum(len(p.vertices) - 2 for m in meshes for p in m.data.polygons)
    info['street'] = True
    print('STREET', key, tris, '->', after, f'{os.path.getsize(os.path.join(OUT, info["file"])) // 1024} kB')
json.dump(cat, open(os.path.join(G, 'garments.json'), 'w'), indent=1)
