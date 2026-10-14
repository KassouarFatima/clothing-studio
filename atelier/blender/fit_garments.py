# Fits every prepared garment to MODE's avatars, so the body and the clothes match. Each garment keeps the shape it was
# designed with (pushing fabric onto the skin made it look painted on); it is placed on the avatar's own landmarks
# (neck, shoulder points, waist, crotch, ankles, feet, head, hand), and the avatar adapts to it: its arms take the
# garment's sleeve angle, and the skin under the fabric is hidden (a per-vertex mask), so no body pokes through.
# Output: public/models/garments/<gender>/<garment>.glb and cover.json ({garment: {mask, arm}}) for both avatars,
# and public/models/avatars/<gender>-arms.json (the arm rig).
# Run: Blender -b --factory-startup --python fit_garments.py -- <public/models> [garment,…]
import bpy, sys, os, math, json, base64
import numpy as np
from mathutils import Vector, Matrix

ARGS = sys.argv[sys.argv.index('--') + 1:]
MODELS = ARGS[0]; ONLY = ARGS[1].split(',') if len(ARGS) > 1 else None
G = os.path.join(MODELS, 'garments')
cat = json.load(open(os.path.join(G, 'garments.json')))

def clear():
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for x in list(coll):
            if not x.users: coll.remove(x)
def load(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.data.objects if o not in before]
    for o in objs:
        if o.type == 'MESH':
            mw = o.matrix_world.copy(); o.parent = None; o.matrix_world = mw
    for o in objs:
        if o.type != 'MESH': bpy.data.objects.remove(o)
    meshes = [o for o in bpy.data.objects if o not in before]
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes: o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if len(meshes) > 1: bpy.ops.object.join()
    return bpy.context.view_layer.objects.active
def central_half(xs, gap=0.02):
    xs = sorted(xs)
    if not xs: return 0
    m = min(range(len(xs)), key=lambda i: abs(xs[i])); lo = hi = m
    while lo > 0 and xs[lo] - xs[lo - 1] < gap: lo -= 1
    while hi < len(xs) - 1 and xs[hi + 1] - xs[hi] < gap: hi += 1
    return max(-xs[lo], xs[hi])

def axis_angle(cs):
    # the direction of a limb (its principal axis in the front view), as an angle from vertical, outward positive
    a = np.array([(c.x, c.z) for c in cs]); a -= a.mean(0)
    w, v = np.linalg.eigh(a.T @ a); d = v[:, 1]
    if d[1] > 0: d = -d   # pointing down
    return math.atan2(d[0], -d[1])

# ---------- avatar landmarks ----------
def landmarks(av):
    vs = [v.co.copy() for v in av.data.vertices]
    H = max(v.z for v in vs)
    band = lambda z, w=0.008: [v for v in vs if abs(v.z - z) < w]
    # shoulders: going down from the head, the first height where the body suddenly widens (neck → shoulders)
    neck_z, sh_half = None, None
    prev = None
    for i in range(0, 80):
        z = H * 0.9 - i * 0.004
        w = central_half([v.x for v in band(z)], 0.015)
        if prev is not None and neck_z is None and w > prev + 0.03: neck_z = z + 0.012
        prev = w
    neck_z = neck_z or H * 0.85
    # shoulder point: the outermost body point a little below the neck base
    sh = band(neck_z - 0.05, 0.012)
    sh_half = max(abs(v.x) for v in sh)
    sh_z = neck_z - 0.04
    # arm direction: a line through the arm's points (outside the torso) from shoulder to wrist
    arm = [v for v in vs if v.x > 0 and H * 0.5 < v.z < sh_z - 0.08 and v.x > central_half([u.x for u in band(v.z, 0.01)], 0.02) + 0.005]
    arm_angle = axis_angle(arm) if len(arm) > 20 else 0.4   # radians from vertical, outward positive
    feet = [v for v in vs if v.z < H * 0.05 and v.x > 0]
    foot = dict(x=sum(v.x for v in feet) / len(feet), y0=min(v.y for v in feet), y1=max(v.y for v in feet), len=max(v.y for v in feet) - min(v.y for v in feet))
    head = [v for v in vs if v.z > neck_z + 0.08]
    hand = [v for v in vs if v.x > 0 and H * 0.4 < v.z < H * 0.5 and v.x > 0.2]
    crotch_z = max((v.z for v in vs if abs(v.x) < 0.012 and H * 0.35 < v.z < H * 0.55), default=H * 0.47)
    torso_y = sum(v.y for v in band(H * 0.7)) / max(1, len(band(H * 0.7)))
    def girth_half(z): return central_half([v.x for v in band(z, 0.01)], 0.02)
    armpit_z = H * 0.61
    for i in range(80):
        z = H * 0.61 + i * 0.005
        xs = sorted(v.x for v in band(z, 0.004) if v.x > 0)
        if any(xs[j + 1] - xs[j] > 0.012 for j in range(len(xs) - 1)): armpit_z = z
        elif z > H * 0.68: break
    armpit_z = max(armpit_z - 0.02, H * 0.76)   # where an A-pose arm rests on the chest, the gap closes early
    return dict(H=H, armpit_z=armpit_z, neck_z=neck_z, sh_half=sh_half, sh_z=sh_z, arm_angle=arm_angle, foot=foot, crotch_z=crotch_z, torso_y=torso_y,
                head_top=max(v.z for v in vs), head_w=max(v.x for v in head) - min(v.x for v in head), head_y=sum(v.y for v in head) / len(head),
                hand=Vector((sum(v.x for v in hand) / len(hand), sum(v.y for v in hand) / len(hand), sum(v.z for v in hand) / len(hand))) if hand else Vector((0.3, 0, 0.8)),
                waist_z=H * 0.61, hip_z=H * 0.52, hip_half=girth_half(H * 0.52), ankle_z=H * 0.045, knee_z=H * 0.285)

