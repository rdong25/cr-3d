// MINIONS — a vicious little winged gargoyle-imp, one .glb reused for all three.
//
// ~1.0 units tall, flies. A hunched, muscular slate-blue body with a defined
// chest and ribcage, sinewy arms with three-clawed hands, digitigrade legs
// with talons, a barbed tail, swept-back horns, a snarling fanged jaw and
// small burning eyes. Big bat wings (arm bone + four finger struts + scalloped
// membrane) ride rigidly on wing_L / wing_R and carry a team-colored war band
// so the team reads from the top-down game camera.
// Follows the Ember Warden pipeline (see tools/hero/design.mjs).
// Y up, faces +Z, feet at y = 0. LEFT is +X.

import {
  sphere, ellipsoid, capsule, roundBox, torus, cylinder, halfspace, bezierTube,
  union, subtract, intersect, offset, band, place, euler, basis, norm, cross, node, fbm, noise3,
} from './sdf.mjs'

// ---------------------------------------------------------------------------
// Skeleton. Knight bones scaled ~0.6x, plus wing_L / wing_R off the chest.
// (Unchanged: the clips and the game depend on these names and positions.)
// ---------------------------------------------------------------------------
const P = {
  root: [0, 0, 0], hips: [0, 0.35, 0], spine: [0, 0.42, 0], chest: [0, 0.52, 0], neck: [0, 0.64, 0], head: [0, 0.70, 0],
}
export const BONES = [
  { name: 'root', parent: null, pos: P.root, tail: [0, 0.2, 0] },
  { name: 'hips', parent: 'root', pos: P.hips, tail: P.spine },
  { name: 'spine', parent: 'hips', pos: P.spine, tail: P.chest },
  { name: 'chest', parent: 'spine', pos: P.chest, tail: P.neck },
  { name: 'neck', parent: 'chest', pos: P.neck, tail: P.head },
  { name: 'head', parent: 'neck', pos: P.head, tail: [0, 0.92, 0] },
  { name: 'wing_L', parent: 'chest', pos: [0.13, 0.57, -0.09], tail: [0.38, 0.66, -0.28] },
  { name: 'wing_R', parent: 'chest', pos: [-0.13, 0.57, -0.09], tail: [-0.38, 0.66, -0.28] },
]
const LIMB = {}
for (const [side, s] of [['L', 1], ['R', -1]]) {
  const S = [s * 0.20, 0.60, 0], E = [s * 0.26, 0.47, 0.01], W = [s * 0.30, 0.36, 0.02], F = [s * 0.31, 0.30, 0.04]
  const Hp = [s * 0.09, 0.33, 0], K = [s * 0.10, 0.19, 0.01], A = [s * 0.10, 0.07, 0], T = [s * 0.10, 0.02, 0.09]
  LIMB[side] = { s, S, E, W, F, Hp, K, A, T }
  BONES.push(
    { name: `upperarm_${side}`, parent: 'chest', pos: S, tail: E },
    { name: `forearm_${side}`, parent: `upperarm_${side}`, pos: E, tail: W },
    { name: `hand_${side}`, parent: `forearm_${side}`, pos: W, tail: F },
    { name: `thigh_${side}`, parent: 'hips', pos: Hp, tail: K },
    { name: `shin_${side}`, parent: `thigh_${side}`, pos: K, tail: A },
    { name: `foot_${side}`, parent: `shin_${side}`, pos: A, tail: T },
  )
}
// Where the leg is SCULPTED (digitigrade Z shape), as opposed to where its
// bones are: knee pushed forward, hock (raised heel) pushed back, toe base.
for (const L of Object.values(LIMB)) {
  L.Kv = [L.s * 0.105, 0.195, 0.05]
  L.Hk = [L.s * 0.10, 0.108, -0.045]
  L.Tb = [L.s * 0.10, 0.042, 0.03]
}

// ---------------------------------------------------------------------------
// Palette (sRGB). Dark slate hide, bone, worn iron, one brass accent.
// ---------------------------------------------------------------------------
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
const C = {
  skin: hex(0x40557c), skinDark: hex(0x232c44), belly: hex(0x8e98ab), bruise: hex(0x3d3d68),
  membrane: hex(0x383246), membraneThin: hex(0x5a4552), vein: hex(0x93565f), membraneEdge: hex(0x211e2b),
  bone: hex(0xd2c5a3), boneDark: hex(0x3a2e25), scar: hex(0x9a8f97), maw: hex(0x3a1014),
  iron: hex(0x3e434b), steel: hex(0x8a93a1), brass: hex(0xc8943a), brassDeep: hex(0x9a6a22),
  leather: hex(0x4d3220), leatherDark: hex(0x2c1b12), ember: hex(0xffb04a),
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k]
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t) }
const flat = (c) => () => c
/** Hammered metal: soft low-frequency dents plus fine grain. */
const hammered = (c, k = 1) => (x, y, z) => shade(c, k * (0.84 + 0.14 * fbm(x * 36, y * 36, z * 36, 3) + 0.06 * noise3(x * 200, y * 200, z * 200)))
const grain = (c, amt = 0.08, freq = 60) => (x, y, z) => shade(c, 1 - amt / 2 + amt * fbm(x * freq, y * freq, z * freq, 3))

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k]
const lerp3 = (a, b, t) => add(a, scale(sub(b, a), t))
const segD = (p, a, b) => {
  const ab = sub(b, a), ap = sub(p, a)
  const t = clamp((ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1), 0, 1)
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t)
}

/** Ray-march along dir from `from` to find where a node's surface is. */
function surfacePoint(n, from, dir) {
  const d0 = norm(dir)
  let t = 0
  for (let i = 0; i < 200; i++) {
    const p = [from[0] + d0[0] * t, from[1] + d0[1] * t, from[2] + d0[2] * t]
    const d = n.d(p[0], p[1], p[2])
    if (Math.abs(d) < 1e-4) return p
    t += d * 0.8
  }
  return [from[0] + d0[0] * t, from[1] + d0[1] * t, from[2] + d0[2] * t]
}
/** Local frame whose Y axis points along `dir`, X roughly toward `hintX`. */
function frameY(dir, hintX = [1, 0, 0]) {
  const y = norm(dir)
  const z = norm(cross(hintX, y))
  const x = cross(y, z)
  return basis(x, y, z)
}
/** Mirror a node built on the +X (left) side to the -X (right) side. */
const mirrorX = (n) => node((x, y, z) => n.d(-x, y, z), [-n.max[0], n.min[1], n.min[2]], [-n.min[0], n.max[1], n.max[2]])
const sided = (n, s) => (s > 0 ? n : mirrorX(n))
/** An unbounded slab |dot(p - c, n)| < halfWidth — only use inside intersect. */
const slab = (c, n, hw) => { const [nx, ny, nz] = norm(n); return node((x, y, z) => Math.abs((x - c[0]) * nx + (y - c[1]) * ny + (z - c[2]) * nz) - hw, [-Infinity, -Infinity, -Infinity], [Infinity, Infinity, Infinity]) }

/**
 * Skin weights by distance to hand-placed guide segments (not the bone
 * segments): the sculpt is small, hunched and digitigrade, so the stock
 * envelope (bone segments, 2.8 cm falloff) smears neighbouring limbs together.
 * groups: [boneName, [[a, b], ...], radius]; radius ~ how fat the form is there.
 */
