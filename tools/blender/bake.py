# Step 2 of the Blender bake. Run headless:
#
#   Blender -b -P tools/blender/bake.py -- .cache/bake/hero [size=2048]
#
# Reads what export.mjs wrote, then:
#   1. builds the game mesh (low) and the dense sculpt (high) as Blender meshes
#   2. unwraps the game mesh into one UV atlas
#   3. gives the sculpt procedural "smart materials" (edge wear, cavity dirt, dents,
#      scratches, grain) driven by its paint, curvature and ray-traced occlusion
#   4. bakes sculpt -> game mesh with Cycles: normal map, base color, and a packed
#      occlusion / roughness / metalness map
#   5. writes uv.f32 (per triangle corner) and the three textures back to the folder
#
# Model coordinates are kept as they are (Y up); nothing here depends on Blender's Z-up.

import bpy, sys, os, json, math, time
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
WORK = os.path.abspath(argv[0])
SIZE = int(argv[1]) if len(argv) > 1 else 2048
meta = json.load(open(os.path.join(WORK, 'meta.json')))
t0 = time.time()
def log(msg): print(f'[bake {time.time() - t0:6.1f}s] {msg}', flush=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices: d.use = True
    scene.cycles.device = 'GPU'
except Exception as e:
    log(f'GPU not available ({e}); baking on CPU')
scene.cycles.samples = 24
scene.cycles.use_denoising = False


def load(name, dtype):
    return np.fromfile(os.path.join(WORK, name), dtype=dtype)


def make_object(name, pos, idx):
    me = bpy.data.meshes.new(name)
    nt = len(idx) // 3
    me.vertices.add(len(pos) // 3)
    me.vertices.foreach_set('co', pos)
    me.loops.add(nt * 3)
    me.loops.foreach_set('vertex_index', idx.astype(np.int32))
    me.polygons.add(nt)
    me.polygons.foreach_set('loop_start', np.arange(0, nt * 3, 3, dtype=np.int32))
    me.polygons.foreach_set('loop_total', np.full(nt, 3, dtype=np.int32))
    me.update(calc_edges=True)
    me.polygons.foreach_set('use_smooth', np.ones(nt, dtype=bool))
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


# --- 1. meshes -----------------------------------------------------------------------------
low = make_object('low', load('low.pos', np.float32), load('low.idx', np.uint32))
# The game shades with normals taken from the sculpt, not from the triangles. The normal map
# has to be baked against those same normals or it will not line up at runtime.
low.data.normals_split_custom_set_from_vertices(load('low.nrm', np.float32).reshape(-1, 3).tolist())
assert len(low.data.polygons) == meta['low']['triangles']

highs = []
for g in meta['groups']:
    ob = make_object('high_' + g['name'], load(f"high.{g['name']}.pos", np.float32), load(f"high.{g['name']}.idx", np.uint32))
    me = ob.data
    col = load(f"high.{g['name']}.col", np.float32).reshape(-1, 3)
    rgba = np.concatenate([col, np.ones((len(col), 1), dtype=np.float32)], axis=1)
    me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT').data.foreach_set('color', rgba.ravel())
    attr = load(f"high.{g['name']}.attr", np.float32).reshape(-1, 2)
    me.attributes.new('kind', 'FLOAT', 'POINT').data.foreach_set('value', np.ascontiguousarray(attr[:, 0]))
    me.attributes.new('curv', 'FLOAT', 'POINT').data.foreach_set('value', np.ascontiguousarray(attr[:, 1]))
    highs.append(ob)
log(f"meshes: low {meta['low']['triangles']:,} tris, high {sum(g['triangles'] for g in meta['groups']):,} tris")

# --- 2. UV atlas ---------------------------------------------------------------------------
bpy.context.view_layer.objects.active = low
low.select_set(True)
low.data.uv_layers.new(name='UVMap')
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(72), island_margin=0.0, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
bpy.ops.uv.select_all(action='SELECT')
bpy.ops.uv.pack_islands(rotate=True, margin_method='FRACTION', margin=6.0 / SIZE, shape_method='CONCAVE')
bpy.ops.object.mode_set(mode='OBJECT')
uv = np.zeros(len(low.data.loops) * 2, dtype=np.float32)
low.data.uv_layers.active.data.foreach_get('uv', uv)
order = np.zeros(len(low.data.loops), dtype=np.int32)
low.data.loops.foreach_get('vertex_index', order)
assert np.array_equal(order, load('low.idx', np.uint32).astype(np.int32)), 'Blender reordered the triangles'
uv.tofile(os.path.join(WORK, 'uv.f32'))
log(f'unwrapped: uv range {uv.min():.3f}..{uv.max():.3f}')


# --- 3. smart materials on the sculpt --------------------------------------------------------
mat = bpy.data.materials.new('Sculpt')
mat.use_nodes = True
nt = mat.node_tree
nodes, links = nt.nodes, nt.links
nodes.clear()


class F:
    """A float in the node graph: a socket or a constant, with arithmetic."""
    def __init__(self, x): self.x = x
    def to(self, sock):
        if isinstance(self.x, (int, float)): sock.default_value = self.x
        else: links.new(self.x, sock)
    def _m(self, op, *others, clamp=False):
        n = nodes.new('ShaderNodeMath'); n.operation = op; n.use_clamp = clamp
        for i, o in enumerate((self,) + others): f(o).to(n.inputs[i])
        return F(n.outputs[0])
    def __add__(self, o): return self._m('ADD', o)
    def __radd__(self, o): return f(o)._m('ADD', self)
    def __sub__(self, o): return self._m('SUBTRACT', o)
    def __rsub__(self, o): return f(o)._m('SUBTRACT', self)
    def __mul__(self, o): return self._m('MULTIPLY', o)
    def __rmul__(self, o): return f(o)._m('MULTIPLY', self)
    def __neg__(self): return f(0.0) - self
    def abs(self): return self._m('ABSOLUTE')
    def max(self, o): return self._m('MAXIMUM', o)
    def min(self, o): return self._m('MINIMUM', o)
    def sat(self): return self._m('ADD', 0.0, clamp=True)
    def pow(self, o): return self._m('POWER', o)


def f(x): return x if isinstance(x, F) else F(float(x))


def sstep(a, b, x):
    n = nodes.new('ShaderNodeMapRange'); n.interpolation_type = 'SMOOTHSTEP'
    f(x).to(n.inputs['Value']); f(a).to(n.inputs['From Min']); f(b).to(n.inputs['From Max'])
    return F(n.outputs[0])


def fmix(t, a, b):
    n = nodes.new('ShaderNodeMix'); n.data_type = 'FLOAT'
    f(t).to(n.inputs[0]); f(a).to(n.inputs[2]); f(b).to(n.inputs[3])
    return F(n.outputs[0])


class C:
    """A color in the node graph."""
    def __init__(self, x): self.x = x
    def to(self, sock):
        if isinstance(self.x, tuple): sock.default_value = (*self.x, 1.0)
        else: links.new(self.x, sock)
    def _blend(self, kind, t, o):
        n = nodes.new('ShaderNodeMix'); n.data_type = 'RGBA'; n.blend_type = kind; n.clamp_factor = True
        f(t).to(n.inputs[0]); self.to(n.inputs[6]); c(o).to(n.inputs[7])
        return C(n.outputs[2])
    def mix(self, t, o): return self._blend('MIX', t, o)
    def mul(self, o, t=1.0): return self._blend('MULTIPLY', t, o)
    def scale(self, k):
        n = nodes.new('ShaderNodeVectorMath'); n.operation = 'SCALE'
        self.to(n.inputs[0]); f(k).to(n.inputs['Scale'])
        return C(n.outputs[0])


def c(x): return x if isinstance(x, C) else C(tuple(x))


def attribute(name):
    n = nodes.new('ShaderNodeAttribute'); n.attribute_type = 'GEOMETRY'; n.attribute_name = name
    return n


coords = nodes.new('ShaderNodeTexCoord')
P = coords.outputs['Object']


def stretched(sx, sy, sz, rot=(0, 0, 0)):
    n = nodes.new('ShaderNodeMapping'); n.vector_type = 'POINT'
    links.new(P, n.inputs['Vector']); n.inputs['Scale'].default_value = (sx, sy, sz); n.inputs['Rotation'].default_value = rot
    return n.outputs[0]


def noise(scale, detail=4.0, rough=0.55, vec=None):
    n = nodes.new('ShaderNodeTexNoise'); n.noise_dimensions = '3D'
    links.new(vec or P, n.inputs['Vector'])
    n.inputs['Scale'].default_value = scale; n.inputs['Detail'].default_value = detail; n.inputs['Roughness'].default_value = rough
    return F(n.outputs[0])


def voronoi(scale, feature='F1', vec=None, smooth=0.6):
    n = nodes.new('ShaderNodeTexVoronoi'); n.voronoi_dimensions = '3D'; n.feature = feature
    links.new(vec or P, n.inputs['Vector']); n.inputs['Scale'].default_value = scale
    if feature == 'SMOOTH_F1': n.inputs['Smoothness'].default_value = smooth
    return F(n.outputs[0])


def occlusion(distance, samples=16):
    n = nodes.new('ShaderNodeAmbientOcclusion'); n.samples = samples; n.only_local = True
    n.inputs['Distance'].default_value = distance
    return F(n.outputs['AO'])


paint = C(attribute('Col').outputs['Color'])
kind = F(attribute('kind').outputs['Fac'])
curv = F(attribute('curv').outputs['Fac'])
sep = nodes.new('ShaderNodeSeparateXYZ'); links.new(P, sep.inputs[0])
height = F(sep.outputs['Y'])

KIND = dict(steel=0, gold=1, leather=2, cloth=3, mail=4, bone=5, painted=6, skin=7, wood=8)
def is_kind(name): return (1.0 - (kind - float(KIND[name])).abs() * 2.0).sat()

# Shared masks.
grunge = noise(7.0, 6.0, 0.62)              # big soft blotches
mottle = noise(34.0, 4.0, 0.6)              # medium variation
fine = noise(190.0, 3.0, 0.5)               # grit
ao_wide = occlusion(0.14)
ao_tight = occlusion(0.022)
convex = curv.sat()
concave = (-curv).sat()
# Wear follows convex edges, broken up so it reads as chipped rather than airbrushed.
edge = sstep(0.28, 0.75, convex * (0.55 + 0.9 * mottle) + 0.25 * convex * fine)
cavity = (concave * 0.8).max(1.0 - sstep(0.25, 0.95, ao_tight))
grime = (cavity * (0.6 + 0.8 * grunge)).sat()
# Directional scratches: thin lines from noise stretched hard along one axis, two directions.
scr_a = sstep(0.66, 0.72, noise(1.0, 2.0, 0.5, stretched(260, 9, 260, (0.3, 0.0, 0.5))))
scr_b = sstep(0.68, 0.73, noise(1.0, 2.0, 0.5, stretched(8, 240, 240, (0.0, 0.4, -0.3))))
scratch = (scr_a + scr_b).sat() * sstep(0.35, 0.7, grunge + 0.4 * convex)

surfaces = {}

# Steel: hammered, bright worn edges, dark oily grime in the creases, scattered scratches.
dents = voronoi(42.0, 'SMOOTH_F1', smooth=0.85)
planish = voronoi(15.0, 'SMOOTH_F1', smooth=1.0)   # the broad facets a hammer leaves
patina = sstep(0.42, 0.7, noise(11.0, 5.0, 0.6))    # warm heat-stain patches
rust = c((0.05, 0.043, 0.038)).mix(sstep(0.45, 0.7, grunge), (0.17, 0.085, 0.04))
steel_col = paint.scale(0.84 + 0.28 * grunge).mul((1.0, 0.9, 0.78), patina * 0.35).mix(scratch * 0.4, (0.72, 0.74, 0.78)).mix(edge * 0.8, (0.86, 0.88, 0.92)).mix(grime * 0.82, rust)
surfaces['steel'] = dict(
    color=steel_col,
    rough=fmix(grime, fmix(edge, 0.27 + 0.22 * mottle + 0.14 * scratch, 0.16), 0.8),
    metal=1.0 - 0.6 * grime,
    bump=dents * 0.002 + planish * 0.0035 + mottle * 0.0003 - scratch * 0.00035 + fine * 0.00008 - edge * fine * 0.0004)

# Gold trim: softer metal, so rounder wear; tarnish settles brown in the creases.
gold_col = paint.scale(0.88 + 0.2 * grunge).mix(edge * 0.6, (1.0, 0.88, 0.58)).mix(grime * 0.75, (0.11, 0.065, 0.025))
surfaces['gold'] = dict(
    color=gold_col,
    rough=fmix(grime, fmix(edge, 0.26 + 0.16 * mottle, 0.14), 0.68),
    metal=1.0 - 0.5 * grime,
    bump=dents * 0.0009 + mottle * 0.00035 + fine * 0.00006 - scratch * 0.0002)

# Leather: pebbled grain, scuffed pale on the edges, darker where hands and straps rub.
pebble = voronoi(330.0, 'DISTANCE_TO_EDGE')
crease = sstep(0.0, 0.07, voronoi(55.0, 'DISTANCE_TO_EDGE'))
leather_col = paint.scale(0.78 + 0.4 * grunge).mul((0.6, 0.55, 0.5), (1.0 - crease) * 0.6).mix(edge * 0.55, paint.scale(1.9).mix(0.35, (0.5, 0.4, 0.3))).mix(grime * 0.6, (0.035, 0.022, 0.014))
surfaces['leather'] = dict(
    color=leather_col,
    rough=fmix(edge, 0.56 + 0.2 * mottle, 0.78),
    metal=0.0,
    bump=sstep(0.0, 0.25, pebble) * 0.00022 + crease * 0.0004 + mottle * 0.0003)

# Cloth: soft wrinkles, sun-faded high points, dust and damp toward the hem.
wrinkle = noise(16.0, 3.0, 0.5, stretched(1.0, 0.35, 1.0))
weave = (noise(1.0, 0.0, 0.5, stretched(900, 40, 900)) + noise(1.0, 0.0, 0.5, stretched(40, 900, 40))) * 0.5
hem = 1.0 - sstep(0.28, 0.62, height + 0.12 * grunge)
cloth_col = paint.scale(0.8 + 0.3 * grunge).scale(0.9 + 0.2 * weave).mix(edge * 0.3, paint.scale(1.35)).scale(1.0 - 0.3 * hem * (0.5 + mottle)).scale(1.0 - 0.45 * grime)
surfaces['cloth'] = dict(
    color=cloth_col,
    rough=0.86 + 0.1 * mottle,
    metal=0.0,
    bump=wrinkle * 0.0016 + weave * 0.00016)

# Chain mail: rows of small rings, bright where they rub, dark between.
rings_d = voronoi(210.0, 'F1', stretched(1.0, 1.25, 1.0))
ring = 1.0 - sstep(0.0, 0.2, (rings_d - 0.34).abs())
mail_col = paint.scale(0.55 + 0.5 * grunge).mix(ring * 0.75, (0.5, 0.52, 0.56)).scale(1.0 - 0.5 * grime)
surfaces['mail'] = dict(
    color=mail_col,
    rough=fmix(ring, 0.7, 0.34),
    metal=fmix(ring, 0.35, 1.0),
    bump=ring * 0.0011)

# Horn and bone: growth rings along the length, polished tips, stained roots.
growth = noise(1.0, 3.0, 0.6, stretched(30, 260, 30, (0.0, 0.0, 0.5)))
bone_col = paint.scale(0.86 + 0.22 * growth).mix(edge * 0.3, paint.scale(1.25)).mix(grime * 0.7, (0.16, 0.1, 0.05))
surfaces['bone'] = dict(
    color=bone_col,
    rough=fmix(grime, 0.38 + 0.2 * growth, 0.8),
    metal=0.0,
    bump=growth * 0.0005 + fine * 0.00008)

# Painted wood (shield face): paint chipped off the rim and high spots, scored by blows.
chip = sstep(0.5, 0.62, mottle * 0.65 + edge * 0.6 + 0.3 * scratch)
gouge = sstep(0.71, 0.74, noise(1.0, 2.0, 0.5, stretched(150, 6, 150, (0.5, 0.2, 0.9))))
painted_col = paint.scale(0.84 + 0.28 * grunge).mix(chip * 0.85, paint.scale(0.36)).mix(gouge * 0.7, paint.scale(0.25)).scale(1.0 - 0.4 * grime)
surfaces['painted'] = dict(
    color=painted_col,
    rough=fmix(chip, 0.42 + 0.14 * mottle, 0.8),
    metal=0.0,
    bump=-chip * 0.00035 - gouge * 0.0007 + mottle * 0.00025)

# Skin and creature hide: fine wrinkle cells, soft lumps, sheen on the high points, dirt in folds.
hide = voronoi(260.0, 'DISTANCE_TO_EDGE')
lumps = noise(22.0, 3.0, 0.5)
surfaces['skin'] = dict(
    color=paint.scale(0.84 + 0.26 * grunge).mix(edge * 0.22, paint.scale(1.45)).mix(grime * 0.6, paint.scale(0.28)),
    rough=fmix(edge, 0.56 + 0.16 * mottle, 0.42),
    metal=0.0,
    bump=sstep(0.0, 0.22, hide) * 0.00024 + lumps * 0.0009 + mottle * 0.0003)

# Wood (gun stocks, bows, shafts): fine fibres and pores, oiled sheen worn matte at the edges.
fibre = noise(1.0, 3.0, 0.55, stretched(70, 600, 70)) * 0.5 + noise(1.0, 3.0, 0.55, stretched(600, 70, 70)) * 0.25 + noise(1.0, 3.0, 0.55, stretched(70, 70, 600)) * 0.25
pores = sstep(0.62, 0.7, noise(260.0, 2.0, 0.5))
surfaces['wood'] = dict(
    color=paint.scale(0.78 + 0.4 * fibre).scale(1.0 - 0.25 * pores).mix(edge * 0.4, paint.scale(1.4)).mix(grime * 0.6, paint.scale(0.3)),
    rough=fmix(edge, 0.5 + 0.2 * fibre, 0.7),
    metal=0.0,
    bump=fibre * 0.0005 - pores * 0.00015 + mottle * 0.0002)

color, rough, metal, bump = c((0.5, 0.5, 0.5)), f(0.5), f(0.0), f(0.0)
for name, s in surfaces.items():
    m = is_kind(name)
    color = color.mix(m, s['color'])
    rough = fmix(m, rough, s['rough'])
    metal = fmix(m, metal, s['metal'])
    bump = fmix(m, bump, s['bump'])

# A little of the wide occlusion and a top-down gradient go into the color itself, the way a
# hand-painted game texture carries its own soft shading. The rest stays in the AO map.
shade = (0.62 + 0.38 * ao_wide) * (0.86 + 0.2 * sstep(0.0, 1.7, height))
color = color.scale(shade)

bump_node = nodes.new('ShaderNodeBump')
bump_node.inputs['Strength'].default_value = 1.0
bump_node.inputs['Distance'].default_value = 1.0
bump.to(bump_node.inputs['Height'])
bsdf = nodes.new('ShaderNodeBsdfPrincipled')
links.new(bump_node.outputs[0], bsdf.inputs['Normal'])
emit_color = nodes.new('ShaderNodeEmission'); color.to(emit_color.inputs['Color'])
orm = nodes.new('ShaderNodeCombineXYZ')
sstep(0.0, 1.0, ao_wide).to(orm.inputs[0]); rough.sat().to(orm.inputs[1]); metal.sat().to(orm.inputs[2])
emit_orm = nodes.new('ShaderNodeEmission'); links.new(orm.outputs[0], emit_orm.inputs['Color'])
output = nodes.new('ShaderNodeOutputMaterial')
for ob in highs: ob.data.materials.append(mat)
log(f'smart materials: {len(nodes)} nodes')

# --- 4. bake -------------------------------------------------------------------------------
target = bpy.data.materials.new('Target')
target.use_nodes = True
tex = target.node_tree.nodes.new('ShaderNodeTexImage')
target.node_tree.nodes.active = tex
low.data.materials.append(target)

for ob in bpy.data.objects: ob.select_set(False)
for ob in highs: ob.select_set(True)
low.select_set(True)
bpy.context.view_layer.objects.active = low


def bake(name, kind, shader, colorspace):
    img = bpy.data.images.new(name, SIZE, SIZE, alpha=False, float_buffer=False)
    img.colorspace_settings.name = colorspace
    tex.image = img
    links.new(shader.outputs[0], output.inputs['Surface'])
    bpy.ops.object.bake(type=kind, use_selected_to_active=True, cage_extrusion=0.006, max_ray_distance=0.016,
                        margin=6, margin_type='EXTEND', use_clear=True, normal_space='TANGENT')
    img.filepath_raw = os.path.join(WORK, name + '.png')
    img.file_format = 'PNG'
    img.save()
    # Shipping copies: JPEG at the baked size and at half size (phones, small troops).
    img.file_format = 'JPEG'
    img.save(filepath=os.path.join(WORK, f'{name}.{SIZE}.jpg'), quality=86)
    img.scale(SIZE // 2, SIZE // 2)
    img.save(filepath=os.path.join(WORK, f'{name}.{SIZE // 2}.jpg'), quality=88)
    log(f'baked {name}')


bake('normal', 'NORMAL', bsdf, 'Non-Color')
bake('color', 'EMIT', emit_color, 'sRGB')
bake('orm', 'EMIT', emit_orm, 'Non-Color')
log('done')
