// THE PRINCE — a royal lancer.
//
// Same 22-bone skeleton as the Ember Warden, but a different character:
// polished, gilded and fluted plate; a pointed-visor great helm ("hounskull")
// under a gold crown with a tall team plume; ermine mantle and a long team
// cape; a heraldic kite shield with a gold fleur-de-lis; and an ivory lance
// with a fluted vamplate, gold bands and a swallow-tailed team pennant.
//
// Conventions (same as glTF / Three.js): Y up, character faces +Z,
// ground at y = 0, 1 unit ≈ the old procedural Knight's scale.
// The character's LEFT is +X, RIGHT is -X. Sword in the right hand,
// shield on the left forearm.

import {
  sphere, ellipsoid, capsule, roundBox, torus, cylinder, halfspace, star, bezierTube,
  union, subtract, intersect, offset, band, place, euler, basis, norm, cross, node, fbm, noise3,
} from './sdf.mjs'
import { cappedCone, repeatAround } from '../hero/sdf.mjs'

// ---------------------------------------------------------------------------
// Skeleton. Rest pose has identity rotations, so every animation angle is a
// plain rotation from this pose. `tail` is only used for envelope weighting.
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
  // Cape: a three-bone chain hanging off the chest, so it can sway and trail.
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
// Palette (sRGB). Polished steel, generous gold, ivory and ermine; the team
// color is carried by cloth, plume, shield face and pennant.
// ---------------------------------------------------------------------------
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
const C = {
  steel: hex(0xa7b1bf), steelDark: hex(0x5f6875), iron: hex(0x3a3f47),
  gold: hex(0xecba4c), goldDeep: hex(0xbd8528),
  mail: hex(0x3d4350), coif: hex(0x4c5361), leather: hex(0x4a2f1e), leatherDark: hex(0x2c1b12),
  ivory: hex(0xd9cfb6), ochre: hex(0xa87628), fur: hex(0xe2dac8), furSpot: hex(0x2b2521), ember: hex(0xffb04a),
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k]
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const flat = (c) => () => c
/** Polished plate: broad soft reflections of tone, only a whisper of grain. */
const polished = (c, k = 1) => (x, y, z) => shade(c, k * (0.9 + 0.1 * fbm(x * 14, y * 14, z * 14, 3) + 0.03 * noise3(x * 120, y * 120, z * 120)))
/** Gilding: warm gold with slightly deeper patches so big gold areas are not flat. */
const gilt = (x, y, z) => mix(C.goldDeep, C.gold, 0.7 + 0.3 * fbm(x * 26, y * 26, z * 26, 3))
const grain = (c, amt = 0.08, freq = 60) => (x, y, z) => shade(c, 1 - amt / 2 + amt * fbm(x * freq, y * freq, z * freq, 3))
const steelP = polished(C.steel)

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
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const grow = (n, r) => [n.min.map((v) => v - r), n.max.map((v) => v + r)]

/**
 * Fleur-de-lis in the unit square (about 1 tall, centered on the origin, tip
 * up = +v). Approximate signed distance: negative inside. Used as paint on the
 * tabard and cape and as raised gold on the shield.
 */
function fleur(u, v) {
  const au = Math.abs(u)
  const ell = (cx, cy, rx, ry, rot = 0) => {
    const c = Math.cos(rot), s = Math.sin(rot), dx = au - cx, dy = v - cy
    const lx = c * dx + s * dy, ly = -s * dx + c * dy
    const k0 = Math.hypot(lx / rx, ly / ry), k1 = Math.hypot(lx / (rx * rx), ly / (ry * ry))
    return k1 === 0 ? -Math.min(rx, ry) : (k0 * (k0 - 1)) / k1
  }
  const bar = Math.max(au - 0.27, Math.abs(v + 0.2) - 0.045)
  return Math.min(
    ell(0, 0.13, 0.125, 0.37),            // tall middle petal
    ell(0.27, 0.07, 0.09, 0.25, -0.6),    // side petals, leaning out
    ell(0.39, 0.2, 0.07, 0.07),           // their curled tips
    bar,                                  // the binding band
    ell(0, -0.36, 0.07, 0.14),            // lower stem
    ell(0.17, -0.33, 0.05, 0.1, 0.6),     // lower side leaves
  )
}

// ---------------------------------------------------------------------------
// Pieces. Each piece is meshed on its own (like an artist's separate armor
// parts), with:
//   material: 'soft' | 'metal' | 'team' | 'glow'
//   sdf:      the sculpted shape
//   paint:    (x,y,z) -> sRGB color, before baked AO/curvature are applied
//   skin:     { rigid: { bone: weight, ... } }  or  { envelope: [bones] }
//             or { fn: (x, y, z) => ({ bone: weight }) }; add occluder: 'name'
//             for props that must not bake shadows onto the body (shield, lance)
//   res:      optional voxel size override (smaller = finer)
//   opt:      optional { err, cw } decimation overrides (see build.mjs); the
//             defaults here are a little looser than the Warden's to fit the budget
// ---------------------------------------------------------------------------
export const PIECES = []
/** Where the lance is held and where it points in the rest pose (for pose tooling). */
export const LANCE = {}
const piece = (name, material, sdf, paint, skin, res, opt) => PIECES.push({ name, material, sdf, paint, skin, res, opt: { err: 0.0031, cw: 0.5, ...opt } })

