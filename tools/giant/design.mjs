// THE GIANT — a huge bare-chested brawler.
//
// Same 22-bone skeleton as the Ember Warden, scaled x1.35 (~2.3 units tall).
// Knight pieces are authored at Knight scale and uniformly scaled x1.35 by
// the `piece` helper below; Giant-native pieces (head, sash, muscles) are
// authored directly at Giant scale via `pieceS`. No weapon, no helmet:
// bare skin torso, leather sash + belt, big fists, heavy greaves.
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
  root: [0, 0, 0], hips: [0, 0.783, 0], spine: [0, 0.945, 0], chest: [0, 1.161, 0], neck: [0, 1.4445, 0], head: [0, 1.5795, 0],
}
export const BONES = [
  { name: 'root', parent: null, pos: P.root, tail: [0, 0.405, 0] },
  { name: 'hips', parent: 'root', pos: P.hips, tail: P.spine },
  { name: 'spine', parent: 'hips', pos: P.spine, tail: P.chest },
  { name: 'chest', parent: 'spine', pos: P.chest, tail: P.neck },
  { name: 'neck', parent: 'chest', pos: P.neck, tail: P.head },
  { name: 'head', parent: 'neck', pos: P.head, tail: [0, 2.025, 0] },
  { name: 'tabard_F', parent: 'hips', pos: [0, 0.8505, 0.2565], tail: [0, 0.459, 0.297] },
  // Cape: a three-bone chain hanging off the chest, so it can sway and trail.
  { name: 'cape_1', parent: 'chest', pos: [0, 1.377, -0.297], tail: [0, 0.999, -0.3645] },
  { name: 'cape_2', parent: 'cape_1', pos: [0, 0.999, -0.3645], tail: [0, 0.6345, -0.4185] },
  { name: 'cape_3', parent: 'cape_2', pos: [0, 0.6345, -0.4185], tail: [0, 0.351, -0.4725] },
]
const LIMB = {}
for (const [side, s] of [['L', 1], ['R', -1]]) {
  const S = [s * 0.4455, 1.377, 0], E = [s * 0.594, 1.08, 0.0135], W = [s * 0.675, 0.837, 0.0405], F = [s * 0.702, 0.675, 0.0675]
  const Hp = [s * 0.189, 0.7425, 0], K = [s * 0.216, 0.432, 0.0135], A = [s * 0.216, 0.1485, 0], T = [s * 0.216, 0.0405, 0.2025]
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
  skin: hex(0xc68e5f), skinDeep: hex(0x8a5a38), skinLight: hex(0xe0aa7a), hair: hex(0x2e1d12),
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
const GS = 1.35 // Giant scale vs the Knight
/** Uniformly scale a Knight-scale SDF node up to Giant scale. */
const scaled = (n) => node((x, y, z) => n.d(x / GS, y / GS, z / GS) * GS,
  n.min.map((v) => v * GS), n.max.map((v) => v * GS))
/** Knight piece: SDF + voxel res are scaled x1.35; paint/skin are used as-is. */
const piece = (name, material, sdf, paint, skin, res) => PIECES.push({ name, material, sdf: scaled(sdf), paint, skin, res: res ? res * GS : undefined })
/** Giant-native piece: authored directly at Giant scale, no scaling. */
const pieceS = (name, material, sdf, paint, skin, res) => PIECES.push({ name, material, sdf, paint, skin, res })

// ---- Body (bare skin suit), soft-skinned to the skeleton ----
const torsoUpper = ellipsoid([0, 0.85, 0], [0.275, 0.26, 0.19])
const pelvis = ellipsoid([0, 0.6, 0], [0.185, 0.13, 0.145])
const torso = union(0.08, torsoUpper, pelvis)
{
  const parts = [torso, capsule([0, 1.0, 0], [0, 1.2, 0], 0.1, 0.095)]
  for (const { S, E, W, Hp, K, A } of Object.values(LIMB)) {
    parts.push(sphere(S, 0.09), capsule(S, E, 0.085, 0.075), capsule(E, W, 0.07, 0.06))
    parts.push(capsule(Hp, K, 0.1, 0.08), capsule(K, A, 0.075, 0.065))
  }
  // Bare skin: warm tan with soft variation, a touch darker low on the body.
  const mailPaint = (x, y, z) => {
    const tone = 0.9 + 0.1 * fbm(x * 40, y * 40, z * 40, 3) + 0.05 * Math.sin(y * 60)
    return shade(mix(C.skinDeep, C.skinLight, sstep(0.3, 1.9, y)), tone)
  }
  piece('undersuit', 'soft', union(0.05, ...parts), mailPaint,
    { envelope: ['hips', 'spine', 'chest', 'neck', 'upperarm_L', 'forearm_L', 'upperarm_R', 'forearm_R', 'thigh_L', 'shin_L', 'thigh_R', 'shin_R'] })
}
// (No coif: the Giant wears no mail and no helmet.)

// ---- Belt + buckle ----
piece('belt', 'soft', band(torso, 0.02, 0.022, [0, 0.645, 0], [0, 1, 0], 0.036),
  (x, y, z) => mix(C.leather, C.leatherDark, sstep(0.025, 0.036, Math.abs(y - 0.645))), { envelope: ['hips', 'spine'] })
{
  const front = surfacePoint(torso, [0, 0.645, 1], [0, 0, -1])
  const c = add(front, [0, 0, 0.04])
  const frame = subtract(0.004, roundBox(c, [0.06, 0.046, 0.016], 0.013), roundBox(c, [0.034, 0.022, 0.04], 0.008))
  piece('buckle', 'metal', union(0.006, frame, capsule(add(c, [-0.03, 0, 0.012]), add(c, [0.012, 0, 0.012]), 0.008)), flat(C.gold), { rigid: { hips: 1 } })
}

// ---- Bare chest: sculpted pecs + abs over the skin suit (Giant scale) ----
{
  const skinPaint = (x, y, z) => shade(mix(C.skinDeep, C.skinLight, sstep(0.6, 1.9, y)), 0.94 + 0.08 * fbm(x * 40, y * 40, z * 40, 3))
  pieceS('pecs', 'soft', union(0.05,
    ellipsoid([0.15, 1.24, 0.15], [0.2, 0.16, 0.14]),
    ellipsoid([-0.15, 1.24, 0.15], [0.2, 0.16, 0.14])), skinPaint, { envelope: ['chest', 'spine'] })
  pieceS('abs', 'soft', union(0.03,
    ellipsoid([0, 1.03, 0.2], [0.14, 0.075, 0.085]),
    ellipsoid([0, 0.9, 0.19], [0.13, 0.07, 0.08]),
    ellipsoid([0, 0.78, 0.16], [0.12, 0.065, 0.075])), skinPaint, { envelope: ['spine', 'hips'] })
  // Leather sash, team-colored, slung diagonally across the chest.
  const torsoS = ellipsoid([0, 1.1475, 0], [0.371, 0.351, 0.2565])
  const sash = band(offset(torsoS, 0.02), 0.012, 0.02, [0, 1.1, 0.2], [-0.67, 0.74, 0], 0.095)
  pieceS('sash', 'team', sash, (x, y, z) => { const k = 0.92 - 0.08 * fbm(x * 30, y * 30, z * 30, 3); return [k, k, k] },
    { envelope: ['chest', 'spine', 'hips'] })
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

// ---- Arms: rerebraces, bracers, elbow cops, big bare fists ----
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
  const fist = union(0.02, roundBox(fistC, [0.082, 0.1, 0.092], 0.055, frameY(hdir)),
    capsule(add(fistC, [-s * 0.06, 0.026, 0.06]), add(fistC, [-s * 0.04, -0.046, 0.092]), 0.034, 0.029))
  piece(`fist_${side}`, 'soft', fist, (x, y, z) => shade(C.skin, 0.9 + 0.12 * fbm(x * 40, y * 40, z * 40, 3)), { rigid: { [`hand_${side}`]: 1 } })
  // No knuckle plates: the Giant's fists are bare skin.
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

// ---- Bare head: skin skull, hair + topknot, team headband, ember eyes ----
{
  const skinPaint = (x, y, z) => shade(mix(C.skinDeep, C.skinLight, sstep(1.4, 2.1, y)), 0.94 + 0.08 * fbm(x * 40, y * 40, z * 40, 3))
  pieceS('head', 'soft', union(0.04,
    ellipsoid([0, 1.8, 0.02], [0.23, 0.26, 0.24]),
    ellipsoid([0, 1.66, 0.1], [0.16, 0.12, 0.14])), skinPaint, { rigid: { head: 1 } })
  pieceS('hair', 'soft', union(0.03,
    ellipsoid([0, 1.95, -0.03], [0.24, 0.18, 0.25]),
    sphere([0, 2.12, -0.03], 0.09)), flat(C.hair), { rigid: { head: 1 } })
  pieceS('headband', 'team', torus([0, 1.88, 0.01], 0.235, 0.028), (x, y, z) => [0.92, 0.92, 0.92], { rigid: { head: 1 } })
  pieceS('nose', 'soft', ellipsoid([0, 1.74, 0.26], [0.035, 0.05, 0.04]), skinPaint, { rigid: { head: 1 } })
  for (const sgn of [1, -1]) {
    pieceS(`eye_${sgn > 0 ? 'L' : 'R'}`, 'glow', ellipsoid([sgn * 0.095, 1.83, 0.23], [0.04, 0.024, 0.03]), flat(C.ember), { rigid: { head: 1 } }, 0.005)
  }
}

// Bones that pieces may reference must exist.
const boneNames = new Set(BONES.map((b) => b.name))
for (const p of PIECES) {
  const refs = p.skin.rigid ? Object.keys(p.skin.rigid) : p.skin.envelope || []
  for (const r of refs) if (!boneNames.has(r)) throw new Error(`${p.name} references unknown bone ${r}`)
}
void noise3
