import argparse, io, json, math, struct, shutil
from pathlib import Path
from PIL import Image

parser = argparse.ArgumentParser(description='Convert the CC-BY MakeHuman hoodie OBJ into portable GLBs.')
parser.add_argument('--source', type=Path, default=Path(__file__).resolve().parent)
parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parent)
parser.add_argument('--include-original', action='store_true', help='Also export the original wider A-pose for inspection.')
args = parser.parse_args()
SOURCE, DEST = args.source, args.output
DEST.mkdir(parents=True, exist_ok=True)
vertices, uvs, faces = [], [], []
for line in (SOURCE/'ladieshoodiedown1.obj').read_text().splitlines():
    fields=line.split()
    if not fields: continue
    if fields[0]=='v': vertices.append(tuple(map(float, fields[1:4])))
    elif fields[0]=='vt': uvs.append(tuple(map(float, fields[1:3])))
    elif fields[0]=='f':
        face=[]
        for field in fields[1:]:
            values=field.split('/')
            face.append((int(values[0])-1,int(values[1])-1))
        faces.append(face)

parents = list(range(len(vertices)))
def find(index):
    while parents[index] != index:
        parents[index] = parents[parents[index]]
        index = parents[index]
    return index
for face in faces:
    for index, _ in face[1:]:
        parents[find(index)] = find(face[0][0])
components = {}
for index in range(len(vertices)):
    components.setdefault(find(index), []).append(index)
zipper_vertices = set()
for component in components.values():
    if len(component) == 132:
        zipper_vertices.update(component)

def smooth(x):
    x=max(0,min(1,x)); return x*x*(3-2*x)