// ---- Body under the armor (chain mail suit), soft-skinned to the skeleton ----
const torsoUpper = ellipsoid([0, 0.86, 0], [0.265, 0.25, 0.185])
const pelvis = ellipsoid([0, 0.6, 0], [0.18, 0.125, 0.14])
const torso = union(0.07, torsoUpper, pelvis)
{
  const parts = [torso, capsule([0, 1.0, 0], [0, 1.2, 0], 0.1, 0.095)]
  for (const { S, E, W, Hp, K, A } of Object.values(LIMB)) {
    parts.push(sphere(S, 0.088), capsule(S, E, 0.082, 0.072), capsule(E, W, 0.067, 0.058))
    parts.push(capsule(Hp, K, 0.098, 0.078), capsule(K, A, 0.072, 0.062))
  }
  const mailPaint = (x, y, z) => {
    const rings = 0.5 + 0.5 * Math.sin(y * 260 + Math.sin(x * 90) * 2)
    return shade(C.mail, 0.85 + 0.12 * rings + 0.1 * fbm(x * 40, y * 40, z * 40, 3))
  }
  piece('undersuit', 'soft', union(0.05, ...parts), mailPaint,
    { envelope: ['hips', 'spine', 'chest', 'neck', 'upperarm_L', 'forearm_L', 'upperarm_R', 'forearm_R', 'thigh_L', 'shin_L', 'thigh_R', 'shin_R'] }, undefined, { err: 0.003 })
}
piece('coif', 'soft', ellipsoid([0, 1.13, -0.01], [0.16, 0.07, 0.15]), grain(C.coif, 0.2, 80), { envelope: ['chest', 'neck', 'head'] })

// ---- Breastplate: globose, keeled, fan-fluted, with a lozenge ember jewel ----
const plateBase = union(0.05, offset(torsoUpper, 0.032), ellipsoid([0, 0.86, 0.09], [0.2, 0.19, 0.15]))
const gemPos = surfacePoint(plateBase, [0, 0.915, 1], [0, 0, -1])
const RZ45 = euler(0, 0, Math.PI / 4)
{
  let plate = intersect(0.015, plateBase, halfspace([0, 0.7, 0], [0, -1, 0]))
  plate = subtract(0.02, plate, cylinder([0, 1.12, 0], 0.12, 0.12, 0.02))
  for (const s of [1, -1]) plate = subtract(0.02, plate, sphere([s * 0.34, 0.98, 0], 0.11))
  // Medial keel from the neck to the waist.
  const keel = intersect(0.004, offset(plateBase, 0.014), roundBox([0, 0.87, 0.2], [0.012, 0.18, 0.16], 0.008))
  plate = union(0.012, plate, subtract(0.006, keel, sphere(gemPos, 0.078)))
  plate = subtract(0.006, plate, sphere(gemPos, 0.046))
  // Fluting that fans out from the waist, three channels a side.
  for (const s of [1, -1]) for (const th of [0.45, 0.8, 1.14]) {
    const groove = intersect(0, band(plateBase, 0, 0.006, [0, 0.69, 0], [Math.cos(th), -s * Math.sin(th), 0], 0.004), halfspace([0, 0, 0.02], [0, 0, -1]))
    plate = subtract(0.003, plate, groove)
  }
  const platePaint = (x, y, z) => {
    const c = shade(steelP(x, y, z), 0.95 + 0.12 * sstep(0.7, 1.05, y))
    return Math.abs(x) < 0.018 && z > 0.1 ? gilt(x, y, z) : c // gilded keel
  }
  piece('breastplate', 'metal', plate, platePaint, { rigid: { chest: 1 } }, undefined, { err: 0.003 })
  // Raised gold: waist band and a V collar running from the jewel to the shoulders.
  const trims = [band(plateBase, 0.005, 0.008, [0, 0.705, 0], [0, 1, 0], 0.016)]
  for (const s of [1, -1]) {
    trims.push(intersect(0, intersect(0, band(plateBase, 0.004, 0.007, [0, 0.945, 0], [-s * 0.55, 1, 0], 0.012), halfspace([s * 0.05, 0, 0], [-s, 0, 0])), halfspace([0, 0, 0.03], [0, 0, -1])))
  }
  piece('plate_trim', 'metal', union(0, ...trims), gilt, { rigid: { chest: 1 } }, undefined, { err: 0.004 })
  const setting = subtract(0.004, roundBox(add(gemPos, [0, 0, 0.002]), [0.052, 0.052, 0.02], 0.008, RZ45), roundBox(gemPos, [0.034, 0.034, 0.06], 0.004, RZ45))
  const rays = []
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) rays.push(capsule(add(gemPos, [dx * 0.06, dy * 0.06, 0.004]), add(gemPos, [dx * 0.1, dy * 0.1, -0.006 - Math.abs(dx) * 0.012]), 0.012, 0.004))
  piece('gem_setting', 'metal', union(0.006, setting, ...rays), gilt, { rigid: { chest: 1 } }, 0.005)
  piece('gem', 'glow', roundBox(add(gemPos, [0, 0, -0.004]), [0.037, 0.037, 0.022], 0.012, RZ45),
    (x, y, z) => mix(C.ember, [1, 0.95, 0.75], sstep(0.92, 0.95, y)), { rigid: { chest: 1 } })
}