# ---------- garment landmarks and fitting ----------
FRAME_NECK = 1.47
HOODED = {'hoodie': 0.2, 'parka': 0.22}
def fit_top(g, L, key):
    vs = g.data.vertices
    collar = FRAME_NECK + {'mens_shirt': 0.03, 'flannel': 0.03, 'suit': 0.02, 'overcoat': 0.04, 'black_dress': 0.02, 'tshirt': 0.01}.get(key, 0)
    if key in ('evening_dress', 'red_dress'): collar = FRAME_NECK - 0.03
    # garment shoulder points: outermost points just below the collar
    sh = [v.co for v in vs if collar - 0.09 < v.co.z < collar - 0.04]
    g_half = max((abs(c.x) for c in sh), default=0.2)
    s = L['sh_half'] * (1.12 if key in ('overcoat', 'parka', 'hoodie') else 1.06) / g_half
    s = max(0.8, min(1.25, s))
    gy = sum(c.y for c in sh) / max(1, len(sh))
    # scale around the collar, then put the collar on the avatar's neck base
    # coats keep most of their length when the shoulders are narrower (a woman's parka would end at the hips otherwise)
    sz = max(s, 0.94) if key in ('parka', 'overcoat', 'hoodie') else s
    g.data.transform(Matrix.Translation((0, L['torso_y'], L['neck_z'] + 0.015)) @ Matrix.Diagonal((s, s, sz, 1)) @ Matrix.Translation((0, -gy, -collar)))
    return s
def fit_bottom(g, L, key):
    vs = g.data.vertices
    top = max(v.co.z for v in vs); hem = min(v.co.z for v in vs)
    hip = [v.co for v in vs if abs(v.co.z - (top - 0.1)) < 0.015]
    g_half = central_half([c.x for c in hip], 0.03) or 0.2
    sx = max(0.8, min(1.3, (L['hip_half'] + {'baggy_jeans': 0.05, 'cargo_jeans': 0.04, 'plaid_skirt': 0.03}.get(key, 0.02)) / (g_half if g_half > 0.05 else 0.2)))
    target_top = L['waist_z'] - (0.015 if key in ('cargo_jeans', 'baggy_jeans') else 0.0)
    if key in ('cargo_jeans', 'baggy_jeans'):   # full length: from the waist to the floor
        sz = (target_top - 0.0) / (top - hem)
        g.data.transform(Matrix.Translation((0, L['torso_y'], target_top)) @ Matrix.Scale(sz, 4, (0, 0, 1)) @ Matrix.Scale(sx, 4, (1, 0, 0)) @ Matrix.Scale(sx, 4, (0, 1, 0)) @ Matrix.Translation((0, 0, -top)))
    else:
        g.data.transform(Matrix.Translation((0, L['torso_y'], target_top)) @ Matrix.Scale(sx, 4) @ Matrix.Translation((0, 0, -top)))
