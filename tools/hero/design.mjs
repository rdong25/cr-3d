// THE EMBER WARDEN — an original armored melee hero.
//
// This file is the "art": the skeleton, and every sculpted piece of the
// character as signed-distance clay. Change numbers here, re-run
// `npm run build:hero`, and the .glb in public/models is regenerated.
//
// Conventions (same as glTF / Three.js): Y up, character faces +Z,
// ground at y = 0, 1 unit ≈ the old procedural Knight's scale.
// The character's LEFT is +X, RIGHT is -X. Sword in the right hand,
// shield on the left forearm.

import {
  sphere, ellipsoid, capsule, roundBox, torus, cylinder, halfspace, star, bezierTube,
  union, subtract, intersect, offset, band, place, euler, basis, norm, cross, node, fbm, noise3,
} from './sdf.mjs'

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
// Palette (sRGB). Kept small and saturated — stylized games read by color.
// ---------------------------------------------------------------------------
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
const C = {
  steel: hex(0x929cab), steelDark: hex(0x5d6570), iron: hex(0x3e434b), gold: hex(0xe3a93f), goldDeep: hex(0xb87a24),
  mail: hex(0x434956), coif: hex(0x535a68), leather: hex(0x6a4327), leatherDark: hex(0x3f2617),
  ivory: hex(0xeee2c6), hornTip: hex(0x4a3526), ember: hex(0xffb04a), team: hex(0xf4f4f4),
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k]
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const flat = (c) => () => c
/** Hammered metal: soft low-frequency dents plus fine grain. */
const hammered = (c, k = 1) => (x, y, z) => shade(c, k * (0.86 + 0.1 * fbm(x * 22, y * 22, z * 22, 3) + 0.06 * noise3(x * 140, y * 140, z * 140)))
const grain = (c, amt = 0.08, freq = 60) => (x, y, z) => shade(c, 1 - amt / 2 + amt * fbm(x * freq, y * freq, z * freq, 3))

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

// ---------------------------------------------------------------------------
// Pieces. Each piece is meshed on its own (like an artist's separate armor
// parts), with:
//   material: 'soft' | 'metal' | 'team' | 'glow'
//   sdf:      the sculpted shape
//   paint:    (x,y,z) -> sRGB color, before baked AO/curvature are applied
//   skin:     { rigid: { bone: weight, ... } }  or  { envelope: [bones] }
//             or { fn: (x, y, z) => ({ bone: weight }) }; add occluder: 'name'
//             for props that must not bake shadows onto the body (shield, sword)
//   res:      optional voxel size override (smaller = finer)
// ---------------------------------------------------------------------------
export const PIECES = []
const piece = (name, material, sdf, paint, skin, res) => PIECES.push({ name, material, sdf, paint, skin, res })

// ---- Body under the armor (chain mail suit), soft-skinned to the skeleton ----
const torsoUpper = ellipsoid([0, 0.85, 0], [0.275, 0.26, 0.19])
const pelvis = ellipsoid([0, 0.6, 0], [0.185, 0.13, 0.145])
const torso = union(0.08, torsoUpper, pelvis)
{
  const parts = [torso, capsule([0, 1.0, 0], [0, 1.2, 0], 0.1, 0.095)]
  for (const { S, E, W, Hp, K, A } of Object.values(LIMB)) {
    parts.push(sphere(S, 0.09), capsule(S, E, 0.085, 0.075), capsule(E, W, 0.07, 0.06))
    parts.push(capsule(Hp, K, 0.1, 0.08), capsule(K, A, 0.075, 0.065))
  }
  const mailPaint = (x, y, z) => {
    // tight ring texture faked with high-frequency noise + soft bands
    const rings = 0.5 + 0.5 * Math.sin(y * 260 + Math.sin(x * 90) * 2)
    return shade(C.mail, 0.85 + 0.12 * rings + 0.1 * fbm(x * 40, y * 40, z * 40, 3))
  }
  piece('undersuit', 'soft', union(0.05, ...parts), mailPaint,
    { envelope: ['hips', 'spine', 'chest', 'neck', 'upperarm_L', 'forearm_L', 'upperarm_R', 'forearm_R', 'thigh_L', 'shin_L', 'thigh_R', 'shin_R'] })
}
// Chain-mail coif bunched between helmet and breastplate.
piece('coif', 'soft', ellipsoid([0, 1.13, -0.01], [0.17, 0.075, 0.16]), grain(C.coif, 0.2, 80), { envelope: ['chest', 'neck', 'head'] })