// ---- Belt, buckle and a two-lame fauld (hip skirt) ----
piece('belt', 'soft', band(torso, 0.022, 0.02, [0, 0.667, 0], [0, 1, 0], 0.022),
  (x, y, z) => mix(C.leather, C.leatherDark, sstep(0.012, 0.022, Math.abs(y - 0.667))), { envelope: ['hips', 'spine'] }, undefined, { err: 0.003 })
{
  const front = surfacePoint(torso, [0, 0.667, 1], [0, 0, -1])
  const c = add(front, [0, 0, 0.042])
  const plate = roundBox(c, [0.04, 0.04, 0.014], 0.008, RZ45)
  piece('buckle', 'metal', union(0.004, subtract(0.004, plate, roundBox(add(c, [0, 0, 0.014]), [0.02, 0.02, 0.008], 0.004, RZ45)), sphere(add(c, [0, 0, 0.01]), 0.013)), gilt, { rigid: { hips: 1 } })
}
{
  // Solid flared skirt (nothing shows of an inner wall, so none is built). Each
  // lame swells toward its lower edge and the next one tucks back under it.
  const FT = 0.648, FB = 0.5, LH = (FT - FB) / 2
  const lame = (y) => { const f = (Math.min(FT - FB - 1e-4, Math.max(0, FT - y)) / LH) % 1; return f < 0.88 ? f / 0.88 : (1 - f) / 0.12 }
  const shape = (x, y, z) => {
    const u = Math.max(0, FT - y), l = lame(y)
    const a = 0.23 + u * 0.36 + 0.015 * l, b = 0.178 + u * 0.2 + 0.015 * l
    const qx = x / a, qz = z / b
    const k0 = Math.hypot(qx, qz), k1 = Math.hypot(qx / a, qz / b)
    const ell = k1 === 0 ? -b : (k0 * (k0 - 1)) / k1
    return Math.max(ell, y - FT, FB - y)
  }
  const fauld = node(shape, [-0.33, FB - 0.01, -0.26], [0.33, FT + 0.01, 0.26])
  piece('fauld', 'metal', fauld, (x, y, z) => {
    if (y < FB + 0.004) return C.iron
    const f = (Math.max(0, FT - y) / LH) % 1
    return f > 0.68 ? gilt(x, y, z) : shade(steelP(x, y, z), 0.9)
  }, { rigid: { hips: 1 } }, undefined, { err: 0.004 })
}

// ---- Pauldrons: a scallop-fluted cop over one gilt-edged lame, and a standing haute-piece ----
for (const [side, { s }] of Object.entries(LIMB)) {
  const w = { [`upperarm_${side}`]: 0.55, chest: 0.45 }
  const c1 = [s * 0.385, 1.075, 0], out1 = [s * Math.cos(0.5), -Math.sin(0.5), 0]
  const dome1 = ellipsoid(c1, [0.172, 0.125, 0.182], euler(0, 0, -s * 0.5))
  const pivot = [s * 0.2, 1.14, 0] // the flutes radiate from the neck side
  const fluted = node((x, y, z) => {
    const vx = x - pivot[0], vy = y - pivot[1]
    const r = Math.hypot(vx, vy)
    const fl = Math.abs(Math.cos(Math.atan2(z, r) * 10))
    return dome1.d(x, y, z) - 0.009 * fl * sstep(0.05, 0.16, Math.hypot(r, z))
  }, ...grow(dome1, 0.012))
  const hollow = ellipsoid([s * 0.35, 0.93, 0], [0.165, 0.125, 0.155])
  const rim1 = (x, y, z) => dot(sub([x, y, z], c1), out1)
  piece(`pauldron_${side}`, 'metal', subtract(0.012, fluted, hollow),
    (x, y, z) => (rim1(x, y, z) > 0.112 ? gilt(x, y, z) : shade(steelP(x, y, z), 0.95 + 0.15 * sstep(0.95, 1.18, y))), { rigid: w }, 0.0055, { err: 0.003 })
  const c2 = [s * 0.462, 0.972, 0], out2 = [s * Math.cos(0.78), -Math.sin(0.78), 0]
  const dome2 = ellipsoid(c2, [0.15, 0.088, 0.168], euler(0, 0, -s * 0.78))
  const rib = intersect(0.004, offset(dome2, 0.008), roundBox(c2, [0.2, 0.2, 0.011], 0.006))
  piece(`pauldron_lame_${side}`, 'metal', subtract(0.01, union(0.008, dome2, rib), hollow),
    (x, y, z) => (dot(sub([x, y, z], c2), out2) > 0.098 ? gilt(x, y, z) : shade(steelP(x, y, z), 0.92)), { rigid: w }, undefined, { err: 0.003 })
  // Haute-piece: a low crescent guard standing between shoulder and neck, flared outward.
  const hc = [s * 0.27, 1.1, 0]
  const haute = intersect(0.006, roundBox(add(hc, [s * 0.03, 0.07, 0]), [0.012, 0.09, 0.14], 0.01, euler(0, 0, -s * 0.42)),
    ellipsoid(hc, [0.2, 0.142, 0.135]))
  piece(`haute_${side}`, 'metal', haute, (x, y, z) => {
    const q = Math.hypot((y - hc[1]) / 0.142, z / 0.135)
    return q > 0.83 ? gilt(x, y, z) : steelP(x, y, z)
  }, { rigid: w })
}

