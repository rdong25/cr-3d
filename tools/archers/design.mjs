// THE ARCHERS — a hooded ranger (one .glb reused for both archers).
//
// Same 22-bone Knight skeleton and pipeline as the Ember Warden:
// SDF pieces -> Surface Nets -> decimation -> baked AO -> skin -> clips.
// Faces +Z, feet at y = 0, ~1.5 units tall. Layers, inside out: athletic body
// in dark cloth; fitted leather cuirass with a second chest guard, baldric,
// belt, pouches, dagger and tassets; cowl + deep hood over a masked, shadowed
// face; magenta braid; short team half-cape off the left shoulder; quiver over
// the right. Recurve bow in the LEFT hand (rigid to hand_L).

import {
  sphere, ellipsoid, capsule, roundBox, torus, cylinder, halfspace, star, bezierTube,
  union, subtract, intersect, offset, band, place, euler, basis, norm, cross, node, fbm, noise3,
} from './sdf.mjs'

// ---------------------------------------------------------------------------
// Skeleton — verbatim Knight BONES (rest pose has identity rotations).
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
  // Cape bones kept (unused by the design, still posed by the clips).
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
// Palette (sRGB): weathered cloth, dark leather, bone, brass, one magenta accent.
// ---------------------------------------------------------------------------
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
const C = {
  skin: hex(0xd2a07a), skinShade: hex(0x7a5441),
  hair: hex(0xcf2675), hairDeep: hex(0x7d1247),
  hood: hex(0x5b6b48), hoodDeep: hex(0x36432f), mask: hex(0x2a2e31),
  cloth: hex(0x3d423c), legging: hex(0x4a3a2c),
  leather: hex(0x6e4526), leatherDark: hex(0x40271a), leatherLight: hex(0x91663a), thread: hex(0xcdb690),
  boot: hex(0x3d291c), sole: hex(0x1c1511),
  wood: hex(0x5e3b1f), woodDark: hex(0x39230f), horn: hex(0x2c2520),
  steel: hex(0x9aa4b2), steelDark: hex(0x5d6570), brass: hex(0xc99b46), brassDeep: hex(0x8f6a2a),
  bone: hex(0xe6dabd), eye: hex(0xe4fbef), fletchPale: hex(0xd9cfb8),
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k]
const clamp01 = (t) => Math.min(1, Math.max(0, t))
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t) }
const flat = (c) => () => c
const grain = (c, amt = 0.08, freq = 60) => (x, y, z) => shade(c, 1 - amt / 2 + amt * fbm(x * freq, y * freq, z * freq, 3))
/** Hammered metal: soft low-frequency dents plus fine grain. */
const hammered = (c, k = 1) => (x, y, z) => shade(c, k * (0.86 + 0.1 * fbm(x * 22, y * 22, z * 22, 3) + 0.06 * noise3(x * 140, y * 140, z * 140)))
/** Worn leather: blotchy large-scale tone plus fine grain. */
const worn = (c, k = 1) => (x, y, z) => shade(c, k * (0.84 + 0.2 * fbm(x * 18, y * 18, z * 18, 3) + 0.08 * noise3(x * 120, y * 120, z * 120)))
const grey = (k) => [k, k, k]

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
const lerp3 = (a, b, t) => add(a, scale(sub(b, a), t))
const lerp = (a, b, t) => a + (b - a) * t
/** Surface point of `n` hit from the outside at height y, compass angle phi (0 = front, + = her left). */
const ringPoint = (n, y, phi, lift = 0) => {
  const o = [Math.sin(phi), 0, Math.cos(phi)]
  return add(surfacePoint(n, [o[0] * 0.8, y, o[2] * 0.8], scale(o, -1)), scale(o, lift))
}

// ---------------------------------------------------------------------------
// Pieces. material: 'soft' | 'metal' | 'team' | 'glow'
// (No glow piece on purpose: the runtime hangs a visor halo and a chest-gem
// halo on any model with a glow material, and she has neither.)
// ---------------------------------------------------------------------------
export const PIECES = []
const piece = (name, material, sdf, paint, skin, res) => PIECES.push({ name, material, sdf, paint, skin, res })
const TORSO_ENV = { envelope: ['hips', 'spine', 'chest'] }

// ---- Body: athletic torso (ribcage > waist < hips), cloth sleeves, leggings ----
const ribcage = ellipsoid([0, 0.935, 0.004], [0.222, 0.172, 0.142])
const waistE = ellipsoid([0, 0.735, 0], [0.142, 0.13, 0.108])
const pelvis = ellipsoid([0, 0.595, -0.004], [0.182, 0.105, 0.138])
const torso = union(0.055, ribcage, waistE, pelvis)
{
  const parts = [torso, capsule([-0.24, 1.03, 0], [0.24, 1.03, 0], 0.07), capsule([0, 1.0, 0], [0, 1.2, 0], 0.06, 0.055)]
  for (const { S, E, W, Hp, K, A } of Object.values(LIMB)) {
    parts.push(sphere(S, 0.08), capsule(S, E, 0.074, 0.064), capsule(E, W, 0.061, 0.047))
    parts.push(capsule(Hp, K, 0.102, 0.075), capsule(K, A, 0.07, 0.054))
  }
  const bodyPaint = (x, y, z) => {
    const weave = 0.86 + 0.16 * fbm(x * 55, y * 55, z * 55, 3)
    if (y < 0.6) return shade(C.legging, weave * (0.92 + 0.08 * Math.sin(y * 150 + x * 30))) // leggings, soft creases
    return shade(C.cloth, weave * (0.9 + 0.1 * Math.sin(y * 170 + z * 40))) // sleeves
  }
  piece('undersuit', 'soft', union(0.045, ...parts), bodyPaint,
    { envelope: ['hips', 'spine', 'chest', 'neck', 'upperarm_L', 'forearm_L', 'upperarm_R', 'forearm_R', 'thigh_L', 'shin_L', 'thigh_R', 'shin_R'] })
}

// ---- Leather cuirass: fitted lower shell with stitched panels + laced front ----
const cuirBase = union(0.035, offset(torso, 0.02),
  ellipsoid([0.085, 0.955, 0.086], [0.088, 0.08, 0.075]), ellipsoid([-0.085, 0.955, 0.086], [0.088, 0.08, 0.075]))