// ---- Belt + buckle ----
piece('belt', 'soft', band(torso, 0.02, 0.022, [0, 0.645, 0], [0, 1, 0], 0.036),
  (x, y, z) => mix(C.leather, C.leatherDark, sstep(0.025, 0.036, Math.abs(y - 0.645))), { envelope: ['hips', 'spine'] })
{
  const front = surfacePoint(torso, [0, 0.645, 1], [0, 0, -1])
  const c = add(front, [0, 0, 0.04])
  const frame = subtract(0.004, roundBox(c, [0.06, 0.046, 0.016], 0.013), roundBox(c, [0.034, 0.022, 0.04], 0.008))
  piece('buckle', 'metal', union(0.006, frame, capsule(add(c, [-0.03, 0, 0.012]), add(c, [0.012, 0, 0.012]), 0.008)), flat(C.gold), { rigid: { hips: 1 } })
}

// ---- Breastplate with sculpted pecs, center ridge, ember gem ----
const plateBase = union(0.04, offset(torsoUpper, 0.035),
  ellipsoid([0.1, 0.9, 0.11], [0.14, 0.12, 0.11]), ellipsoid([-0.1, 0.9, 0.11], [0.14, 0.12, 0.11]))
const gemPos = surfacePoint(plateBase, [0, 0.91, 1], [0, 0, -1])
{
  let plate = intersect(0.015, plateBase, halfspace([0, 0.68, 0], [0, -1, 0]))
  plate = subtract(0.02, plate, cylinder([0, 1.12, 0], 0.12, 0.12, 0.02))
  for (const s of [1, -1]) plate = subtract(0.02, plate, sphere([s * 0.34, 0.98, 0], 0.11))
  plate = subtract(0.006, plate, sphere(gemPos, 0.05))
  const ridge = intersect(0.004, offset(plateBase, 0.012), roundBox([0, 0.83, 0.2], [0.014, 0.12, 0.08], 0.01))
  plate = union(0.012, plate, subtract(0.006, ridge, sphere(gemPos, 0.075)))
  // Two horizontal lame grooves across the belly read as articulated plates.
  for (const gy of [0.728, 0.772]) plate = subtract(0.003, plate, band(plateBase, 0, 0.005, [0, gy, 0], [0, 1, 0], 0.0035))
  const steelPaint = hammered(C.steel)
  piece('breastplate', 'metal', plate, (x, y, z) => shade(steelPaint(x, y, z), 0.95 + 0.12 * sstep(0.7, 1.05, y)), { rigid: { chest: 1 } })
  piece('plate_trim', 'metal', union(0, band(plateBase, 0.005, 0.008, [0, 0.7, 0], [0, 1, 0], 0.017), torus([0, 1.093, 0], 0.125, 0.02)), flat(C.gold), { rigid: { chest: 1 } })
  piece('gem_setting', 'metal', torus(add(gemPos, [0, 0, 0.004]), 0.058, 0.015, euler(Math.PI / 2, 0, 0)), flat(C.gold), { rigid: { chest: 1 } })
  piece('gem', 'glow', ellipsoid(add(gemPos, [0, 0, -0.008]), [0.045, 0.055, 0.032]),
    (x, y, z) => mix(C.ember, [1, 0.95, 0.75], sstep(0.92, 0.95, y)), { rigid: { chest: 1 } })
}

