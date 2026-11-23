// THE BOMBER — a hunched, skull-faced sapper who lobs iron bombs.
//
// Same 22-bone Knight skeleton and pipeline as the Ember Warden
// (tools/hero/design.mjs). Y up, faces +Z, feet at y = 0, ~1.6 units tall.
// LEFT is +X, RIGHT is -X. Bomb in the right hand, rigid to hand_R.
//
// Layering, inside out: wiry cloth body -> scorched leather jerkin -> sapper's
// apron (bib + hinged flap) -> belt, sash, crossed straps -> bandolier bombs,
// ember lamp, satchel, fuse coil -> ragged cloak (cape chain + shoulder mantle
// + hood) -> team scarf. The skull sits forward in the hood so the face reads.

import {
  sphere, ellipsoid, capsule, roundBox, torus, cylinder, halfspace, bezierTube,
  union, subtract, intersect, offset, band, place, euler, basis, norm, cross, node, fbm, noise3,
} from './sdf.mjs'
import { cappedCone, repeatAround } from '../hero/sdf.mjs'

// ---------------------------------------------------------------------------
// Skeleton — Knight BONES verbatim.
// ---------------------------------------------------------------------------
const P = {
  root: [0, 0, 0], hips: [0, 0.58, 0], spine: [0, 0.7, 0], chest: [0, 0.86, 0], neck: [0, 1.07, 0], head: [0, 1.17, 0],
}
export const BONES = [
  { name: 'root', parent: null, pos: P.root, tail: [0, 0.3, 0] },
  { name: 'hips', parent: 'root', pos: P.hips, tail: P.spine },
  { name: 'spine', parent: 'hips', pos: P.spine, tail: P.chest },
  { name: 'chest', parent: 'spine', pos: P.chest, tail: P.neck },
  { name: 'neck', parent: 'chest', pos: P.neck, tail: P.head },
  { name: 'head', parent: 'neck', pos: P.head, tail: [0, 1.5, 0] },
  { name: 'tabard_F', parent: 'hips', pos: [0, 0.63, 0.19], tail: [0, 0.34, 0.22] },
  { name: 'cape_1', parent: 'chest', pos: [0, 1.02, -0.22], tail: [0, 0.74, -0.27] },
  { name: 'cape_2', parent: 'cape_1', pos: [0, 0.74, -0.27], tail: [0, 0.47, -0.31] },
  { name: 'cape_3', parent: 'cape_2', pos: [0, 0.47, -0.31], tail: [0, 0.26, -0.35] },
]
const LIMB = {}
for (const [side, s] of [['L', 1], ['R', -1]]) {
  const S = [s * 0.33, 1.02, 0], E = [s * 0.44, 0.8, 0.01], W = [s * 0.5, 0.62, 0.03], F = [s * 0.52, 0.5, 0.05]
  const Hp = [s * 0.14, 0.55, 0], K = [s * 0.16, 0.32, 0.01], A = [s * 0.16, 0.11, 0], T = [s * 0.16, 0.03, 0.15]
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

// ---------------------------------------------------------------------------
// Palette (sRGB): weathered cloth, scorched leather, bone, dark iron, brass.
// ---------------------------------------------------------------------------
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
const C = {
  cloak: hex(0x343748), cloakDeep: hex(0x1b1c26), fray: hex(0x77736c),
  cloth: hex(0x2a2a31), patch: hex(0x5d5548),
  leather: hex(0x6b4528), leatherDark: hex(0x3c2616), apron: hex(0x7d5631), char: hex(0x17110d), thread: hex(0xc9b48a),
  bone: hex(0xe6dbbd), boneShadow: hex(0x8d7a50), boneDeep: hex(0x2c2119),
  linen: hex(0xa39478), linenDark: hex(0x5f5441), rope: hex(0x94805c), ropeDark: hex(0x574a36), cord: hex(0x6e6250), cordDark: hex(0x3a3229),
  iron: hex(0x6a6e78), castIron: hex(0x3a3c43), ironDark: hex(0x222328), rust: hex(0x6d4630), steel: hex(0x8a8f99),
  brass: hex(0xd29b3c), brassDeep: hex(0x9a6a22), ember: hex(0xffb04a), soot: hex(0x16130f),
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k]
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const flat = (c) => () => c
const fract = (v) => v - Math.floor(v)
/** Triangle wave 0..1 with period 1. */
const tri = (u) => Math.abs(fract(u) - 0.5) * 2
const grain = (c, amt = 0.08, freq = 60) => (x, y, z) => shade(c, 1 - amt / 2 + amt * fbm(x * freq, y * freq, z * freq, 3))
const hammered = (c, k = 1) => (x, y, z) => shade(c, k * (0.86 + 0.1 * fbm(x * 22, y * 22, z * 22, 3) + 0.06 * noise3(x * 140, y * 140, z * 140)))
/** Soot smudge mask 0..1: big soft blotches. */
const smudge = (x, y, z, f = 9, lo = 0.56, hi = 0.7) => sstep(lo, hi, fbm(x * f + 3.1, y * f + 7.7, z * f + 1.3, 3))
/** Scorched leather: mottled hide with charred burn marks ringed in dry brown. */
const leather = (c, burnAmt = 1) => (x, y, z) => {
  const n = fbm(x * 11, y * 11, z * 11, 2)
  let col = shade(c, 0.82 + 0.3 * n)
  const b = fbm(x * 10 + 5, y * 10 + 2, z * 10 + 9, 3)
  col = mix(col, shade(c, 0.55), sstep(0.54, 0.62, b) * burnAmt)
  return mix(col, C.char, sstep(0.61, 0.72, b) * 0.9 * burnAmt)
}
/** Aged bone: ivory with brown blotches and soot. */
const agedBone = (x, y, z) => {
  const blotch = fbm(x * 28, y * 28, z * 28, 3)
  const col = shade(mix(C.bone, C.boneShadow, sstep(0.52, 0.75, blotch) * 0.5), 0.92 + 0.1 * fbm(x * 90, y * 90, z * 90, 2))
  return mix(col, C.soot, smudge(x, y, z, 14, 0.6, 0.75) * 0.55)
}
/** Dark weathered cloth with vertical fold streaks and dusty smudges. */
const cloth = (c, k = 1) => (x, y, z) => {
  const streak = fbm(x * 13, y * 4, z * 13, 2)
  const col = shade(c, k * (0.84 + 0.26 * streak))
  return mix(col, C.fray, smudge(x, y, z, 6, 0.5, 0.8) * 0.2)
}
/** Rough cast iron (matte): dark grey, rust blooms, soot. */
const castIron = (x, y, z) => {
  let col = shade(C.castIron, 0.85 + 0.3 * fbm(x * 20, y * 20, z * 20, 2))
  col = mix(col, C.rust, sstep(0.56, 0.74, fbm(x * 24 + 4, y * 24, z * 24 + 8, 3)) * 0.45)
  return mix(col, C.ironDark, smudge(x, y, z, 15, 0.48, 0.7) * 0.7)
}
const teamCloth = (k0 = 0.92) => (x, y, z) => {
  const k = k0 - 0.16 * fbm(x * 14, y * 30, z * 14, 2)
  return [k, k, k]
}

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
function frameY(dir, hintX = [1, 0, 0]) {
  const y = norm(dir)
  const z = norm(cross(hintX, y))
  const x = cross(y, z)
  return basis(x, y, z)
}
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a) => Math.hypot(a[0], a[1], a[2])
const lerp3 = (a, b, t) => add(a, scale(sub(b, a), t))
/** SDF surface normal (for placing details that stand off a surface). */
function normalAt(n, p, e = 0.002) {
  return norm([
    n.d(p[0] + e, p[1], p[2]) - n.d(p[0] - e, p[1], p[2]),
    n.d(p[0], p[1] + e, p[2]) - n.d(p[0], p[1] - e, p[2]),
    n.d(p[0], p[1], p[2] + e) - n.d(p[0], p[1], p[2] - e),
  ])
}
/** Thin shell hugging `base` (lifted by `lift`), kept where region(x,y,z) < 0. */
function sheet(base, lift, half, region, mn, mx) {
  return node((x, y, z) => Math.max(Math.abs(base.d(x, y, z) - lift) - half, region(x, y, z)), mn, mx)
}
/** A limb wound in overlapping bandage: a tapered capsule with a spiral step. */
function wrapped(a, b, ra, rb, turns, depth) {
  const base = capsule(a, b, ra, rb)
  const ax = norm(sub(b, a)), L = len(sub(b, a))
  const r1 = norm(cross(ax, [0.3, 0.2, 1])), r2 = cross(ax, r1)
  const prof = (x, y, z) => {
    const q = [x - a[0], y - a[1], z - a[2]]
    const p = fract((dot(q, ax) / L) * turns + Math.atan2(dot(q, r2), dot(q, r1)) / (Math.PI * 2))
    return p < 0.82 ? p / 0.82 : (1 - p) / 0.18
  }
  const n = node((x, y, z) => base.d(x, y, z) - depth * prof(x, y, z), base.min.map((v) => v - depth), base.max.map((v) => v + depth))
  n.prof = prof
  return n
}
const wrapPaint = (w) => (x, y, z) => {
  const p = w.prof(x, y, z)
  const col = shade(C.linen, 0.85 + 0.2 * fbm(x * 20, y * 20, z * 20, 2))
  return mix(mix(col, C.linenDark, 0.6 * sstep(0.3, 0, Math.min(p, (1 - p) * 3))), C.soot, smudge(x, y, z, 10, 0.5, 0.8) * 0.4)
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------
export const PIECES = []
/** `opt.err` loosens the decimation error bound for big soft forms (default 2.2 mm). */
const piece = (name, material, sdf, paint, skin, res, opt = {}) => PIECES.push({ name, material, sdf, paint, skin, res, ...opt })

/** Torso layers all share these weights, so stacked layers never slide apart. */
const torsoW = (y) => {
  const a = sstep(0.63, 0.77, y), b = sstep(0.79, 0.93, y)
  return { hips: 1 - a, spine: a * (1 - b), chest: a * b }
}
const torsoSkin = { fn: (x, y, z) => torsoW(y) }

// ---- Wiry body: ribcage over a pinched waist, hunched upper back ----
const ribcage = ellipsoid([0, 0.9, 0], [0.215, 0.2, 0.155])
const yoke = capsule([-0.25, 1.01, -0.01], [0.25, 1.01, -0.01], 0.085)
const hump = ellipsoid([0, 1.02, -0.09], [0.19, 0.11, 0.11])
const waist = ellipsoid([0, 0.73, 0], [0.155, 0.13, 0.125])
const pelvis = ellipsoid([0, 0.6, 0], [0.18, 0.115, 0.145])
const torso = union(0.07, union(0.06, ribcage, yoke, hump), waist, pelvis)
{
  const parts = [torso, capsule([0, 1.05, 0], [0, 1.2, 0.04], 0.07, 0.065)]
  for (const { S, E, W, Hp, K, A } of Object.values(LIMB)) {
    parts.push(sphere(S, 0.078), capsule(S, E, 0.07, 0.06), capsule(E, W, 0.058, 0.05))
    parts.push(capsule(Hp, K, 0.097, 0.078), capsule(K, A, 0.066, 0.054))
  }
  piece('body', 'soft', union(0.05, ...parts), cloth(C.cloth),
    { envelope: ['hips', 'spine', 'chest', 'neck', 'upperarm_L', 'forearm_L', 'upperarm_R', 'forearm_R', 'thigh_L', 'shin_L', 'thigh_R', 'shin_R'] }, undefined, { err: 0.0035, ratio: 0.012 })
}

// ---- Scorched leather jerkin (sleeveless) ----
const jerkinBase = offset(torso, 0.018)
{
  let jerkin = intersect(0.012, jerkinBase, halfspace([0, 0.545, 0], [0, -1, 0]))
  jerkin = subtract(0.015, jerkin, cylinder([0, 1.14, 0.01], 0.1, 0.1, 0.02))
  for (const s of [1, -1]) jerkin = subtract(0.015, jerkin, sphere([s * 0.345, 1.02, 0], 0.1))
  piece('jerkin', 'soft', jerkin, leather(C.leather), torsoSkin, undefined, { err: 0.0032, ratio: 0.015 })
}

// ---- Sapper's apron: thick bib on the chest, heavy flap hinged at the belt ----
const bibSolid = (() => {
  let bib = intersect(0.008, offset(torso, 0.034), roundBox([0, 0.83, 0.16], [0.17, 0.2, 0.14], 0.03))
  for (const s of [1, -1]) bib = intersect(0.008, bib, halfspace([s * 0.078, 1.03, 0], [s, 0.22, 0]))
  return bib
})()
const strapBase = union(0.012, jerkinBase, bibSolid)
{
  const ap = leather(C.apron, 1.15)
  piece('apron_bib', 'soft', bibSolid, (x, y, z) => {
    const col = ap(x, y, z)
    const edge = (0.078 + 0.22 * (1.03 - y)) - Math.abs(x)
    const stitch = edge > 0.008 && edge < 0.014 && Math.sin(y * 420) > 0.1
    return stitch ? C.thread : col
  }, torsoSkin, 0.005)

  // Flap: built flat in its own frame, then tilted to hang off the belt.
  const R = euler(-0.1, 0, 0), c = [0, 0.455, 0.203]
  const local = (n) => place(n, c, R)
  let flap = roundBox([0, 0, 0], [0.152, 0.185, 0.011], 0.008)
  flap = intersect(0.004, flap, halfspace([0, -0.165, 0], [0.12, -1, 0])) // hem cut on a slant
  for (const s of [1, -1]) flap = intersect(0.004, flap, halfspace([s * 0.152, 0.185, 0], [s, 0.16, 0])) // flares toward the hem
  for (const [bx, by, br] of [[-0.09, -0.185, 0.036], [0.035, -0.19, 0.03], [0.14, -0.15, 0.04], [-0.165, -0.05, 0.022]]) {
    flap = subtract(0.004, flap, cylinder([bx, by, 0], br, 0.05, 0, euler(Math.PI / 2, 0, 0))) // burnt bites
  }
  const toLocal = (x, y, z) => { const q = [x - c[0], y - c[1], z - c[2]]; return [R[0] * q[0] + R[3] * q[1] + R[6] * q[2], R[1] * q[0] + R[4] * q[1] + R[7] * q[2], R[2] * q[0] + R[5] * q[1] + R[8] * q[2]] }
  piece('apron_flap', 'soft', local(flap), (x, y, z) => {
    const [lx, ly] = toLocal(x, y, z)
    let col = ap(x, y, z)
    col = mix(col, C.char, sstep(-0.09, -0.19, ly) * 0.8) // hem singed black
    const edge = 0.152 + 0.16 * (0.185 - ly) - Math.abs(lx)
    if (edge > 0.01 && edge < 0.016 && ly > -0.1 && Math.sin(ly * 420) > 0.1) col = C.thread
    return col
  }, { rigid: { tabard_F: 1 } }, 0.005)
  // Stitched patch and a tool pocket, raised off the flap.
  const patchR = euler(0, 0, 0.18)
  const patch = roundBox([0.07, -0.035, 0.011], [0.05, 0.043, 0.007], 0.005, patchR)
  piece('apron_patch', 'soft', local(patch), (x, y, z) => {
    const [lx, ly] = toLocal(x, y, z)
    const q = [lx - 0.07, ly + 0.035]
    const u = Math.cos(0.18) * q[0] + Math.sin(0.18) * q[1], v = -Math.sin(0.18) * q[0] + Math.cos(0.18) * q[1]
    const e = Math.min(0.05 - Math.abs(u), 0.043 - Math.abs(v))
    const dash = Math.sin((Math.abs(u) > Math.abs(v) + 0.007 ? v : u) * 380) > 0
    return e > 0.006 && e < 0.012 && dash ? C.thread : shade(C.patch, 0.85 + 0.3 * fbm(x * 40, y * 40, z * 40, 3))
  }, { rigid: { tabard_F: 1 } }, 0.004)
  const pocket = union(0.004, roundBox([-0.068, 0.045, 0.014], [0.052, 0.05, 0.012], 0.008), roundBox([-0.068, 0.085, 0.02], [0.057, 0.02, 0.01], 0.007))
  piece('apron_pocket', 'soft', local(pocket), leather(C.leatherDark, 0.4), { rigid: { tabard_F: 1 } }, 0.005)
  piece('apron_pocket_stud', 'metal', local(sphere([-0.068, 0.078, 0.034], 0.011)), flat(C.brass), { rigid: { tabard_F: 1 } }, 0.004)
}

// ---- Belt, buckle, team sash ----
{
  piece('belt', 'soft', band(strapBase, 0.009, 0.009, [0, 0.665, 0], [0, 1, 0], 0.027),
    (x, y, z) => shade(mix(C.leatherDark, C.leather, sstep(0.027, 0.012, Math.abs(y - 0.665)) * 0.5), 0.8 + 0.3 * fbm(x * 20, y * 20, z * 20, 2)), torsoSkin, undefined, { err: 0.003 })
  const front = surfacePoint(strapBase, [0, 0.665, 1], [0, 0, -1])
  const c = add(front, [0, 0, 0.022])
  const frame = subtract(0.004, roundBox(c, [0.05, 0.04, 0.013], 0.011), roundBox(c, [0.027, 0.019, 0.04], 0.007))
  piece('buckle', 'metal', union(0.005, frame, capsule(add(c, [-0.026, 0, 0.01]), add(c, [0.012, 0, 0.01]), 0.007)), hammered(C.brass, 1.05), { rigid: torsoW(0.665) }, 0.004)

  piece('sash', 'team', band(jerkinBase, 0.008, 0.009, [0, 0.607, 0], [0, 1, 0.12], 0.03), teamCloth(0.9), torsoSkin, undefined, { err: 0.003 })
  // Knot at the right hip with two torn tails that follow the thigh.
  const k = surfacePoint(jerkinBase, [-0.5, 0.612, 0.4], [0.75, 0, -0.66])
  const kn = norm([-0.75, 0, 0.66])
  const knot = ellipsoid(add(k, scale(kn, 0.012)), [0.038, 0.032, 0.03])
  const tails = []
  for (const [dx, drop, w] of [[-0.012, 0.2, 0.026], [0.03, 0.15, 0.022]]) {
    const top = add(k, scale(kn, 0.014)), bot = add(top, [dx * 2 - 0.02, -drop, 0.035])
    const mid = lerp3(top, bot, 0.5), dir = norm(sub(bot, top))
    let t = roundBox(mid, [w, drop / 2 + 0.01, 0.007], 0.005, frameY(dir, [kn[2], 0, -kn[0]]))
    t = subtract(0.003, t, sphere(add(bot, scale(dir, 0.016)), 0.02)) // torn, notched end
    tails.push(t)
  }
  piece('sash_knot', 'team', union(0.01, knot, ...tails), (x, y, z) => { const c0 = teamCloth(0.88)(x, y, z); return shade(c0, y < 0.47 ? 0.55 : 1) },
    { fn: (x, y, z) => { const w = 0.6 * sstep(0.6, 0.45, y); return { hips: 1 - w, thigh_R: w } } }, 0.005)
}

// ---- Crossed straps: bandolier (left shoulder -> right hip) over the satchel strap ----
const bandN = norm([0.679, -0.734, 0]), satchN = norm([-0.679, -0.734, 0]), strapO = [0, 0.9, 0]
{
  const strapPaint = (n, hw) => (x, y, z) => {
    const e = hw - Math.abs(dot(sub([x, y, z], strapO), n))
    const along = x * n[1] - y * n[0]
    const col = shade(C.leatherDark, 0.85 + 0.35 * fbm(x * 45, y * 45, z * 45, 3))
    return e > 0.004 && e < 0.009 && Math.sin(along * 400) > 0.1 ? shade(C.thread, 0.85) : col
  }
  piece('satchel_strap', 'soft', band(strapBase, 0.005, 0.005, strapO, satchN, 0.017), grain(C.leatherDark, 0.3, 30), torsoSkin, undefined, { err: 0.003 })
  piece('bandolier', 'soft', band(strapBase, 0.009, 0.009, strapO, bandN, 0.03), strapPaint(bandN, 0.03), torsoSkin, 0.0045, { err: 0.003 })

  // Small round bombs slung along the bandolier, each under a retaining loop.
  const along = norm([-0.734, -0.679, 0]) // strap direction on the chest, downhill
  const bombs = [], caps = [], fuses = [], loops = [], centers = []
  for (const t of [-0.108, 0.112, 0.214]) {
    const on = surfacePoint(strapBase, [along[0] * t, 0.9 + along[1] * t, 1], [0, 0, -1])
    const n = normalAt(strapBase, on)
    const c = add(on, scale(n, 0.04))
    const up = norm(add(scale(n, 0.55), [0.12 * Math.sign(t), 1, 0]))
    centers.push(c)
    bombs.push(sphere(c, 0.04))
    caps.push(union(0.003, cylinder(add(c, scale(up, 0.043)), 0.016, 0.01, 0.003, frameY(up)), torus(add(c, scale(up, 0.037)), 0.018, 0.005, frameY(up))))
    const f0 = add(c, scale(up, 0.05))
    fuses.push(capsule(f0, add(f0, add(scale(up, 0.022), [0.012 * Math.sign(t), 0, 0.008])), 0.0065, 0.0055))
    loops.push(torus(add(c, scale(n, -0.006)), 0.037, 0.0075, frameY(along, n)))
  }
  const nearest = (x, y, z) => { let b = centers[0], bd = Infinity; for (const c of centers) { const d = Math.hypot(x - c[0], y - c[1], z - c[2]); if (d < bd) { bd = d; b = c } } return torsoW(b[1]) }
  const skin = { fn: nearest }
  piece('belt_bombs', 'soft', union(0, ...bombs), castIron, skin, 0.0045)
  piece('belt_bomb_caps', 'metal', union(0, ...caps), flat(C.brass), skin, 0.003)
  piece('belt_bomb_fuses', 'soft', union(0, ...fuses), grain(C.cord, 0.3, 150), skin, 0.003)
  piece('belt_bomb_loops', 'soft', union(0, ...loops), grain(C.leatherDark, 0.3, 60), skin, 0.004)

  // Ember lamp where the straps cross: a slotted brass slow-match tin, coal glowing inside.
  const lp = surfacePoint(strapBase, [0, 0.905, 1], [0, 0, -1])
  const c = add(lp, [0, 0, 0.03])
  let cage = subtract(0.002, cylinder(c, 0.033, 0.038, 0.004), cylinder(c, 0.025, 0.05, 0))
  cage = subtract(0.002, cage, repeatAround(roundBox([c[0] + 0.03, c[1], c[2]], [0.014, 0.022, 0.0065], 0.004), 7, [c[0], c[2]], 0.224))
  const lamp = union(0.003, cage,
    cylinder(add(c, [0, -0.038, 0]), 0.036, 0.007, 0.003), cylinder(add(c, [0, 0.036, 0]), 0.036, 0.006, 0.003),
    cappedCone(add(c, [0, 0.053, 0]), 0.013, 0.031, 0.01), torus(add(c, [0, 0.074, -0.004]), 0.012, 0.0045, euler(0, 0, Math.PI / 2)),
    roundBox(add(c, [0, 0, -0.026]), [0.02, 0.03, 0.012], 0.004))
  const w = { rigid: torsoW(0.905) }
  piece('lamp', 'metal', lamp, hammered(C.brass, 0.95), w, 0.003)
  piece('lamp_coal', 'glow', cylinder(c, 0.027, 0.03, 0.004), flat(C.ember), w, 0.004)
}

// ---- Satchel on the left hip, fuse-cord coil on the right ----
{
  const c = [0.268, 0.55, 0.0]
  const body = roundBox(c, [0.046, 0.078, 0.09], 0.022)
  const flapS = union(0.004, roundBox(add(c, [0.012, 0.03, 0]), [0.042, 0.056, 0.096], 0.02))
  const flapCut = intersect(0.004, flapS, halfspace(add(c, [0.02, 0, 0]), [-1, 0, 0]))
  const bp = leather(C.leather, 0.7)
  piece('satchel', 'soft', body, (x, y, z) => shade(bp(x, y, z), 0.9), { rigid: { hips: 1 } })
  piece('satchel_flap', 'soft', flapCut, (x, y, z) => {
    const e = Math.min(0.096 - Math.abs(z), y - (c[1] - 0.026))
    return e > 0.008 && e < 0.014 && Math.sin((e === 0.096 - Math.abs(z) ? y : z) * 400) > 0.1 ? C.thread : leather(C.leatherDark, 0.5)(x, y, z)
  }, { rigid: { hips: 1 } }, 0.005)
  const bk = add(c, [0.056, -0.012, 0])
  piece('satchel_buckle', 'metal', union(0.003, roundBox(bk, [0.008, 0.022, 0.019], 0.006), roundBox(add(bk, [0, 0.03, 0]), [0.005, 0.02, 0.011], 0.004)), flat(C.brass), { rigid: { hips: 1 } }, 0.004)
  piece('satchel_hanger', 'soft', capsule([0.2, 0.7, 0], add(c, [-0.01, 0.07, 0]), 0.017, 0.02), grain(C.leatherDark, 0.3, 60), { rigid: torsoW(0.64) })

  // Coil of fuse cord hanging off the belt.
  const cc = [-0.262, 0.535, -0.015]
  const toX = euler(0, 0, Math.PI / 2)
  const rings = []
  for (let i = 0; i < 4; i++) rings.push(torus(add(cc, [-0.004 + (i % 2) * 0.008 - i * 0.004, (i % 2) * 0.006, i * 0.004 - 0.006]), 0.066 - (i % 2) * 0.006, 0.0125, euler(0.1 * (i - 1.5), 0.06 * (i % 2), Math.PI / 2)))
  void toX
  const tail = bezierTube(add(cc, [0, -0.064, 0.01]), add(cc, [0.01, -0.12, 0.03]), add(cc, [-0.02, -0.15, 0.02]), add(cc, [-0.01, -0.19, 0.045]), 0.011, 0.009, 8, 0.006)
  const coil = union(0.004, ...rings, tail)
  piece('fuse_coil', 'soft', coil, (x, y, z) => {
    const a = Math.atan2(y - cc[1], z - cc[2])
    const twist = 0.5 + 0.5 * Math.sin(a * 26 + x * 300)
    return mix(shade(mix(C.ropeDark, C.rope, twist), 0.85 + 0.25 * fbm(x * 60, y * 60, z * 60, 2)), C.soot, sstep(0.4, 0.34, y) * 0.8)
  }, { rigid: { hips: 1 } }, 0.004)
  piece('fuse_coil_tie', 'soft', union(0.004, capsule([-0.2, 0.675, -0.015], add(cc, [0.012, 0.068, 0]), 0.014, 0.012), torus(add(cc, [0.004, 0.066, 0]), 0.026, 0.009, euler(0, 0, 0))), grain(C.leatherDark, 0.3, 60), { rigid: { hips: 1 } }, 0.005)
}

// ---- Arms: torn sleeves, bandaged forearms, thick blast gloves ----
const BOMB_R = 0.105
const handFrame = {}
for (const [side, { s, S, E, W, F }] of Object.entries(LIMB)) {
  const up = norm(sub(E, S))
  // Sleeve: a looser layer over the upper arm with a torn hem above the elbow.
  const sl = capsule(add(S, scale(up, 0.05)), lerp3(S, E, 0.9), 0.081, 0.081)
  const r1 = norm(cross(up, [0, 0, 1])), r2 = cross(up, r1)
  const hemAt = (x, y, z) => { const q = sub([x, y, z], S); const a = Math.atan2(dot(q, r2), dot(q, r1)); return 0.185 + 0.045 * tri(a * 0.8 + 0.2 * s) + 0.02 * tri(a * 2.07 + 0.4) }
  const sleeve = node((x, y, z) => Math.max(sl.d(x, y, z), dot(sub([x, y, z], S), up) - hemAt(x, y, z)), sl.min, sl.max)
  const cp = cloth(C.cloak, 0.95)
  piece(`sleeve_${side}`, 'soft', sleeve, (x, y, z) => mix(cp(x, y, z), C.fray, sstep(0.03, 0, hemAt(x, y, z) - dot(sub([x, y, z], S), up)) * 0.6),
    { rigid: { [`upperarm_${side}`]: 1 } }, 0.0055)

  const dir = norm(sub(W, E))
  const wrap = wrapped(add(E, scale(dir, -0.01)), add(E, scale(dir, 0.12)), 0.066, 0.063, 3.2, 0.007)
  piece(`arm_wrap_${side}`, 'soft', wrap, wrapPaint(wrap), { fn: (x, y, z) => { const t = dot(sub([x, y, z], E), dir); const w = sstep(-0.04, 0.03, t); return { [`upperarm_${side}`]: 1 - w, [`forearm_${side}`]: w } } }, 0.0045)

  // Gauntlet cuff: flared, cut square at the open end, rolled rim, wrist strap.
  const cuffTop = add(W, scale(dir, -0.135))
  let cuff = capsule(add(W, scale(dir, -0.12)), add(W, scale(dir, 0.005)), 0.093, 0.068)
  cuff = intersect(0.006, cuff, halfspace(cuffTop, scale(dir, -1)))
  cuff = union(0.008, cuff, torus(add(cuffTop, scale(dir, 0.006)), 0.088, 0.011, frameY(dir)))
  const gl = leather(C.leather, 0.9)
  piece(`glove_cuff_${side}`, 'soft', cuff, (x, y, z) => {
    const t = dot(sub([x, y, z], cuffTop), dir)
    const col = mix(gl(x, y, z), C.char, sstep(0.05, 0.14, t) * 0.35)
    return t > 0.022 && t < 0.03 && Math.sin(Math.atan2(z - W[2], x - W[0]) * 26) > 0.1 ? C.thread : col
  }, { rigid: { [`forearm_${side}`]: 1 } }, 0.005)
  piece(`glove_strap_${side}`, 'soft', torus(add(W, scale(dir, -0.03)), 0.073, 0.012, frameY(dir)), grain(C.leatherDark, 0.3, 60), { rigid: { [`forearm_${side}`]: 1 } }, 0.005)
  const wristOut = add(add(W, scale(dir, -0.03)), [s * 0.079, 0, 0.012])
  piece(`glove_buckle_${side}`, 'metal', roundBox(wristOut, [0.008, 0.017, 0.017], 0.005, frameY(dir)), flat(C.brass), { rigid: { [`forearm_${side}`]: 1 } }, 0.004)

  // Mitt: a heavy padded fist with a thumb and a plated back.
  const hdir = norm(sub(F, W))
  const mittC = add(W, scale(hdir, 0.075))
  const HR = frameY(hdir)
  handFrame[side] = { mittC, hdir }
  const parts = [roundBox(mittC, [0.062, 0.076, 0.07], 0.045, HR)]
  if (side === 'L') {
    // Empty hand: curled fingers and a thumb.
    parts.push(capsule(add(mittC, [-s * 0.04, 0.02, 0.05]), add(mittC, [-s * 0.035, -0.04, 0.078]), 0.027, 0.022))
    for (let i = 0; i < 3; i++) {
      const fx = s * (0.04 - i * 0.04)
      parts.push(capsule(add(mittC, [fx, -0.045, 0.02]), add(mittC, [fx * 0.9, -0.085, 0.058]), 0.024, 0.02))
    }
  }
  const rigidH = { rigid: { [`hand_${side}`]: 1 } }
  const mp = leather(C.leather, 0.8)
  if (side === 'R') {
    // Bomb hand: palm behind the bomb, fingers hooked over the top, thumb underneath.
    const g = add(add(W, scale(hdir, 0.12)), [0, 0, 0.085])
    const u0 = norm(sub(mittC, g))
    const e1 = norm(sub([0, 1, 0], scale(u0, u0[1]))), e2 = cross(u0, e1)
    const on = (theta, phi, lift = 0.012) => {
      const v = add(scale(e1, Math.cos(phi)), scale(e2, Math.sin(phi)))
      return add(g, scale(add(scale(u0, Math.cos(theta)), scale(v, Math.sin(theta))), BOMB_R + lift))
    }
    for (const phi of [-0.95, -0.32, 0.32, 0.95]) {
      parts.push(capsule(on(0.35, phi * 0.7), on(0.8, phi), 0.027, 0.023), capsule(on(0.8, phi), on(1.2, phi * 1.05), 0.023, 0.019))
    }
    parts.push(capsule(on(0.4, 2.5), on(0.85, 2.7), 0.028, 0.024), capsule(on(0.85, 2.7), on(1.2, 2.8), 0.024, 0.02))
    handFrame.R.g = g
  }
  piece(`glove_${side}`, 'soft', union(0.014, ...parts), (x, y, z) => mix(mp(x, y, z), C.char, smudge(x, y, z, 16, 0.5, 0.68) * 0.55), rigidH, 0.005)
  // Riveted iron plate on the back of the hand.
  const backC = add(mittC, [s * 0.056, 0.012, -0.012])
  piece(`glove_plate_${side}`, 'metal', roundBox(backC, [0.014, 0.052, 0.05], 0.011, HR), hammered(C.iron, 1.05), rigidH, 0.0045)
  const studs = []
  for (const [dy, dz] of [[0.03, 0.028], [0.03, -0.028], [-0.03, 0.028], [-0.03, -0.028]]) studs.push(sphere(add(backC, [s * 0.013, dy, dz]), 0.0085))
  piece(`glove_studs_${side}`, 'metal', union(0, ...studs), flat(C.brass), rigidH, 0.003)
}

// ---- Team armband on the left sleeve ----
{
  const { S, E } = LIMB.L
  const up = norm(sub(E, S))
  const at = lerp3(S, E, 0.6)
  const arm = capsule(add(S, scale(up, 0.05)), lerp3(S, E, 0.9), 0.081, 0.081)
  const knotP = add(at, [0.087, 0, 0.02])
  const armband = union(0.008, band(arm, 0.006, 0.007, at, up, 0.03),
    ellipsoid(knotP, [0.022, 0.026, 0.024]),
    capsule(knotP, add(knotP, [0.03, -0.075, 0.012]), 0.014, 0.01), capsule(knotP, add(knotP, [0.012, -0.065, -0.03]), 0.013, 0.009))
  piece('armband', 'team', armband, teamCloth(0.95), { rigid: { upperarm_L: 1 } }, 0.005)
}

// ---- Legs: patched trousers, knee pads, bandaged shins, heavy boots ----
for (const [side, { s, Hp, K, A }] of Object.entries(LIMB)) {
  const thigh = capsule(Hp, K, 0.097, 0.078)
  const tp = intersect(0.004, offset(thigh, 0.007), roundBox([s * 0.2, 0.44, 0.06], [0.05, 0.052, 0.06], 0.012, euler(0, 0, s * 0.2)))
  piece(`thigh_patch_${side}`, 'soft', tp, (x, y, z) => {
    const q = [x - s * 0.2, y - 0.44]
    const v = -Math.sin(s * 0.2) * q[0] + Math.cos(s * 0.2) * q[1]
    return Math.abs(Math.abs(v) - 0.04) < 0.004 && Math.sin(z * 380) > 0 ? C.thread : shade(C.patch, 0.8 + 0.3 * fbm(x * 40, y * 40, z * 40, 3))
  }, { rigid: { [`thigh_${side}`]: 1 } }, 0.005)

  const kneeW = { rigid: { [`thigh_${side}`]: 0.4, [`shin_${side}`]: 0.6 } }
  const pad = union(0.012, ellipsoid(add(K, [0, 0.004, 0.058]), [0.066, 0.072, 0.042]), torus(add(K, [0, 0.0, 0.005]), 0.073, 0.012))
  piece(`kneepad_${side}`, 'soft', pad, leather(C.leatherDark, 0.6), kneeW, 0.0055)
  piece(`kneestud_${side}`, 'metal', sphere(add(K, [0, 0.004, 0.1]), 0.016), flat(C.brass), kneeW, 0.004)

  const wrap = wrapped(add(K, [0, -0.05, 0]), add(A, [0, 0.07, 0]), 0.073, 0.066, 3.2, 0.007)
  piece(`shin_wrap_${side}`, 'soft', wrap, wrapPaint(wrap), { rigid: { [`shin_${side}`]: 1 } }, 0.0045)

  // Boot: shaft with a folded cuff on the shin, foot with a thick sole and iron toe cap.
  const shaftTop = add(A, [0, 0.105, 0])
  let shaft = capsule(add(A, [0, 0.01, 0]), add(A, [0, 0.09, 0]), 0.075, 0.082)
  shaft = intersect(0.006, shaft, halfspace(shaftTop, [0, 1, 0]))
  shaft = union(0.008, shaft, torus(add(shaftTop, [0, -0.012, 0]), 0.08, 0.014))
  const bp = leather(C.leatherDark, 0.5)
  piece(`boot_shaft_${side}`, 'soft', shaft, (x, y, z) => shade(bp(x, y, z), 1.15), { rigid: { [`shin_${side}`]: 1 } })
  const footBase = union(0.03, roundBox([s * 0.16, 0.064, 0.04], [0.08, 0.064, 0.13], 0.05), ellipsoid([s * 0.16, 0.058, 0.15], [0.086, 0.058, 0.078]))
  const foot = intersect(0.006, footBase, halfspace([0, 0.003, 0], [0, -1, 0]))
  piece(`boot_${side}`, 'soft', foot, (x, y, z) => mix(shade(bp(x, y, z), 1.1), C.fray, sstep(0.07, 0.02, y) * 0.3), { rigid: { [`foot_${side}`]: 1 } })
  const slab = (lo, hi) => node((x, y, z) => Math.max(lo - y, y - hi), [-1, lo, -1], [1, hi, 1])
  piece(`boot_sole_${side}`, 'soft', intersect(0.003, offset(footBase, 0.008), slab(0.003, 0.03)), grain(C.char, 0.3, 60), { rigid: { [`foot_${side}`]: 1 } })
  const toe = intersect(0.004, intersect(0.004, offset(footBase, 0.007), halfspace([0, 0, 0.158], [0, 0, -1])), halfspace([0, 0.026, 0], [0, -1, 0]))
  piece(`boot_toecap_${side}`, 'metal', toe, hammered(C.iron), { rigid: { [`foot_${side}`]: 1 } })
  piece(`boot_strap_${side}`, 'soft', band(footBase, 0.004, 0.006, [0, 0.075, 0.075], [0, 0.45, 1], 0.014), grain(C.leather, 0.3, 60), { rigid: { [`foot_${side}`]: 1 } })
  piece(`boot_buckle_${side}`, 'metal', roundBox(surfacePoint(footBase, [s * 0.4, 0.085, 0.07], [-s, 0, 0]), [0.008, 0.016, 0.016], 0.005), flat(C.brass), { rigid: { [`foot_${side}`]: 1 } }, 0.004)
}

// ---- Ragged cloak, back: a flared sheet on the cape chain, hem torn into points ----
{
  const TOP = 1.1
  const hemAt = (phi) => 0.2 + 0.17 * Math.pow(tri(phi * 1.75 + 0.15), 1.15) + 0.05 * tri(phi * 4.3 + 0.6)
  const frame = (x, y, z) => { const u = Math.max(0, TOP - y); const cz = -0.03 - 0.05 * u; return { u, cz, phi: Math.atan2(x, -(z - cz)) } }
  const shape = (x, y, z) => {
    const { u, cz, phi } = frame(x, y, z)
    const fold = 1 + 0.05 * Math.min(1, u * 2.2) * Math.sin(phi * 7)
    const a = (0.24 + 0.17 * u) * fold, b = (0.2 + 0.1 * u) * fold
    const qx = x / a, qz = (z - cz) / b
    const k0 = Math.hypot(qx, qz), k1 = Math.hypot(qx / a, qz / b)
    const shell = Math.abs((k0 * (k0 - 1)) / k1) - 0.01
    return Math.max(shell, (hemAt(phi) - y) * 0.7, y - TOP, (z - cz) - 0.01)
  }
  const capeBones = (x, y, z) => {
    const knots = [['chest', 1.08], ['cape_1', 1.0], ['cape_2', 0.74], ['cape_3', 0.47]]
    if (y >= knots[0][1]) return { chest: 1 }
    for (let i = 0; i < knots.length - 1; i++) {
      const [a, ya] = knots[i], [b, yb] = knots[i + 1]
      if (y <= ya && y >= yb) { const t = (ya - y) / (ya - yb); return { [a]: 1 - t, [b]: t } }
    }
    return { cape_3: 1 }
  }
  const cp = cloth(C.cloak)
  const capePaint = (x, y, z) => {
    const { phi } = frame(x, y, z)
    let col = shade(cp(x, y, z), 0.92 + 0.12 * Math.sin(phi * 7))
    col = mix(col, C.fray, sstep(0.06, 0, y - hemAt(phi)) * 0.7) // frayed, dusty hem
    // A big stitched patch, lower left of the back.
    const pu = phi + 0.42, pv = y - 0.62
    const e = Math.min(0.2 - Math.abs(pu), 0.075 - Math.abs(pv) * 1)
    if (e > 0) col = e < 0.012 && Math.sin((Math.abs(pu) > 0.19 ? pv * 380 : pu * 130)) > 0 ? C.thread : shade(C.patch, 0.7 + 0.3 * fbm(x * 40, y * 40, z * 40, 3))
    return mix(col, C.soot, smudge(x, y, z, 5, 0.5, 0.85) * 0.35)
  }
  piece('cloak_back', 'soft', node(shape, [-0.48, 0.16, -0.44], [0.48, 1.12, 0.06]), capePaint, { fn: capeBones }, 0.006, { err: 0.0046, ratio: 0.025 })
}

// ---- Cloak mantle: a short ragged cowl over the shoulders, open at the chest ----
// Its surface is a dome above the shoulder line and a gently flaring bell below it,
// so the hem hangs clear of the sleeves instead of curling back into them.
const mantleDome = ellipsoid([0, 0.97, -0.03], [0.47, 0.2, 0.25])
const mantleSurf = node((x, y, z) => {
  const fl = 1 + 0.45 * Math.max(0, 0.97 - y)
  return mantleDome.d(x / fl, Math.max(y, 0.97), (z + 0.03) / fl - 0.03)
}, [-0.56, 0.7, -0.36], [0.56, 1.18, 0.3])
{
  const M = mantleSurf
  const hemAt = (phi) => 0.965 - 0.1 * Math.pow(tri(phi * 1.43 + 0.1), 1.2) - 0.03 * tri(phi * 3.7 + 0.35)
  // Drape folds fanning out from the neck, deepest at the hem.
  const drape = (phi, y) => 0.016 * (0.5 + 0.5 * Math.sin(phi * 9 + 0.6 + 1.5 * Math.sin(phi * 2))) * sstep(1.15, 0.93, y)
  const shape = (x, y, z) => {
    const phi = Math.atan2(x, z)
    const shell = Math.abs(M.d(x, y, z) - drape(phi, y)) - 0.009
    const open = Math.max(-z, Math.abs(x) - (0.03 + 0.5 * (1.13 - y)))
    return Math.max(shell, (hemAt(phi) - y) * 0.7, -open * 0.7)
  }
  const cp = cloth(C.cloak, 1.08)
  piece('cloak_mantle', 'soft', node(shape, [-0.54, 0.82, -0.33], [0.54, 1.19, 0.27]), (x, y, z) => {
    const phi = Math.atan2(x, z)
    let col = shade(cp(x, y, z), 0.86 + 17 * drape(phi, y))
    col = mix(col, C.fray, sstep(0.035, 0, y - hemAt(phi)) * 0.65)
    return mix(col, C.soot, smudge(x, y, z, 6, 0.45, 0.9) * 0.22)
  }, { fn: (x, y, z) => { const w = 0.55 * sstep(0.2, 0.38, Math.abs(x)); return { chest: 1 - w, [x > 0 ? 'upperarm_L' : 'upperarm_R']: w } } }, 0.0055, { err: 0.0032, ratio: 0.025 })
}

// ---- Team scarf: a broad wrap wound round the neck over the hood, knot and torn tail on the chest ----
{
  // A ring of cloth with a flat (tall, thin) cross-section and wound creases, tilted to dip at the throat.
  const SC = [0, 1.114, 0.008], SR = euler(0.3, 0, 0.05), RING = 0.16, A = 0.043, B = 0.076
  const toL = (x, y, z) => { const q = [x - SC[0], y - SC[1], z - SC[2]]; return [SR[0] * q[0] + SR[3] * q[1] + SR[6] * q[2], SR[1] * q[0] + SR[4] * q[1] + SR[7] * q[2], SR[2] * q[0] + SR[5] * q[1] + SR[8] * q[2]] }
  const crease = (lx, ly, lz) => { const ang = Math.atan2(lx, lz); return Math.abs(Math.sin(ly * 52 + ang * 1.5 + 2.2 * Math.sin(ang * 2 + 1) + 0.9 * Math.sin(ang * 7))) }
  const ring = node((x, y, z) => {
    const ang = Math.atan2(x, z)
    const rho = Math.hypot(x, z) - RING * (1 + 0.05 * Math.sin(ang * 3 + 1))
    const k0 = Math.hypot(rho / A, y / B), k1 = Math.hypot(rho / (A * A), y / (B * B))
    return (k1 === 0 ? -A : (k0 * (k0 - 1)) / k1) + 0.005 - 0.011 * crease(x, y, z)
  }, [-RING - A - 0.02, -B - 0.012, -RING - A - 0.02], [RING + A + 0.02, B + 0.012, RING + A + 0.02])
  // The loose end crosses over itself at the right collarbone before it drops.
  const over = roundBox([-0.105, 1.07, 0.15], [0.05, 0.036, 0.016], 0.012, euler(0.25, -0.55, 0.5))
  const scarf = union(0.012, place(ring, SC, SR), over)
  piece('scarf', 'team', scarf, (x, y, z) => {
    const [lx, ly, lz] = toL(x, y, z)
    const k = 0.6 - 0.08 * fbm(x * 14, y * 30, z * 14, 2) + 0.36 * Math.sqrt(crease(lx, ly, lz))
    return [k, k, k]
  }, { rigid: { chest: 0.65, neck: 0.35 } }, 0.0065, { err: 0.0042, ratio: 0.03 })
  // A second torn end thrown over the left shoulder, lying on the mantle.
  const MB = mantleSurf
  const back = (x, y, z) => {
    const cx = 0.06 + 0.2 * (1.12 - y) + 0.012 * Math.sin(y * 40)
    const notch = 0.86 + 0.6 * Math.abs(x - cx) * (Math.abs(x - cx) < 0.02 ? -1.2 : 1)
    return Math.max(Math.abs(x - cx) - (0.05 + 0.05 * (1.12 - y)), notch - y, y - 1.16, z + 0.02)
  }
  piece('scarf_tail_back', 'team', sheet(MB, 0.026, 0.006, back, [0, 0.84, -0.36], [0.26, 1.17, -0.01]), (x, y, z) => {
    const k = (0.84 - 0.14 * fbm(x * 14, y * 30, z * 14, 2) - 0.1 * Math.sin(y * 40 + 1)) * (y < 0.9 ? 0.5 : 1)
    return [k, k, k]
  }, { rigid: { chest: 1 } }, 0.005)
  // Tail down the right of the chest, hugging the layers below it.
  const region = (x, y, z) => {
    const cx = -0.125 + 0.05 * (1.0 - y)
    const notch = 0.83 + 0.5 * Math.abs(x - cx) * (Math.abs(x - cx) < 0.018 ? -1.2 : 1) // forked, torn end
    return Math.max(Math.abs(x - cx) - (0.04 + 0.03 * (1.0 - y)), notch - y, y - 1.1, -z)
  }
  piece('scarf_tail', 'team', sheet(strapBase, 0.014, 0.006, region, [-0.22, 0.8, 0], [-0.04, 1.11, 0.24]), (x, y, z) => {
    const k = (0.86 - 0.14 * fbm(x * 14, y * 30, z * 14, 2)) * (y < 0.87 ? 0.5 : 1)
    return [k, k, k]
  }, torsoSkin, 0.005)
}

// ---- Hood: deep cowl with a brow peak and a drooping point ----
{
  const HC = [0, 1.385, 0.035]
  const main = ellipsoid(HC, [0.205, 0.225, 0.225])
  const peak = capsule([0, 1.555, 0.09], [0, 1.53, 0.24], 0.065, 0.032)
  const tail = bezierTube([0, 1.47, -0.08], [0, 1.535, -0.25], [0, 1.45, -0.345], [0.015, 1.3, -0.335], 0.125, 0.024, 12, 0.03)
  const neck = capsule([0, 1.1, 0.0], [0, 1.24, 0.01], 0.125, 0.13)
  const outer = union(0.05, main, peak, tail, neck)
  const inner = union(0.03, ellipsoid(HC, [0.181, 0.2, 0.2]), capsule([0, 1.05, 0.0], [0, 1.26, 0.01], 0.1, 0.105), capsule([0, 1.52, 0.1], [0, 1.5, 0.3], 0.04, 0.03))
  let hood = subtract(0.008, outer, inner)
  hood = subtract(0.014, hood, ellipsoid([0, 1.33, 0.3], [0.152, 0.2, 0.2]))
  hood = intersect(0.006, hood, halfspace([0, 1.1, 0], [0, -1, 0]))
  // A few heavy folds raked back from the brow.
  const folded = node((x, y, z) => hood.d(x, y, z) + 0.004 * Math.sin((y - 0.45 * z) * 75 + 2 * Math.sin(Math.abs(x) * 14)) * sstep(1.46, 1.28, y) * sstep(-0.3, -0.05, z), hood.min, hood.max)
  const cp = cloth(C.cloak, 1.05)
  piece('hood', 'soft', folded, (x, y, z) => {
    // Inside of the cowl is nearly black so the skull sits in shadow.
    if (inner.d(x, y, z) < 0.012) return shade(C.cloakDeep, 0.6)
    let col = cp(x, y, z)
    // Stitched patch on the left temple.
    const pu = y - 1.47 - 0.3 * (z + 0.02), pv = z + 0.02
    const e = Math.min(0.05 - Math.abs(pu), 0.06 - Math.abs(pv))
    if (x > 0.08 && e > 0) col = e < 0.011 && Math.sin((0.05 - Math.abs(pu) < 0.011 ? pv : pu) * 380) > 0 ? C.thread : shade(C.patch, 0.75 + 0.3 * fbm(x * 40, y * 40, z * 40, 3))
    // Worn pale along the rim of the opening.
    const rim = sstep(0.03, 0.0, Math.abs(ellipsoid([0, 1.33, 0.3], [0.152, 0.2, 0.2]).d(x, y, z)))
    col = mix(col, C.fray, rim * 0.55 * (z > 0.1 ? 1 : 0))
    return mix(col, C.soot, smudge(x, y, z, 6, 0.5, 0.85) * 0.3)
  }, { rigid: { head: 1 } }, 0.0055, { err: 0.0032, ratio: 0.035 })
}

// ---- Skull: cranium, brow, cheekbones, carved sockets and nose, teeth, jaw ----
{
  const sockets = [1, -1].map((s) => ellipsoid([s * 0.059, 1.36, 0.212], [0.044, 0.034, 0.052], euler(0, 0, s * 0.3)))
  const nasal = union(0.004, ...[1, -1].map((s) => ellipsoid([s * 0.011, 1.297, 0.216], [0.0135, 0.028, 0.036], euler(0, 0, s * 0.36))))
  let skull = union(0.025,
    ellipsoid([0, 1.39, 0.055], [0.135, 0.14, 0.155]),
    capsule([-0.082, 1.402, 0.178], [0.082, 1.402, 0.178], 0.027),
    ellipsoid([0.088, 1.318, 0.152], [0.036, 0.028, 0.05]), ellipsoid([-0.088, 1.318, 0.152], [0.036, 0.028, 0.05]),
    ellipsoid([0, 1.278, 0.153], [0.068, 0.05, 0.063]),
    capsule([0, 1.385, 0.195], [0, 1.335, 0.212], 0.02, 0.016))
  for (const so of sockets) skull = subtract(0.008, skull, so)
  skull = subtract(0.005, skull, nasal)
  for (const s of [1, -1]) skull = subtract(0.02, skull, sphere([s * 0.168, 1.345, 0.1], 0.052))
  for (const s of [1, -1]) skull = subtract(0.014, skull, sphere([s * 0.083, 1.268, 0.2], 0.032)) // gaunt hollows under the cheekbones
  skull = intersect(0.006, skull, halfspace([0, 1.243, 0], [0, -1, 0]))
  // A hairline crack over the left brow.
  skull = subtract(0.002, skull, bezierTube([0.03, 1.43, 0.2], [0.05, 1.46, 0.19], [0.035, 1.49, 0.165], [0.06, 1.515, 0.12], 0.0045, 0.002, 8, 0.002))
  const bonePaint = (x, y, z) => {
    let col = agedBone(x, y, z)
    for (const so of sockets) col = mix(col, C.boneDeep, sstep(0.004, -0.012, so.d(x, y, z)) * 0.92)
    col = mix(col, C.boneDeep, sstep(0.003, -0.008, nasal.d(x, y, z)) * 0.92)
    return shade(col, 0.82 + 0.2 * sstep(1.24, 1.45, y))
  }
  piece('skull', 'soft', skull, bonePaint, { rigid: { head: 1 } }, 0.004)

  let jaw = union(0.02, ellipsoid([0, 1.178, 0.15], [0.066, 0.032, 0.058]),
    capsule([0.055, 1.182, 0.12], [0.1, 1.275, 0.05], 0.02, 0.016), capsule([-0.055, 1.182, 0.12], [-0.1, 1.275, 0.05], 0.02, 0.016))
  jaw = subtract(0.008, jaw, ellipsoid([0, 1.205, 0.13], [0.042, 0.03, 0.052]))
  piece('jaw', 'soft', jaw, (x, y, z) => shade(agedBone(x, y, z), 0.88), { rigid: { head: 1 } }, 0.004)

  const teeth = []
  for (let i = -3; i <= 3; i++) {
    const a = i * 0.38
    const w = 0.0088 - 0.0006 * Math.abs(i)
    teeth.push(roundBox([0.06 * Math.sin(a), 1.231, 0.156 + 0.06 * Math.cos(a)], [w, 0.0165 - 0.001 * Math.abs(i), 0.0095], 0.0045, euler(0, a, 0)))
    teeth.push(roundBox([0.055 * Math.sin(a + 0.19), 1.2, 0.155 + 0.055 * Math.cos(a + 0.19)], [w * 0.9, 0.0145, 0.009], 0.004, euler(0, a + 0.19, 0)))
  }
  piece('teeth', 'soft', union(0, ...teeth), (x, y, z) => shade(mix(C.bone, C.boneShadow, 0.25 + 0.5 * sstep(0.012, 0, Math.abs(y - 1.215))), 0.92 + 0.12 * fbm(x * 150, y * 150, z * 150, 2)), { rigid: { head: 1 } }, 0.003)

  // Ember eyes: small coals deep in the sockets.
  piece('eyes', 'glow', union(0, sphere([0.059, 1.36, 0.182], 0.0155), sphere([-0.059, 1.36, 0.182], 0.0155)), flat(C.ember), { rigid: { head: 1 } }, 0.0025)
}

// ---- The bomb: riveted iron sphere, banded seam, brass fuse cap, lit fuse ----
{
  const g = handFrame.R.g
  const f = norm([-0.25, 0.6, 0.75]) // fuse axis: up, forward and a little outward
  const R = frameY(f)
  const local = (n) => place(n, g, R)
  const rigid = { rigid: { hand_R: 1 } }
  const shell = sphere([0, 0, 0], BOMB_R)
  // Two hemispheres: a shallow groove either side of the seam band, and a foundry dimple at the base.
  let iron = subtract(0.003, shell, band(shell, 0, 0.004, [0, 0.02, 0], [0, 1, 0], 0.003))
  iron = subtract(0.003, iron, band(shell, 0, 0.004, [0, -0.02, 0], [0, 1, 0], 0.003))
  iron = subtract(0.006, iron, sphere([0, -BOMB_R - 0.012, 0], 0.03))
  const toLocalY = (x, y, z) => dot(sub([x, y, z], g), f)
  piece('bomb', 'soft', local(iron), (x, y, z) => shade(castIron(x, y, z), 0.85 + 0.4 * sstep(-0.1, 0.1, toLocalY(x, y, z))), rigid, 0.005)
  piece('bomb_band', 'metal', local(band(shell, 0.004, 0.004, [0, 0, 0], [0, 1, 0], 0.0135)), hammered(C.steel, 0.9), rigid, 0.004)
  const rivet = union(0, sphere([BOMB_R + 0.007, 0, 0], 0.0085), sphere([BOMB_R * 0.94, 0.036, 0], 0.0075), sphere([BOMB_R * 0.94, -0.036, 0], 0.0075))
  piece('bomb_rivets', 'metal', local(repeatAround(rivet, 12, [0, 0], 0.13)), flat(C.steel), rigid, 0.003)
  let cap = union(0.004, cylinder([0, BOMB_R + 0.014, 0], 0.033, 0.024, 0.006), torus([0, BOMB_R - 0.003, 0], 0.04, 0.012), torus([0, BOMB_R + 0.035, 0], 0.031, 0.007))
  cap = subtract(0.003, cap, cylinder([0, BOMB_R + 0.04, 0], 0.016, 0.014, 0))
  piece('bomb_cap', 'metal', local(cap), hammered(C.brass), rigid, 0.0035)
  const fuse = bezierTube([0, BOMB_R + 0.02, 0], [0, BOMB_R + 0.085, 0], [-0.04, BOMB_R + 0.125, 0.012], [-0.08, BOMB_R + 0.1, 0.03], 0.0105, 0.009, 10, 0.006)
  piece('bomb_fuse', 'soft', local(fuse), (x, y, z) => {
    const q = sub([x, y, z], g)
    const t = fuse.param(dot(q, [R[0], R[3], R[6]]), dot(q, [R[1], R[4], R[7]]), dot(q, [R[2], R[5], R[8]]))
    const twist = 0.5 + 0.5 * Math.sin((x * 1.3 + y + z * 0.7) * 520)
    return mix(mix(C.cordDark, C.cord, twist), C.char, sstep(0.6, 0.95, t))
  }, rigid, 0.003)
  const tip = [-0.08, BOMB_R + 0.1, 0.03]
  const spark = union(0.004, sphere(tip, 0.02),
    capsule(tip, add(tip, [-0.03, 0.022, 0.012]), 0.009, 0.002), capsule(tip, add(tip, [-0.012, -0.028, 0.02]), 0.008, 0.002),
    capsule(tip, add(tip, [-0.02, 0.006, -0.03]), 0.008, 0.002), capsule(tip, add(tip, [0.004, 0.032, 0.008]), 0.008, 0.002))
  piece('bomb_spark', 'glow', local(spark), flat(C.ember), rigid, 0.003)
}

// Bones that pieces may reference must exist.
const boneNames = new Set(BONES.map((b) => b.name))
for (const p of PIECES) {
  const refs = p.skin.rigid ? Object.keys(p.skin.rigid) : p.skin.envelope || []
  for (const r of refs) if (!boneNames.has(r)) throw new Error(`${p.name} references unknown bone ${r}`)
}