const armhole = (n, k = 0.015) => {
  let o = subtract(k, n, cylinder([0, 1.14, 0], 0.1, 0.1, 0.02))
  for (const s of [1, -1]) o = subtract(k, o, sphere([s * 0.335, 1.0, 0], 0.105))
  return o
}
const seamQ = (x, z) => Math.abs(x) + 0.25 * z - 0.095 // 0 on the side-panel seams
{
  let cuir = armhole(intersect(0.012, cuirBase, halfspace([0, 0.672, 0], [0, -1, 0])))
  for (const s of [1, -1]) cuir = subtract(0.003, cuir, band(cuirBase, 0, 0.006, [s * 0.095, 0, 0], [1, 0, s * 0.25], 0.004))
  cuir = subtract(0.003, cuir, intersect(0, band(cuirBase, 0, 0.006, [0, 0, 0], [1, 0, 0], 0.004), halfspace([0, 0, -0.02], [0, 0, 1])))
  cuir = subtract(0.003, cuir, band(cuirBase, 0, 0.006, [0, 0.772, 0], [0, 1, 0], 0.004))
  const lp = worn(C.leather)
  piece('cuirass', 'soft', cuir, (x, y, z) => {
    const q = seamQ(x, z)
    let c = mix(lp(x, y, z), shade(C.leatherDark, 1.15), 0.55 * sstep(-0.002, 0.004, q)) // side panels darker
    c = shade(c, 0.92 + 0.12 * sstep(0.68, 1.0, y))
    const aq = Math.abs(q)
    if (aq > 0.008 && aq < 0.015 && Math.sin(y * 240) > 0.1) c = mix(c, C.thread, 0.75) // stitches along the seams
    const ay = Math.abs(y - 0.772)
    if (ay > 0.008 && ay < 0.014 && Math.sin(Math.atan2(x, z) * 46) > 0.1) c = mix(c, C.thread, 0.7)
    if (z > 0 && Math.abs(x) < 0.03 && y > 0.69 && y < 0.84) { // laced front
      const f = ((y - 0.69) / 0.0375) % 1
      if (Math.abs(x) < 0.006) c = shade(c, 0.45)
      if (Math.abs(Math.abs(x) / 0.028 - Math.abs(2 * f - 1)) < 0.24) c = mix(c, C.thread, 0.85)
    }
    return c
  }, TORSO_ENV, 0.0055)
}
// Second layer: a darker chest guard over the ribs with a V lower edge.
const guardBase = offset(cuirBase, 0.013)
const guardEdge = (x) => 0.842 + 0.34 * Math.abs(x)
{
  let guard = intersect(0.007, intersect(0.007, guardBase, halfspace([0, 0.842, 0], [0.34, -1, 0])), halfspace([0, 0.842, 0], [-0.34, -1, 0]))
  guard = armhole(guard, 0.012)
  const lp = worn(C.leatherDark, 1.2)
  piece('chest_guard', 'soft', guard, (x, y, z) => {
    let c = lp(x, y, z)
    const e = (y - guardEdge(x)) * 0.95
    if (e < 0.007) c = mix(c, C.leatherLight, 0.5) // rolled edge
    else if (e > 0.012 && e < 0.019 && Math.sin(x * 270) > 0.1) c = mix(c, C.thread, 0.8)
    return c
  }, TORSO_ENV, 0.0055)
  const studs = []
  for (const sx of [-0.15, -0.075, 0, 0.075, 0.15]) studs.push(sphere(surfacePoint(guardBase, [sx, guardEdge(sx) + 0.036, 1], [0, 0, -1]), 0.0105))
  piece('guard_studs', 'metal', union(0, ...studs), flat(C.brass), TORSO_ENV, 0.004)
}
// Quiver baldric: right shoulder to left hip, with a brass buckle on the chest.
{
  const P0 = [-0.02, 0.87, 0], N = norm([1, 1, 0])
  const strapBand = intersect(0.004, band(cuirBase, 0.019, 0.011, P0, N, 0.022), halfspace([0, 0.69, 0], [0, -1, 0]))
  // stops just under the cowl's hem instead of poking through the cloth
  const strap = node((x, y, z) => Math.max(strapBand.d(x, y, z), y - cowlHem(x, z) - 0.012), [-0.3, 0.68, -0.25], [0.3, 1.0, 0.25])
  piece('baldric', 'soft', strap, (x, y, z) => {
    const t = Math.abs((x - P0[0]) * N[0] + (y - P0[1]) * N[1])
    let c = shade(C.leatherLight, 0.85 + 0.2 * fbm(x * 60, y * 60, z * 60, 3))
    if (t > 0.016) c = shade(c, 0.55)
    else if (t > 0.009 && t < 0.013 && Math.sin((x - y) * 190) > 0.2) c = mix(c, C.thread, 0.6)
    return c
  }, TORSO_ENV, 0.005)
  const c = surfacePoint(offset(cuirBase, 0.032), [0.045, 0.805, 1], [0, 0, -1])
  const R = euler(0, 0, Math.PI / 4)
  const frame = subtract(0.003, roundBox(c, [0.036, 0.026, 0.011], 0.008, R), roundBox(c, [0.021, 0.012, 0.03], 0.005, R))
  piece('baldric_buckle', 'metal', union(0.004, frame, capsule(add(c, [-0.018, -0.018, 0.006]), add(c, [0.012, 0.012, 0.008]), 0.0055)), flat(C.brass), TORSO_ENV, 0.004)
}

// ---- Belt, buckle, pouches, dagger ----
const beltOuter = offset(torso, 0.044)
piece('belt', 'soft', band(torso, 0.026, 0.018, [0, 0.652, 0], [0, 1, 0], 0.03),
  (x, y, z) => {
    let c = mix(shade(C.leather, 0.95 + 0.15 * fbm(x * 60, y * 60, z * 60, 3)), C.leatherDark, sstep(0.019, 0.027, Math.abs(y - 0.652)))
    if (Math.abs(Math.abs(y - 0.652) - 0.015) < 0.003 && Math.sin(Math.atan2(x, z) * 60) > 0.2) c = mix(c, C.thread, 0.6)
    return c
  }, { envelope: ['hips', 'spine'] }, 0.0055)
{
  const c = add(surfacePoint(beltOuter, [0, 0.652, 1], [0, 0, -1]), [0, 0, 0.008])
  const frame = subtract(0.004, roundBox(c, [0.05, 0.04, 0.014], 0.012), roundBox(c, [0.028, 0.019, 0.04], 0.007))
  piece('buckle', 'metal', union(0.005, frame, capsule(add(c, [-0.026, 0, 0.01]), add(c, [0.012, 0, 0.011]), 0.007)), hammered(C.brass, 1.1), { rigid: { hips: 1 } }, 0.0045)
}
function pouch(name, phi, w, h) {
  const o = [Math.sin(phi), 0, Math.cos(phi)], R = euler(0, phi, 0)
  const c = ringPoint(beltOuter, 0.64, phi)
  const bodyC = add(add(c, scale(o, 0.022)), [0, -0.05, 0])
  const body = roundBox(bodyC, [w, h, 0.03], 0.02, R)
  const flapC = add(add(c, scale(o, 0.03)), [0, -0.022, 0])
  const flap = roundBox(flapC, [w + 0.004, h * 0.6, 0.028], 0.016, R)
  piece(`${name}`, 'soft', body, worn(C.leather, 0.95), { rigid: { hips: 1 } })
  piece(`${name}_flap`, 'soft', flap, (x, y, z) => {
    let c2 = worn(C.leatherDark, 1.25)(x, y, z)
    if (y < flapC[1] - h * 0.6 + 0.012) c2 = mix(c2, C.thread, 0.45)
    return c2
  }, { rigid: { hips: 1 } })
  piece(`${name}_stud`, 'metal', sphere(add(add(c, scale(o, 0.06)), [0, -0.04, 0]), 0.011), flat(C.brass), { rigid: { hips: 1 } }, 0.004)
}
pouch('pouch_L', 0.95, 0.05, 0.048)
pouch('pouch_R', -2.05, 0.04, 0.04)
{
  // Dagger on the right hip: wrapped hilt above the belt, sheath raked back over the thigh.
  const phi = -1.2, o = [Math.sin(phi), 0, Math.cos(phi)]
  const c = ringPoint(beltOuter, 0.655, phi, 0.024)
  const d = norm([-0.3, -1, -0.3])
  const top = add(c, scale(d, -0.012)), tip = add(c, scale(d, 0.2))
  const rig = { rigid: { hips: 1 } }
  const sheath = union(0.006, capsule(top, tip, 0.023, 0.013))
  piece('dagger_sheath', 'soft', sheath, (x, y, z) => {
    const t = (x - c[0]) * d[0] + (y - c[1]) * d[1] + (z - c[2]) * d[2]
    let col = worn(C.leatherDark, 1.15)(x, y, z)
    if (Math.abs(t - 0.07) < 0.01) col = C.leatherLight
    return col
  }, rig, 0.005)
  piece('dagger_fittings', 'metal', union(0,
    torus(add(c, scale(d, 0.002)), 0.022, 0.008, frameY(d)),
    capsule(add(c, scale(d, 0.185)), add(c, scale(d, 0.222)), 0.015, 0.006),
    roundBox(add(c, scale(d, -0.022)), [0.04, 0.008, 0.013], 0.006, frameY(d, [o[2], 0, -o[0]])),
    sphere(add(c, scale(d, -0.118)), 0.017)), hammered(C.brass, 1.05), rig, 0.004)
  piece('dagger_grip', 'soft', capsule(add(c, scale(d, -0.028)), add(c, scale(d, -0.105)), 0.0135, 0.012),
    (x, y, z) => shade(C.mask, 0.9 + 0.5 * (0.5 + 0.5 * Math.sin(((x - c[0]) * d[0] + (y - c[1]) * d[1] + (z - c[2]) * d[2]) * 420))), rig, 0.004)
}