def narrow_legs(g, L, rx, ry):
    # The wide trousers' legs are far deeper than the legs inside them (a 30 cm front-to-back "tube" around a 11 cm calf),
    # which reads as a skirt. Each leg is scaled in, band by band (smoothed), to at most rx (side) and ry (front-back).
    vs = g.data.vertices; crotch = L['crotch_z']
    bands = {}
    for v in vs:
        if v.co.z < crotch and abs(v.co.x) > 0.005:
            bands.setdefault((round(v.co.z / 0.02), 1 if v.co.x > 0 else -1), []).append(v.co)
    ext = {}
    for k, cs in bands.items():
        if len(cs) < 6: continue
        xs = sorted(c.x for c in cs); ys = sorted(c.y for c in cs); lo, hi = int(len(cs) * 0.02), int(len(cs) * 0.98) - 1
        ext[k] = ((xs[lo] + xs[hi]) / 2, (ys[lo] + ys[hi]) / 2, (xs[hi] - xs[lo]) / 2, (ys[hi] - ys[lo]) / 2)
    keys = sorted(ext)
    def target(k):
        side = k[1]; near = [ext[(k[0] + d, side)] for d in range(-2, 3) if (k[0] + d, side) in ext]
        return min(1, rx / max(e[2] for e in near)), min(1, ry / max(e[3] for e in near))
    scale = {k: target(k) for k in keys}
    top_b = round(crotch / 0.02)
    for v in vs:
        if abs(v.co.x) <= 0.005: continue
        side = 1 if v.co.x > 0 else -1
        b = min(round(v.co.z / 0.02), top_b - 1)
        k = next((kk for d in (0, 1, -1, 2, -2) for kk in [(b + d, side)] if kk in scale), None)
        if not k: continue
        w = min(1, max(0, (crotch + 0.12 - v.co.z) / 0.12))   # fades out above the crotch
        sx, sy = 1 + (scale[k][0] - 1) * w, 1 + (scale[k][1] - 1) * w
        cx, cy = ext[k][0], ext[k][1]
        v.co.x = cx + (v.co.x - cx) * sx; v.co.y = cy + (v.co.y - cy) * sy
    print('  legs narrowed to', rx, ry)
def drape_over(g, proxies, L, cap=1.3):
    # A coat or jacket hangs over whatever trousers are worn. Below the waist its skirt (the torso part, not the sleeves)
    # is widened, band by band and smoothed, until it clears the widest trousers the shop has, by 2 cm.
    def spans(vs, only_torso=None):
        out = {}
        for c in vs:
            if only_torso and abs(c.x) > only_torso(c.z): continue
            out.setdefault(round(c.z / 0.02), []).append(c)
        return out
    pants = {}
    for px in proxies:
        for b, cs in spans([v.co for v in px.data.vertices]).items():
            pants.setdefault(b, []).extend(cs)
    P = {b: (max(abs(c.x) for c in cs), (min(c.y for c in cs) + max(c.y for c in cs)) / 2, (max(c.y for c in cs) - min(c.y for c in cs)) / 2) for b, cs in pants.items() if len(cs) > 10}
    coat = {}
    for v in g.data.vertices: coat.setdefault(round(v.co.z / 0.02), []).append(v.co)
    C = {}
    for b, cs in coat.items():
        hx = central_half([c.x for c in cs], 0.03)
        if hx < 0.05: continue
        mid = [c for c in cs if abs(c.x) <= hx]
        ys = [c.y for c in mid]
        C[b] = (hx, (min(ys) + max(ys)) / 2, (max(ys) - min(ys)) / 2)
    need = {}
    for b in C:
        if b not in P: continue
        sx = max(1, (P[b][0] + 0.02) / C[b][0]); sy = max(1, (P[b][2] + 0.02 + abs(P[b][1] - C[b][1])) / max(C[b][2], 0.05))
        need[b] = (min(cap, sx), min(cap, sy))
    ks = sorted(need)
    sm = {}
    for b in ks:
        near = [need[k] for k in range(b - 2, b + 3) if k in need]
        sm[b] = (sum(n[0] for n in near) / len(near), sum(n[1] for n in near) / len(near))
    top = L['waist_z'] + 0.03
    for v in g.data.vertices:
        b = round(v.co.z / 0.02)
        if b not in sm or b not in C: continue
        w = min(1, max(0, (top - v.co.z) / 0.12))
        hx = C[b][0]
        wx = 1 - min(1, max(0, (abs(v.co.x) - (hx + 0.01)) / 0.05))   # the torso part, not the sleeves
        k = w * wx
        if not k: continue
        sx, sy = 1 + (sm[b][0] - 1) * k, 1 + (sm[b][1] - 1) * k
        v.co.x *= sx; v.co.y = C[b][1] + (v.co.y - C[b][1]) * sy
    for b in (38, 42, 46):
        if b in P and b in C: print('   band', b, 'pants x/ycentre/yhalf', [round(x, 3) for x in P[b]], 'coat', [round(x, 3) for x in C[b]], 'need', [round(x, 2) for x in need.get(b, (0, 0))])
    print('  skirt widened over the trousers by up to', round(max((m[0] for m in sm.values()), default=1), 2))