function skinBy(groups, soft = 0.017) {
  return {
    fn: (x, y, z) => {
      const p = [x, y, z]
      const ds = groups.map(([name, segs, r]) => [name, Math.min(...segs.map(([a, b]) => segD(p, a, b))) - r])
      const dmin = Math.min(...ds.map((d) => d[1]))
      const out = {}
      for (const [name, d] of ds) { const w = Math.exp(-(d - dmin) / soft); if (w > 0.03) out[name] = (out[name] || 0) + w }
      return out
    },
  }
}

// ---------------------------------------------------------------------------
// Pieces.
// ---------------------------------------------------------------------------
export const PIECES = []
const piece = (name, material, sdf, paint, skin, res) => PIECES.push({ name, material, sdf, paint, skin, res })

// ===========================================================================
// BODY — one continuous hide: hunched torso, neck, arms and digitigrade legs.
// ===========================================================================
// Torso core: a deep, wide ribcage tipped forward over a narrow waist.
const ribcage = ellipsoid([0, 0.54, 0.0], [0.168, 0.118, 0.12], euler(0.2, 0, 0))
const hump = ellipsoid([0, 0.605, -0.068], [0.152, 0.078, 0.094])
const waist = ellipsoid([0, 0.425, 0.012], [0.098, 0.078, 0.084])
const belly = ellipsoid([0, 0.445, 0.058], [0.07, 0.085, 0.05])
const pelvis = ellipsoid([0, 0.345, -0.005], [0.116, 0.066, 0.094])
const torsoParts = [ribcage, hump, waist, belly, pelvis]
for (const s of [1, -1]) {
  torsoParts.push(
    ellipsoid([s * 0.078, 0.558, 0.092], [0.088, 0.062, 0.05], euler(0.15, 0, s * 0.12)), // pec
    ellipsoid([s * 0.112, 0.5, -0.04], [0.068, 0.1, 0.08]), // lat
    ellipsoid([s * 0.118, 0.578, -0.082], [0.062, 0.052, 0.046]), // scapula mound the wing grows from
  )
}
const torsoCore = union(0.035, ...torsoParts)
// Torso + trapezius: what the harness straps wrap.
const traps = []
for (const s of [1, -1]) traps.push(capsule([s * 0.05, 0.632, -0.02], [s * 0.165, 0.612, -0.008], 0.036, 0.034))
const torsoWide = union(0.03, torsoCore, ...traps)
const NECK_A = [0, 0.61, -0.015], NECK_B = [0, 0.728, 0.062]
const neckShape = capsule(NECK_A, NECK_B, 0.075, 0.068)

const boneBits = [] // spurs and spikes that grow out of the hide, painted as bone
let bodySdf, hideSdf
{
  const parts = [torsoWide, neckShape]
  for (const { s, S, E, W, Hp, Kv, Hk, Tb } of Object.values(LIMB)) {
    // collarbone
    parts.push(capsule([s * 0.03, 0.627, 0.082], [s * 0.165, 0.632, 0.04], 0.014, 0.013))
    // arm: deltoid, upper arm with bicep / tricep, corded forearm
    const up = norm(sub(E, S)), fo = norm(sub(W, E))
    parts.push(ellipsoid(add(S, [s * 0.006, -0.008, 0]), [0.062, 0.066, 0.062], euler(0, 0, -s * 0.3)))
    parts.push(capsule(S, E, 0.047, 0.036))
    parts.push(ellipsoid(add(lerp3(S, E, 0.52), [0, 0, 0.02]), [0.036, 0.058, 0.038], frameY(up)))
    parts.push(ellipsoid(add(lerp3(S, E, 0.45), [s * 0.006, 0, -0.022]), [0.034, 0.055, 0.034], frameY(up)))
    parts.push(sphere(E, 0.038))
    parts.push(capsule(E, W, 0.04, 0.025))
    parts.push(ellipsoid(add(lerp3(E, W, 0.3), [s * 0.008, 0, 0.008]), [0.038, 0.058, 0.04], frameY(fo)))
    const spur = capsule(add(E, [0, 0.005, -0.028]), add(E, [s * 0.014, 0.03, -0.085]), 0.017, 0.003)
    boneBits.push(spur)
    // leg: heavy thigh, forward knee, backswept shin to a raised hock, long metatarsal
    parts.push(ellipsoid([s * 0.075, 0.335, -0.05], [0.064, 0.06, 0.06])) // glute
    parts.push(capsule(add(Hp, [s * 0.008, 0, 0]), Kv, 0.066, 0.041))
    const th = norm(sub(Kv, Hp))
    parts.push(ellipsoid(add(lerp3(Hp, Kv, 0.42), [s * 0.012, 0, 0.022]), [0.052, 0.075, 0.056], frameY(th)))
    parts.push(sphere(add(Kv, [0, 0, 0.006]), 0.04))
    parts.push(capsule(Kv, Hk, 0.039, 0.025))
    const sh = norm(sub(Hk, Kv))
    parts.push(ellipsoid(add(lerp3(Kv, Hk, 0.36), [0, 0, -0.02]), [0.032, 0.05, 0.034], frameY(sh)))
    parts.push(sphere(Hk, 0.029))
    parts.push(capsule(Hk, Tb, 0.024, 0.029))
    boneBits.push(capsule(add(Hk, [0, 0.004, -0.015]), add(Hk, [0, 0.034, -0.066]), 0.014, 0.003)) // hock spur
  }
  let b = union(0.028, ...parts)

  // Ribs: three raised cords on each flank, slanting down toward the front.
  const ribs = []
  for (const s of [1, -1]) {
    const region = roundBox([s * 0.128, 0.468, 0.035], [0.075, 0.075, 0.09], 0.03)
    for (let i = 0; i < 3; i++) {
      ribs.push(intersect(0.004, intersect(0.004, offset(torsoCore, 0.0065), slab([0, 0.512 - i * 0.031, 0], [0, 1, 0.42], 0.0072)), region))
    }
  }
  b = union(0.009, b, ...ribs)

  // Carved muscle definition: sternum, linea alba, two ab creases.
  const grooves = []
  const frontBox = (y0, y1, hw) => roundBox([0, (y0 + y1) / 2, 0.12], [hw, (y1 - y0) / 2, 0.1], 0.02)
  grooves.push(intersect(0.004, band(torsoCore, 0, 0.007, [0, 0, 0], [1, 0, 0], 0.0055), frontBox(0.495, 0.615, 0.03)))
  grooves.push(intersect(0.004, band(torsoCore, 0, 0.005, [0, 0, 0], [1, 0, 0], 0.0045), frontBox(0.375, 0.495, 0.03)))
  for (const gy of [0.462, 0.424]) grooves.push(intersect(0.004, band(torsoCore, 0, 0.005, [0, gy, 0], [0, 1, 0.25], 0.0045), frontBox(gy - 0.05, gy + 0.05, 0.062)))
  // Old claw scars raked across the left pec.
  for (let i = 0; i < 3; i++) {
    grooves.push(intersect(0.003, band(torsoCore, 0, 0.004, [0.05 + i * 0.024, 0.56, 0], [1, 0.55, 0], 0.0038), roundBox([0.085, 0.565, 0.12], [0.07, 0.036 - i * 0.004, 0.1], 0.02)))
  }
  b = subtract(0.006, b, union(0, ...grooves))

  // Spine: a row of bone spikes from the hump down to the tail root.
  const spineYs = [0.635, 0.595, 0.55, 0.505, 0.46, 0.415]
  spineYs.forEach((y, i) => {
    const p = surfacePoint(torsoCore, [0, y, -1], [0, 0, 1])
    const len = 0.062 - i * 0.006
    boneBits.push(capsule(add(p, [0, -0.004, 0.012]), add(p, [0, len * 0.55, -len]), 0.02 - i * 0.0015, 0.003))
  })
  hideSdf = b
  bodySdf = union(0.007, b, ...boneBits)
}
const boneSdf = union(0, ...boneBits)