// ---- Leather tassets: a ring of tongue-shaped strips hanging from the belt ----
const NSTRIP = 10, STRIP = (Math.PI * 2) / NSTRIP
const skirtEll = (y) => { const u = Math.max(0, 0.66 - y); return [0.218 + 0.34 * u, 0.152 + 0.27 * u] }
const skirtSkin = (x, y, z) => {
  const t = 0.62 * sstep(0.64, 0.46, y)
  const wl = clamp01(x / 0.12), wr = clamp01(-x / 0.12)
  return { hips: 1 - t * (wl + wr), thigh_L: t * wl, thigh_R: t * wr }
}
{
  const stripOf = (x, z) => { const phi = Math.atan2(x, z + 0.004); const k = Math.floor(phi / STRIP); return { phi, k, w: phi / STRIP - k - 0.5 } }
  const shape = (x, y, z) => {
    const [a, b] = skirtEll(y)
    const qx = x / a, qz = (z + 0.004) / b
    const k0 = Math.hypot(qx, qz), k1 = Math.hypot(qx / a, qz / b)
    const ell = k1 === 0 ? -0.1 : (k0 * (k0 - 1)) / k1
    const { k, w } = stripOf(x, z)
    const r = Math.hypot(x, z)
    const hem = 0.452 + 0.075 * Math.pow(Math.abs(2 * w), 2.6) + (k % 2 === 0 ? 0 : 0.018)
    const front = k === 0 || k === -1 ? 1 : -1 // the two front strips are left out (the loincloth hangs there)
    return Math.max(Math.abs(ell - 0.003 * (k % 2 === 0 ? 1 : -1)) - 0.008, hem - y, y - 0.665, (Math.abs(w) - 0.455) * r * STRIP, front)
  }
  const lp = worn(C.leather, 0.92)
  piece('tassets', 'soft', node(shape, [-0.32, 0.44, -0.29], [0.32, 0.67, 0.29]), (x, y, z) => {
    const { k, w } = stripOf(x, z)
    let c = shade(lp(x, y, z), k % 2 === 0 ? 1 : 0.8)
    const hem = 0.452 + 0.075 * Math.pow(Math.abs(2 * w), 2.6) + (k % 2 === 0 ? 0 : 0.018)
    const e = Math.min((0.455 - Math.abs(w)) * 0.12, (y - hem) * 0.8)
    if (e < 0.008) c = shade(c, 0.55)
    return c
  }, { fn: skirtSkin }, 0.0055)
  const studs = []
  for (let k = -NSTRIP / 2; k < NSTRIP / 2; k++) {
    if (k === 0 || k === -1) continue
    const phi = (k + 0.5) * STRIP, y = 0.492 + (k % 2 === 0 ? 0 : 0.018)
    const [a, b] = skirtEll(y)
    const r = 1 / Math.hypot(Math.sin(phi) / a, Math.cos(phi) / b) + 0.011
    studs.push(sphere([r * Math.sin(phi), y, r * Math.cos(phi) - 0.004], 0.0115))
  }
  piece('tasset_studs', 'metal', union(0, ...studs), flat(C.brass), { fn: skirtSkin }, 0.004)
}

// ---- Team loincloth, hinged at the belt ----
{
  const cut = (n) => intersect(0.005, intersect(0.005, n, halfspace([0, 0.34, 0], [0.7, -1, 0])), halfspace([0, 0.34, 0], [-0.7, -1, 0]))
  const front = cut(roundBox([0, 0.5, 0.172], [0.072, 0.165, 0.009], 0.007, euler(-0.07, 0, 0)))
  const arrow = union(0, roundBox([0, 0.5, 0.17], [0.008, 0.06, 0.05], 0.004),
    intersect(0, intersect(0, roundBox([0, 0.57, 0.17], [0.04, 0.04, 0.05], 0), halfspace([0, 0.6, 0], [1, 1, 0])), halfspace([0, 0.6, 0], [-1, 1, 0])))
  piece('tabard_front', 'team', front, (x, y, z) => {
    const edge = Math.min(0.072 - Math.abs(x), (y - (0.34 + 0.7 * Math.abs(x))) * 0.8, 0.665 - y)
    let k = 0.92 - 0.1 * fbm(x * 30, y * 90, z * 30, 3) - 0.05 * (0.5 + 0.5 * Math.sin(x * 110))
    if (edge < 0.016) k *= 0.42
    if (arrow.d(x, y, z) < 0) k *= 0.42
    return grey(k)
  }, { rigid: { tabard_F: 1 } }, 0.005)
}

