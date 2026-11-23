// BABY DRAGON — a small flying dragon, ~1.4 units tall at the shoulder.
//
// Horizontal body, long snout with teeth, horns, lighter belly plates,
// back spikes, webbed wings on wing_L / wing_R bones, and a tail with a
// spade tip on the reused cape_1/2/3 bone chain. Fire breath in Attack:
// head lunges forward/down, glow in the mouth.
// Follows the Ember Warden pipeline exactly (see tools/hero/design.mjs).
// Y up, faces +Z, feet at y = 0. LEFT is +X.

import {
  sphere, ellipsoid, capsule, roundBox, torus, cylinder, halfspace, star, bezierTube,
  union, subtract, intersect, offset, band, place, euler, basis, norm, cross, node, fbm, noise3,
} from './sdf.mjs'

// ---------------------------------------------------------------------------
// Skeleton. Knight bones, re-posed for a horizontal quadruped body, plus
// wing_L / wing_R off the chest and the cape chain reused as a TAIL
// (pointing back, slightly down).
// ---------------------------------------------------------------------------
const P = {
  root: [0, 0, 0], hips: [0, 0.55, 0], spine: [0, 0.62, -0.08], chest: [0, 0.72, -0.10], neck: [0, 0.84, 0.02], head: [0, 0.94, 0.22],
}
export const BONES = [
  { name: 'root', parent: null, pos: P.root, tail: [0, 0.3, 0] },
  { name: 'hips', parent: 'root', pos: P.hips, tail: P.spine },
  { name: 'spine', parent: 'hips', pos: P.spine, tail: P.chest },
  { name: 'chest', parent: 'spine', pos: P.chest, tail: P.neck },
  { name: 'neck', parent: 'chest', pos: P.neck, tail: P.head },
  { name: 'head', parent: 'neck', pos: P.head, tail: [0, 1.05, 0.45] },
  { name: 'wing_L', parent: 'chest', pos: [0.22, 0.82, -0.18], tail: [0.55, 1.0, -0.45] },
  { name: 'wing_R', parent: 'chest', pos: [-0.22, 0.82, -0.18], tail: [-0.55, 1.0, -0.45] },
  // Tail chain (reused cape bones), pointing back and slightly down.
  { name: 'cape_1', parent: 'chest', pos: [0, 0.58, -0.45], tail: [0, 0.52, -0.72] },
  { name: 'cape_2', parent: 'cape_1', pos: [0, 0.52, -0.72], tail: [0, 0.48, -0.98] },
  { name: 'cape_3', parent: 'cape_2', pos: [0, 0.48, -0.98], tail: [0, 0.52, -1.22] },
]
const LIMB = {}
for (const [side, s] of [['L', 1], ['R', -1]]) {
  // Front legs (arms) under the chest, hind legs (thighs) under the hips.
  const S = [s * 0.24, 0.68, -0.05], E = [s * 0.30, 0.45, 0.0], W = [s * 0.32, 0.28, 0.03], F = [s * 0.33, 0.20, 0.08]
  const Hp = [s * 0.16, 0.52, -0.28], K = [s * 0.18, 0.30, -0.30], A = [s * 0.18, 0.10, -0.28], T = [s * 0.18, 0.02, -0.15]
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
// Palette (sRGB).
// ---------------------------------------------------------------------------
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
const C = {
  green: hex(0x5d8a4a), greenDark: hex(0x3c5c30), greenLight: hex(0x86b06a), membrane: hex(0x7a4a5a),
  ivory: hex(0xf2ead2), hornTip: hex(0x6a5138), fire: hex(0xff9a2a), eye: hex(0xffb03a), claw: hex(0xe8dfc2),
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k]
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const flat = (c) => () => c
const grain = (c, amt = 0.08, freq = 60) => (x, y, z) => shade(c, 1 - amt / 2 + amt * fbm(x * freq, y * freq, z * freq, 3))

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k]

// ---------------------------------------------------------------------------
// Pieces.
// ---------------------------------------------------------------------------
export const PIECES = []
const piece = (name, material, sdf, paint, skin, res) => PIECES.push({ name, material, sdf, paint, skin, res })

// ---- Body: long horizontal torso, soft-skinned ----
const body = union(0.05,
  ellipsoid([0, 0.68, -0.12], [0.30, 0.27, 0.50]),
  ellipsoid([0, 0.70, 0.16], [0.26, 0.25, 0.28]),
  ellipsoid([0, 0.62, -0.40], [0.24, 0.22, 0.22]))
piece('body', 'soft', body,
  (x, y, z) => shade(C.green, 0.85 + 0.2 * sstep(0.4, 0.95, y) + 0.08 * fbm(x * 30, y * 30, z * 30, 3)),
  { envelope: ['hips', 'spine', 'chest'] })

// Neck, rising from the chest to the head.
piece('neck', 'soft', capsule([0, 0.80, -0.02], [0, 0.92, 0.16], 0.14, 0.12), grain(C.green, 0.08, 50),
  { envelope: ['neck', 'chest'] })