const bodyGroups = [
  ['hips', [[[-0.07, 0.34, 0], [0.07, 0.34, 0]]], 0.075],
  ['spine', [[[0, 0.42, 0], [0, 0.465, 0]]], 0.085],
  ['chest', [[[-0.11, 0.565, -0.01], [0.11, 0.565, -0.01]], [[0, 0.52, 0], [0, 0.62, -0.03]]], 0.115],
  ['neck', [[[0, 0.655, 0.005], [0, 0.69, 0.035]]], 0.07],
  ['head', [[[0, 0.75, 0.06], [0, 0.82, 0.06]]], 0.075],
]
for (const [side, { S, E, W, Hp, Kv, Hk, Tb }] of Object.entries(LIMB)) {
  bodyGroups.push(
    [`upperarm_${side}`, [[S, E]], 0.045],
    [`forearm_${side}`, [[E, W]], 0.034],
    [`thigh_${side}`, [[Hp, Kv]], 0.052],
    [`shin_${side}`, [[Kv, Hk], [Hk, Tb]], 0.03],
  )
}
const bodySkin = skinBy(bodyGroups)

{
  const scarAt = (x, y, z) => {
    // pale scar tissue in the three chest grooves and one slash across the right thigh
    let k = 0
    if (z > 0.06 && y > 0.52 && y < 0.61) for (let i = 0; i < 3; i++) k = Math.max(k, sstep(0.007, 0.002, Math.abs((x - 0.05 - i * 0.024) + 0.55 * (y - 0.56)) / 1.14))
    k = Math.max(k, sstep(0.006, 0.002, segD([x, y, z], [-0.165, 0.3, 0.02], [-0.105, 0.245, 0.085])))
    k = Math.max(k, sstep(0.006, 0.002, segD([x, y, z], [0.29, 0.56, 0.02], [0.225, 0.5, 0.06])))
    return k
  }
  const bodyPaint = (x, y, z) => {
    const ax = Math.abs(x)
    // lighter underbelly: throat, chest, abdomen and inner thighs
    const under = sstep(0.0, 0.09, z) * sstep(0.2, 0.07, ax) * sstep(0.26, 0.34, y) * sstep(0.74, 0.62, y)
    let c = mix(C.skin, C.belly, under * 0.78)
    // darker along the back and on the extremities
    const dorsal = sstep(-0.01, -0.1, z) * sstep(0.3, 0.42, y) * sstep(0.26, 0.16, ax)
    c = mix(c, C.skinDark, 0.62 * dorsal)
    c = mix(c, C.skinDark, 0.5 * sstep(0.46, 0.36, y) * sstep(0.2, 0.26, ax)) // forearms
    c = mix(c, C.skinDark, 0.55 * sstep(0.2, 0.09, y)) // shins
    // broad mottling, bruised patches, fine pores
    const big = fbm(x * 10 + 3.1, y * 10, z * 10 + 7.7, 3)
    c = mix(c, C.bruise, 0.5 * sstep(0.55, 0.72, fbm(x * 17 + 9, y * 17 + 2, z * 17, 3)) * (1 - under))
    // dark blotches, and broken stripes across the back, shoulders and thighs
    c = mix(c, C.skinDark, 0.5 * sstep(0.5, 0.64, fbm(x * 7 + 1.3, y * 7 + 4.1, z * 7 + 2.2, 2)) * (1 - under))
    const stripe = sstep(0.45, 0.85, Math.sin(y * 64 + 9 * fbm(x * 9, y * 5, z * 9, 2) + ax * 20))
    c = mix(c, C.skinDark, 0.5 * stripe * (1 - under) * Math.max(sstep(0.0, -0.08, z), sstep(0.15, 0.22, ax) * sstep(0.44, 0.5, y), sstep(0.34, 0.3, y) * sstep(0.2, 0.14, y) * sstep(0.1, 0.14, ax)))
    c = shade(c, 0.78 + 0.4 * big + 0.1 * fbm(x * 70, y * 70, z * 70, 2))
    c = mix(c, C.scar, 0.75 * scarAt(x, y, z))
    // bone spurs and spine spikes: dark at the root, pale at the point
    const bd = boneSdf.d(x, y, z)
    if (bd < 0.004) {
      const out = hideSdf.d(x, y, z) // how far this point stands proud of the hide
      c = mix(mix(C.boneDark, C.bone, sstep(0.0, 0.03, out)), c, sstep(0.0, 0.004, bd))
    }
    return c
  }
  piece('body', 'soft', bodySdf, bodyPaint, bodySkin, 0.0048)
}

// ===========================================================================
// HEAD — heavy brow, short snarling muzzle, underslung jaw, swept ears.
// Sculpted around the head joint, then pushed forward (HEAD_Z) so the skull
// hangs out in front of the chest: that is most of the hunch.
// ===========================================================================
const HEAD_Z = 0.03
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
const headPiece = (name, material, sdf, paint, res) =>
  piece(name, material, place(sdf, [0, 0, HEAD_Z], I3), (x, y, z) => paint(x, y, z - HEAD_Z), { rigid: { head: 1 } }, res)