// ---- Left spaulder (bow arm): three overlapping leather lames, dark rolled edges, studs ----
{
  const { S } = LIMB.L
  const w = { upperarm_L: 0.5, chest: 0.5 }, own = { rigid: w, occluder: 'spaulder' }
  const lames = [
    { rz: -0.5, out: 0.066, r: [0.122, 0.06, 0.12] },
    { rz: -0.92, out: 0.05, r: [0.104, 0.052, 0.124] },
    { rz: -1.22, out: 0.032, r: [0.086, 0.045, 0.112], down: 0.075 },
  ].map((l) => {
    const dir = [-Math.sin(l.rz), Math.cos(l.rz), 0], tan = [Math.cos(l.rz), Math.sin(l.rz), 0] // plate normal, and down-the-arm
    const c = add(add(S, scale(dir, l.out)), scale(tan, l.down || 0))
    const R = euler(0, 0, l.rz)
    const dome = ellipsoid(c, l.r, R)
    const inner = ellipsoid(sub(c, scale(dir, 0.024)), [l.r[0] - 0.008, l.r[1], l.r[2] - 0.008], R)
    return { ...l, dir, tan, c, R, dome, shell: subtract(0.005, dome, inner) }
  })
  const studs = []
  lames.forEach((l, i) => {
    const sdf = i === 0 ? l.shell : subtract(0.004, l.shell, offset(lames[i - 1].dome, 0.004))
    const lp = worn(i === 1 ? C.leatherDark : C.leather, i === 1 ? 1.35 : 0.98)
    piece(`spaulder_${i}`, 'soft', sdf, (x, y, z) => {
      const q = sub([x, y, z], l.c)
      const h = q[0] * l.dir[0] + q[1] * l.dir[1] // height above the plate's rim plane
      let c = lp(x, y, z)
      if (h < -0.012) c = shade(C.leatherDark, 0.8) // rolled edge
      else if (h > -0.006 && h < 0.001 && Math.sin(Math.atan2(q[2], q[0] * l.tan[0] + q[1] * l.tan[1]) * 22) > 0.1) c = mix(c, C.thread, 0.7)
      if (i === 0 && Math.abs(z) < 0.007) c = shade(c, 0.6) // centre seam
      return c
    }, own, 0.0055)
    for (const a of i === 0 ? [-1.75, -0.8, 0, 0.8, 1.75] : [-1.2, 0, 1.2]) {
      const loc = [Math.cos(a), 0.22, Math.sin(a)]
      const d = norm(add(add(scale(l.tan, loc[0]), scale(l.dir, loc[1])), [0, 0, loc[2]]))
      studs.push(sphere(surfacePoint(l.dome, add(l.c, scale(d, 0.5)), scale(d, -1)), 0.0105))
    }
  })
  piece('spaulder_studs', 'metal', union(0, ...studs), flat(C.brass), own, 0.004)
}

// ---- Arms: archer's arm guard (left), short bracer (right), fingerless gloves ----
for (const [side, { s, S, E, W, F }] of Object.entries(LIMB)) {
  const dir = norm(sub(W, E))
  const fore = { rigid: { [`forearm_${side}`]: 1 } }
  const a0 = add(E, scale(dir, side === 'L' ? 0.028 : 0.06)), a1 = sub(W, scale(dir, 0.03))
  const sleeve = capsule(a0, a1, 0.071, 0.057)
  // flat cuff at the wrist; the elbow end stays rounded so a bent arm never shows a cut face
  const bracer = intersect(0.006, sleeve, halfspace(a1, dir))
  const lp = worn(C.leather, 0.95)
  const along = (x, y, z) => (x - a0[0]) * dir[0] + (y - a0[1]) * dir[1] + (z - a0[2]) * dir[2]
  const L = Math.hypot(...sub(a1, a0))
  piece(`bracer_${side}`, 'soft', bracer, (x, y, z) => {
    const t = along(x, y, z) / L
    let c = lp(x, y, z)
    // lacing down the outer side
    const out = (x - lerp(a0[0], a1[0], t)) * s
    if (out > 0.03 && Math.abs(z - lerp(a0[2], a1[2], t)) < 0.022) {
      const f = (t * 5) % 1
      if (Math.abs(Math.abs(z - lerp(a0[2], a1[2], t)) / 0.02 - Math.abs(2 * f - 1)) < 0.3) c = mix(c, C.thread, 0.8)
    }
    if (t < 0.07 || t > 0.93) c = shade(c, 0.6)
    return c
  }, fore, 0.005)
  if (side === 'L') {
    // Arm guard plate: a stiff second layer over the inside of the bow forearm.
    const plate = intersect(0.006, intersect(0.006, intersect(0.006, offset(sleeve, 0.011), halfspace(add(a0, scale(dir, 0.012)), scale(dir, -1))), halfspace(sub(a1, scale(dir, 0.012)), dir)),
      halfspace(lerp3(a0, a1, 0.5), [1, 0, -0.55]))
    piece('armguard', 'soft', plate, (x, y, z) => {
      const t = along(x, y, z) / L
      let c = worn(C.leatherDark, 1.25)(x, y, z)
      if (Math.abs(((t * 4 + 0.5) % 1) - 0.5) < 0.07) c = shade(c, 0.6) // tooled ribs
      return c
    }, fore, 0.005)
  }
  const straps = [], buckles = []
  for (const t of side === 'L' ? [0.2, 0.5, 0.8] : [0.28, 0.74]) {
    const p = lerp3(a0, a1, t), r = lerp(0.071, 0.057, t) + (side === 'L' ? 0.012 : 0.003)
    straps.push(torus(p, r - 0.003, 0.0065, frameY(dir)))
    buckles.push(roundBox(add(p, [s * (r + 0.001), 0, -0.004]), [0.007, 0.013, 0.012], 0.005, frameY(dir)))
  }
  piece(`bracer_straps_${side}`, 'soft', union(0, ...straps), grain(shade(C.leatherLight, 0.8), 0.2, 80), fore, 0.005)
  piece(`bracer_buckles_${side}`, 'metal', union(0, ...buckles), flat(C.brass), fore, 0.004)
  // Leather elbow pad: rounds off the joint when the arm folds (the draw hand comes right back to the jaw).
  piece(`elbow_${side}`, 'soft', ellipsoid(add(E, [s * 0.014, 0.002, -0.026]), [0.056, 0.062, 0.054]), worn(C.leatherDark, 1.3),
    { rigid: { [`upperarm_${side}`]: 0.5, [`forearm_${side}`]: 0.5 } })

  // Fingerless glove: leather palm and wrist, bare curled fingers and thumb.
  const hdir = norm(sub(F, W))
  const hand = { rigid: { [`hand_${side}`]: 1 }, occluder: 'hands' }
  // The bow hand sits a little low so the arrow rides over the top of the fist.
  const fistC = add(add(W, scale(hdir, 0.058)), side === 'L' ? [0, 0, -0.04] : [0, 0, 0])
  const R = frameY(hdir)
  const palm = union(0.03, roundBox(fistC, [0.04, 0.05, 0.04], 0.028, R), sphere(W, 0.043))
  const glovePaint = worn(C.leatherDark, 1.3)
  piece(`glove_${side}`, 'soft', palm, (x, y, z) => {
    let c = glovePaint(x, y, z)
    const t = (x - W[0]) * hdir[0] + (y - W[1]) * hdir[1] + (z - W[2]) * hdir[2]
    if (Math.abs(t + 0.004) < 0.007) c = mix(c, C.leatherLight, 0.7) // cuff
    return c
  }, hand, 0.005)
  const fingers = []
  if (side === 'L') {
    // wrapped round the bow grip: four fingers across the front, thumb over the top
    for (const dz of [-0.029, -0.01, 0.009, 0.028]) fingers.push(capsule([fistC[0] - 0.024, fistC[1] - 0.052, fistC[2] + dz], [fistC[0] + 0.034, fistC[1] - 0.05, fistC[2] + dz], 0.0115))
    fingers.push(capsule([fistC[0] - 0.036, fistC[1] - 0.005, fistC[2] + 0.03], [fistC[0] - 0.018, fistC[1] - 0.05, fistC[2] + 0.04], 0.0125, 0.011))
  } else {
    for (const dz of [-0.029, -0.01, 0.009, 0.028]) fingers.push(capsule(add(fistC, [0.02, -0.04, dz]), add(fistC, [-0.034, -0.05, dz]), 0.0115))
    fingers.push(capsule(add(fistC, [0.034, 0.0, 0.03]), add(fistC, [0.02, -0.045, 0.046]), 0.0125, 0.011))
  }
  piece(`fingers_${side}`, 'soft', union(0.004, ...fingers), grain(C.skin, 0.1, 60), hand, 0.004)
}

