import bpy, math
keep = ['GEO-body_male_realistic', 'GEO-body_female_realistic']
for o in list(bpy.data.objects):
    if o.type == 'MESH' and o.name not in keep: bpy.data.objects.remove(o)
for o in list(bpy.data.objects):
    if o.type not in ('MESH',): bpy.data.objects.remove(o)
m, f = bpy.data.objects[keep[0]], bpy.data.objects[keep[1]]
for o in (m, f):
    for c in o.users_collection: pass
    o.hide_render = False; o.hide_viewport = False
print('male', tuple(round(v,3) for v in m.dimensions), 'female', tuple(round(v,3) for v in f.dimensions))
m.location.x = -0.55; f.location.x = 0.55
for coll in bpy.data.collections: coll.hide_render = False; coll.hide_viewport = False
scn = bpy.context.scene
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scn.collection.objects.link(cam)
cam.location = (0, -5.2, 0.95); cam.rotation_euler = (math.radians(90), 0, 0); cam.data.lens = 50
scn.camera = cam
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); scn.collection.objects.link(sun); sun.rotation_euler = (math.radians(50), 0, math.radians(30)); sun.data.energy = 3
scn.render.engine = 'BLENDER_WORKBENCH'; scn.render.resolution_x = 900; scn.render.resolution_y = 900
scn.render.filepath = '/private/tmp/claude-501/-Users-mac-Desktop-untitled-folder/6c879e51-9bd7-4af2-a6cc-41606644569b/scratchpad/bodies.png'
bpy.ops.render.render(write_still=True)