const skull = ellipsoid([0, 0.79, 0.03], [0.115, 0.098, 0.13])
const crestBits = []
let headSdf
{
  const parts = [skull,
    ellipsoid([0, 0.746, 0.14], [0.062, 0.04, 0.064]), // muzzle
    capsule([0, 0.797, 0.145], [0, 0.762, 0.2], 0.023, 0.026), // nose bridge
    ellipsoid([0, 0.842, 0.07], [0.088, 0.045, 0.072]), // forehead boss between the horns
  ]
  for (const s of [1, -1]) {
    parts.push(capsule([s * 0.012, 0.795, 0.168], [s * 0.114, 0.834, 0.09], 0.034, 0.027)) // angry V brow ridge
    parts.push(ellipsoid([s * 0.088, 0.75, 0.088], [0.036, 0.028, 0.048])) // cheekbone
    parts.push(ellipsoid([s * 0.082, 0.714, 0.045], [0.03, 0.044, 0.044])) // jaw muscle
    parts.push(ellipsoid([s * 0.03, 0.728, 0.185], [0.03, 0.022, 0.024])) // curled upper lip over the fang
  }
  let h = union(0.02, ...parts)
  // Underslung lower jaw, dropped open at the front, with a chin spur.
  const jaw = union(0.012,
    ellipsoid([0, 0.678, 0.098], [0.065, 0.025, 0.084], euler(0.24, 0, 0)),
    ellipsoid([0, 0.66, 0.16], [0.04, 0.025, 0.03]))
  h = union(0.012, h, jaw)
  h = subtract(0.006, h, ellipsoid([0, 0.7, 0.155], [0.054, 0.0125, 0.064], euler(0.14, 0, 0))) // the mouth
  // Snarl wrinkles across the nose.
  for (const [y, z] of [[0.781, 0.172], [0.769, 0.19]]) h = subtract(0.004, h, capsule([-0.022, y - 0.004, z], [0.022, y - 0.004, z], 0.0048))
  for (const s of [1, -1]) {
    h = subtract(0.008, h, ellipsoid([s * 0.056, 0.776, 0.152], [0.027, 0.02, 0.026], euler(0, 0, s * 0.3))) // eye socket under the brow
    h = subtract(0.004, h, sphere([s * 0.02, 0.752, 0.207], 0.0085)) // nostril
    h = subtract(0.016, h, sphere([s * 0.128, 0.795, 0.04], 0.03)) // hollow temple behind the brow
    h = subtract(0.012, h, ellipsoid([s * 0.088, 0.722, 0.108], [0.02, 0.016, 0.03])) // sunken cheek under the cheekbone
    for (const [dy, r] of [[0.03, 0.0045], [0.046, 0.004]]) { // furrows stacked above the brow
      h = subtract(0.004, h, capsule([s * 0.022, 0.812 + dy, 0.158 - dy * 0.9], [s * 0.086, 0.838 + dy * 0.8, 0.116 - dy * 0.9], r))
    }
    // Long pointed ear swept back and out, cupped on its front face.
    let ear = capsule([s * 0.098, 0.772, 0.0], [s * 0.262, 0.848, -0.135], 0.04, 0.004)
    ear = intersect(0.006, ear, slab([s * 0.16, 0.8, -0.05], [-s * 0.35, 0.25, 1], 0.016))
    ear = subtract(0.006, ear, capsule([s * 0.118, 0.776, 0.012], [s * 0.235, 0.834, -0.092], 0.02, 0.003))
    h = union(0.012, h, ear)
  }
  h = subtract(0.004, h, sphere([-0.2, 0.842, -0.1], 0.017)) // a bite out of the right ear
  // Scar slashed through the left brow and cheek.
  h = subtract(0.003, h, capsule([0.03, 0.852, 0.14], [0.092, 0.738, 0.122], 0.006))
  // Low bony crest down the back of the skull.
  for (const [y, z, l] of [[0.885, -0.005, 0.032], [0.868, -0.06, 0.038], [0.83, -0.098, 0.034]]) {
    const p = surfacePoint(skull, [0, y + 0.3, z - 0.12], [0, -0.92, 0.38])
    crestBits.push(capsule(add(p, [0, -0.008, 0.008]), add(p, [0, l * 0.75, -l]), 0.016, 0.003))
  }
  crestBits.push(capsule([0, 0.656, 0.176], [0, 0.628, 0.202], 0.015, 0.003)) // chin spur
  for (const s of [1, -1]) crestBits.push(capsule([s * 0.096, 0.742, 0.1], [s * 0.132, 0.748, 0.07], 0.012, 0.003)) // cheek spurs
  headSdf = union(0.006, h, ...crestBits)
}
{
  const crestSdf = union(0, ...crestBits)
  const mawBox = ellipsoid([0, 0.7, 0.14], [0.054, 0.017, 0.075], euler(0.14, 0, 0))
  const headPaint = (x, y, z) => {
    const ax = Math.abs(x)
    let c = mix(C.skin, C.belly, 0.6 * sstep(0.682, 0.655, y) * sstep(0.02, 0.1, z)) // pale under the jaw
    c = mix(c, shade(C.skinDark, 0.6), 0.7 * sstep(0.02, 0.006, Math.abs(y - 0.704 + 0.14 * (z - 0.155))) * sstep(0.09, 0.13, z)) // dark lips
    c = mix(c, C.skinDark, 0.6 * sstep(0.83, 0.88, y) + 0.55 * sstep(0.02, -0.08, z) * sstep(0.12, 0.06, ax)) // dark crown and nape
    c = mix(c, C.skinDark, 0.7 * sstep(0.13, 0.2, ax)) // dark ear tips
    c = mix(c, shade(C.skinDark, 0.45), 0.9 * sstep(0.034, 0.014, Math.hypot(ax - 0.056, (y - 0.776) * 1.3)) * sstep(0.09, 0.13, z)) // pits of shadow around the eyes
    c = mix(c, shade(C.skinDark, 0.7), 0.6 * sstep(0.034, 0.012, Math.hypot(x, y - 0.756)) * sstep(0.175, 0.2, z)) // nose leather
    c = mix(c, C.skinDark, 0.45 * sstep(0.5, 0.64, fbm(x * 9 + 1.3, y * 9 + 4.1, z * 9 + 2.2, 2)) * sstep(0.72, 0.76, y))
    c = shade(c, 0.74 + 0.46 * fbm(x * 13 + 5, y * 13, z * 13, 3) + 0.12 * fbm(x * 80, y * 80, z * 80, 2))
    c = mix(c, C.scar, 0.8 * sstep(0.009, 0.003, segD([x, y, z], [0.03, 0.852, 0.145], [0.092, 0.738, 0.126])))
    if (mawBox.d(x, y, z) < 0.002) c = mix(C.maw, shade(C.maw, 0.45), sstep(0.17, 0.1, z))
    const bd = crestSdf.d(x, y, z)
    if (bd < 0.004) c = mix(mix(C.bone, C.boneDark, 0.3), c, sstep(0.0, 0.004, bd))
    return c
  }
  headPiece('head', 'soft', headSdf, headPaint, 0.004)

  // Teeth: two upper fangs, two lower tusks at the corners, a few small snaggle teeth.
  const teeth = []
  for (const s of [1, -1]) {
    teeth.push(capsule([s * 0.032, 0.716, 0.184], [s * 0.035, 0.681, 0.192], 0.0095, 0.002))
    teeth.push(capsule([s * 0.012, 0.712, 0.2], [s * 0.012, 0.698, 0.203], 0.0055, 0.002))
    teeth.push(capsule([s * 0.046, 0.69, 0.146], [s * 0.054, 0.73, 0.157], 0.01, 0.002))
    teeth.push(capsule([s * 0.02, 0.682, 0.176], [s * 0.02, 0.699, 0.18], 0.0055, 0.002))
  }
  headPiece('teeth', 'soft', union(0, ...teeth), (x, y, z) => shade(mix(C.bone, C.boneDark, 0.25 * sstep(0.02, 0.0, Math.abs(y - 0.704))), 0.9 + 0.2 * fbm(x * 90, y * 90, z * 90, 2)), 0.003)
}
for (const s of [1, -1]) {
  const sd = s > 0 ? 'L' : 'R'
  // Small burning eyes: narrow slanted slits set deep under the brow.
  headPiece(`eye_${sd}`, 'glow', ellipsoid([s * 0.056, 0.775, 0.134], [0.017, 0.0085, 0.011], euler(0, 0, s * 0.34)), flat(C.ember), 0.0025)
  // Horn: thick at the root, swept up, out and then back in a long curve.
  const horn = bezierTube([s * 0.066, 0.85, 0.05], [s * 0.135, 0.935, 0.07], [s * 0.19, 0.995, -0.06], [s * 0.15, 0.985, -0.215], 0.037, 0.005, 14)
  headPiece(`horn_${sd}`, 'soft', horn, (x, y, z) => {
    const t = horn.param(x, y, z)
    const ridge = 0.86 + 0.14 * Math.sin(t * 70) + 0.08 * fbm(x * 60, y * 60, z * 60, 2)
    return shade(mix(mix(C.boneDark, C.bone, sstep(0.0, 0.3, t)), C.boneDark, sstep(0.6, 1, t)), ridge)
  }, 0.0045)
}