// ---- Pauldrons: two stacked plates, gold crest stripe, rivets, stubby spike ----
for (const [side, { s, S }] of Object.entries(LIMB)) {
  const c1 = [s * 0.38, 1.07, 0]
  const dome1 = ellipsoid(c1, [0.175, 0.13, 0.185], euler(0, 0, -s * 0.45))
  const dome2 = ellipsoid([s * 0.455, 0.975, 0], [0.15, 0.09, 0.168], euler(0, 0, -s * 0.75))
  const shell = subtract(0.012, union(0, dome1, dome2), ellipsoid([s * 0.35, 0.92, 0], [0.16, 0.12, 0.15]))
  const w = { [`upperarm_${side}`]: 0.55, chest: 0.45 }
  const pp = hammered(C.steel)
  piece(`pauldron_${side}`, 'metal', shell, (x, y, z) => shade(pp(x, y, z), 0.95 + 0.15 * sstep(0.95, 1.18, y)), { rigid: w })
  const stripe = band(dome1, 0.006, 0.008, c1, [0, 0, 1], 0.02)
  piece(`pauldron_gold_${side}`, 'metal', stripe, flat(C.gold), { rigid: w })
  const top = surfacePoint(dome1, add(c1, [s * 0.04, 0.4, 0]), [0, -1, 0])
  piece(`pauldron_spike_${side}`, 'metal', capsule(add(top, [0, -0.02, 0]), add(top, [s * 0.05, 0.11, -0.02]), 0.032, 0.004), flat(C.iron), { rigid: w })
  // Rivets around the lower plate's outer rim, found by marching onto its surface.
  const c2 = [s * 0.455, 0.975, 0], R2 = euler(0, 0, -s * 0.75)
  const rim = []
  for (const a of [-0.9, -0.3, 0.3, 0.9]) {
    const l = [s * Math.cos(a), -0.25, Math.sin(a)]
    const dir = norm([R2[0] * l[0] + R2[1] * l[1] + R2[2] * l[2], R2[3] * l[0] + R2[4] * l[1] + R2[5] * l[2], R2[6] * l[0] + R2[7] * l[1] + R2[8] * l[2]])
    rim.push(sphere(surfacePoint(dome2, add(c2, scale(dir, 0.5)), scale(dir, -1)), 0.015))
  }
  piece(`pauldron_rivets_${side}`, 'metal', union(0, ...rim), flat(C.gold), { rigid: w })
}

// ---- Arms: rerebraces, bracers, elbow cops, leather fists with steel knuckle plates ----
for (const [side, { s, S, E, W, F }] of Object.entries(LIMB)) {
  const up = norm(sub(E, S))
  piece(`rerebrace_${side}`, 'metal', capsule(add(S, scale(up, 0.1)), sub(E, scale(up, 0.045)), 0.094, 0.086), hammered(C.steel, 0.9), { rigid: { [`upperarm_${side}`]: 1 } })
  piece(`rerebrace_trim_${side}`, 'metal', torus(sub(E, scale(up, 0.05)), 0.088, 0.011, frameY(up)), flat(C.gold), { rigid: { [`upperarm_${side}`]: 1 } })
  const dir = norm(sub(W, E))
  const bracer = union(0.012,
    capsule(add(E, scale(dir, 0.05)), sub(W, scale(dir, 0.03)), 0.083, 0.094),
    capsule(sub(W, scale(dir, 0.065)), sub(W, scale(dir, 0.02)), 0.102, 0.106))
  piece(`bracer_${side}`, 'metal', bracer, hammered(C.steel, 0.95), { rigid: { [`forearm_${side}`]: 1 } })
  piece(`bracer_trim_${side}`, 'metal', torus(sub(W, scale(dir, 0.022)), 0.1, 0.012, frameY(dir)), flat(C.gold), { rigid: { [`forearm_${side}`]: 1 } })
  piece(`elbow_${side}`, 'metal', union(0.01, ellipsoid(add(E, [s * 0.02, 0.005, -0.035]), [0.07, 0.072, 0.062]),
    capsule(add(E, [s * 0.05, 0.03, -0.05]), add(E, [s * 0.075, -0.02, -0.07]), 0.025, 0.012)),
    flat(shade(C.steel, 0.9)), { rigid: { [`upperarm_${side}`]: 0.5, [`forearm_${side}`]: 0.5 } })
  const hdir = norm(sub(F, W))
  const fistC = add(W, scale(hdir, 0.07))
  const fist = union(0.02, roundBox(fistC, [0.062, 0.075, 0.07], 0.042, frameY(hdir)),
    capsule(add(fistC, [-s * 0.045, 0.02, 0.045]), add(fistC, [-s * 0.03, -0.035, 0.07]), 0.026, 0.022))
  piece(`fist_${side}`, 'soft', fist, grain(C.leather, 0.18, 70), { rigid: { [`hand_${side}`]: 1 } })
  piece(`knuckles_${side}`, 'metal', roundBox(add(fistC, [s * 0.058, -0.005, 0.01]), [0.016, 0.06, 0.06], 0.013, frameY(hdir)), flat(C.steelDark), { rigid: { [`hand_${side}`]: 1 } })
}