// ---- Legs: knee pads, tall soft boots with folded cuffs ----
for (const [side, { s, K, A }] of Object.entries(LIMB)) {
  const knee = { rigid: { [`thigh_${side}`]: 0.4, [`shin_${side}`]: 0.6 } }
  const pad = ellipsoid(add(K, [0, 0.004, 0.05]), [0.06, 0.066, 0.042])
  piece(`kneepad_${side}`, 'soft', pad, worn(C.leather, 1.05), knee)
  piece(`kneepad_stud_${side}`, 'metal', sphere(add(K, [0, 0.004, 0.094]), 0.013), flat(C.brass), knee, 0.004)
  const shin = { rigid: { [`shin_${side}`]: 1 } }, foot = { rigid: { [`foot_${side}`]: 1 } }
  const x0 = s * 0.16
  const shaft = union(0.02, capsule([x0, 0.275, 0.006], [x0, 0.12, 0], 0.079, 0.064), sphere([x0, 0.11, 0], 0.066))
  const bootPaint = (x, y, z) => shade(C.boot, 0.82 + 0.22 * fbm(x * 40, y * 40, z * 40, 3) + 0.1 * Math.sin(y * 120 + Math.sin(x * 40) * 2) * sstep(0.26, 0.1, y))
  piece(`boot_${side}`, 'soft', intersect(0.006, shaft, halfspace([0, 0.285, 0], [0, 1, 0])), bootPaint, shin)
  const cuff = intersect(0.008, intersect(0.008, capsule([x0, 0.31, 0.006], [x0, 0.25, 0.004], 0.092, 0.086), halfspace([0, 0.3, 0], [0, 1, 0.12])), halfspace([0, 0.247, 0], [0, -1, 0]))
  piece(`boot_cuff_${side}`, 'soft', cuff, (x, y, z) => {
    let c = worn(C.leather, 0.9)(x, y, z)
    if (y < 0.262 && Math.sin(Math.atan2(x - x0, z) * 22) > 0) c = mix(c, C.thread, 0.6)
    return c
  }, shin)
  piece(`boot_trim_${side}`, 'team', band(capsule([x0, 0.31, 0.006], [x0, 0.25, 0.004], 0.092, 0.086), 0.002, 0.006, [0, 0.29, 0], [0, 1, 0.12], 0.008), () => grey(0.8), shin, 0.0055)
  const sole = union(0.03, roundBox([x0, 0.058, 0.05], [0.066, 0.058, 0.125], 0.045), ellipsoid([x0, 0.05, 0.145], [0.064, 0.05, 0.07]))
  piece(`boot_foot_${side}`, 'soft', intersect(0.008, sole, halfspace([0, 0.002, 0], [0, -1, 0])),
    (x, y, z) => (y < 0.022 ? C.sole : bootPaint(x, y, z)), foot)
  // ankle strap with a small buckle
  piece(`boot_strap_${side}`, 'soft', torus([x0, 0.125, 0.004], 0.07, 0.01, euler(0.25, 0, 0)), grain(C.leatherLight, 0.2, 80), shin, 0.004)
  piece(`boot_buckle_${side}`, 'metal', roundBox([x0 + s * 0.07, 0.125, 0.004], [0.007, 0.016, 0.014], 0.005), flat(C.brass), shin, 0.004)
}

// ---- Cowl: a shoulder mantle with a rolled collar and a ragged, team-trimmed hem ----
// (the mantle is the chest guard's surface pushed out, so its hem stands proud of the leather)
const cowlBody = union(0.04,
  capsule([-0.25, 1.035, -0.005], [0.25, 1.035, -0.005], 0.093),
  sphere([0.32, 1.028, 0], 0.099), sphere([-0.32, 1.028, 0], 0.099),
  offset(guardBase, 0.016),
  torus([0, 1.135, -0.005], 0.126, 0.042))
const cowlHem = (x, z) => {
  const phi = Math.atan2(x, z), cf = Math.cos(phi)
  return 0.965 - 0.045 * Math.pow(Math.max(0, cf), 3) - 0.035 * Math.pow(Math.max(0, -cf), 3) + 0.008 * Math.sin(phi * 9 + 0.5)
}
const COWL_MIN = [-0.46, 0.9, -0.26], COWL_MAX = [0.46, 1.2, 0.26]
const armSocket = union(0, ...Object.values(LIMB).map(({ S, E }) => union(0.02, sphere(S, 0.087), capsule(S, E, 0.082, 0.072))))
const cowl = node((x, y, z) => Math.max(cowlBody.d(x, y, z), cowlHem(x, z) - y, -armSocket.d(x, y, z)), COWL_MIN, COWL_MAX)
{
  piece('cowl', 'soft', cowl, (x, y, z) => {
    const phi = Math.atan2(x, z)
    const fold = 0.5 + 0.5 * Math.sin(phi * 13 + Math.sin(y * 30) * 1.5)
    let c = shade(mix(C.hoodDeep, C.hood, 0.3 + 0.7 * sstep(0.95, 1.12, y)), 0.8 + 0.2 * fold * sstep(1.12, 1.0, y) + 0.16 * fbm(x * 35, y * 35, z * 35, 3))
    if (y > 1.1 && y < 1.18 && Math.sin(phi * 30) > 0.3 && Math.hypot(x, z) > 0.15) c = mix(c, C.thread, 0.4) // whip-stitched collar roll
    return c
  }, { rigid: { chest: 1 } }, 0.0055)
  const trim = node((x, y, z) => Math.max(Math.abs(cowlBody.d(x, y, z) - 0.003) - 0.006, Math.abs(y - cowlHem(x, z) - 0.021) - 0.02, -armSocket.d(x, y, z)), COWL_MIN, COWL_MAX)
  piece('cowl_trim', 'team', trim, (x, y, z) => { const e = y - cowlHem(x, z); return grey(e < 0.009 ? 0.4 : 0.82) }, { rigid: { chest: 1 } }, 0.0065)
  // Brass cloak brooch on the left collarbone.
  const c = surfacePoint(cowlBody, [0.16, 1.035, 1], [0, 0, -1])
  piece('brooch', 'metal', union(0.004, cylinder(add(c, [0, 0, 0.004]), 0.034, 0.009, 0.005, euler(Math.PI / 2 - 0.3, 0, 0)), sphere(add(c, [0, 0.003, 0.012]), 0.016)), hammered(C.brass, 1.1), { rigid: { chest: 1 } }, 0.004)
}

// ---- Head: deep hood, shadowed face, cloth half-mask, pale eyes, magenta fringe ----
const HC = [0, 1.325, 0.018]
const hoodOuter = union(0.045,
  ellipsoid([0, 1.35, -0.012], [0.155, 0.168, 0.172]),
  ellipsoid([0, 1.432, -0.14], [0.062, 0.05, 0.105], euler(-0.5, 0, 0)), // drooping point at the back
  ellipsoid([0, 1.452, 0.1], [0.102, 0.042, 0.088], euler(0.25, 0, 0)), // brim that shades the face
  capsule([0, 1.14, -0.005], [0, 1.3, -0.01], 0.116, 0.13))