// ===========================================================================
// HANDS — three long fingers ending in hooked claws, plus a thumb claw.
// Built hanging in the rest pose with the palm facing back, so that in the
// raised fighting stance the claws hook downward, ready to rake.
// ===========================================================================
for (const [side, { s, W, F }] of Object.entries(LIMB)) {
  const hd = norm(sub(F, W))
  const palmC = add(W, scale(hd, 0.034))
  const flesh = [roundBox(palmC, [0.034, 0.04, 0.023], 0.019, frameY(hd)), sphere(W, 0.028)]
  const claws = []
  for (const [i, fx] of [-1, 0, 1].entries()) {
    const base = add(add(W, scale(hd, 0.062)), [fx * 0.024, 0, 0.004])
    const splay = [fx * 0.012, 0, 0]
    const k1 = add(add(base, scale(hd, 0.036 + (i === 1 ? 0.006 : 0))), splay)
    flesh.push(capsule(base, k1, 0.0145, 0.012), sphere(base, 0.0165))
    const tip = add(k1, add(scale(hd, 0.05), [fx * 0.008, 0, -0.034]))
    claws.push(bezierTube(k1, add(k1, scale(hd, 0.026)), add(k1, add(scale(hd, 0.046), [0, 0, -0.012])), tip, 0.0115, 0.002, 5, 0.004))
  }
  // thumb on the body side
  const tb = add(palmC, [-s * 0.03, 0.006, -0.004]), tk = add(tb, [-s * 0.02, -0.024, -0.012])
  flesh.push(capsule(tb, tk, 0.014, 0.011))
  claws.push(capsule(tk, add(tk, [-s * 0.008, -0.026, -0.022]), 0.01, 0.002))
  const clawSdf = union(0, ...claws)
  const hand = union(0.006, union(0.01, ...flesh), clawSdf)
  piece(`hand_${side}`, 'soft', hand, (x, y, z) => {
    const skin = shade(mix(C.skinDark, C.skin, 0.3), 0.8 + 0.36 * fbm(x * 30, y * 30, z * 30, 3))
    const cd = clawSdf.d(x, y, z)
    if (cd > 0.004) return skin
    const along = (x - W[0]) * hd[0] + (y - W[1]) * hd[1] + (z - W[2]) * hd[2]
    return mix(mix(C.bone, C.boneDark, 0.75 * sstep(0.105, 0.16, along)), skin, sstep(0.0, 0.004, cd))
  }, { rigid: { [`hand_${side}`]: 1 } }, 0.004)
}

// ===========================================================================
// FEET — raptor feet: a pad, three splayed toes and a dewclaw, all taloned.
// ===========================================================================
for (const [side, { s }] of Object.entries(LIMB)) {
  const flesh = [ellipsoid([s * 0.1, 0.034, 0.042], [0.036, 0.027, 0.04])]
  const talons = []
  for (const a of [-0.42, 0, 0.42]) {
    const dx = Math.sin(a), dz = Math.cos(a)
    const t0 = [s * 0.1 + dx * 0.016, 0.03, 0.052 + dz * 0.012]
    const t1 = [s * 0.1 + dx * 0.058, 0.022, 0.052 + dz * 0.062]
    flesh.push(capsule(t0, t1, 0.0165, 0.0135), sphere(t1, 0.0155))
    talons.push(bezierTube(add(t1, [0, 0.004, 0]), add(t1, [dx * 0.02, 0.014, dz * 0.02]), add(t1, [dx * 0.042, 0.008, dz * 0.042]), [t1[0] + dx * 0.052, 0.004, t1[2] + dz * 0.052], 0.012, 0.002, 5, 0.004))
  }
  flesh.push(capsule([s * 0.1, 0.036, 0.02], [s * 0.1, 0.026, -0.012], 0.015, 0.012))
  talons.push(capsule([s * 0.1, 0.026, -0.012], [s * 0.1, 0.005, -0.046], 0.0105, 0.002))
  const talonSdf = union(0, ...talons)
  let foot = union(0.005, union(0.01, ...flesh), talonSdf)
  foot = intersect(0.003, foot, halfspace([0, 0.002, 0], [0, -1, 0]))
  piece(`foot_${side}`, 'soft', foot, (x, y, z) => {
    const skin = shade(C.skinDark, 0.85 + 0.36 * fbm(x * 30, y * 30, z * 30, 3))
    const td = talonSdf.d(x, y, z)
    if (td > 0.004) return skin
    return mix(mix(C.bone, C.boneDark, 0.7 * sstep(0.03, 0.004, y)), skin, sstep(0.0, 0.004, td))
  }, { rigid: { [`foot_${side}`]: 1 } }, 0.004)
}

// ===========================================================================
// TAIL — whip tail trailing back and down, ending in a flat barbed blade.
// (No tail bone in the rig: it rides rigidly on the hips.)
// ===========================================================================
{
  const p0 = [0, 0.338, -0.075], p1 = [0, 0.3, -0.22], p2 = [0.03, 0.17, -0.3], p3 = [0.015, 0.135, -0.42]
  const whip = bezierTube(p0, p1, p2, p3, 0.04, 0.011, 14)
  const e = norm(sub(p3, p2))
  const R = frameY(e)
  // arrowhead in its own frame: Y along the tail, X across, thin in Z
  let barb = roundBox([0, 0.05, 0], [0.052, 0.062, 0.0085], 0.006)
  barb = intersect(0.003, intersect(0.003, barb, halfspace([0, 0.108, 0], [1, 0.5, 0])), halfspace([0, 0.108, 0], [-1, 0.5, 0]))
  barb = subtract(0.004, barb, cylinder([0, -0.036, 0], 0.04, 0.05, 0, euler(Math.PI / 2, 0, 0)))
  barb = union(0.006, barb, capsule([0, -0.01, 0], [0, 0.085, 0], 0.012, 0.005)) // central rib
  const barbW = place(barb, p3, R)
  const dorsal = []
  for (const t of [0.22, 0.4, 0.58]) {
    const u = 1 - t
    const q = [0, 1, 2].map((i) => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i])
    const r = 0.04 - 0.029 * t
    dorsal.push(capsule(add(q, [0, r * 0.6, 0]), add(q, [0, r + 0.03, -0.022]), 0.011, 0.002))
  }
  const hardSdf = union(0, barbW, ...dorsal)
  piece('tail', 'soft', union(0.006, whip, hardSdf), (x, y, z) => {
    const t = whip.param(x, y, z)
    let c = shade(mix(C.skin, C.skinDark, 0.35 + 0.5 * t), 0.8 + 0.36 * fbm(x * 24, y * 24, z * 24, 3))
    c = shade(c, 0.9 + 0.1 * Math.sin(t * 90)) // faint segment rings
    const hd = hardSdf.d(x, y, z)
    if (hd < 0.004) c = mix(mix(C.boneDark, C.bone, sstep(-0.3, -0.42, z) * 0.8 + 0.2 * sstep(0.004, -0.004, hd)), c, sstep(0.0, 0.004, hd))
    return c
  }, { rigid: { hips: 1 } }, 0.0045)
}