// ---- Arms: banded rerebraces, winged couters, flared vambraces, steel gauntlets ----
for (const [side, { s, S, E, W, F }] of Object.entries(LIMB)) {
  const up = norm(sub(E, S))
  const rere = union(0.008, capsule(add(S, scale(up, 0.1)), sub(E, scale(up, 0.045)), 0.088, 0.08),
    capsule(sub(E, scale(up, 0.125)), sub(E, scale(up, 0.095)), 0.087, 0.087))
  piece(`rerebrace_${side}`, 'metal', rere, (x, y, z) => {
    const t = dot(sub([x, y, z], E), up)
    return t > -0.14 && t < -0.08 ? gilt(x, y, z) : shade(steelP(x, y, z), 0.92)
  }, { rigid: { [`upperarm_${side}`]: 1 } })
  const dir = norm(sub(W, E))
  const vambrace = union(0.012,
    capsule(add(E, scale(dir, 0.05)), sub(W, scale(dir, 0.035)), 0.078, 0.086),
    capsule(sub(W, scale(dir, 0.08)), sub(W, scale(dir, 0.02)), 0.09, 0.108))
  piece(`vambrace_${side}`, 'metal', vambrace, (x, y, z) => {
    const t = dot(sub([x, y, z], W), dir)
    return t > -0.052 || (t > -0.118 && t < -0.098) ? gilt(x, y, z) : shade(steelP(x, y, z), 0.95)
  }, { rigid: { [`forearm_${side}`]: 1 } })
  // Couter: a cop over the elbow point with a round wing on the outside.
  const wc = add(E, [s * 0.08, 0, -0.012])
  const couter = union(0.01, ellipsoid(add(E, [s * 0.02, 0.005, -0.035]), [0.068, 0.07, 0.06]), ellipsoid(wc, [0.02, 0.078, 0.088]))
  piece(`couter_${side}`, 'metal', union(0.004, couter, sphere(add(wc, [s * 0.02, 0, 0]), 0.018)), (x, y, z) => {
    const r = Math.hypot(y - wc[1], z - wc[2])
    return (x - wc[0]) * s > -0.012 && (r > 0.058 || r < 0.021) ? gilt(x, y, z) : shade(steelP(x, y, z), 0.9)
  }, { rigid: { [`upperarm_${side}`]: 0.5, [`forearm_${side}`]: 0.5 } })
  const hdir = norm(sub(F, W))
  const fistC = add(W, scale(hdir, 0.07))
  const fist = union(0.02, roundBox(fistC, [0.06, 0.074, 0.068], 0.04, frameY(hdir)),
    capsule(add(fistC, [-s * 0.045, 0.02, 0.045]), add(fistC, [-s * 0.03, -0.035, 0.07]), 0.026, 0.022))
  piece(`gauntlet_${side}`, 'metal', fist, polished(C.steelDark, 1.05), { rigid: { [`hand_${side}`]: 1 } })
  piece(`knuckles_${side}`, 'metal', roundBox(add(fistC, [s * 0.056, -0.005, 0.01]), [0.016, 0.058, 0.058], 0.013, frameY(hdir)), gilt, { rigid: { [`hand_${side}`]: 1 } })
}

// ---- Legs: ridged cuisses, winged poleyns, keeled greaves, pointed sabatons ----
for (const [side, { s, Hp, K, A }] of Object.entries(LIMB)) {
  const thigh = capsule(Hp, K, 0.098, 0.078)
  let cuisse = intersect(0.01, intersect(0.01, offset(thigh, 0.024), halfspace([0, 0, -0.01], [0, 0, -1])), halfspace([0, 0.37, 0], [0, -1, 0]))
  cuisse = union(0.008, cuisse, intersect(0.004, offset(thigh, 0.034), roundBox([s * 0.15, 0.45, 0.1], [0.011, 0.09, 0.07], 0.007)))
  piece(`cuisse_${side}`, 'metal', cuisse, (x, y, z) => (y < 0.412 ? gilt(x, y, z) : shade(steelP(x, y, z), 0.9)), { rigid: { [`thigh_${side}`]: 1 } })
  const kw = add(K, [s * 0.074, 0, 0.012])
  const poleyn = union(0.012, ellipsoid(add(K, [0, 0.005, 0.06]), [0.07, 0.076, 0.05]), ellipsoid(kw, [0.02, 0.064, 0.064]))
  piece(`poleyn_${side}`, 'metal', union(0.004, poleyn, sphere(add(K, [0, 0.005, 0.108]), 0.018)), (x, y, z) => {
    const stud = Math.hypot(x - K[0], y - K[1] - 0.005) < 0.022 && z > K[2] + 0.1
    const wing = (x - kw[0]) * s > -0.01 && Math.hypot(y - kw[1], z - kw[2]) > 0.046
    return stud || wing ? gilt(x, y, z) : shade(steelP(x, y, z), 0.95)
  }, { rigid: { [`thigh_${side}`]: 0.4, [`shin_${side}`]: 0.6 } })
  const shin = capsule(add(K, [0, -0.055, 0]), add(A, [0, 0.035, 0]), 0.084, 0.074)
  const greave = union(0.008, shin, intersect(0.004, offset(shin, 0.011), roundBox([s * 0.16, 0.2, 0.08], [0.01, 0.09, 0.06], 0.006)))
  piece(`greave_${side}`, 'metal', greave, (x, y, z) => (y > 0.236 && y < 0.262 ? gilt(x, y, z) : shade(steelP(x, y, z), 0.85 + 0.15 * sstep(0.1, 0.3, y))), { rigid: { [`shin_${side}`]: 1 } })
  // Pointed sabaton with two lame grooves and a gilt toe cap.
  const foot = union(0.03, roundBox([s * 0.16, 0.062, 0.03], [0.08, 0.062, 0.12], 0.05), capsule([s * 0.16, 0.052, 0.1], [s * 0.16, 0.034, 0.262], 0.062, 0.014))
  let sabaton = intersect(0.008, foot, halfspace([0, 0.002, 0], [0, -1, 0]))
  for (const gz of [0.1, 0.155]) sabaton = subtract(0.003, sabaton, band(foot, 0, 0.006, [0, 0.06, gz], [0, 0.3, 1], 0.004))
  piece(`sabaton_${side}`, 'metal', sabaton, (x, y, z) => (z > 0.228 ? gilt(x, y, z) : shade(polished(C.steelDark)(x, y, z), 1 + 0.3 * sstep(0.02, 0.12, y))), { rigid: { [`foot_${side}`]: 1 } })
}

// ---- Tabard (team colored): a long pointed panel with a fleur-de-lis, hinged at the belt ----
{
  const TIP = 0.235
  const cut = (n) => intersect(0.006, intersect(0.006, n, halfspace([0, TIP, 0], [0.62, -1, 0])), halfspace([0, TIP, 0], [-0.62, -1, 0]))
  const front = cut(roundBox([0, 0.435, 0.224], [0.108, 0.205, 0.011], 0.009, euler(-0.1, 0, 0)))
  piece('tabard_front', 'team', front, (x, y, z) => {
    const edge = Math.min(0.108 - Math.abs(x), (y - (TIP + 0.62 * Math.abs(x))) * 0.85)
    let k = 0.94 - 0.08 * fbm(x * 30, y * 90, z * 30, 3) - 0.05 * (0.5 + 0.5 * Math.sin(x * 70))
    if (edge < 0.02) k *= 0.4
    else if (edge < 0.03) k *= 1.06
    if (fleur(x / 0.15, (y - 0.47) / 0.15) < 0) k *= 0.4
    return [k, k, k]
  }, { rigid: { tabard_F: 1 } }, 0.005)
  piece('tabard_tip', 'metal', union(0.006, sphere([0, TIP - 0.006, 0.245], 0.02), capsule([0, TIP - 0.02, 0.246], [0, TIP - 0.055, 0.248], 0.012, 0.004)), gilt, { rigid: { tabard_F: 1 } })
}

