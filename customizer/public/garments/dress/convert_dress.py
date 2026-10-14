from pathlib import Path
from collections import defaultdict
import io, json, struct
import numpy as np
from PIL import Image

import argparse
parser = argparse.ArgumentParser(description='Convert the CC0 MakeHuman camisole dress OBJ to glTF.')
parser.add_argument('--source-dir', required=True, type=Path, help='Directory containing dress_camisole_full_skirt.obj')
parser.add_argument('--output-dir', default=Path(__file__).resolve().parent, type=Path)
args = parser.parse_args()
ROOT, DEST = args.source_dir, args.output_dir
DEST.mkdir(parents=True, exist_ok=True)
vertices, texcoords, faces = [], [], []
for line in (ROOT / 'dress_camisole_full_skirt.obj').read_text().splitlines():
    data = line.split()
    if not data: continue
    if data[0] == 'v': vertices.append([float(n) * 0.1 for n in data[1:4]])
    if data[0] == 'vt': texcoords.append([float(n) for n in data[1:3]])
    if data[0] == 'f': faces.append([(int(n.split('/')[0])-1, int(n.split('/')[1])-1) for n in data[1:]])
vertices, texcoords = np.asarray(vertices), np.asarray(texcoords)
parent = list(range(len(vertices)))
def find(i):
    while parent[i] != i:
        parent[i] = parent[parent[i]]
        i = parent[i]
    return i
for face in faces:
    for v, uv in face[1:]: parent[find(v)] = find(face[0][0])
components = defaultdict(list)
for face in faces: components[find(face[0][0])].append(face)
components = sorted(components.values(), key=len, reverse=True)

def subdivide(points, quads, uv):
    face_points = points[quads].mean(axis=1)
    face_uvs = uv.mean(axis=1)
    edge_faces, vertex_faces, vertex_edges = defaultdict(list), defaultdict(list), defaultdict(set)
    for fi, face in enumerate(quads):
        for ci, vertex in enumerate(face):
            following = face[(ci + 1) % 4]
            edge = tuple(sorted((int(vertex), int(following))))
            edge_faces[edge].append(fi)
            vertex_faces[vertex].append(fi)
            vertex_edges[vertex].add(edge)
            vertex_edges[following].add(edge)
    moved = points.copy()
    for vertex, adjacency in vertex_faces.items():
        edges = vertex_edges[vertex]
        boundary = [b if a == vertex else a for a, b in edges if len(edge_faces[(a, b)]) == 1]
        if len(boundary) == 2:
            moved[vertex] = points[vertex] * .75 + points[boundary].sum(axis=0) * .125
        elif not boundary:
            n = len(adjacency)
            mean_edges = np.asarray([(points[a] + points[b]) / 2 for a, b in edges]).mean(axis=0)
            moved[vertex] = (face_points[adjacency].mean(axis=0) + 2 * mean_edges + (n - 3) * points[vertex]) / n
    result_points = list(moved)
    edge_indices = {}
    for edge, linked in edge_faces.items():
        a, b = edge
        point = (points[a] + points[b] + face_points[linked].sum(axis=0)) / 4 if len(linked) == 2 else (points[a] + points[b]) / 2
        edge_indices[edge] = len(result_points)
        result_points.append(point)
    face_start = len(result_points)
    result_points.extend(face_points)
    result_faces, result_uvs = [], []
    for fi, face in enumerate(quads):
        for ci, vertex in enumerate(face):
            next_i, previous_i = (ci + 1) % 4, (ci - 1) % 4
            result_faces.append([vertex, edge_indices[tuple(sorted((int(vertex), int(face[next_i]))))],
                face_start + fi, edge_indices[tuple(sorted((int(vertex), int(face[previous_i]))))]])
            result_uvs.append([uv[fi, ci], (uv[fi, ci] + uv[fi, next_i]) / 2,
                face_uvs[fi], (uv[fi, previous_i] + uv[fi, ci]) / 2])
    return np.asarray(result_points), np.asarray(result_faces), np.asarray(result_uvs)

gltf = {'asset': {'version':'2.0','generator':'CC0 MakeHuman garment conversion; Catmull-Clark subdivision',
    'copyright':'Camisole Dress with Full Skirt — Margaret Toigo, CC0 1.0'},
    'scene':0,'scenes':[{'nodes':[]}], 'nodes':[], 'meshes':[], 'materials':[],
    'buffers':[{'byteLength':0}], 'bufferViews':[], 'accessors':[], 'images':[],
    'textures':[], 'samplers':[{'magFilter':9729,'minFilter':9987,'wrapS':10497,'wrapT':10497}]}
binary = bytearray()
def buffer_view(data, target=None):
    while len(binary) % 4: binary.append(0)
    index = len(gltf['bufferViews'])
    view = {'buffer':0,'byteOffset':len(binary),'byteLength':len(data)}
    if target: view['target'] = target
    gltf['bufferViews'].append(view)
    binary.extend(data)
    return index