// ---- Legs: cuisses, knee cops, greaves, sabatons ----
for (const [side, { s, Hp, K, A }] of Object.entries(LIMB)) {
  const thigh = capsule(Hp, K, 0.1, 0.08)
  const cuisse = intersect(0.01, intersect(0.01, offset(thigh, 0.026), halfspace([0, 0, -0.01], [0, 0, -1])), halfspace([0, 0.37, 0], [0, -1, 0]))
  piece(`cuisse_${side}`, 'metal', cuisse, hammered(C.steel, 0.9), { rigid: { [`thigh_${side}`]: 1 } })
  piece(`kneecop_${side}`, 'metal', union(0.012, ellipsoid(add(K, [0, 0.005, 0.06]), [0.072, 0.078, 0.05]),
    ellipsoid(add(K, [s * 0.055, 0, 0.03]), [0.03, 0.06, 0.045])), flat(C.steel), { rigid: { [`thigh_${side}`]: 0.4, [`shin_${side}`]: 0.6 } })
  piece(`kneestud_${side}`, 'metal', sphere(add(K, [0, 0.005, 0.11]), 0.019), flat(C.gold), { rigid: { [`thigh_${side}`]: 0.4, [`shin_${side}`]: 0.6 } })
  const gp = hammered(C.steel)
  piece(`greave_${side}`, 'metal', capsule(add(K, [0, -0.055, 0]), add(A, [0, 0.035, 0]), 0.086, 0.079), (x, y, z) => shade(gp(x, y, z), 0.85 + 0.15 * sstep(0.1, 0.3, y)), { rigid: { [`shin_${side}`]: 1 } })
  const foot = union(0.035, roundBox([s * 0.16, 0.065, 0.045], [0.085, 0.065, 0.15], 0.055), ellipsoid([s * 0.16, 0.058, 0.155], [0.086, 0.06, 0.075]))
  const sabaton = intersect(0.008, foot, halfspace([0, 0.002, 0], [0, -1, 0]))
  piece(`sabaton_${side}`, 'metal', sabaton, (x, y, z) => shade(C.steelDark, 1 + 0.25 * sstep(0.02, 0.12, y)), { rigid: { [`foot_${side}`]: 1 } })
  piece(`sabaton_band_${side}`, 'metal', band(foot, 0.004, 0.006, [0, 0.07, 0.11], [0, 0.5, 1], 0.012), flat(C.gold), { rigid: { [`foot_${side}`]: 1 } })
}

// ---- Tabards (team colored), hinged at the belt so they swing over the legs ----
function panelPaint(cx, cy, hw, hh, emblem) {
  return (x, y, z) => {
    const edge = Math.min(hw - Math.abs(x - cx), (y - (0.31 + 0.5 * Math.abs(x))) * 0.9, hh - Math.abs(y - cy))
    let k = 0.94 - 0.08 * fbm(x * 30, y * 90, z * 30, 3) - 0.06 * (0.5 + 0.5 * Math.sin(x * 70))
    if (edge < 0.022) k *= 0.42
    if (emblem && emblem.d(x, y, z) < 0) k *= 0.42
    return [k, k, k]
  }
}
{
  const cut = (n) => intersect(0.006, intersect(0.006, n, halfspace([0, 0.31, 0], [0.5, -1, 0])), halfspace([0, 0.31, 0], [-0.5, -1, 0]))
  const front = cut(roundBox([0, 0.47, 0.215], [0.125, 0.17, 0.011], 0.009, euler(-0.13, 0, 0)))
  const emblem = star([0, 0.5, 0.2], 0.06, 0.45, 0.3)
  piece('tabard_front', 'team', front, panelPaint(0, 0.47, 0.125, 0.17, emblem), { rigid: { tabard_F: 1 } }, 0.005)
}

