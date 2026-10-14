# Some of the downloaded garments have thousands of tiny holes in their fabric (seams the artist left open), through
# which the lining or the body shows as dark speckles. Every small loop of open edges (under 3 cm across: sleeve ends
# and hems are far bigger) is closed, with the surrounding fabric's UVs. The garments are rewritten in place.
# Run: Blender -b --factory-startup --python fill_base_holes.py -- <public/models> [garment,…]
import bpy, bmesh, sys, os, json
ARGS = sys.argv[sys.argv.index('--') + 1:]
G = os.path.join(ARGS[0], 'garments'); ONLY = ARGS[1].split(',') if len(ARGS) > 1 else ['parka', 'overcoat', 'hoodie', 'flannel', 'mens_shirt', 'black_dress']
cat = json.load(open(os.path.join(G, 'garments.json')))
for key in ONLY:
    path = os.path.join(G, cat[key]['file'])
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    filled = 0
    for m in meshes:
        bm = bmesh.new(); bm.from_mesh(m.data); uv = bm.loops.layers.uv.active
        edges = [e for e in bm.edges if len(e.link_faces) == 1]
        parent = {}
        def root(e):
            while parent.setdefault(e, e) != e: parent[e] = parent[parent[e]]; e = parent[e]
            return e
        by_vert = {}
        for e in edges:
            for v in e.verts: by_vert.setdefault(v, []).append(e)
        for es in by_vert.values():
            for e in es[1:]: parent[root(e)] = root(es[0])
        loops = {}
        for e in edges: loops.setdefault(root(e), []).append(e)
        for es in loops.values():
            vs = list({v for e in es for v in e.verts})
            if len(vs) > 24: continue
            c = sum((v.co for v in vs), vs[0].co * 0) / len(vs)
            if max((v.co - c).length for v in vs) > 0.03: continue
            new = bmesh.ops.holes_fill(bm, edges=es, sides=0)['faces']
            for f in new:
                f.smooth = True
                for lp in f.loops:
                    other = next((l for l in lp.vert.link_loops if l.face not in new), None)
                    if uv and other: lp[uv].uv = other[uv].uv
            filled += 1
        bm.to_mesh(m.data); bm.free()
    if key == 'hoodie':   # its hood is only two flaps (the zip's edges) that hang by the face like long hair: cut off at the collar
        for m in meshes:
            bm = bmesh.new(); bm.from_mesh(m.data)
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if (m.matrix_world @ v.co).z > 1.49], context='VERTS')
            bm.to_mesh(m.data); bm.free()
    bpy.ops.object.select_all(action='DESELECT')
    for m in meshes: m.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_draco_mesh_compression_enable=True,
                              export_draco_mesh_compression_level=6, export_image_format='JPEG', export_jpeg_quality=88)
    print('FILLED', key, filled, 'holes', os.path.getsize(path) // 1024, 'kB')