// ===========================================================================
// WINGS — proper bat wings, rigid on wing_L / wing_R (which flap about Z).
// Laid out nearly flat in the rest pose so they read large from the top-down
// game camera: arm (shoulder -> elbow -> wrist), four finger struts fanning
// from the wrist, and a thin membrane with a scalloped trailing edge that
// sags a little between the struts.
// ===========================================================================
{
  // Top-down layout of the LEFT wing in (x, z). The right wing is mirrored.
  const R0 = [0.13, -0.09], EL = [0.29, -0.158], WR = [0.455, -0.005], RF = [0.135, -0.03]
  const TIPS = [[0.7, -0.125], [0.665, -0.335], [0.52, -0.475], [0.325, -0.495]]
  const BA = [0.132, -0.335]
  const OUTLINE = [RF, WR, ...TIPS, BA]
  const cen = [0.42, -0.24]
  const polygon = (px, pz) => {
    let d = Infinity, sgn = 1
    for (let i = 0, j = OUTLINE.length - 1; i < OUTLINE.length; j = i, i++) {
      const ex = OUTLINE[j][0] - OUTLINE[i][0], ez = OUTLINE[j][1] - OUTLINE[i][1]
      const wx = px - OUTLINE[i][0], wz = pz - OUTLINE[i][1]
      const t = clamp((wx * ex + wz * ez) / (ex * ex + ez * ez), 0, 1)
      const bx = wx - ex * t, bz = wz - ez * t
      d = Math.min(d, bx * bx + bz * bz)
      const c1 = pz >= OUTLINE[i][1], c2 = pz < OUTLINE[j][1], c3 = ex * wz > ez * wx
      if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) sgn = -sgn
    }
    return sgn * Math.sqrt(d)
  }
  // Scallops: a circle bitten out of each trailing edge between strut tips.
  const scallops = []
  const scallop = (a, b, depth) => {
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], L = Math.hypot(b[0] - a[0], b[1] - a[1])
    let n = [-(b[1] - a[1]) / L, (b[0] - a[0]) / L]
    if (n[0] * (m[0] - cen[0]) + n[1] * (m[1] - cen[1]) < 0) n = [-n[0], -n[1]]
    const r = (L * L / 4 + depth * depth) / (2 * depth)
    scallops.push([m[0] + n[0] * (r - depth), m[1] + n[1] * (r - depth), r])
  }
  scallop(RF, WR, 0.03)
  scallop(TIPS[0], TIPS[1], 0.05); scallop(TIPS[1], TIPS[2], 0.048); scallop(TIPS[2], TIPS[3], 0.042); scallop(TIPS[3], BA, 0.055)
  const outline = (px, pz) => {
    let d = polygon(px, pz)
    for (const [cx, cz, r] of scallops) d = Math.max(d, r - Math.hypot(px - cx, pz - cz))
    return d
  }
  const STRUTS = [[R0, EL], [EL, WR], ...TIPS.map((t) => [WR, t])]
  const seg2 = (px, pz, a, b) => {
    const ex = b[0] - a[0], ez = b[1] - a[1], wx = px - a[0], wz = pz - a[1]
    const t = clamp((wx * ex + wz * ez) / (ex * ex + ez * ez), 0, 1)
    return Math.hypot(wx - ex * t, wz - ez * t)
  }
  const strutDist = (px, pz) => { let d = Infinity; for (const [a, b] of STRUTS) d = Math.min(d, seg2(px, pz, a, b)); return d }
  // Height of the wing surface: rises a little from the shoulder, droops at the
  // tip and along the trailing edge.
  const baseY = (px, pz) => {
    const u = Math.max(0, px - 0.13), v = Math.max(0, -pz - 0.02)
    return 0.572 + 0.3 * u - 0.42 * u * u - 0.05 * v - 0.18 * v * v
  }
  const sheetY = (px, pz) => baseY(px, pz) - 0.034 * sstep(0.0, 0.09, strutDist(px, pz))
  const TH = 0.0058
  const sheet = (extraTh, d2of) => node((x, y, z) => {
    const d2 = d2of(x, z)
    const dy = Math.abs(y - sheetY(x, z)) - (TH + extraTh)
    return Math.min(Math.max(d2, dy), 0) + Math.hypot(Math.max(d2, 0), Math.max(dy, 0)) - 0.002
  }, [0.1, 0.44, -0.53], [0.73, 0.68, 0.04])
  // Team war band: an arc across the fingers, concentric with the wrist.
  const BAND_R = 0.25, BAND_HW = 0.034
  const bandD2 = (px, pz, hw) => {
    const dx = px - WR[0], dz = pz - WR[1]
    const ang = Math.atan2(-dz, dx) // 0 = straight out, grows toward the tail
    return Math.max(outline(px, pz) + 0.004, Math.abs(Math.hypot(dx, dz) - BAND_R) - hw, 0.5 - ang, ang - 2.12)
  }
  const p3 = (p, lift = 0) => [p[0], baseY(p[0], p[1]) + lift, p[1]]
  const bones = [
    capsule(p3(R0, 0.004), p3(EL, 0.01), 0.04, 0.028),
    capsule(p3(EL, 0.01), p3(WR, 0.008), 0.027, 0.02),
    sphere(p3(EL, 0.01), 0.032), sphere(p3(WR, 0.008), 0.026),
    ...TIPS.map((t, i) => capsule(p3(WR, 0.005), p3(t, 0.003), 0.0165 - i * 0.001, 0.006)),
  ]
  const boneNode = union(0.008, ...bones)
  // Thumb claw at the wrist and a small hook at each finger tip.
  const wr3 = p3(WR, 0.008)
  const clawBits = [bezierTube(wr3, add(wr3, [0.012, 0.012, 0.03]), add(wr3, [0.03, 0.024, 0.052]), add(wr3, [0.055, 0.016, 0.062]), 0.014, 0.002, 5, 0.004)]
  const clawNode = union(0, ...clawBits)
  const membrane = subtract(0.002, sheet(0, outline), sheet(0.01, (px, pz) => bandD2(px, pz, BAND_HW - 0.004)))
  const wingL = union(0.005, union(0.007, membrane, boneNode), clawNode)
  const bandL = sheet(0.0028, (px, pz) => bandD2(px, pz, BAND_HW))

  for (const [side, { s }] of Object.entries(LIMB)) {
    const wingPaint = (wx, y, z) => {
      const x = s * wx
      const bd = boneNode.d(x, y, z)
      const sd = strutDist(x, z)
      // membrane: dark near the struts, thinner and warmer in the open panels
      let m = mix(C.membrane, C.membraneThin, 0.75 * sstep(0.012, 0.075, sd))
      m = shade(m, 0.8 + 0.36 * fbm(x * 12 + 4, y * 12, z * 12 + 1, 3))
      // veins: thin ridged-noise branches, plus creases radiating from the wrist
      const ridge = Math.abs(fbm(x * 15 + 1.7, 2.3, z * 15 + 5.1, 3) - 0.5)
      m = mix(m, C.vein, 0.9 * sstep(0.015, 0.004, ridge) * sstep(0.01, 0.04, sd))
      const fine = Math.abs(fbm(x * 36 + 8.2, 6.1, z * 36 + 0.4, 2) - 0.5)
      m = mix(m, C.vein, 0.5 * sstep(0.014, 0.004, fine) * sstep(0.01, 0.04, sd))
      const ang = Math.atan2(-(z - WR[1]), x - WR[0])
      m = shade(m, 0.93 + 0.07 * Math.sin(ang * 46))
      m = mix(m, C.membraneEdge, 0.8 * sstep(-0.03, -0.004, outline(x, z))) // dark, thick hem
      // arm and fingers: hide colour, paler knuckles
      const limb = shade(mix(C.skinDark, C.skin, 0.55), 0.8 + 0.36 * fbm(x * 30, y * 30, z * 30, 3))
      let c = mix(limb, m, sstep(0.001, 0.008, bd))
      const cd = clawNode.d(x, y, z)
      if (cd < 0.004) c = mix(mix(C.boneDark, C.bone, sstep(0.0, 0.05, z)), c, sstep(0.0, 0.004, cd))
      return c
    }
    piece(`wing_${side}`, 'soft', sided(wingL, s), wingPaint, { rigid: { [`wing_${side}`]: 1 } }, 0.0046)
    piece(`wing_band_${side}`, 'team', sided(bandL, s), (wx, y, z) => {
      const x = s * wx
      const r = Math.abs(Math.hypot(x - WR[0], z - WR[1]) - BAND_R)
      let k = 0.95 - 0.12 * fbm(x * 30, y * 30, z * 30, 3)
      if (r > BAND_HW - 0.009) k *= 0.42 // dark border
      k *= 1 - 0.45 * sstep(0.014, 0.004, strutDist(x, z)) // worn through over the finger bones
      return [k, k, k]
    }, { rigid: { [`wing_${side}`]: 1 } }, 0.0046)
  }
}