const opening = ellipsoid([0, 1.312, 0.17], [0.108, 0.122, 0.105])
{
  const head = { rigid: { head: 1 }, occluder: 'head' }
  const hood = intersect(0.01, subtract(0.014, hoodOuter, opening), halfspace([0, 1.1, 0], [0, -1, 0]))
  piece('hood', 'soft', hood, (x, y, z) => {
    let c = mix(C.hoodDeep, C.hood, 0.3 + 0.7 * sstep(1.2, 1.5, y))
    c = shade(c, 0.84 + 0.2 * fbm(x * 30, y * 30, z * 30, 3) + 0.06 * Math.sin(y * 90 + x * 40))
    if (Math.abs(x) < 0.005 && y > 1.38) c = shade(c, 0.6) // centre seam
    else if (Math.abs(Math.abs(x) - 0.012) < 0.004 && y > 1.38 && Math.sin((z - y) * 200) > 0.1) c = mix(c, C.thread, 0.45)
    return c
  }, head, 0.0055)
  const rimD = (x, y, z) => { const h = hoodOuter.d(x, y, z); return Math.max(h - 0.004, -h - 0.012, Math.abs(opening.d(x, y, z) + 0.002) - 0.0085) }
  piece('hood_trim', 'soft', node(rimD, [-0.15, 1.16, 0.0], [0.15, 1.47, 0.22]), (x, y, z) => {
    return shade(C.leatherDark, 1.15 + 0.3 * fbm(x * 60, y * 60, z * 60, 3))
  }, head, 0.005)

  const skull = ellipsoid(HC, [0.1, 0.122, 0.106])
  const face = union(0.012, skull,
    ellipsoid([0, 1.31, 0.118], [0.017, 0.03, 0.022]), // nose
    capsule([-0.052, 1.357, 0.098], [0.052, 1.357, 0.098], 0.014), // brow ridge
    ellipsoid([0, 1.245, 0.075], [0.058, 0.05, 0.05])) // jaw
  piece('face', 'soft', face, (x, y, z) => {
    let c = mix(C.skin, C.skinShade, 0.1 + 0.55 * sstep(1.35, 1.42, y))
    const band = sstep(0.024, 0.012, Math.abs(y - 1.337)) // dark warpaint across the eyes
    c = mix(c, [0.09, 0.06, 0.08], 0.8 * band)
    return shade(c, 0.94 + 0.1 * fbm(x * 50, y * 50, z * 50, 3))
  }, head, 0.005)
  const mask = intersect(0.004, intersect(0.004, offset(face, 0.008), halfspace([0, 1.31, 0.1], [0, 1, -0.4])), halfspace([0, 0, 0.0], [0, 0, -1]))
  piece('mask', 'soft', mask, (x, y, z) => {
    let c = shade(C.mask, 0.85 + 0.3 * fbm(x * 45, y * 45, z * 45, 3) + 0.12 * Math.sin(y * 210 + Math.abs(x) * 60))
    if (y - 0.4 * (z - 0.1) > 1.299) c = shade(C.hood, 0.9) // folded top hem
    return c
  }, head, 0.0045)
  for (const s of [1, -1]) {
    const p = surfacePoint(face, [s * 0.041, 1.337, 1], [0, 0, -1])
    piece(`eye_${s > 0 ? 'L' : 'R'}`, 'soft', ellipsoid(add(p, [0, 0, -0.001]), [0.018, 0.0068, 0.008], euler(0, 0, s * 0.16)), flat(C.eye), head, 0.003)
    // Magenta fringe escaping the hood beside the face.
  }
  {
    // Magenta fringe: a swept lock across the brow and down her left cheek.
    const lock = union(0.008,
      bezierTube([-0.02, 1.43, 0.118], [0.04, 1.428, 0.132], [0.088, 1.395, 0.12], [0.098, 1.3, 0.106], 0.015, 0.009, 10, 0.01),
      bezierTube([-0.01, 1.432, 0.116], [-0.05, 1.426, 0.126], [-0.082, 1.405, 0.116], [-0.094, 1.36, 0.103], 0.012, 0.007, 8, 0.01))
    piece('fringe', 'soft', lock, (x, y, z) => shade(mix(C.hair, C.hairDeep, sstep(1.42, 1.28, y) * 0.5), 0.82 + 0.3 * (0.5 + 0.5 * Math.sin(x * 420 + z * 300))), head, 0.004)
  }
}

// ---- Magenta braid: out from under the hood at the collar, over the cowl, down the right of the chest ----
{
  const front = union(0, cowlBody, guardBase)
  const pts = []
  const N = 13
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const y = lerp(1.168, 0.83, t)
    const x = -0.082 - 0.045 * Math.sin(t * Math.PI * 0.6) + 0.006 * Math.sin(t * 9)
    const p = surfacePoint(front, [x, y, 0.6], [0, 0, -1])
    pts.push([x, y, p[2] + 0.011])
  }
  for (let pass = 0; pass < 3; pass++) for (let i = 1; i < N; i++) pts[i][2] = (pts[i - 1][2] + 2 * pts[i][2] + pts[i + 1][2]) / 4 // relax
  const knots = []
  for (let i = 0; i < N; i++) {
    const a = pts[i], b = pts[i + 1], t = i / N
    const r = lerp(0.021, 0.014, t)
    const side = i % 2 === 0 ? 1 : -1
    const m = lerp3(a, b, 0.5)
    knots.push(ellipsoid([m[0] + side * 0.006, m[1], m[2]], [r * 0.85, r * 1.3, r * 0.8], euler(0, 0, side * 0.6)))
  }
  const end = pts[N]
  const braid = union(0.006, ...knots)
  piece('braid', 'soft', braid, (x, y, z) => {
    const st = 0.5 + 0.5 * Math.sin((y + Math.abs(x + 0.1) * 0.8) * 420)
    return shade(mix(C.hair, C.hairDeep, 0.1 + 0.45 * sstep(1.17, 0.83, y)), 0.8 + 0.3 * st)
  }, { rigid: { chest: 1 } }, 0.0045)
  piece('braid_tie', 'metal', torus(add(end, [0, 0.012, 0]), 0.012, 0.0075), flat(C.brass), { rigid: { chest: 1 } }, 0.004)
  piece('braid_tuft', 'soft', capsule(add(end, [0, 0.005, 0]), add(end, [0.004, -0.065, -0.006]), 0.015, 0.003),
    (x, y, z) => shade(C.hairDeep, 0.9 + 0.5 * (0.5 + 0.5 * Math.sin(x * 600))), { rigid: { chest: 1 } }, 0.004)
}