def cut_hood(g, L):
    # The hoodie's hood is only two flaps (the zip's edges), which hang by the face like long hair: it is cut off at
    # the collar, so it reads as a zip sweatshirt.
    import bmesh
    bm = bmesh.new(); bm.from_mesh(g.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > L['neck_z'] + 0.03], context='VERTS')
    bm.to_mesh(g.data); bm.free()
def align_legs(g, L, av_legs, top_z):
    # move each trouser leg onto the avatar's leg: per height, shift the leg's centre to the avatar's leg centre
    vs = g.data.vertices
    bands = {}
    for v in vs:
        if v.co.z < L['crotch_z'] - 0.03 and abs(v.co.x) > 0.01:
            k = (round(v.co.z / 0.02), 1 if v.co.x > 0 else -1); bands.setdefault(k, []).append(v.co.x)
    centre = {k: (min(xs) + max(xs)) / 2 for k, xs in bands.items() if len(xs) > 5}
    for v in vs:
        if v.co.z > L['crotch_z'] + 0.02 or abs(v.co.x) < 0.005: continue
        side = 1 if v.co.x > 0 else -1
        b = round(min(v.co.z, L['crotch_z'] - 0.03) / 0.02)
        gc, ac = centre.get((b, side)), av_legs.get((b, side))
        if gc is None or ac is None: continue
        w = min(1, max(0, (L['crotch_z'] + 0.02 - v.co.z) / 0.08))   # blend in below the crotch
        v.co.x += (ac - gc) * w
def avatar_legs(av, L):
    bands = {}
    for v in av.data.vertices:
        if v.co.z < L['crotch_z'] - 0.03 and abs(v.co.x) > 0.01 and abs(v.co.x) < 0.25:
            k = (round(v.co.z / 0.02), 1 if v.co.x > 0 else -1); bands.setdefault(k, []).append(v.co.x)
    return {k: (min(xs) + max(xs)) / 2 for k, xs in bands.items() if len(xs) > 5}
def fit_shoes(g, L, pair):
    vs = g.data.vertices
    ys = [v.co.y for v in vs]; xs = [v.co.x for v in vs]
    length = (max(ys) - min(ys))
    s = L['foot']['len'] * 1.1 / length
    cx = (max(xs) + min(xs)) / 2 if not pair else 0
    g.data.transform(Matrix.Translation((L['foot']['x'] if not pair else 0, (L['foot']['y0'] + L['foot']['y1']) / 2, 0)) @ Matrix.Scale(s, 4) @ Matrix.Translation((-cx, -(max(ys) + min(ys)) / 2, -min(v.co.z for v in vs))))
    if pair:   # spread the pair to the avatar's feet
        for v in vs:
            v.co.x += (1 if v.co.x > 0 else -1) * (L['foot']['x'] - 0.1 * s)
def fit_hat(g, L):
    vs = g.data.vertices
    xs = [v.co.x for v in vs]; w = max(xs) - min(xs)
    s = L['head_w'] * (1.55 if w > 0.3 else 1.25) / w
    bottom = min(v.co.z for v in vs)
    g.data.transform(Matrix.Translation((0, L['head_y'], L['head_top'] - 0.1)) @ Matrix.Scale(s, 4) @ Matrix.Translation((0, 0, -bottom)))
def fit_bag(g, L):
    vs = g.data.vertices
    c = Vector((sum(v.co.x for v in vs) / len(vs), sum(v.co.y for v in vs) / len(vs), max(v.co.z for v in vs)))
    g.data.transform(Matrix.Translation(L['hand'] + Vector((0.04, 0, -0.02)) - c))
def refine(g):
    # low-poly garments: smooth them first, so fitting doesn't show their flat facets
    tris = sum(len(p.vertices) - 2 for p in g.data.polygons)
    if tris < 25000:
        m = g.modifiers.new('sub', 'SUBSURF'); m.levels = 1 if tris > 9000 else 2; m.quality = 3
        bpy.context.view_layer.objects.active = g; bpy.ops.object.modifier_apply(modifier='sub')