// ---- Cape: a long, full, folded sheet on the cape bone chain, under an ermine mantle ----
{
  const TOP = 1.07, BOTTOM = 0.13
  const frame = (x, y, z) => {
    const u = Math.max(0, TOP - y)
    const cz = -0.04 - 0.05 * u
    const phi = Math.atan2(x, -(z - cz))
    const hem = BOTTOM + 0.022 * Math.sin(phi * 9 + 1.2) + 0.07 * Math.abs(Math.sin(phi)) // longest in the middle
    return { u, cz, phi, hem }
  }
  const shape = (x, y, z) => {
    const { u, cz, phi, hem } = frame(x, y, z)
    const fold = 1 + 0.05 * Math.min(1, u * 1.8) * Math.sin(phi * 9)
    const a = (0.275 + 0.17 * u) * fold, b = (0.185 + 0.14 * u) * fold
    const qx = x / a, qz = (z - cz) / b
    const k0 = Math.hypot(qx, qz), k1 = Math.hypot(qx / a, qz / b)
    const ell = (k0 * (k0 - 1)) / k1
    return Math.max(Math.abs(ell) - 0.011, hem - y, y - TOP, (z - cz) - 0.015)
  }
  /** True on the lining (the side that faces his back). */
  const inside = (x, y, z) => {
    const { u, cz } = frame(x, y, z)
    return Math.hypot(x / (0.275 + 0.17 * u), (z - cz) / (0.185 + 0.14 * u)) < 0.985
  }
  const capeSdf = node(shape, [-0.56, 0.08, -0.5], [0.56, 1.1, 0.06])
  const capeBones = (x, y, z) => {
    const knots = [['chest', 1.08], ['cape_1', 1.0], ['cape_2', 0.74], ['cape_3', 0.47]]
    if (y >= knots[0][1]) return { chest: 1 }
    for (let i = 0; i < knots.length - 1; i++) {
      const [a, ya] = knots[i], [b, yb] = knots[i + 1]
      if (y <= ya && y >= yb) { const t = (ya - y) / (ya - yb); return { [a]: 1 - t, [b]: t } }
    }
    return { cape_3: 1 }
  }
  const capePaint = (x, y, z) => {
    const { phi, hem } = frame(x, y, z)
    let k = 0.9 - 0.1 * fbm(x * 30, y * 60, z * 30, 3) + 0.06 * Math.sin(phi * 9)
    if (inside(x, y, z)) return [k * 0.55, k * 0.55, k * 0.55] // plain, deeper lining
    const h = y - hem
    if (h < 0.05) k *= 0.38            // broad dark hem
    else if (h > 0.075 && h < 0.1) k *= 0.5 // and a second, thinner line above it
    if (fleur(x / 0.3, (y - 0.66) / 0.3) < 0) k *= 0.42 // heraldic fleur-de-lis on the back
    return [k, k, k]
  }
  piece('cape', 'team', capeSdf, capePaint, { fn: capeBones }, 0.0075, { err: 0.007, cw: 0.3 })
  const mantle = bezierTube([0.285, 1.04, -0.03], [0.23, 1.11, -0.31], [-0.23, 1.11, -0.31], [-0.285, 1.04, -0.03], 0.058, 0.058, 12, 0.02)
  const fur = node((x, y, z) => mantle.d(x, y, z) - 0.005 * fbm(x * 24, y * 24, z * 24, 2), ...grow(mantle, 0.008))
  piece('mantle', 'soft', fur, (x, y, z) => {
    const spot = noise3(x * 30 + 7, y * 46, z * 30) > 0.77 // ermine tails
    return spot ? C.furSpot : shade(C.fur, 0.86 + 0.18 * fbm(x * 60, y * 60, z * 60, 3))
  }, { fn: () => ({ chest: 0.65, cape_1: 0.35 }) }, 0.008, { err: 0.005, cw: 0.4 })
  for (const s of [1, -1]) {
    const cl = [s * 0.262, 1.035, 0.035]
    piece(`cape_clasp_${s > 0 ? 'L' : 'R'}`, 'metal', union(0.006, roundBox(cl, [0.038, 0.038, 0.014], 0.008, RZ45), sphere(add(cl, [0, 0, 0.014]), 0.018)), gilt, { rigid: { chest: 1 } })
  }
}