// ---- Half-cape: short team cloak off the left shoulder, on the cape bone chain ----
{
  const TOP = 1.05, BOTTOM = 0.42
  const frame = (x, y, z) => {
    const u = Math.max(0, TOP - y)
    const cz = -0.02 - 0.05 * u
    const phi = Math.atan2(x, -(z - cz))
    const hem = BOTTOM + 0.022 * Math.sin(phi * 7 + 1.2) + 0.15 * sstep(0.9, -0.35, phi)
    const edge = u < 0.42 ? -0.125 + 0.21 * u : -0.037 - 0.4 * (u - 0.42) // inner edge runs down beside the quiver
    return { u, cz, phi, hem, edge }
  }
  const shape = (x, y, z) => {
    const { u, cz, phi, hem, edge } = frame(x, y, z)
    const fold = 1 + 0.1 * Math.min(1, u * 2.4) * Math.sin(phi * 7 + 0.6)
    const a = (0.285 + 0.3 * u) * fold, b = (0.15 + 0.2 * u) * fold
    const qx = x / a, qz = (z - cz) / b
    const k0 = Math.hypot(qx, qz), k1 = Math.hypot(qx / a, qz / b)
    const ell = k1 === 0 ? -0.1 : (k0 * (k0 - 1)) / k1
    return Math.max(Math.abs(ell) - 0.0105, hem - y, y - TOP, (z - cz) + 0.035, edge - x)
  }
  const capeBones = (x, y, z) => {
    const knots = [['chest', 1.06], ['cape_1', 0.99], ['cape_2', 0.74], ['cape_3', 0.47]]
    if (y >= knots[0][1]) return { chest: 1 }
    for (let i = 0; i < knots.length - 1; i++) {
      const [a, ya] = knots[i], [b, yb] = knots[i + 1]
      if (y <= ya && y >= yb) { const t = (ya - y) / (ya - yb); return { [a]: 1 - t, [b]: t } }
    }
    return { cape_3: 1 }
  }
  piece('cape', 'team', node(shape, [-0.3, 0.38, -0.48], [0.56, 1.06, 0.0]), (x, y, z) => {
    const { phi, hem, edge } = frame(x, y, z)
    let k = 0.84 - 0.12 * fbm(x * 30, y * 60, z * 30, 3) + 0.13 * Math.sin(phi * 7 + 0.6)
    const e = Math.min(y - hem, (x - edge) * 0.9)
    if (e < 0.03) k *= 0.42 // dark border
    else if (e < 0.042) k *= 1.08
    return grey(Math.min(1, k))
  }, { fn: capeBones }, 0.006)
}

// ---- Quiver over the right shoulder: stitched leather tube, brass mounts, five fletched arrows ----
{
  const qb = [-0.105, 0.66, -0.172], qt = [-0.215, 1.1, -0.2]
  const ax = norm(sub(qt, qb)), R = frameY(ax)
  const rig = { rigid: { chest: 1 } }
  const tube = capsule(qb, qt, 0.052, 0.062)
  let quiver = intersect(0.006, tube, halfspace(qt, ax))
  quiver = subtract(0.006, quiver, capsule(sub(qt, scale(ax, 0.03)), add(qt, scale(ax, 0.05)), 0.047)) // open mouth
  const along = (x, y, z) => (x - qb[0]) * ax[0] + (y - qb[1]) * ax[1] + (z - qb[2]) * ax[2]
  const QL = Math.hypot(...sub(qt, qb))
  const lp = worn(C.leather, 0.9)
  piece('quiver', 'soft', quiver, (x, y, z) => {
    const t = along(x, y, z) / QL
    let c = lp(x, y, z)
    if (t > 0.97) c = shade(C.leatherDark, 0.5) // dark inside the mouth
    // stitched seam down the outer face + diamond tooling
    const side = (x - lerp(qb[0], qt[0], t)) * R[0] + (y - lerp(qb[1], qt[1], t)) * R[3] + (z - lerp(qb[2], qt[2], t)) * R[6]
    if (z < lerp(qb[2], qt[2], t) - 0.03) {
      if (Math.abs(side) < 0.004) c = shade(c, 0.5)
      else if (Math.abs(Math.abs(side) - 0.011) < 0.004 && Math.sin(t * 150) > 0) c = mix(c, C.thread, 0.75)
    }
    return c
  }, rig, 0.0055)
  const mounts = [0.93, 0.5].map((t) => band(tube, 0.003, 0.006, lerp3(qb, qt, t), ax, t > 0.9 ? 0.02 : 0.012))
  piece('quiver_mounts', 'metal', union(0, ...mounts, intersect(0.004, offset(tube, 0.005), halfspace(add(qb, scale(ax, -0.004)), ax))), hammered(C.brass, 1.05), rig, 0.0045)
  const shafts = [], vanes = [[], []], nocks = []
  const slots = [[0.004, 0.004, 0.26], [0.026, 0.014, 0.21], [-0.024, 0.012, 0.23], [0.0, -0.026, 0.2]]
  slots.forEach(([lx, lz, len], i) => {
    // each arrow leans a little differently in the tube
    const lean = norm(add(ax, [lx * 0.5, 0, lz * 0.5]))
    const base = add(sub(qt, scale(ax, 0.04)), [R[0] * lx + R[2] * lz, R[3] * lx + R[5] * lz, R[6] * lx + R[8] * lz])
    const end = add(base, scale(lean, len + 0.04))
    shafts.push(capsule(base, end, 0.008))
    nocks.push(sphere(end, 0.0105))
    const Ra = frameY(lean)
    for (let v = 0; v < 3; v++) {
      const vane = place(roundBox([0, 0, 0.0195], [0.004, 0.042, 0.0165], 0.0035), [0, 0, 0], euler(0, (v / 3) * Math.PI * 2 + i, 0))
      vanes[i % 2].push(place(vane, sub(end, scale(lean, 0.06)), Ra))
    }
  })
  piece('quiver_shafts', 'soft', union(0, ...shafts), grain(C.wood, 0.15, 60), rig, 0.0045)
  piece('quiver_nocks', 'soft', union(0, ...nocks), flat(C.bone), rig, 0.004)
  const featherPaint = (c0, c1) => (x, y, z) => shade(mix(c0, c1, 0.5 + 0.5 * Math.sin((x + y * 2 + z) * 260)), 0.9 + 0.1 * Math.sin(y * 500))
  piece('quiver_fletch_a', 'soft', union(0, ...vanes[0]), featherPaint(C.hair, C.hairDeep), rig, 0.0045)
  piece('quiver_fletch_b', 'soft', union(0, ...vanes[1]), featherPaint(C.fletchPale, shade(C.fletchPale, 0.7)), rig, 0.0045)
}