def turn_sleeves(g, L, frm, to):
    # Sleeves modelled raised (arms out, like a scarecrow) are lowered to `to` degrees, about the same shoulder joint
    # the avatar's arms turn on: each sleeve turns as one piece (blended in at the armhole), the body doesn't move.
    a0 = math.radians(frm); down = (math.sin(a0), -math.cos(a0)); across = (math.cos(a0), math.sin(a0))
    d = math.radians(to - frm)
    for v in g.data.vertices:
        sg = 1 if v.co.x > 0 else -1
        qx, qz = abs(v.co.x) - J[0], v.co.z - J[2]
        t = qx * down[0] + qz * down[1]; u = qx * across[0] + qz * across[1]
        w = smooth(t / 0.12) * (1 - smooth((abs(u) - 0.15) / 0.05))
        if not w: continue
        a = d * w; c, s_ = math.cos(a), math.sin(a)
        nx, nz = qx * c - qz * s_, qx * s_ + qz * c
        v.co.x = sg * (J[0] + nx); v.co.z = J[2] + nz
    print(f'  sleeves lowered from {frm:.0f} to {to:.0f} deg')
def pitch_sleeves(g, key, arm):
    # Sleeves hanging further back (or forward) than the avatar's arms: tilted about the shoulder joint, front to back,
    # until the cuff is where the arm is at that distance (else the hands come out through the sleeve's front).
    c = np.array(CUFF_PT[key]); a = math.radians(arm)
    h = math.sqrt(max(0, 1 - ARM_D[1] ** 2)); Dp = np.array((math.sin(a) * h, ARM_D[1], -math.cos(a) * h))
    down = np.array((math.sin(a), 0, -math.cos(a))); k = np.array((math.cos(a), 0, math.sin(a)))
    tc = (c - J) @ down
    if tc < 0.2: return
    A = J + Dp * np.linalg.norm(c - J)
    phi = math.asin(max(-0.5, min(0.5, (A[1] - c[1]) / tc)))
    if abs(math.degrees(phi)) < 2: return
    for v in g.data.vertices:
        sg = 1 if v.co.x > 0 else -1
        q = np.array((abs(v.co.x), v.co.y, v.co.z)) - J
        t = q @ down; u = q @ k
        w = smooth(t / 0.12) * (1 - smooth((abs(u) - 0.15) / 0.05))
        if not w: continue
        th = phi * w
        q = q * math.cos(th) + np.cross(k, q) * math.sin(th) + k * (k @ q) * (1 - math.cos(th))
        p = J + q
        v.co.x, v.co.y, v.co.z = sg * p[0], p[1], p[2]
    print(f'  sleeves tilted {math.degrees(phi):+.0f} deg front/back onto the arms')
def mirror_good_half(g):
    # the model's right shoulder panel is missing: its complete left half (+x) is mirrored onto the right
    import bmesh
    bm = bmesh.new(); bm.from_mesh(g.data)
    bmesh.ops.symmetrize(bm, input=bm.verts[:] + bm.edges[:] + bm.faces[:], direction='X', dist=0.002)
    bm.to_mesh(g.data); bm.free()
MIRROR = {'flannel'}
def fill_holes(g, L, low=None):
    # Some models have holes in the fabric over the chest or belly (seams the original artist left open): small loops
    # of open edges on the torso, away from the neck, hem and cuffs. Closed with the fabric around them (same UVs).
    import bmesh
    bm = bmesh.new(); bm.from_mesh(g.data)
    uv = bm.loops.layers.uv.active
    open_edges = [e for e in bm.edges if len(e.link_faces) == 1]
    parent = {}
    def root(e):
        while parent.setdefault(e, e) != e: parent[e] = parent[parent[e]]; e = parent[e]
        return e
    by_vert = {}
    for e in open_edges:
        for v in e.verts: by_vert.setdefault(v, []).append(e)
    for es in by_vert.values():
        for e in es[1:]: parent[root(e)] = root(es[0])
    loops = {}
    for e in open_edges: loops.setdefault(root(e), []).append(e)
    filled = 0
    for es in loops.values():
        vs = list({v for e in es for v in e.verts})
        c = sum((v.co for v in vs), Vector()) / len(vs)
        rad = sum((v.co - c).length for v in vs) / len(vs)
        if rad < (0.09 if low else 0.075) and (abs(c.x) < L['hip_half'] + (0.1 if low else 0.04) or (low and math.hypot(abs(c.x) - J[0], c.z - J[2]) < 0.5)) and (low if low else L['crotch_z'] - 0.12) < c.z < L['armpit_z'] + 0.02:
            new = bmesh.ops.holes_fill(bm, edges=es, sides=0)['faces']
            for f in new:
                for lp in f.loops:   # each corner takes its vertex's UV from the fabric around the hole
                    other = next((l for l in lp.vert.link_loops if l.face not in new), None)
                    if uv and other: lp[uv].uv = other[uv].uv
            filled += 1
    bm.to_mesh(g.data); bm.free()
    if filled: print('  filled', filled, 'holes')