def write_glb(relaxed=False):
    posed=[]
    for x,y,z in vertices:
        side=-1 if x<0 else 1
        if relaxed:
            influence=smooth((abs(x)-1.5)/1.3)*max(smooth((y-.4)/1.1),smooth((abs(x)-2.2)/.6))
            angle=-side*math.radians(28)*influence
            dx=x-side*1.7; dy=y-4.7
            x=side*1.7+math.cos(angle)*dx-math.sin(angle)*dy
            y=4.7+math.sin(angle)*dx+math.cos(angle)*dy
        posed.append((x,y,z))
    mins=[min(v[i] for v in posed) for i in range(3)]
    maxs=[max(v[i] for v in posed) for i in range(3)]
    center=[(a+b)/2 for a,b in zip(mins,maxs)]
    posed=[tuple((v[i]-center[i])*.1 for i in range(3)) for v in posed]
    source_normals=[[0,0,0] for _ in posed]
    triangles=[]
    for face in faces:
        for corner in range(1,len(face)-1):
            triangle=[face[0],face[corner],face[corner+1]]; triangles.append(triangle)
            a,b,c=[posed[item[0]] for item in triangle]
            u=[b[i]-a[i] for i in range(3)];v=[c[i]-a[i] for i in range(3)]
            normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]]
            for index,_ in triangle:
                for axis in range(3):source_normals[index][axis]+=normal[axis]
    for normal in source_normals:
        length=math.sqrt(sum(x*x for x in normal))
        if length:
            for axis in range(3):normal[axis]/=length
    positions,normals,texcoords,indices,zipper_indices=[],[],[],[],[]
    pairs={}
    for triangle in triangles:
        for pair in triangle:
            if pair not in pairs:
                pairs[pair]=len(pairs); vi,ti=pair
                positions.extend(posed[vi]);normals.extend(source_normals[vi]);texcoords.extend(uvs[ti])
            (zipper_indices if triangle[0][0] in zipper_vertices else indices).append(pairs[pair])
    binary=bytearray(); views=[]; accessors=[]
    def append(data,target=None):
        while len(binary)%4:binary.append(0)
        view={'buffer':0,'byteOffset':len(binary),'byteLength':len(data)}
        if target:view['target']=target
        views.append(view);binary.extend(data);return len(views)-1
    def accessor(values,size,component=5126,position=False):
        data=struct.pack('<'+('f' if component==5126 else 'H')*len(values),*values)
        a={'bufferView':append(data,34962 if component==5126 else 34963),'componentType':component,'count':len(values)//size,'type':{1:'SCALAR',2:'VEC2',3:'VEC3'}[size]}
        if position:
            a['min']=[min(values[i::size]) for i in range(size)];a['max']=[max(values[i::size]) for i in range(size)]
        accessors.append(a);return len(accessors)-1
    attributes={'POSITION':accessor(positions,3,position=True),'NORMAL':accessor(normals,3),'TEXCOORD_0':accessor(texcoords,2)}
    index_accessor=accessor(indices,1,5123)
    zipper_accessor=accessor(zipper_indices,1,5123)
    images=[]
    for name in ['hoodietex1.png','normalshoodie.png']:
        # Keep the authored UV tangent orientation. Reflect image rows instead
        # of V coordinates so the normal map's green direction stays correct.
        texture = Image.open(SOURCE/name).transpose(Image.Transpose.FLIP_TOP_BOTTOM)
        encoded_texture = io.BytesIO()
        texture.save(encoded_texture, format='PNG', optimize=True)
        images.append({'bufferView':append(encoded_texture.getvalue()),'mimeType':'image/png','name':name})
    gltf={
      'asset':{'version':'2.0','generator':'Local OBJ to glTF conversion','copyright':'Hooded Sweat Jacket by Elvaerwyn, CC BY 4.0'},
      'scene':0,'scenes':[{'nodes':[0,1]}],'nodes':[{'name':'fabric','mesh':0,'extras':{'role':'fabric'}},{'name':'zipper','mesh':1,'extras':{'role':'metal'}}],
      'meshes':[{'name':'fabric','primitives':[{'attributes':attributes,'indices':index_accessor,'material':0}]},{'name':'zipper','primitives':[{'attributes':attributes,'indices':zipper_accessor,'material':1}]}],
      'materials':[{'name':'Hoodie_Fabric','doubleSided':True,'pbrMetallicRoughness':{'baseColorTexture':{'index':0},'metallicFactor':0,'roughnessFactor':.92},'normalTexture':{'index':1,'scale':1.0}},{'name':'Zipper_Metal','pbrMetallicRoughness':{'baseColorFactor':[.28,.30,.32,1],'metallicFactor':.6,'roughnessFactor':.3}}],
      'samplers':[{'magFilter':9729,'minFilter':9987,'wrapS':10497,'wrapT':10497}],
      'textures':[{'sampler':0,'source':0},{'sampler':0,'source':1}],'images':images,
      'accessors':accessors,'bufferViews':views,'buffers':[{'byteLength':len(binary)}],
      'extras':{'author':'Elvaerwyn','license':'CC BY 4.0','licenseUrl':'https://creativecommons.org/licenses/by/4.0/','source':'https://static.makehumancommunity.org/assets/assetpacks/shirts02.html','changes':'Triangulated, centered, scaled, computed smooth normals, converted to GLB'+('; sleeves rotated into a relaxed presentation pose' if relaxed else '')},
    }
    while len(binary)%4:binary.append(0)
    encoded=json.dumps(gltf,separators=(',',':')).encode()
    while len(encoded)%4:encoded+=b' '
    output=struct.pack('<III',0x46546c67,2,12+8+len(encoded)+8+len(binary))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(binary),0x004e4942)+binary
    name='model.glb' if relaxed else 'hoodie-original.glb';(DEST/name).write_bytes(output)
    print(json.dumps({'file':str(DEST/name),'bytes':len(output),'vertices':len(pairs),'triangles':(len(indices)+len(zipper_indices))//3,'zipper_triangles':len(zipper_indices)//3,'bounds':accessors[0]}))

if args.include_original:
    write_glb()
write_glb(True)
for name in ['hoodietex1.png','normalshoodie.png','elvs_hooded_sweat_jacket1.thumb']:
    target=DEST/('preview.png' if name.endswith('.thumb') else name)
    if (SOURCE/name).exists() and (SOURCE/name).resolve() != target.resolve():
        shutil.copyfile(SOURCE/name,target)