// ---- Helmet: pointed-visor great helm, ember eye slits, gilt comb, crown and tall plume ----
const skull = ellipsoid([0, 1.385, 0], [0.255, 0.275, 0.265])
const ogive = union(0.07, skull, capsule([0, 1.5, -0.01], [0, 1.69, -0.015], 0.15, 0.035)) // drawn up to a point
const jaw = ellipsoid([0, 1.245, 0.03], [0.205, 0.15, 0.225])
const snout = capsule([0, 1.29, 0.1], [0, 1.245, 0.385], 0.155, 0.02)
const helmShell = union(0.035, union(0.06, ogive, jaw), snout)
{
  // The visor is a plate standing 1.3 cm proud of the skull, bounded by three planes.
  const visorD = (x, y, z) => Math.max(y - 1.44, 1.168 - y, 0.05 + 0.25 * (y - 1.3) - z)
  const visor = node((x, y, z) => Math.max(helmShell.d(x, y, z) - 0.013, visorD(x, y, z)), ...grow(helmShell, 0.014))
  const comb = intersect(0.004, offset(ogive, 0.017), roundBox([0, 1.6, -0.05], [0.012, 0.165, 0.34], 0.008))
  let helm = union(0.008, union(0.003, helmShell, visor), comb)
  helm = intersect(0.012, helm, halfspace([0, 1.128, 0], [0, -1, 0]))
  // Two eye slits, canted down toward the nasal for a stern look.
  const slit = (s, grow_ = 0) => roundBox([s * 0.09, 1.366, 0.3], [0.068 + grow_, 0.0145 + grow_, 0.1], 0.01, euler(0, 0, s * 0.14))
  for (const s of [1, -1]) helm = subtract(0.008, helm, slit(s))
  // Breaths: three upright slots on each cheek of the snout.
  for (const s of [1, -1]) for (let i = 0; i < 3; i++) {
    const p = surfacePoint(visor, [s * (0.052 + i * 0.036), 1.243 + i * 0.006, 1], [0, 0, -1])
    helm = subtract(0.003, helm, roundBox(p, [0.0075, 0.036, 0.03], 0.005))
  }
  const helmPaint = (x, y, z) => {
    const vd = visorD(x, y, z)
    const g = (vd > -0.024 && vd < 0.006)                              // gilt border of the visor plate
      || (Math.abs(x) < 0.014 && z > 0.15 && y > 1.2 && y < 1.44)       // gilt nasal keel
      || (Math.abs(x) < 0.018 && y > 1.452)                             // gilt comb
      || y < 1.153                                                      // gilt neck rim
    return g ? gilt(x, y, z) : shade(steelP(x, y, z), 0.92 + 0.16 * sstep(1.2, 1.68, y))
  }
  piece('helmet', 'metal', helm, helmPaint, { rigid: { head: 1 } }, 0.0055, { err: 0.003, cw: 0.4 })
  for (const s of [1, -1]) {
    const side = s > 0 ? 'L' : 'R'
    // The glow is the helm's own lining, 1.8 cm behind the surface, seen through the slit.
    piece(`eye_${side}`, 'glow', intersect(0, offset(helmShell, -0.018), slit(s, 0.004)), flat(C.ember), { rigid: { head: 1 } }, 0.004, { err: 0.004 })
    const pv = surfacePoint(helmShell, [s * 0.6, 1.345, 0.05], [-s, 0, 0])
    piece(`visor_pivot_${side}`, 'metal', union(0.006, cylinder(add(pv, [s * 0.006, 0, 0]), 0.043, 0.014, 0.007, euler(0, 0, Math.PI / 2)), sphere(add(pv, [s * 0.02, 0, 0]), 0.018)), gilt, { rigid: { head: 1 } })
  }
  // Crown: a circlet hugging the skull with six tall ball-tipped points and six short ones.
  const circlet = band(ogive, 0.007, 0.01, [0, 1.56, 0], [0, 1, 0], 0.022)
  const tall = union(0.006, capsule([0.207, 1.568, 0], [0.236, 1.668, 0], 0.03, 0.009), sphere([0.24, 1.682, 0], 0.017))
  const short = capsule([0.207, 1.568, 0], [0.224, 1.628, 0], 0.024, 0.007)
  const crown = union(0.006, circlet, repeatAround(tall, 6, [0, 0], Math.PI / 2, 0.27), repeatAround(short, 6, [0, 0], 0, 0.26))
  piece('crown', 'metal', crown, gilt, { rigid: { head: 1 } }, 0.006, { err: 0.004 })
  piece('plume_socket', 'metal', cappedCone([0, 1.735, -0.015], 0.035, 0.05, 0.032), gilt, { rigid: { head: 1 } })
  // Plume: three feathers rising from the point of the helm, arching over and
  // falling away behind. Strand channels run along each one.
  const feather = (q0, q1, q2, q3, r, SEG = 10) => {
    const pt = (t) => { const u = 1 - t; return [0, 1, 2].map((i) => u * u * u * q0[i] + 3 * u * u * t * q1[i] + 3 * u * t * t * q2[i] + t * t * t * q3[i]) }
    const rad = (t) => r * (0.3 + 0.7 * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.15 + 0.04)), 0.6) - 0.16 * t)
    const out = []
    for (let i = 0; i < SEG; i++) {
      const a = pt(i / SEG), b = pt((i + 1) / SEG)
      const T = norm(sub(b, a)), U = norm(cross(T, [1, 0, 0])), V = cross(T, U)
      out.push({ cap: capsule(a, b, rad(i / SEG), rad((i + 1) / SEG)), t: (i + 0.5) / SEG, a, U, V })
    }
    return out
  }
  const B = [0, 1.74, -0.015]
  const segs = [
    ...feather(B, [0, 2.0, 0.12], [0, 2.03, -0.36], [0, 1.55, -0.5], 0.072, 12),
    ...feather(B, [0.06, 1.9, 0.04], [0.24, 1.92, -0.2], [0.27, 1.62, -0.32], 0.05),
    ...feather(B, [-0.06, 1.9, 0.04], [-0.24, 1.92, -0.2], [-0.27, 1.62, -0.32], 0.05),
  ]
  const plumeCore = union(0.018, ...segs.map((g) => g.cap))
  /** Nearest feather segment: how far along the feather, and the angle around it. */
  const strand = (x, y, z) => {
    let best = Infinity, g = segs[0]
    for (const c of segs) { const d = c.cap.d(x, y, z); if (d < best) { best = d; g = c } }
    const q = [x - g.a[0], y - g.a[1], z - g.a[2]]
    return { t: g.t, ridge: Math.cos(Math.atan2(dot(q, g.U), dot(q, g.V)) * 5) }
  }
  const plume = node((x, y, z) => {
    const core = plumeCore.d(x, y, z)
    if (core > 0.03) return core
    const { t, ridge } = strand(x, y, z)
    return core - 0.006 * ridge * sstep(0.03, 0.3, t) * (1 - sstep(0.7, 0.95, t))
  }, ...grow(plumeCore, 0.008))
  piece('plume', 'team', plume, (x, y, z) => {
    const { t, ridge } = strand(x, y, z)
    const k = (0.8 + 0.14 * ridge) * (1 - 0.3 * sstep(0.6, 1, t)) * (0.92 + 0.1 * fbm(x * 40, y * 40, z * 40, 2))
    return [k, k, k]
  }, { rigid: { head: 1 } }, 0.007, { err: 0.0045, cw: 0.25 })
}