def lay_straps(g, L):
    # straps standing above the shoulders (made on a body with higher shoulders): lowered onto the avatar's shoulders
    top = L['armpit_z'] + 0.08
    for v in g.data.vertices:
        if v.co.z > top: v.co.z = top + (v.co.z - top) * 0.4
    vg = g.vertex_groups.new(name='straps'); vg.add([v.index for v in g.data.vertices if v.co.z > top - 0.02], 1.0, 'REPLACE')
    return 'straps'
def push_out(g, av, offset=0.006, group=None):
    # wherever the fabric is inside the body, move it just outside the skin (only the vertex group, if given)
    m = g.modifiers.new('outside', 'SHRINKWRAP'); m.target = av; m.wrap_method = 'NEAREST_SURFACEPOINT'; m.wrap_mode = 'OUTSIDE'; m.offset = offset
    if group: m.vertex_group = group
    bpy.context.view_layer.objects.active = g; bpy.ops.object.modifier_apply(modifier='outside')

# ---------- the avatar's arms ----------
# Every garment keeps its own designed shape; the avatar adapts to it instead: its arms turn (about the shoulder joint)
# to the garment's sleeve angle. Each avatar vertex has an arm weight (1 on the arm, blended across the shoulder);
# the browser turns the arms exactly the same way (avatars/<gender>-arms.json).
def smooth(t): t = min(1, max(0, t)); return t * t * (3 - 2 * t)
def arm_rig(av, L):
    vs = [v.co for v in av.data.vertices]
    H = L['H']
    arm = np.array([(c.x, c.y, c.z) for c in vs if c.x > 0 and H * 0.45 < c.z < L['sh_z'] - 0.08 and c.x > L['hip_half'] + 0.06])
    C = arm.mean(0); w, v = np.linalg.eigh((arm - C).T @ (arm - C)); D = v[:, 2]
    if D[2] > 0: D = -D
    J = C + D * ((L['sh_z'] - 0.03 - C[2]) / D[2])
    global ARM_D; ARM_D = D
    W = np.zeros(len(vs))
    for i, c in enumerate(vs):
        q = np.array((abs(c.x), c.y, c.z)) - J
        t = q @ D; perp = np.linalg.norm(q - t * D)
        thr = 0.07 + 0.05 * min(1, max(0, (t - 0.35) / 0.2))   # wider at the hand
        W[i] = smooth((t + 0.03) / 0.1) * (1 - smooth((perp - thr) / 0.02))
    return J, W
def pose(co, J, W, base, angle):
    # co: (n, 3) Blender coordinates; turns both arms from `base` to `angle` (degrees from vertical, outward positive)
    a = math.radians(angle - base) * W * np.sign(co[:, 0])
    dx = co[:, 0] - np.sign(co[:, 0]) * J[0]; dz = co[:, 2] - J[2]
    out = co.copy()
    out[:, 0] = np.sign(co[:, 0]) * J[0] + dx * np.cos(a) - dz * np.sin(a)
    out[:, 2] = J[2] + dx * np.sin(a) + dz * np.cos(a)
    return out