// ---- Belly plates: lighter overlapping plates along the underside (team) ----
{
  const plates = []
  for (const [y, z] of [[0.45, 0.24], [0.43, 0.06], [0.43, -0.12], [0.45, -0.30]]) {
    plates.push(ellipsoid([0, y, z], [0.17, 0.08, 0.14]))
  }
  piece('belly_plates', 'team', union(0.02, ...plates),
    (x, y, z) => { const k = 0.9 - 0.1 * fbm(x * 40, y * 40, z * 40, 3); return [k, k, k] },
    { envelope: ['hips', 'spine', 'chest'] })
}

// Team saddle blanket draped over the back.
piece('saddle', 'team',
  intersect(0.01, ellipsoid([0, 0.86, -0.15], [0.24, 0.10, 0.34]), halfspace([0, 0.84, 0], [0, -1, 0])),
  (x, y, z) => { const k = 0.88 - 0.08 * fbm(x * 30, y * 60, z * 30, 3); return [k, k, k] },
  { rigid: { chest: 1 } })

// ---- Head: skull, long snout, lower jaw, brow ridges; mouth carved open ----
const mouthCut = ellipsoid([0, 0.90, 0.42], [0.09, 0.035, 0.13])
let headSdf = union(0.03,
  ellipsoid([0, 0.96, 0.24], [0.17, 0.15, 0.17]),
  ellipsoid([0, 0.93, 0.42], [0.11, 0.09, 0.14]),
  ellipsoid([0, 0.865, 0.38], [0.095, 0.05, 0.12]),
  ellipsoid([0.07, 1.03, 0.34], [0.05, 0.03, 0.05]),
  ellipsoid([-0.07, 1.03, 0.34], [0.05, 0.03, 0.05]))
headSdf = subtract(0.008, headSdf, mouthCut)
piece('head', 'soft', headSdf,
  (x, y, z) => shade(C.green, 0.85 + 0.2 * sstep(0.8, 1.1, y) + 0.08 * fbm(x * 40, y * 40, z * 40, 3)),
  { rigid: { head: 1 } })

// Fire glow inside the open mouth.
piece('mouth_fire', 'glow', ellipsoid([0, 0.895, 0.44], [0.07, 0.025, 0.09]),
  (x, y, z) => mix(C.fire, [1, 0.95, 0.7], sstep(0.86, 0.92, y)), { rigid: { head: 1 } }, 0.004)

// Glowing amber eyes, set proud of the skull.
for (const s of [1, -1]) {
  piece(`eye_${s > 0 ? 'L' : 'R'}`, 'glow', ellipsoid([s * 0.085, 1.00, 0.375], [0.04, 0.035, 0.03]), flat(C.eye), { rigid: { head: 1 } }, 0.004)
  // Horn sweeping back from the skull.
  const p0 = [s * 0.08, 1.04, 0.14], p1 = [s * 0.17, 1.12, -0.02], p2 = [s * 0.21, 1.06, -0.22], p3 = [s * 0.19, 0.96, -0.36]
  const horn = bezierTube(p0, p1, p2, p3, 0.04, 0.007, 10)
  piece(`horn_${s > 0 ? 'L' : 'R'}`, 'soft', horn, (x, y, z) => {
    const t = horn.param(x, y, z)
    return shade(mix(C.ivory, C.hornTip, sstep(0.5, 1, t)), 0.92 + 0.08 * Math.sin(t * 50))
  }, { rigid: { head: 1 } }, 0.005)
}

// Teeth: upper fangs pointing down, lower teeth pointing up, in the mouth slot.
{
  const teeth = []
  for (const s of [1, -1]) {
    teeth.push(capsule([s * 0.05, 0.87, 0.48], [s * 0.05, 0.82, 0.48], 0.012, 0.002))
    teeth.push(capsule([s * 0.09, 0.875, 0.40], [s * 0.09, 0.83, 0.40], 0.011, 0.002))
    teeth.push(capsule([s * 0.05, 0.87, 0.44], [s * 0.05, 0.915, 0.44], 0.01, 0.002))
  }
  piece('teeth', 'soft', union(0, ...teeth), flat(C.ivory), { rigid: { head: 1 } })
}

// ---- Back spikes along the spine ----
{
  const spikes = []
  const bases = [[0, 0.92, -0.05], [0, 0.94, -0.20], [0, 0.93, -0.35], [0, 0.90, -0.50], [0, 0.86, -0.62]]
  for (const b of bases) spikes.push(capsule(b, add(b, [0, 0.09, -0.03]), 0.025, 0.004))
  piece('back_spikes', 'soft', union(0, ...spikes), flat(C.greenDark),
    { fn: (x, y, z) => (z > -0.28 ? { chest: 1 } : z > -0.45 ? { spine: 1 } : { hips: 1 }) })
}