// ---- Bow in the LEFT hand + nocked arrow -------------------------------------
// Built in the bind pose around the grip point g (animations.mjs BOW.gripRest):
// the bow's long axis is Z, the arrow runs along -Y through g. A recurve: the
// wrapped grip sits in the fist, the limbs sweep back toward the string and the
// tips flick forward again. When the bow arm swings up, the bow stands vertical
// and the arrow points forward.
{
  const { W } = LIMB.L
  const g = add(W, [0.02, 0, 0]) // = BOW.gripRest
  const rigid = { rigid: { hand_L: 1 }, occluder: 'bow' }
  const yR = g[1] - 0.1 // riser line (in the fingers)
  const yS = g[1] + 0.012 // string line (at the heel of the hand)
  const ROOT = 0.1, REACH = 0.38, AMP = yS - 0.012 - yR
  const limbY = (u) => yR + AMP * Math.pow(Math.sin(2.4 * u), 1.15)
  const U_STRING = 0.72
  const limbs = []
  for (const sgn of [1, -1]) {
    const N = 26, pts = []
    for (let i = 0; i <= N; i++) { const u = i / N; pts.push([limbY(u), g[2] + sgn * (ROOT + REACH * u)]) }
    const nearest = (y, z) => {
      let best = Infinity, bu = 0
      for (let i = 0; i < N; i++) {
        const a = pts[i], b = pts[i + 1]
        const ay = b[0] - a[0], az = b[1] - a[1], py = y - a[0], pz = z - a[1]
        const h = clamp01((py * ay + pz * az) / (ay * ay + az * az))
        const d = Math.hypot(py - ay * h, pz - az * h)
        if (d < best) { best = d; bu = (i + h) / N }
      }
      return [best, bu]
    }
    const limb = node((x, y, z) => {
      const [d2, u] = nearest(y, z)
      const dx = Math.abs(x - g[0]) - lerp(0.0185, 0.0095, u), dd = d2 - lerp(0.0105, 0.006, u)
      const r = 0.004
      return Math.min(Math.max(dx + r, dd + r), 0) + Math.hypot(Math.max(dx + r, 0), Math.max(dd + r, 0)) - r
    }, [g[0] - 0.022, yR - 0.02, Math.min(pts[0][1], pts[N][1]) - 0.015], [g[0] + 0.022, yS + 0.012, Math.max(pts[0][1], pts[N][1]) + 0.015])
    limb.u = (y, z) => nearest(y, z)[1]
    limbs.push(limb)
  }
  const limbPaint = (limb) => (x, y, z) => {
    const u = limb.u(y, z)
    let c = shade(mix(C.wood, C.woodDark, 0.6 * sstep(0.2, 0.9, u)), 0.85 + 0.25 * fbm(x * 30, y * 30, z * 160, 3))
    if (y < limbY(u) - 0.002) c = mix(c, C.horn, 0.75) // dark horn belly facing the target
    if (u < 0.1) c = shade(C.leatherLight, 0.75 + 0.35 * (0.5 + 0.5 * Math.sin(z * 520))) // binding at the riser
    if (u > U_STRING - 0.045 && u < U_STRING + 0.03) c = shade(C.thread, 0.8 + 0.25 * (0.5 + 0.5 * Math.sin(z * 700))) // string nock whipping
    if (u > 0.9) c = mix(C.bone, shade(C.bone, 0.7), sstep(0.9, 1, u)) // bone tips
    return c
  }
  piece('bow_limb_upper', 'soft', limbs[0], limbPaint(limbs[0]), rigid, 0.004)
  piece('bow_limb_lower', 'soft', limbs[1], limbPaint(limbs[1]), rigid, 0.004)
  const riser = union(0.012,
    roundBox([g[0], yR, g[2] - 0.045], [0.0175, 0.0185, 0.04], 0.013), // grip, under the arrow
    roundBox([g[0] - 0.021, yR - 0.002, g[2] + 0.04], [0.009, 0.021, 0.055], 0.008), // sight window wall beside the arrow
    roundBox([g[0], yR + 0.003, g[2] + 0.105], [0.0165, 0.016, 0.032], 0.011),
    roundBox([g[0], yR + 0.003, g[2] - 0.105], [0.0165, 0.016, 0.032], 0.011))
  piece('bow_riser', 'soft', riser, (x, y, z) => {
    const dz = z - g[2]
    if (dz > -0.088 && dz < -0.004) return shade(C.leatherDark, 0.85 + 0.6 * (0.5 + 0.5 * Math.sin(z * 480 + x * 140))) // wrapped grip
    return shade(C.wood, 0.85 + 0.25 * fbm(x * 30, y * 30, z * 160, 3))
  }, rigid, 0.004)
  const zs = ROOT + REACH * U_STRING
  piece('bow_string', 'soft', union(0, capsule([g[0], yS, g[2] + zs], [g[0], yS, g[2] - zs], 0.0045),
    sphere([g[0], yS - 0.003, g[2] + zs], 0.008), sphere([g[0], yS - 0.003, g[2] - zs], 0.008)), flat(C.bone), rigid, 0.0035)

  // Nocked arrow: nock on the string, shaft over the fist, steel broadhead.
  const yHead = g[1] - 0.52, yTip = g[1] - 0.62
  piece('arrow_shaft', 'soft', capsule([g[0], yS, g[2]], [g[0], yHead + 0.01, g[2]], 0.0085), (x, y, z) => {
    if (y > yS - 0.012) return C.bone
    return shade(C.wood, 1.15 + 0.2 * fbm(x * 60, y * 60, z * 60, 3))
  }, rigid, 0.004)
  {
    // Leaf-shaped broadhead lying in the bow's plane, diamond in section, on a short socket.
    const poly = [[yHead + 0.006, 0], [yHead - 0.03, 0.021], [yTip, 0], [yHead - 0.03, -0.021]] // (y, z - g.z)
    const edges = poly.map((a, i) => { const b = poly[(i + 1) % poly.length]; const ny = b[1] - a[1], nz = -(b[0] - a[0]); const l = Math.hypot(ny, nz); return [a, ny / l, nz / l] })
    const sgn = Math.sign(edges[0][1] * (poly[2][0] - poly[0][0]) + edges[0][2] * (poly[2][1] - poly[0][1])) // make normals point outward
    const blade = node((x, y, z) => {
      let d = -Infinity
      for (const [a, ny, nz] of edges) d = Math.max(d, -sgn * ((y - a[0]) * ny + (z - g[2] - a[1]) * nz))
      return Math.max(d, Math.abs(x - g[0]) * 0.95 + Math.abs(z - g[2]) * 0.3 - 0.0078)
    }, [g[0] - 0.012, yTip - 0.004, g[2] - 0.03], [g[0] + 0.012, yHead + 0.008, g[2] + 0.03])
    const head = union(0.003, blade, capsule([g[0], yHead + 0.024, g[2]], [g[0], yHead - 0.03, g[2]], 0.011, 0.006))
    piece('arrow_head', 'metal', head, (x, y, z) => mix(shade(C.steel, 0.85), [0.95, 0.97, 1], sstep(0.009, 0.019, Math.abs(z - g[2]))), rigid, 0.003)
  }
  {
    // Three vanes; two stand up in a V over the fist, the third is hidden in the hand.
    const vanes = []
    for (const a of [0.62, -0.62, Math.PI]) {
      const v = intersect(0.002, roundBox([0, 0, 0.022], [0.003, 0.034, 0.019], 0.0028), halfspace([0, -0.034, 0.012], [0, -1, 0.75]))
      vanes.push(place(place(v, [0, 0, 0], euler(0, a, 0)), [g[0], g[1] - 0.045, g[2]], [1, 0, 0, 0, 1, 0, 0, 0, 1]))
    }
    piece('arrow_fletch', 'soft', union(0, ...vanes),
      (x, y, z) => shade(mix(C.hair, C.hairDeep, 0.5 + 0.5 * Math.sin((y * 2 + z + x) * 300)), 1.05), rigid, 0.003)
  }
}

// Bones that pieces may reference must exist.
const boneNames = new Set(BONES.map((b) => b.name))
for (const p of PIECES) {
  const refs = p.skin.rigid ? Object.keys(p.skin.rigid) : p.skin.envelope || []
  for (const r of refs) if (!boneNames.has(r)) throw new Error(`${p.name} references unknown bone ${r}`)
}
void star
void lerp3