# ---------- which skin each garment covers ----------
# Per avatar vertex: is there fabric just outside it (or the skin pokes out through it)? The browser hides skin that is
# covered by the look's garments (whole triangles only), so nothing pokes through and nothing else disappears.
def sleeve_angle(g, av, L, key):
    # The arm angle that puts the avatar's hands through this garment's cuffs: the cuffs are the sleeves' open ends
    # (loops of boundary edges, away from the torso, below the shoulder); the arm points from the shoulder joint to
    # them. No cuffs found (no sleeves, sleeves too short): None, the avatar keeps its pose.
    import bmesh
    bm = bmesh.new(); bm.from_mesh(g.data)
    parent = {}
    def root(i):
        while parent.setdefault(i, i) != i: parent[i] = parent[parent[i]]; i = parent[i]
        return i
    for e in bm.edges:
        if len(e.link_faces) == 1: parent[root(e.verts[0].index)] = root(e.verts[1].index)
    loops = {}
    for i in parent: loops.setdefault(root(i), []).append(i)
    co = np.array([v.co[:] for v in bm.verts]); bm.free()
    best = []
    for vs in loops.values():
        if len(vs) < 8: continue
        c = co[vs].mean(0); rad = np.linalg.norm(co[vs] - c, axis=1).mean()
        if abs(c[0]) > L['hip_half'] + 0.08 and L['crotch_z'] < c[2] < L['sh_z'] - 0.15 and rad < 0.13:
            d = math.hypot(abs(c[0]) - J[0], c[2] - J[2])
            if d > 0.3: best.append((d, math.degrees(math.atan2(abs(c[0]) - J[0], J[2] - c[2])), (abs(c[0]), c[1], c[2])))
    if not best and key not in ('evening_dress', 'red_dress'):
        # closed (modelled) cuffs: the sleeve's end is the fabric farthest from the shoulder, off the torso, above the crotch
        side = co[(np.abs(co[:, 0]) > L['hip_half'] + 0.08) & (co[:, 2] > L['crotch_z']) & (co[:, 2] < L['sh_z'] - 0.1)]
        if len(side) > 50:
            d = np.hypot(np.abs(side[:, 0]) - J[0], side[:, 2] - J[2])
            end = side[d >= np.percentile(d, 99)]
            if d.max() > 0.35:
                best = [(d.max(), math.degrees(math.atan2(np.abs(end[:, 0]).mean() - J[0], J[2] - end[:, 2].mean())), (np.abs(end[:, 0]).mean(), end[:, 1].mean(), end[:, 2].mean()))]
    if not best: print('  sleeves: none'); return None
    far = sorted(best, key=lambda b: b[0])[-2:]   # the two farthest loops: both cuffs
    angle = sum(b[1] for b in far) / len(far)
    CUFF[key] = far[-1][0]; CUFF_PT[key] = np.mean([b[2] for b in far], 0)
    # fine-tune around it: the angle (within 10 degrees) at which most of the arm has the sleeve just around it
    from mathutils.bvhtree import BVHTree
    tree = BVHTree.FromObject(g, bpy.context.evaluated_depsgraph_get())
    arm = np.where((W > 0.95) & (REST[:, 2] > L['H'] * 0.47))[0][::3]
    scores = []
    for a in np.arange(angle - 10, angle + 10.1, 2):
        posed = pose(REST, J, W, BASE, a)
        av.data.vertices.foreach_set('co', posed.ravel()); av.data.update()
        vs = av.data.vertices
        hit = sum(1 for i in arm if tree.ray_cast(vs[i].co + vs[i].normal * 0.001, vs[i].normal, 0.08)[0] is not None)
        scores.append((hit / len(arm), -abs(a - angle), a))
    av.data.vertices.foreach_set('co', REST.ravel()); av.data.update()
    cover, _, best_a = max(scores)
    print(f'  sleeves: cuffs at {angle:.0f} deg, arm best at {best_a:.0f} ({cover:.0%} in the sleeve; avatar {BASE:.0f})')
    return round(float(max(8, best_a)), 1)   # arms never hang into the hips