// ---- Wings: big webbed membranes + leading spar + ribs, rigid on wing bones ----
for (const [side, { s }] of Object.entries(LIMB)) {
  const membrane = ellipsoid([s * 0.45, 0.95, -0.35], [0.36, 0.03, 0.28], euler(0, s * 0.45, s * 0.25))
  const spar = capsule([s * 0.22, 0.84, -0.18], [s * 0.72, 1.02, -0.55], 0.025, 0.01)
  const rib1 = capsule([s * 0.22, 0.84, -0.18], [s * 0.62, 0.98, -0.72], 0.012, 0.005)
  const rib2 = capsule([s * 0.22, 0.84, -0.18], [s * 0.35, 0.92, -0.62], 0.012, 0.005)
  const wing = union(0.01, membrane, spar, rib1, rib2)
  piece(`wing_${side}`, 'soft', wing,
    (x, y, z) => {
      const tip = sstep(0.25, 0.75, Math.abs(x))
      return shade(mix(C.greenDark, C.membrane, tip * 0.7), 0.9 + 0.1 * fbm(x * 30, y * 30, z * 30, 3))
    },
    { rigid: { [`wing_${side}`]: 1 } })
  // Wing-tip claw.
  piece(`wing_claw_${side}`, 'soft', capsule([s * 0.71, 1.015, -0.545], [s * 0.77, 1.05, -0.59], 0.014, 0.002), flat(C.claw), { rigid: { [`wing_${side}`]: 1 } })
}

// ---- Legs: front pair + hind pair, clawed feet ----
for (const [side, { s, S, E, W, F, Hp, K, A }] of Object.entries(LIMB)) {
  piece(`upperarm_${side}`, 'soft', capsule(S, E, 0.075, 0.06), grain(C.green, 0.08, 50), { rigid: { [`upperarm_${side}`]: 1 } })
  piece(`forearm_${side}`, 'soft', capsule(E, W, 0.06, 0.05), grain(C.green, 0.08, 50), { rigid: { [`forearm_${side}`]: 1 } })
  piece(`hand_${side}`, 'soft', ellipsoid([s * 0.32, 0.16, 0.10], [0.07, 0.05, 0.10]), grain(C.greenDark, 0.08, 50), { rigid: { [`hand_${side}`]: 1 } })
  const frontClaws = []
  for (const dx of [-0.04, 0, 0.04]) {
    frontClaws.push(capsule([s * 0.32 + dx, 0.14, 0.18], [s * 0.32 + dx, 0.12, 0.24], 0.011, 0.002))
  }
  piece(`hand_claws_${side}`, 'soft', union(0, ...frontClaws), flat(C.claw), { rigid: { [`hand_${side}`]: 1 } })
  piece(`thigh_${side}`, 'soft', capsule(Hp, K, 0.09, 0.07), grain(C.green, 0.08, 50), { rigid: { [`thigh_${side}`]: 1 } })
  piece(`shin_${side}`, 'soft', capsule(K, A, 0.07, 0.055), grain(C.green, 0.08, 50), { rigid: { [`shin_${side}`]: 1 } })
  piece(`foot_${side}`, 'soft', ellipsoid([s * 0.18, 0.05, -0.12], [0.08, 0.05, 0.11]), grain(C.greenDark, 0.08, 50), { rigid: { [`foot_${side}`]: 1 } })
  const hindClaws = []
  for (const dx of [-0.04, 0, 0.04]) {
    hindClaws.push(capsule([s * 0.18 + dx, 0.03, -0.02], [s * 0.18 + dx, 0.015, 0.04], 0.011, 0.002))
  }
  piece(`hind_claws_${side}`, 'soft', union(0, ...hindClaws), flat(C.claw), { rigid: { [`foot_${side}`]: 1 } })
}

// ---- Tail: tapered tube along the cape bone chain + spade tip ----
{
  const tailTube = bezierTube([0, 0.58, -0.42], [0, 0.54, -0.72], [0, 0.50, -1.00], [0, 0.54, -1.22], 0.13, 0.025, 12)
  const tailSkin = (x, y, z) => {
    if (z >= -0.6) return { cape_1: 1 }
    if (z >= -0.85) { const t = (-0.6 - z) / 0.25; return { cape_1: 1 - t, cape_2: t } }
    if (z >= -1.1) { const t = (-0.85 - z) / 0.25; return { cape_2: 1 - t, cape_3: t } }
    return { cape_3: 1 }
  }
  piece('tail', 'soft', tailTube,
    (x, y, z) => shade(C.green, 0.85 + 0.15 * sstep(0.4, 0.65, y) + 0.08 * fbm(x * 30, y * 30, z * 30, 3)),
    { fn: tailSkin })
  const spade = union(0.01,
    roundBox([0, 0.54, -1.30], [0.07, 0.015, 0.10], 0.01, euler(0.4, 0, 0)),
    ellipsoid([0, 0.54, -1.30], [0.045, 0.02, 0.07], euler(0.4, 0, 0)))
  piece('tail_spade', 'soft', spade, flat(C.greenDark), { rigid: { cape_3: 1 } })
}

// Bones that pieces may reference must exist.
const boneNames = new Set(BONES.map((b) => b.name))
for (const p of PIECES) {
  const refs = p.skin.rigid ? Object.keys(p.skin.rigid) : p.skin.envelope || []
  for (const r of refs) if (!boneNames.has(r)) throw new Error(`${p.name} references unknown bone ${r}`)
}
void noise3