// ===========================================================================
// GEAR — spiked iron collar, crossed leather harness with an ember stone,
// iron bracers, belt and a ragged team-colored loincloth.
// ===========================================================================
// ---- Spiked collar, tipped forward along the hunched neck ----
{
  const axis = norm(sub(NECK_B, NECK_A))
  const c = [0, 0.668, 0.012]
  const R = frameY(axis)
  const ring = subtract(0.003, cylinder([0, 0, 0], 0.099, 0.021, 0.007), cylinder([0, 0, 0], 0.08, 0.06, 0))
  const spikes = [], studs = []
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) / 8 * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a)
    spikes.push(capsule([ca * 0.09, 0, sa * 0.09], [ca * 0.152, 0.012, sa * 0.152], 0.0145, 0.002))
    const b = i / 8 * Math.PI * 2
    studs.push(sphere([Math.cos(b) * 0.099, 0, Math.sin(b) * 0.099], 0.0085))
  }
  const spikeSdf = place(union(0, ...spikes), c, R), studSdf = place(union(0, ...studs), c, R)
  const iron = hammered(C.iron, 1.05)
  piece('collar', 'metal', union(0.004, place(ring, c, R), spikeSdf, studSdf), (x, y, z) => {
    if (studSdf.d(x, y, z) < 0.002) return C.brass
    const q = sub([x, y, z], c)
    return mix(iron(x, y, z), C.steel, sstep(0.105, 0.15, Math.hypot(q[0], q[1], q[2])) * (spikeSdf.d(x, y, z) < 0.003 ? 1 : 0))
  }, { rigid: { neck: 1 } }, 0.0045)
}

// ---- Crossed harness straps over the shoulders, ember stone where they meet ----
{
  const strap = (sg) => band(torsoWide, 0.0055, 0.0052, [0, 0.548, 0], [sg, 1.15, 0], 0.0145)
  const straps = union(0.003, strap(1), strap(-1))
  piece('harness', 'soft', straps, (x, y, z) => {
    const e = Math.min(Math.abs(x + 1.15 * (y - 0.548)), Math.abs(-x + 1.15 * (y - 0.548))) / 1.524
    const c = mix(C.leather, C.leatherDark, sstep(0.008, 0.013, e))
    return shade(c, 0.8 + 0.4 * fbm(x * 50, y * 50, z * 50, 3))
  }, bodySkin, 0.0045)
  const front = surfacePoint(union(0, torsoWide, straps), [0, 0.548, 1], [0, 0, -1])
  const toZ = euler(Math.PI / 2, 0, 0)
  const setting = union(0.004, torus(add(front, [0, 0, 0.006]), 0.026, 0.0085, toZ), cylinder(add(front, [0, 0, 0.001]), 0.026, 0.006, 0.002, toZ))
  const rivets = []
  for (const [dx, dy] of [[0.045, 0.039], [-0.045, 0.039], [0.045, -0.039], [-0.045, -0.039]]) {
    rivets.push(sphere(surfacePoint(union(0, torsoWide, straps), [dx, 0.548 + dy, 1], [0, 0, -1]), 0.008))
  }
  for (const sg of [1, -1]) rivets.push(sphere(surfacePoint(union(0, torsoWide, straps), [sg * 0.085, 0.461, -1], [0, 0, 1]), 0.008))
  piece('harness_brass', 'metal', union(0, setting, ...rivets), (x, y, z) => shade(mix(C.brassDeep, C.brass, fbm(x * 60, y * 60, z * 60, 2)), 1.05), { rigid: { chest: 1 } }, 0.004)
  piece('ember_stone', 'glow', ellipsoid(add(front, [0, 0, 0.008]), [0.018, 0.021, 0.011]), (x, y, z) => mix(C.ember, [1, 0.95, 0.75], sstep(front[1] + 0.004, front[1] + 0.016, y)), { rigid: { chest: 1 } }, 0.003)
}

// ---- Iron bracers with back-swept spikes ----
for (const [side, { s, E, W }] of Object.entries(LIMB)) {
  const dir = norm(sub(W, E))
  const a = lerp3(E, W, 0.46), b = lerp3(E, W, 0.92)
  let shell = capsule(a, b, 0.047, 0.037)
  shell = intersect(0.003, intersect(0.003, shell, halfspace(a, scale(dir, -1))), halfspace(b, dir))
  const R = frameY(dir)
  const rims = union(0, torus(add(a, scale(dir, 0.004)), 0.046, 0.0075, R), torus(sub(b, scale(dir, 0.004)), 0.0365, 0.007, R))
  const spikes = [], studs = []
  for (const t of [0.56, 0.69, 0.82]) {
    const q = lerp3(E, W, t), rr = 0.047 - (t - 0.46) * 0.022
    spikes.push(capsule(add(q, [s * rr * 0.7, 0, -rr * 0.55]), add(q, [s * (rr + 0.042), 0.02, -rr - 0.012]), 0.012, 0.002))
    studs.push(sphere(add(q, [s * rr * 0.55, 0, rr * 0.84]), 0.0075))
  }
  const spikeSdf = union(0, ...spikes), studSdf = union(0, ...studs)
  const iron = hammered(C.iron, 1.08)
  piece(`bracer_${side}`, 'metal', union(0.004, shell, rims, spikeSdf, studSdf), (x, y, z) => {
    if (studSdf.d(x, y, z) < 0.002) return C.brass
    if (spikeSdf.d(x, y, z) < 0.002) return mix(iron(x, y, z), C.steel, 0.7)
    return iron(x, y, z)
  }, { rigid: { [`forearm_${side}`]: 1 } }, 0.0045)
}