def coverage(g, av, reach, co, head=False, arm=None, cuff=None):
    from mathutils.bvhtree import BVHTree
    dg = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(g, dg)
    av.data.vertices.foreach_set('co', co.ravel()); av.data.update()   # the avatar as it is posed for this garment
    bits = bytearray((len(av.data.vertices) + 7) // 8)
    for v in av.data.vertices:
        p, n = v.co, v.normal
        if not head and REST[v.index, 2] > L['neck_z'] + 0.02: continue   # a hood frames the face, it doesn't hide it
        # fabric just outside the skin, or the skin poking out through it (up to 7 cm)
        hit = tree.ray_cast(p + n * 0.001, n, reach)[0] is not None or tree.ray_cast(p + n * 0.02, -n, 0.09)[0] is not None
        if not hit and arm is not None and cuff and W[v.index] > 0.9:
            # a sleeve longer than the arm: the hand is inside it
            a = math.radians(arm); t = (abs(p.x) - J[0]) * math.sin(a) - (p.z - J[2]) * math.cos(a)
            hit = t < cuff - 0.03
        if hit: bits[v.index >> 3] |= 1 << (v.index & 7)
    av.data.vertices.foreach_set('co', REST.ravel()); av.data.update()
    return base64.b64encode(bytes(bits)).decode()

for gender in ('female', 'male'):
    out_dir = os.path.join(G, gender); os.makedirs(out_dir, exist_ok=True)
    clear()
    av = load(os.path.join(MODELS, 'avatars', f'{gender}.glb')); av.name = 'avatar'
    L = landmarks(av)
    LEGS = avatar_legs(av, L)
    REST = np.array([v.co[:] for v in av.data.vertices])
    J, W = arm_rig(av, L); BASE = math.degrees(L['arm_angle'])
    # three.js coordinates: (x, z, -y)
    json.dump({'joint': [J[0], J[2], -J[1]], 'angle': BASE, 'w': base64.b64encode(np.round(W * 255).astype(np.uint8).tobytes()).decode()},
              open(os.path.join(MODELS, 'avatars', f'{gender}-arms.json'), 'w'))
    cover_file = os.path.join(out_dir, 'cover.json'); CUFF = {}; CUFF_PT = {}
    PROXIES = []
    for pk in ('cargo_jeans', 'baggy_jeans'):   # stand-ins for the widest trousers: coats are draped over them
        px = load(os.path.join(G, cat[pk]['file'])); px.name = 'proxy_' + pk
        fit_bottom(px, L, pk); narrow_legs(px, L, 0.10 if pk == 'cargo_jeans' else 0.115, 0.115 if pk == 'cargo_jeans' else 0.13); align_legs(px, L, LEGS, None)
        px.hide_render = True; PROXIES.append(px)
    COVER = json.load(open(cover_file)) if os.path.exists(cover_file) else {}
    print('LANDMARKS', gender, {k: (round(v, 3) if isinstance(v, float) else v) for k, v in L.items() if k not in ('foot', 'hand')})
    for key, info in cat.items():
        if ONLY and key not in ONLY: continue
        g = load(os.path.join(G, info['file'])); g.name = key
        slot = info['slot']; arm = None
        if key in MIRROR: mirror_good_half(g)
        if slot in ('top', 'outer', 'dress', 'suit'): fit_top(g, L, key)
        elif slot == 'bottom': fit_bottom(g, L, key)
        if key == 'hoodie': cut_hood(g, L)
        if key in ('cargo_jeans', 'baggy_jeans'): narrow_legs(g, L, 0.10 if key == 'cargo_jeans' else 0.115, 0.115 if key == 'cargo_jeans' else 0.13)
        if key in ('suit', 'cargo_jeans', 'baggy_jeans'): align_legs(g, L, LEGS, None)
        elif slot == 'shoes': fit_shoes(g, L, info.get('pair'))
        elif slot == 'hat': fit_hat(g, L)
        elif slot == 'bag': fit_bag(g, L)
        if slot in ('top', 'outer', 'dress', 'bottom'): refine(g)
        if slot in ('top', 'outer', 'dress'): fill_holes(g, L, L['knee_z'] if slot == 'outer' else None)   # a coat's skirt has holes too
        if slot == 'outer': drape_over(g, PROXIES, L)
        if key == 'evening_dress': push_out(g, av, 0.004, lay_straps(g, L))
        if slot == 'bottom': push_out(g, av, 0.005)   # trousers and skirts sit on the hips
        if slot in ('top', 'outer', 'dress') and key != 'tshirt':
            arm = sleeve_angle(g, av, L, key)
            if arm and arm > 32:   # raised sleeves: lowered, and measured again
                turn_sleeves(g, L, arm, 28); arm = sleeve_angle(g, av, L, key)
            if arm and key in CUFF_PT: pitch_sleeves(g, key, arm)
        if slot in ('top', 'outer', 'dress', 'bottom', 'shoes', 'hat'):
            co = pose(REST, J, W, BASE, arm) if arm else REST
            COVER[key] = {'mask': coverage(g, av, {'outer': 0.25, 'dress': 0.25, 'hat': 0.02}.get(slot, 0.12), co, slot == 'hat', arm, CUFF.get(key)), 'arm': arm}   # a hat: only the scalp under it, not the face under the brim
        bpy.ops.object.select_all(action='DESELECT'); g.select_set(True); bpy.context.view_layer.objects.active = g
        bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, f'{key}.glb'), export_format='GLB', use_selection=True,
                                  export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6, export_image_format='JPEG', export_jpeg_quality=85)
        print('FITTED', gender, key)
        bpy.data.objects.remove(g)
    json.dump(COVER, open(cover_file, 'w'))
    json.dump({k: v for k, v in L.items() if k not in ('hand',)} | {'hand': list(L['hand'])}, open(os.path.join(out_dir, 'landmarks.json'), 'w'), indent=1, default=float)
