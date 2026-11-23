// MINIONS — three small flying imps, one .glb reused for all three.
//
// Small creature ~1.0 units tall: blue-grey body, horns, fangs, glowing
// yellow eyes, webbed wings on wing_L / wing_R bones, small claws.
// Follows the Ember Warden pipeline exactly (see tools/hero/design.mjs).
// Y up, faces +Z, feet at y = 0. LEFT is +X.

import {
  sphere, ellipsoid, capsule, roundBox, torus, cylinder, halfspace, star, bezierTube,
  union, subtract, intersect, offset, band, place, euler, basis, norm, cross, node, fbm, noise3,
} from './sdf.mjs'

// ---------------------------------------------------------------------------
// Skeleton. Knight bones scaled ~0.6x, plus wing_L / wing_R off the chest.
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

// ---------------------------------------------------------------------------
// Palette (sRGB).
// ---------------------------------------------------------------------------
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
const C = {
  body: hex(0x6b7f96), bodyDark: hex(0x46586c), belly: hex(0x9fb2c8), membrane: hex(0x54687f),
  ivory: hex(0xeee2c6), hornTip: hex(0x5a4632), eye: hex(0xffd23f), claw: hex(0xd8cfb8),
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

// ---- Body: pot-bellied torso, soft-skinned ----
const torso = union(0.04,
  ellipsoid([0, 0.48, 0], [0.17, 0.16, 0.13]),
  ellipsoid([0, 0.40, 0.05], [0.14, 0.12, 0.10]),
  ellipsoid([0, 0.33, 0], [0.11, 0.09, 0.10]))
piece('body', 'soft', torso,
  (x, y, z) => {
    const belly = sstep(0.02, 0.14, z) * sstep(0.56, 0.42, y)
    return shade(mix(C.body, C.belly, belly * 0.8), 0.9 + 0.1 * fbm(x * 40, y * 40, z * 40, 3))
  },
  { envelope: ['hips', 'spine', 'chest'] })

// Team chest strap (runtime tints it blue/red).
piece('chest_strap', 'team', band(torso, 0.004, 0.007, [0, 0.50, 0], [0, 1, 0], 0.018),
  (x, y, z) => { const k = 0.92 - 0.08 * fbm(x * 30, y * 90, z * 30, 3); return [k, k, k] },
  { envelope: ['hips', 'spine', 'chest'] })

// ---- Head: big round skull, snout, jaw, brow ----
const headSdf = union(0.03,
  ellipsoid([0, 0.72, 0.02], [0.16, 0.145, 0.15]),
  ellipsoid([0, 0.68, 0.13], [0.095, 0.07, 0.085]),
  ellipsoid([0, 0.62, 0.10], [0.085, 0.05, 0.075]),
  ellipsoid([0.06, 0.78, 0.12], [0.05, 0.03, 0.04]),
  ellipsoid([-0.06, 0.78, 0.12], [0.05, 0.03, 0.04]))
piece('head', 'soft', headSdf,
  (x, y, z) => shade(C.body, 0.88 + 0.18 * sstep(0.55, 0.85, y) + 0.08 * fbm(x * 50, y * 50, z * 50, 3)),
  { rigid: { head: 1 } })

// Team headband.
piece('headband', 'team', torus([0, 0.795, 0.02], 0.145, 0.02),
  (x, y, z) => { const k = 0.92 - 0.06 * fbm(x * 40, y * 40, z * 40, 3); return [k, k, k] },
  { rigid: { head: 1 } })

// Glowing yellow eyes, set proud of the skull so they read.
for (const s of [1, -1]) {
  piece(`eye_${s > 0 ? 'L' : 'R'}`, 'glow', ellipsoid([s * 0.062, 0.75, 0.15], [0.038, 0.042, 0.025]), flat(C.eye), { rigid: { head: 1 } }, 0.004)
  // Horn: small curved bezier tube sweeping up and out.
  const p0 = [s * 0.10, 0.82, -0.02], p1 = [s * 0.20, 0.88, -0.02], p2 = [s * 0.26, 0.95, 0.03], p3 = [s * 0.24, 1.02, 0.08]
  const horn = bezierTube(p0, p1, p2, p3, 0.035, 0.006, 10)
  piece(`horn_${s > 0 ? 'L' : 'R'}`, 'soft', horn, (x, y, z) => {
    const t = horn.param(x, y, z)
    return shade(mix(C.ivory, C.hornTip, sstep(0.5, 1, t)), 0.92 + 0.08 * Math.sin(t * 50))
  }, { rigid: { head: 1 } }, 0.005)
  // Pointy ear.
  piece(`ear_${s > 0 ? 'L' : 'R'}`, 'soft', capsule([s * 0.15, 0.72, -0.01], [s * 0.25, 0.76, -0.02], 0.035, 0.008), grain(C.bodyDark, 0.1, 60), { rigid: { head: 1 } })
  // Fang.
  piece(`fang_${s > 0 ? 'L' : 'R'}`, 'soft', capsule([s * 0.045, 0.665, 0.185], [s * 0.045, 0.605, 0.195], 0.013, 0.002), flat(C.ivory), { rigid: { head: 1 } })
}

// ---- Wings: thin webbed membranes + leading spar + ribs, rigid on wing bones ----
for (const [side, { s }] of Object.entries(LIMB)) {
  const membrane = ellipsoid([s * 0.30, 0.62, -0.18], [0.24, 0.028, 0.15], euler(0, s * 0.4, s * 0.28))
  const spar = capsule([s * 0.13, 0.58, -0.10], [s * 0.48, 0.70, -0.30], 0.02, 0.008)
  const rib1 = capsule([s * 0.14, 0.60, -0.12], [s * 0.42, 0.66, -0.38], 0.009, 0.004)
  const rib2 = capsule([s * 0.14, 0.60, -0.12], [s * 0.30, 0.64, -0.34], 0.009, 0.004)
  const wing = union(0.008, membrane, spar, rib1, rib2)
  piece(`wing_${side}`, 'soft', wing,
    (x, y, z) => {
      const tip = sstep(0.15, 0.5, Math.abs(x))
      return shade(mix(C.bodyDark, C.membrane, tip), 0.9 + 0.1 * fbm(x * 40, y * 40, z * 40, 3))
    },
    { rigid: { [`wing_${side}`]: 1 } })
  // Wing-tip claw.
  piece(`wing_claw_${side}`, 'soft', capsule([s * 0.47, 0.695, -0.295], [s * 0.52, 0.72, -0.33], 0.012, 0.002), flat(C.claw), { rigid: { [`wing_${side}`]: 1 } })
}

// ---- Arms: thin capsules, clawed fists ----
for (const [side, { s, S, E, W, F }] of Object.entries(LIMB)) {
  piece(`upperarm_${side}`, 'soft', capsule(S, E, 0.05, 0.045), grain(C.body, 0.1, 60), { rigid: { [`upperarm_${side}`]: 1 } })
  piece(`forearm_${side}`, 'soft', capsule(E, W, 0.042, 0.038), grain(C.body, 0.1, 60), { rigid: { [`forearm_${side}`]: 1 } })
  const hdir = norm(sub(F, W))
  const fistC = add(W, scale(hdir, 0.04))
  piece(`fist_${side}`, 'soft', sphere(fistC, 0.05), grain(C.bodyDark, 0.1, 60), { rigid: { [`hand_${side}`]: 1 } })
  const claws = []
  for (const [dy, dz] of [[0.02, 0.03], [-0.02, 0.03], [0, -0.01]]) {
    claws.push(capsule(add(fistC, [s * 0.03, dy, dz]), add(fistC, [s * 0.06, dy - 0.015, dz + 0.035]), 0.01, 0.002))
  }
  piece(`hand_claws_${side}`, 'soft', union(0, ...claws), flat(C.claw), { rigid: { [`hand_${side}`]: 1 } })
}

// ---- Legs: dangling capsules, clawed feet ----
for (const [side, { s, Hp, K, A }] of Object.entries(LIMB)) {
  piece(`thigh_${side}`, 'soft', capsule(Hp, K, 0.055, 0.045), grain(C.body, 0.1, 60), { rigid: { [`thigh_${side}`]: 1 } })
  piece(`shin_${side}`, 'soft', capsule(K, A, 0.045, 0.038), grain(C.body, 0.1, 60), { rigid: { [`shin_${side}`]: 1 } })
  piece(`foot_${side}`, 'soft', ellipsoid([s * 0.10, 0.045, 0.06], [0.05, 0.035, 0.07]), grain(C.bodyDark, 0.1, 60), { rigid: { [`foot_${side}`]: 1 } })
  const toes = []
  for (const dx of [-0.03, 0, 0.03]) {
    toes.push(capsule([s * 0.10 + dx, 0.03, 0.11], [s * 0.10 + dx, 0.015, 0.16], 0.009, 0.002))
  }
  piece(`toe_claws_${side}`, 'soft', union(0, ...toes), flat(C.claw), { rigid: { [`foot_${side}`]: 1 } })
}

// ---- Back spikes + little tail with spade tip ----
{
  const spikes = []
  for (const y of [0.44, 0.51, 0.58]) {
    spikes.push(capsule([0, y, -0.13], [0, y + 0.055, -0.19], 0.018, 0.003))
  }
  piece('back_spikes', 'soft', union(0, ...spikes), flat(C.bodyDark), { rigid: { spine: 0.5, chest: 0.5 } })
  const tail = union(0.01,
    capsule([0, 0.33, -0.10], [0, 0.26, -0.26], 0.035, 0.012),
    ellipsoid([0, 0.25, -0.29], [0.05, 0.035, 0.02], euler(0.5, 0, 0)))
  piece('tail', 'soft', tail, grain(C.bodyDark, 0.1, 60), { rigid: { hips: 1 } })
}

// Bones that pieces may reference must exist.
const boneNames = new Set(BONES.map((b) => b.name))
for (const p of PIECES) {
  const refs = p.skin.rigid ? Object.keys(p.skin.rigid) : p.skin.envelope || []
  for (const r of refs) if (!boneNames.has(r)) throw new Error(`${p.name} references unknown bone ${r}`)
}
void noise3