// ---- Kite shield on the left forearm: curved team face, gilt border, raised gold fleur-de-lis ----
{
  const { W } = LIMB.L
  // Designed for the guard pose (shoulder -0.42 + elbow -1.05 rad), where it
  // faces forward with the point down. In the rest pose it hangs face-down.
  const n = norm([0.45, -0.875, 0.19])
  const upHint = [0, 0.1, 0.995]
  const zx = n, yx = norm(sub(upHint, scale(n, dot(upHint, n)))), xx = cross(yx, zx)
  const R = basis(xx, yx, zx)
  const fistL = add(W, scale(norm(sub(LIMB.L.F, W)), 0.07))
  const c = add(add(fistL, scale(n, 0.108)), scale(yx, -0.06)) // gripped a little above center
  const local = (sdf) => place(sdf, c, R)
  const toLocal = (x, y, z) => { const q = [x - c[0], y - c[1], z - c[2]]; return [dot(q, xx), dot(q, yx), dot(q, zx)] }
  // Outline: flat top with rounded shoulders, two arcs sweeping to a point.
  const HW = 0.195, YT = 0.2, YS = 0.07, YB = -0.34
  const CX = ((YS - YB) ** 2 - HW ** 2) / (2 * HW), RR = HW + CX
  const smax = (a, b, k) => { const h = Math.max(0, Math.min(1, 0.5 - (0.5 * (b - a)) / k)); return b + (a - b) * h + k * h * (1 - h) }
  const outline = (x, y) => smax(Math.max(Math.hypot(x + CX, y - YS), Math.hypot(x - CX, y - YS)) - RR, y - YT, 0.05)
  const RC = 0.46 // the face is curved around the bearer like a slice of a barrel
  const curve = (x, z) => Math.hypot(x, z + RC) - RC
  const B0 = [-0.22, -0.36, -0.09], B1 = [0.22, 0.22, 0.03]
  const face = node((x, y, z) => Math.max(outline(x, y), Math.abs(curve(x, z) + 0.012) - 0.012), B0, B1)
  const rim = node((x, y, z) => { const o = outline(x, y) - 0.006; return Math.max(o, -(o + 0.03), Math.abs(curve(x, z) + 0.005) - 0.017) }, B0.map((v) => v - 0.01), B1.map((v) => v + 0.01))
  const FS = 0.31, FY = -0.035
  const emblem = node((x, y, z) => Math.max(fleur(x / FS, (y - FY) / FS) * FS, Math.abs(curve(x, z) - 0.003) - 0.008), [-0.16, -0.2, -0.06], [0.16, 0.13, 0.03])
  const skin = { rigid: { forearm_L: 1 }, occluder: 'shield' }
  piece('shield_face', 'team', local(face), (x, y, z) => {
    const [lx, ly, lz] = toLocal(x, y, z)
    if (curve(lx, lz) < -0.014) return [0.22, 0.22, 0.22] // the back
    // Party per pale: one half full color, the other deeper, under the gold fleur.
    let k = (lx > 0 ? 0.96 : 0.55) - 0.07 * fbm(x * 25, y * 25, z * 25, 3)
    k *= 1 - 0.25 * sstep(-0.07, -0.03, outline(lx, ly))
    return [k, k, k]
  }, skin, 0.0055)
  piece('shield_rim', 'metal', local(rim), gilt, skin, 0.006, { err: 0.004 })
  piece('shield_fleur', 'metal', local(emblem), gilt, skin, 0.0045, { err: 0.003 })
  const studs = []
  for (const [sx, sy] of [[-0.135, 0.15], [0.135, 0.15], [-0.15, 0], [0.15, 0], [0, -0.27]]) studs.push(sphere([sx, sy, Math.sqrt(RC * RC - sx * sx) - RC + 0.006], 0.016))
  piece('shield_studs', 'metal', local(union(0, ...studs)), polished(C.steel, 1.1), skin)
}