// ---- Cape: a flared, folded sheet behind the shoulders on the cape bone chain ----
{
  const TOP = 1.06, BOTTOM = 0.3
  const shape = (x, y, z) => {
    const u = Math.max(0, TOP - y)
    const cz = -0.04 - 0.04 * u
    const phi = Math.atan2(x, -(z - cz))
    const fold = 1 + 0.045 * Math.min(1, u * 2.2) * Math.sin(phi * 7)
    const a = (0.27 + 0.2 * u) * fold, b = (0.18 + 0.1 * u) * fold
    const qx = x / a, qz = (z - cz) / b
    const k0 = Math.hypot(qx, qz), k1 = Math.hypot(qx / a, qz / b)
    const ell = (k0 * (k0 - 1)) / k1
    const shell = Math.abs(ell) - 0.011
    const hem = BOTTOM + 0.025 * Math.sin(phi * 7 + 1.2) + 0.05 * Math.abs(Math.sin(phi)) // longer in the middle
    return Math.max(shell, hem - y, y - TOP, (z - cz) - 0.015)
  }
  const capeSdf = node(shape, [-0.5, 0.2, -0.42], [0.5, 1.1, 0.06])
  const capeBones = (x, y, z) => {
    // Weight down the chain by height, with the very top shared with the chest.
    const knots = [['chest', 1.08], ['cape_1', 1.0], ['cape_2', 0.74], ['cape_3', 0.47]]
    if (y >= knots[0][1]) return { chest: 1 }
    for (let i = 0; i < knots.length - 1; i++) {
      const [a, ya] = knots[i], [b, yb] = knots[i + 1]
      if (y <= ya && y >= yb) { const t = (ya - y) / (ya - yb); return { [a]: 1 - t, [b]: t } }
    }
    return { cape_3: 1 }
  }
  const capePaint = (x, y, z) => {
    const u = Math.max(0, TOP - y)
    const cz = -0.04 - 0.04 * u
    const phi = Math.atan2(x, -(z - cz))
    const hem = BOTTOM + 0.025 * Math.sin(phi * 7 + 1.2) + 0.05 * Math.abs(Math.sin(phi))
    let k = 0.9 - 0.1 * fbm(x * 30, y * 60, z * 30, 3) + 0.06 * Math.sin(phi * 7)
    if (y - hem < 0.035) k *= 0.45 // dark trim along the hem
    return [k, k, k]
  }
  piece('cape', 'team', capeSdf, capePaint, { fn: capeBones }, 0.005)
  const mantle = bezierTube([0.27, 1.05, -0.06], [0.2, 1.1, -0.27], [-0.2, 1.1, -0.27], [-0.27, 1.05, -0.06], 0.045, 0.045, 12, 0.02)
  piece('cape_mantle', 'team', mantle, (x, y, z) => { const k = 0.78 + 0.1 * Math.sin(x * 60); return [k, k, k] }, { fn: (x, y, z) => ({ chest: 0.6, cape_1: 0.4 }) })
  for (const s of [1, -1]) {
    const clasp = [s * 0.25, 1.04, 0.0]
    piece(`cape_clasp_${s > 0 ? 'L' : 'R'}`, 'metal', union(0.01, cylinder(clasp, 0.045, 0.012, 0.006, euler(Math.PI / 2, 0, 0)), sphere(add(clasp, [0, 0, 0.012]), 0.022)), flat(C.gold), { rigid: { chest: 1 } })
  }
}