def accessor(array, kind, component=5126, bounds=False):
    array = np.asarray(array, dtype='<f4' if component == 5126 else '<u4')
    entry = {'bufferView':buffer_view(array.tobytes(),34963 if component == 5125 else 34962),
        'componentType':component,'count':len(array),'type':kind}
    if bounds:
        entry['min'] = array.min(axis=0).tolist()
        entry['max'] = array.max(axis=0).tolist()
    gltf['accessors'].append(entry)
    return len(gltf['accessors'])-1

# Reuse the project's original shirt weave at a fine tile scale. This adds
# textile detail without borrowing the shirt's garment-specific AO atlas.
shirt_path = Path(__file__).resolve().parents[2] / 'shirt_baked.glb'
shirt_bytes = shirt_path.read_bytes()
json_length = struct.unpack_from('<I', shirt_bytes, 12)[0]
shirt_gltf = json.loads(shirt_bytes[20:20 + json_length])
shirt_binary_start = 20 + json_length + 8
normal_texture = shirt_gltf['materials'][0]['normalTexture']['index']
normal_image = shirt_gltf['textures'][normal_texture]['source']
normal_image_meta = shirt_gltf['images'][normal_image]
normal_view = shirt_gltf['bufferViews'][normal_image_meta['bufferView']]
normal_start = shirt_binary_start + normal_view.get('byteOffset', 0)
normal_bytes = shirt_bytes[normal_start:normal_start + normal_view['byteLength']]
gltf['images'].append({'bufferView':buffer_view(normal_bytes),
    'mimeType':normal_image_meta['mimeType'],'name':'original-shirt-weave'})
gltf['textures'].append({'sampler':0,'source':0})
gltf['extensionsUsed'] = ['KHR_texture_transform']

# The source print is decorative, not ambient occlusion: keep its UVs but
# leave the dress material neutral so recoloring never bakes that print in.
gltf['materials'].append({'name':'fabric','doubleSided':True,
    'pbrMetallicRoughness':{'baseColorFactor':[1,1,1,1],
        'metallicFactor':0,'roughnessFactor':.84},
    'normalTexture':{'index':0,'scale':.4,
        'extensions':{'KHR_texture_transform':{'scale':[8,8]}}},
    'extras':{'role':'fabric'}})

triangle_count = vertex_count = 0
for component_index, source_faces in enumerate(components):
    used = sorted({v for face in source_faces for v, uv in face})
    mapping = {v:i for i,v in enumerate(used)}
    points = vertices[used]
    quads = np.asarray([[mapping[v] for v, uv in face] for face in source_faces])
    uv = np.asarray([[texcoords[t] for v,t in face] for face in source_faces])
    for level in range(2): points, quads, uv = subdivide(points, quads, uv)
    triangles = np.concatenate([quads[:,[0,1,2]],quads[:,[0,2,3]]])
    cross = np.cross(points[triangles[:,1]] - points[triangles[:,0]],points[triangles[:,2]] - points[triangles[:,0]])
    normals = np.zeros_like(points)
    for corner in range(3): np.add.at(normals,triangles[:,corner],cross)
    normals /= np.maximum(np.linalg.norm(normals,axis=1,keepdims=True),1e-12)
    packed, packed_uv, packed_normals, indices, cache = [],[],[],[],{}
    for fi, quad in enumerate(quads):
        face_indices = []
        for ci,v in enumerate(quad):
            key = (int(v), *np.round(uv[fi,ci],7))
            if key not in cache:
                cache[key] = len(packed)
                packed.append(points[v]);packed_uv.append(uv[fi,ci]);packed_normals.append(normals[v])
            face_indices.append(cache[key])
        a,b,c,d = face_indices
        indices.extend([a,b,c,a,c,d])
    name,role = f'fabric_dress_{component_index}', 'fabric'
    material = 0
    primitive = {'attributes':{'POSITION':accessor(packed,'VEC3',bounds=True),
        'NORMAL':accessor(packed_normals,'VEC3'),'TEXCOORD_0':accessor(packed_uv,'VEC2')},
        'indices':accessor(indices,'SCALAR',5125),'material':material}
    mesh_index = len(gltf['meshes'])
    gltf['meshes'].append({'name':name,'primitives':[primitive]})
    gltf['nodes'].append({'name':name,'mesh':mesh_index,'extras':{'role':role}})
    gltf['scenes'][0]['nodes'].append(mesh_index)
    triangle_count += len(indices)//3; vertex_count += len(packed)
    print(name,role,len(packed),len(indices)//3)

gltf['buffers'][0]['byteLength'] = len(binary)
while len(binary)%4:binary.append(0)
metadata = json.dumps(gltf,separators=(',',':'),ensure_ascii=True).encode()
metadata += b' ' * ((-len(metadata)) % 4)
total = 12 + 8 + len(metadata) + 8 + len(binary)
glb = struct.pack('<III',0x46546C67,2,total)+struct.pack('<II',len(metadata),0x4E4F534A)+metadata+struct.pack('<II',len(binary),0x004E4942)+binary
(DEST/'model.glb').write_bytes(glb)
print(json.dumps({'meshes':len(components),'vertices':vertex_count,'triangles':triangle_count,'bytes':len(glb)}))