// ---- Lance in the right hand: ivory shaft with a gilt spiral, fluted vamplate, gold bands, leaf head, team pennant ----
{
  const { W, F } = LIMB.R
  const g = add(W, scale(norm(sub(F, W)), 0.07))
  // Designed for the carry pose (stance: spine 0.04, chest -0.02, upper arm
  // [-0.55, 0, -0.28], forearm -0.95, hand 0.05), where the lance rides under
  // the forearm, angled up ahead of him with the butt tucked back past the
  // elbow. M turns the hand from the rest pose to that pose; its transpose
  // brings the directions wanted in the pose back to the rest pose we build in.
  const mul = (A, B) => { const o = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o.push(A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c]); return o }
  const M = [euler(0.04), euler(-0.02), euler(-0.55, 0, -0.28), euler(-0.95), euler(0.05)].reduce(mul)
  const toRest = (v) => [M[0] * v[0] + M[3] * v[1] + M[6] * v[2], M[1] * v[0] + M[4] * v[1] + M[7] * v[2], M[2] * v[0] + M[5] * v[1] + M[8] * v[2]]
  const RAISE = 0.62 // radians above level in the carry pose
  const dPose = norm([0.02, Math.sin(RAISE), Math.cos(RAISE)])
  const d = toRest(dPose)
  const wAxis = toRest(norm(sub([0, 1, 0], scale(dPose, dPose[1])))), tAxis = cross(wAxis, d) // pennant flies up and back
  LANCE.grip = g; LANCE.dir = d
  const R = basis(wAxis, d, tAxis)
  const local = (sdf) => place(sdf, g, R)
  const toLocal = (x, y, z) => { const q = [x - g[0], y - g[1], z - g[2]]; return [dot(q, wAxis), dot(q, d), dot(q, tAxis)] }
  const rigid = { rigid: { hand_R: 1 }, occluder: 'lance' }
  piece('lance_shaft', 'soft', local(capsule([0, -0.58, 0], [0, 0.95, 0], 0.027, 0.023)), (x, y, z) => {
    const [lx, ly, lz] = toLocal(x, y, z)
    const stripe = Math.sin(Math.atan2(lz, lx) + ly * 34)
    return stripe > 0.5 ? shade(C.ochre, 0.9 + 0.2 * fbm(x * 50, y * 50, z * 50, 2)) : shade(C.ivory, 0.9 + 0.12 * fbm(x * 50, y * 50, z * 50, 2))
  }, rigid, 0.006, { err: 0.003, cw: 0.45 })
  piece('lance_grip', 'soft', local(capsule([0, -0.11, 0], [0, 0.1, 0], 0.035, 0.034)),
    (x, y, z) => shade(C.leatherDark, 0.8 + 0.4 * (0.5 + 0.5 * Math.sin(toLocal(x, y, z)[1] * 190))), rigid)
  // Vamplate: a fluted steel cone guarding the hand, open toward the grip.
  const cone = cappedCone([0, 0.205, 0], 0.085, 0.132, 0.036)
  const flutedCone = node((x, y, z) => cone.d(x, y, z) - 0.005 * Math.abs(Math.cos(Math.atan2(z, x) * 6)) * sstep(0.04, 0.08, Math.hypot(x, z)), ...grow(cone, 0.006))
  const vamplate = subtract(0.004, flutedCone, cappedCone([0, 0.155, 0], 0.05, 0.116, 0.03))
  piece('lance_vamplate', 'metal', local(vamplate), (x, y, z) => {
    const ly = toLocal(x, y, z)[1]
    return ly < 0.143 || ly > 0.262 ? gilt(x, y, z) : steelP(x, y, z)
  }, rigid, 0.005, { err: 0.003 })
  // Gold furniture: bands on the shaft, the socket under the head, and the butt cap.
  const gold = [cylinder([0, 0.36, 0], 0.033, 0.014, 0.006), cylinder([0, 0.66, 0], 0.032, 0.012, 0.006), cylinder([0, -0.3, 0], 0.034, 0.012, 0.006),
    cappedCone([0, 0.965, 0], 0.045, 0.036, 0.021), torus([0, 0.925, 0], 0.031, 0.011),
    union(0.008, cylinder([0, -0.56, 0], 0.035, 0.03, 0.008), sphere([0, -0.61, 0], 0.038))]
  piece('lance_gold', 'metal', local(union(0, ...gold)), gilt, rigid, undefined, { err: 0.003 })
  // Leaf-shaped head with a medial ridge.
  const toZ = euler(Math.PI / 2, 0, 0)
  const HL = 0.15, HWd = 0.05, hc = (HL * HL - HWd * HWd) / (2 * HWd), hr = hc + HWd
  const diamond = node((x, y, z) => Math.abs(z) * 0.95 + Math.abs(x) * 0.3 - 0.018, [-1, -1, -1], [1, 2, 1])
  const head = intersect(0.003, intersect(0.002, cylinder([hc, 1.1, 0], hr, 0.1, 0, toZ), cylinder([-hc, 1.1, 0], hr, 0.1, 0, toZ)), diamond)
  piece('lance_head', 'metal', local(head), (x, y, z) => {
    const [lx] = toLocal(x, y, z)
    return mix(shade(C.steel, 0.9), [0.95, 0.96, 1], sstep(0.022, 0.04, Math.abs(lx)))
  }, rigid, 0.004)
  // Swallow-tailed pennant flying from just below the head.
  const PY = 0.79, PX0 = 0.022, PL = 0.36
  const pshape = (x, y) => {
    const u = (x - PX0) / PL
    const hh = 0.088 * (1 - 0.42 * u)
    return { u, hh, dy: Math.abs(y - PY) }
  }
  const pennant = node((x, y, z) => {
    const { u, hh, dy } = pshape(x, y)
    const wave = 0.024 * Math.sin(u * 6.5) * Math.min(1, u * 2.5)
    return Math.max(Math.abs(z - wave) - 0.007, (dy - hh) * 0.9, PX0 - x, x - PX0 - PL, ((u - 0.58) * 0.12 - dy) * 0.8)
  }, [0, PY - 0.1, -0.04], [PX0 + PL + 0.01, PY + 0.1, 0.04])
  piece('lance_pennant', 'team', local(pennant), (x, y, z) => {
    const [lx, ly] = toLocal(x, y, z)
    const { u, hh, dy } = pshape(lx, ly)
    let k = 0.95 - 0.08 * fbm(x * 40, y * 40, z * 40, 2)
    if (hh - dy < 0.02) k *= 0.42
    else if (dy < 0.014 && u < 0.55) k *= 0.5
    return [k, k, k]
  }, rigid, 0.0045)
}

// Bones that pieces may reference must exist.
const boneNames = new Set(BONES.map((b) => b.name))
for (const p of PIECES) {
  const refs = p.skin.rigid ? Object.keys(p.skin.rigid) : p.skin.envelope || []
  for (const r of refs) if (!boneNames.has(r)) throw new Error(`${p.name} references unknown bone ${r}`)
}
void star