// ---- Helmet: bucket helm, T visor with ember eyes, crest, gold bands, horns ----
const H0 = [0, 1.36, 0.01]
const dome = ellipsoid(H0, [0.29, 0.3, 0.3])
const helmShell = union(0.06, dome, roundBox([0, 1.25, 0.08], [0.23, 0.12, 0.2], 0.1))
{
  let helm = intersect(0.015, helmShell, halfspace([0, 1.13, 0], [0, -1, 0]))
  helm = subtract(0.012, helm, roundBox([0, 1.36, 0.33], [0.17, 0.026, 0.1], 0.018))
  helm = subtract(0.012, helm, roundBox([0, 1.27, 0.32], [0.024, 0.075, 0.1], 0.015))
  for (const s of [1, -1]) for (let i = 0; i < 3; i++) {
    const p = surfacePoint(helmShell, [s * 0.14, 1.25 - i * 0.035, 1], [0, 0, -1])
    helm = subtract(0.003, helm, sphere(p, 0.012))
  }
  const crest = intersect(0.004, offset(dome, 0.026), roundBox([0, 1.56, -0.02], [0.022, 0.15, 0.3], 0.015))
  helm = union(0.01, helm, crest)
  const hp = hammered(C.steel)
  piece('helmet', 'metal', helm, (x, y, z) => shade(hp(x, y, z), 0.9 + 0.18 * sstep(1.2, 1.62, y)), { rigid: { head: 1 } }, 0.0055)
  const brow = band(dome, 0.006, 0.009, [0, 1.36, 0], [0, 1, -0.2], 0.017)
  const rim = band(helmShell, 0.004, 0.008, [0, 1.152, 0], [0, 1, 0], 0.02)
  const rivets = []
  for (const a of [-2.3, -1.6, -1.0, -0.5, 0.5, 1.0, 1.6, 2.3]) {
    const dir = [Math.sin(a), 0, Math.cos(a)]
    rivets.push(sphere(surfacePoint(dome, add([0, 1.36 + 0.2 * dir[2] * 0.3, 0.01], scale(dir, 0.6)), scale(dir, -1)), 0.015))
  }
  piece('helmet_gold', 'metal', union(0, brow, rim, ...rivets), flat(C.gold), { rigid: { head: 1 } })
  for (const s of [1, -1]) {
    piece(`eye_${s > 0 ? 'L' : 'R'}`, 'glow', ellipsoid([s * 0.075, 1.36, 0.248], [0.046, 0.021, 0.03]), flat(C.ember), { rigid: { head: 1 } }, 0.004)
    const p0 = [s * 0.2, 1.47, -0.02], p1 = [s * 0.43, 1.5, 0.0], p2 = [s * 0.53, 1.63, 0.12], p3 = [s * 0.45, 1.81, 0.23]
    const horn = bezierTube(p0, p1, p2, p3, 0.062, 0.011, 12)
    piece(`horn_${s > 0 ? 'L' : 'R'}`, 'soft', horn, (x, y, z) => {
      const t = horn.param(x, y, z)
      const ridge = 0.92 + 0.08 * Math.sin(t * 60)
      return shade(mix(C.ivory, C.hornTip, sstep(0.55, 1, t)), ridge)
    }, { rigid: { head: 1 } }, 0.005)
    const ringC = surfacePoint(dome, [s * 0.6, 1.485, -0.005], [-s, 0, 0])
    piece(`horn_ring_${s > 0 ? 'L' : 'R'}`, 'metal', torus(add(ringC, [s * 0.012, 0, 0]), 0.056, 0.017, euler(0, 0, -s * Math.PI / 2 + s * 0.12)), flat(C.gold), { rigid: { head: 1 } })
  }
}

// ---- Shield on the left forearm: domed team face, steel rim, gold boss + star ----
{
  const { W } = LIMB.L
  // Designed for the guard pose (shoulder -0.42 + elbow -1.05 rad), where it
  // faces forward. In the rest pose it hangs face-down under the forearm.
  const n = norm([0.45, -0.875, 0.19])
  const upHint = [0, 0.1, 0.995]
  const zx = n, yx = norm(sub(upHint, scale(n, upHint[0] * n[0] + upHint[1] * n[1] + upHint[2] * n[2]))), xx = cross(yx, zx)
  const R = basis(xx, yx, zx)
  // Center-grip round shield: the boss sits just in front of the left fist.
  const fistL = add(W, scale(norm(sub(LIMB.L.F, W)), 0.07))
  const c = add(fistL, scale(n, 0.115))
  const toZ = euler(Math.PI / 2, 0, 0) // local Y -> local Z for the cylinder / torus primitives
  const faceDome = sphere([0, 0, -0.85], 0.88)
  const face = intersect(0.004, intersect(0.004, faceDome, cylinder([0, 0, 0], 0.27, 0.3, 0, toZ)), halfspace([0, 0, -0.026], [0, 0, -1]))
  const local = (sdf) => place(sdf, c, R)
  const facePaint = (x, y, z) => {
    const q = [x - c[0], y - c[1], z - c[2]]
    const r = Math.hypot(q[0] * xx[0] + q[1] * xx[1] + q[2] * xx[2], q[0] * yx[0] + q[1] * yx[1] + q[2] * yx[2])
    const k = 0.95 - 0.35 * sstep(0.17, 0.26, r) - 0.07 * fbm(x * 25, y * 25, z * 25, 3)
    return [k, k, k]
  }
  piece('shield_face', 'team', local(face), facePaint, { rigid: { forearm_L: 1 }, occluder: 'shield' }, 0.0055)
  piece('shield_rim', 'metal', local(torus([0, 0, -0.004], 0.27, 0.03, toZ)), flat(C.steel), { rigid: { forearm_L: 1 }, occluder: 'shield' })
  const emblem = intersect(0.003, intersect(0, offset(faceDome, 0.009), star([0, 0, 0], 0.2, 0.42, 0.3)), halfspace([0, 0, -0.012], [0, 0, -1]))
  piece('shield_star', 'metal', local(emblem), flat(C.gold), { rigid: { forearm_L: 1 }, occluder: 'shield' }, 0.005)
  piece('shield_boss', 'metal', local(ellipsoid([0, 0, 0.035], [0.075, 0.075, 0.05])), flat(C.goldDeep), { rigid: { forearm_L: 1 }, occluder: 'shield' })
  const studs = []
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; studs.push(sphere([Math.cos(a) * 0.27, Math.sin(a) * 0.27, 0.024], 0.018)) }
  piece('shield_studs', 'metal', local(union(0, ...studs)), flat(C.gold), { rigid: { forearm_L: 1 }, occluder: 'shield' })
}

