import bpy
for o in bpy.data.objects:
    if o.type == 'MESH':
        d = o.dimensions
        print(f"{o.name:40s} verts={len(o.data.vertices):6d} dims=({d.x:.2f},{d.y:.2f},{d.z:.2f}) mods={[m.type for m in o.modifiers]} coll={[c.name for c in o.users_collection]}")