// ---- One battered iron pauldron on the left shoulder ----
{
  const { S } = LIMB.L
  const c = add(S, [0.014, 0.03, -0.004]), R = euler(0, 0, -0.5)
  const dome = ellipsoid(c, [0.084, 0.062, 0.082], R)
  let shell = subtract(0.006, dome, ellipsoid(add(c, [-0.012, -0.03, 0]), [0.076, 0.062, 0.074], R))
  shell = subtract(0.005, shell, sphere(add(c, [0.07, -0.035, 0.07]), 0.03)) // a chunk bitten out of the rim
  const rim = band(dome, 0.003, 0.0045, add(c, [0.02, -0.022, 0]), [-0.48, 0.88, 0], 0.008)
  const spikes = []
  for (const [dx, dz, l] of [[0.03, 0.03, 0.05], [0.045, -0.03, 0.056], [-0.012, -0.004, 0.044]]) {
    const dir = norm([dx * 8 + 0.25, 1, dz * 6])
    const p = surfacePoint(dome, add(c, scale(dir, 0.3)), scale(dir, -1))
    spikes.push(capsule(sub(p, scale(dir, 0.008)), add(p, scale(dir, l)), 0.0145, 0.002))
  }
  const spikeSdf = union(0, ...spikes)
  const iron = hammered(C.iron, 1.1)
  piece('pauldron', 'metal', union(0.004, shell, rim, spikeSdf), (x, y, z) => {
    if (rim.d(x, y, z) < 0.0015) return shade(C.brass, 0.85 + 0.25 * fbm(x * 70, y * 70, z * 70, 2))
    if (spikeSdf.d(x, y, z) < 0.002) return mix(iron(x, y, z), C.steel, 0.75)
    return iron(x, y, z)
  }, { rigid: { upperarm_L: 0.55, chest: 0.45 } }, 0.0045)
}

// ---- Broken shackles on the shins: it slipped its chains ----
for (const [side, { s, Kv, Hk }] of Object.entries(LIMB)) {
  const sh = norm(sub(Hk, Kv)), c = lerp3(Kv, Hk, 0.68)
  const cuff = place(subtract(0.002, cylinder([0, 0, 0], 0.04, 0.013, 0.004), cylinder([0, 0, 0], 0.025, 0.05, 0)), c, frameY(sh))
  const bits = [cuff, sphere(add(c, [s * 0.038, 0, 0.006]), 0.0095)]
  if (side === 'L') {
    const l0 = add(c, [0, -0.012, -0.05])
    bits.push(torus(l0, 0.014, 0.0052, euler(0, 0, Math.PI / 2)), torus(add(l0, [0, -0.023, -0.003]), 0.014, 0.0052, euler(Math.PI / 2, 0, 0)))
  }
  piece(`shackle_${side}`, 'metal', union(0.003, ...bits), hammered(C.iron, 1.15), { rigid: { [`shin_${side}`]: 1 } }, 0.004)
}

// ---- Belt, brass buckle and the ragged loincloth (team) ----
{
  piece('belt', 'soft', band(torsoCore, 0.0075, 0.0075, [0, 0.378, 0], [0, 1, 0.12], 0.017), (x, y, z) => {
    const c = mix(C.leather, C.leatherDark, sstep(0.01, 0.016, Math.abs(y + 0.12 * z - 0.378)))
    return shade(c, 0.8 + 0.4 * fbm(x * 50, y * 50, z * 50, 3))
  }, bodySkin, 0.0045)
  const front = surfacePoint(torsoCore, [0, 0.37, 1], [0, 0, -1])
  const toZ = euler(Math.PI / 2, 0, 0)
  const bc = add(front, [0, 0, 0.018])
  const buckle = union(0.004, cylinder(bc, 0.03, 0.007, 0.003, toZ), sphere(add(bc, [0, 0, 0.006]), 0.012))
  piece('buckle', 'metal', buckle, (x, y, z) => mix(C.brassDeep, C.brass, sstep(0.008, 0.02, Math.hypot(x - bc[0], y - bc[1]))), { rigid: { hips: 1 } }, 0.004)

  // Front flap: hangs between the thighs, cut to a ragged point.
  const zf = front[2] + 0.014
  let flap = roundBox([0, 0.272, zf + 0.014], [0.056, 0.1, 0.0075], 0.006, euler(-0.14, 0, 0))
  flap = intersect(0.004, intersect(0.004, flap, halfspace([0.012, 0.176, 0], [0.62, -1, 0])), halfspace([0.012, 0.176, 0], [-0.9, -1, 0]))
  flap = subtract(0.004, flap, sphere([-0.058, 0.262, zf + 0.012], 0.017))
  flap = subtract(0.004, flap, sphere([0.06, 0.305, zf + 0.008], 0.012))
  const clothPaint = (cx, hw, top, bottom) => (x, y, z) => {
    let k = 0.93 - 0.14 * fbm(x * 30, y * 80, z * 30, 3) - 0.05 * (0.5 + 0.5 * Math.sin(x * 160))
    k *= 0.72 + 0.28 * sstep(bottom, bottom + 0.09, y) // grimy toward the hem
    if (Math.abs(x - cx) > hw - 0.011 || y > top - 0.012) k *= 0.42 // dark border
    for (let i = -1; i <= 1; i++) if (Math.abs((x - cx - i * 0.017) * 0.9 + (y - (top + bottom) / 2 - 0.012) * 0.3) < 0.0042 && Math.abs(y - (top + bottom) / 2 - 0.012) < 0.032) k *= 0.42 // three claw strokes
    return [k, k, k]
  }
  piece('loincloth_front', 'team', flap, clothPaint(0, 0.056, 0.372, 0.176), { rigid: { hips: 1 } }, 0.004)
  // Two short tails of cloth at the back, either side of the tail root.
  for (const s of [1, -1]) {
    const back = surfacePoint(torsoCore, [s * 0.062, 0.37, -1], [0, 0, 1])
    let strip = roundBox([s * 0.066, 0.298, back[2] - 0.03], [0.03, 0.078, 0.007], 0.0055, euler(0.2, 0, s * 0.1))
    strip = intersect(0.004, strip, halfspace([s * 0.066, 0.228, 0], [s * 0.5, -1, 0]))
    piece(`loincloth_back_${s > 0 ? 'L' : 'R'}`, 'team', strip, clothPaint(s * 0.066, 0.034, 0.378, 0.225), { rigid: { hips: 1 } }, 0.004)
  }
}

// Bones that pieces may reference must exist.
const boneNames = new Set(BONES.map((b) => b.name))
for (const p of PIECES) {
  const refs = p.skin.rigid ? Object.keys(p.skin.rigid) : p.skin.envelope || []
  for (const r of refs) if (!boneNames.has(r)) throw new Error(`${p.name} references unknown bone ${r}`)
}