// ---- Ember Sword in the right hand: gold guard, steel blade, glowing runes ----
{
  const { W, F } = LIMB.R
  const g = add(W, scale(norm(sub(F, W)), 0.07))
  const d = norm([-0.3, -0.5, 1]) // rest pose: blade points forward, down and a little outward
  const wAxis = norm(sub([0, 1, 0.5], scale(d, 0.5 * d[2] + d[1]))), tAxis = cross(wAxis, d)
  const R = basis(wAxis, d, tAxis)
  const local = (sdf) => place(sdf, g, R)
  const rigid = { rigid: { hand_R: 1 }, occluder: 'sword' }
  piece('sword_grip', 'soft', local(capsule([0, -0.085, 0], [0, 0.08, 0], 0.024, 0.022)),
    (x, y, z) => { const q = sub([x, y, z], g); const t = q[0] * d[0] + q[1] * d[1] + q[2] * d[2]; return shade(C.leatherDark, 0.8 + 0.3 * (0.5 + 0.5 * Math.sin(t * 180))) }, rigid)
  piece('sword_guard', 'metal', local(union(0.02,
    roundBox([0, 0.095, 0], [0.15, 0.024, 0.034], 0.018), sphere([0.155, 0.115, 0], 0.031), sphere([-0.155, 0.115, 0], 0.031),
    ellipsoid([0, 0.1, 0], [0.05, 0.042, 0.046]), sphere([0, -0.115, 0], 0.038))), flat(C.gold), rigid)
  const diamond = node((x, y, z) => (Math.abs(z) * 0.97 + Math.abs(x) * 0.24) - 0.026, [-1, -1, -1], [1, 2, 1])
  let blade = intersect(0.004, roundBox([0, 0.53, 0], [0.068, 0.41, 0.03], 0.008), diamond)
  blade = intersect(0.003, intersect(0.003, blade, halfspace([0, 0.99, 0], [1, 0.5, 0])), halfspace([0, 0.99, 0], [-1, 0.5, 0]))
  for (const zs of [1, -1]) blade = subtract(0.004, blade, roundBox([0, 0.47, zs * 0.03], [0.014, 0.31, 0.012], 0.006))
  piece('sword_blade', 'metal', local(blade), (x, y, z) => {
    const q = sub([x, y, z], g)
    const across = Math.abs(q[0] * wAxis[0] + q[1] * wAxis[1] + q[2] * wAxis[2])
    return mix(shade(C.steel, 0.92), [0.96, 0.97, 1], sstep(0.045, 0.064, across))
  }, rigid, 0.0045)
  const runes = []
  for (let i = 0; i < 7; i++) runes.push(roundBox([0, 0.2 + i * 0.088, 0], [0.0085, 0.03 - (i % 2) * 0.008, 0.0195], 0.006))
  piece('sword_runes', 'glow', local(union(0, ...runes)), flat(C.ember), rigid, 0.004)
}

// Bones that pieces may reference must exist.
const boneNames = new Set(BONES.map((b) => b.name))
for (const p of PIECES) {
  const refs = p.skin.rigid ? Object.keys(p.skin.rigid) : p.skin.envelope || []
  for (const r of refs) if (!boneNames.has(r)) throw new Error(`${p.name} references unknown bone ${r}`)
}
void noise3
