// SKELETONS — a thin full-bone skeleton: skull, spine, ribcage, bone limbs.
// One .glb reused for all three skeletons in a deploy.
//
// Same 22-bone Knight skeleton and pipeline as the Ember Warden
// (tools/hero/design.mjs). Y up, faces +Z, feet at y = 0, ~1.5 units tall.
// LEFT is +X, RIGHT is -X. No flesh anywhere — all bone-white pieces.

import {
  sphere, ellipsoid, capsule, roundBox, torus, cylinder, halfspace, star, bezierTube,
  union, subtract, intersect, offset, band, place, euler, basis, norm, cross, node, fbm, noise3,
} from './sdf.mjs'

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
// Palette
// ---------------------------------------------------------------------------
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
const C = {
  bone: hex(0xeadfc2), boneDark: hex(0xbfae85), boneShadow: hex(0x8a7648),
  joint: hex(0xd8c9a3), spark: hex(0xffc23d), team: hex(0xf4f4f4),
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k]
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const flat = (c) => () => c
const grain = (c, amt = 0.08, freq = 60) => (x, y, z) => shade(c, 1 - amt / 2 + amt * fbm(x * freq, y * freq, z * freq, 3))
/** Aged bone: ivory with brown blotches. */
const agedBone = (x, y, z) => {
  const blotch = fbm(x * 28, y * 28, z * 28, 3)
  const dark = sstep(0.55, 0.75, blotch) * 0.45
  return shade(mix(C.bone, C.boneShadow, dark), 0.92 + 0.1 * fbm(x * 90, y * 90, z * 90, 2))
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

// ---------------------------------------------------------------------------
// Pieces — all bone, no flesh.
// ---------------------------------------------------------------------------
export const PIECES = []
const piece = (name, material, sdf, paint, skin, res) => PIECES.push({ name, material, sdf, paint, skin, res })

// ---- Skull: cranium + jaw, carved eye sockets and nasal cavity ----
{
  const cranium = ellipsoid([0, 1.37, 0.01], [0.145, 0.16, 0.145])
  const jaw = ellipsoid([0, 1.25, 0.03], [0.1, 0.065, 0.095])
  const cheekL = ellipsoid([0.085, 1.3, 0.09], [0.055, 0.045, 0.05])
  const cheekR = ellipsoid([-0.085, 1.3, 0.09], [0.055, 0.045, 0.05])
  let skull = union(0.03, cranium, jaw, cheekL, cheekR)
  for (const s of [1, -1]) skull = subtract(0.008, skull, sphere([s * 0.055, 1.375, 0.125], 0.04))
  skull = subtract(0.006, skull, roundBox([0, 1.315, 0.135], [0.017, 0.027, 0.03], 0.01, euler(0, 0, 0)))
  for (const s of [1, -1]) skull = subtract(0.006, skull, sphere([s * 0.14, 1.36, 0.02], 0.032))
  piece('skull', 'soft', skull, agedBone, { rigid: { head: 1 } }, 0.005)
  const teeth = []
  for (let i = -2; i <= 2; i++) {
    teeth.push(roundBox([i * 0.03, 1.268, 0.112], [0.012, 0.017, 0.011], 0.006))
    teeth.push(roundBox([i * 0.03, 1.228, 0.102], [0.011, 0.014, 0.01], 0.005))
  }
  piece('teeth', 'soft', union(0, ...teeth), (x, y, z) => shade(C.bone, 0.95 + 0.08 * fbm(x * 120, y * 120, z * 120, 2)), { rigid: { head: 1 } }, 0.004)
  const eyes = union(0, ellipsoid([0.055, 1.375, 0.132], [0.021, 0.025, 0.018]), ellipsoid([-0.055, 1.375, 0.132], [0.021, 0.025, 0.018]))
  piece('eyes', 'glow', eyes, flat(C.spark), { rigid: { head: 1 } }, 0.004)
}

// ---- Neck vertebrae: small stacked discs ----
{
  const discs = []
  for (let i = 0; i < 3; i++) discs.push(cylinder([0, 1.09 + i * 0.035, 0], 0.045, 0.012, 0.008))
  piece('neck_bones', 'soft', union(0.006, ...discs), agedBone, { rigid: { neck: 1 } }, 0.0045)
}

// ---- Spine: stacked vertebrae down the back ----
{
  const verts = []
  for (let i = 0; i < 6; i++) {
    const y = 0.66 + i * 0.055
    verts.push(cylinder([0, y, -0.02], 0.05, 0.014, 0.01))
    verts.push(sphere([0, y, -0.055], 0.02)) // spinous process nub
  }
  piece('spine', 'soft', union(0.008, ...verts), agedBone, { envelope: ['hips', 'spine', 'chest'] }, 0.0045)
}

// ---- Ribcage: torus bands around the chest + sternum + collarbones ----
{
  const ribs = []
  const ribYs = [0.78, 0.84, 0.9, 0.96, 1.01]
  for (let i = 0; i < ribYs.length; i++) {
    const y = ribYs[i]
    const r = 0.19 + 0.03 * Math.sin((i / (ribYs.length - 1)) * Math.PI)
    ribs.push(torus([0, y, 0], r, 0.016))
  }
  // Sternum: vertical bar down the front, joining the ribs.
  ribs.push(capsule([0, 1.02, 0.185], [0, 0.78, 0.17], 0.022, 0.018))
  piece('ribcage', 'soft', union(0.008, ...ribs), agedBone, { rigid: { chest: 1 } }, 0.0045)
  // Collarbones + shoulder blades.
  const collar = union(0.01,
    capsule([-0.2, 1.03, 0.08], [0, 1.05, 0.12], 0.016, 0.014),
    capsule([0.2, 1.03, 0.08], [0, 1.05, 0.12], 0.016, 0.014))
  piece('collarbones', 'soft', collar, agedBone, { rigid: { chest: 1 } }, 0.0045)
  const blades = []
  for (const s of [1, -1]) blades.push(ellipsoid([s * 0.16, 0.95, -0.14], [0.09, 0.11, 0.03]))
  piece('shoulder_blades', 'soft', union(0.01, ...blades), agedBone, { rigid: { chest: 1 } }, 0.0045)
}

// ---- Pelvis: hip bone bowl + sacrum ----
{
  const pelvis = union(0.03,
    ellipsoid([0, 0.58, 0], [0.15, 0.09, 0.115]),
    ellipsoid([0.11, 0.62, 0], [0.07, 0.08, 0.09]),
    ellipsoid([-0.11, 0.62, 0], [0.07, 0.08, 0.09]))
  piece('pelvis', 'soft', pelvis, agedBone, { rigid: { hips: 1 } })
  // Team sash: the one cloth piece, so the runtime team tint reads on it.
  piece('sash', 'team', band(pelvis, 0.008, 0.012, [0, 0.6, 0], [0, 1, 0], 0.028),
    (x, y, z) => { const k = 0.9 - 0.1 * fbm(x * 40, y * 40, z * 40, 3); return [k, k, k] }, { rigid: { hips: 1 } })
}

// ---- Bone arms: thin capsules + knuckle joints + finger bones ----
for (const [side, { s, S, E, W, F }] of Object.entries(LIMB)) {
  const up = norm(sub(E, S))
  piece(`upperarm_${side}`, 'soft', capsule(add(S, scale(up, 0.03)), sub(E, scale(up, 0.03)), 0.038, 0.032),
    agedBone, { rigid: { [`upperarm_${side}`]: 1 } }, 0.0045)
  piece(`elbow_${side}`, 'soft', sphere(E, 0.042), (x, y, z) => shade(C.joint, 0.95 + 0.08 * fbm(x * 100, y * 100, z * 100, 2)), { rigid: { [`upperarm_${side}`]: 0.5, [`forearm_${side}`]: 0.5 } }, 0.0045)
  const dir = norm(sub(W, E))
  // Forearm: two thin parallel bones (radius + ulna).
  const off = [0, 0, 0.022]
  const fore = union(0.006,
    capsule(add(add(E, scale(dir, 0.03)), off), add(sub(W, scale(dir, 0.03)), off), 0.02, 0.017),
    capsule(add(add(E, scale(dir, 0.03)), scale(off, -1)), add(sub(W, scale(dir, 0.03)), scale(off, -1)), 0.02, 0.017))
  piece(`forearm_${side}`, 'soft', fore, agedBone, { rigid: { [`forearm_${side}`]: 1 } }, 0.0045)
  // Hand: palm knuckles + three claw finger bones.
  const hdir = norm(sub(F, W))
  const palm = add(W, scale(hdir, 0.04))
  const fingers = []
  for (let i = -1; i <= 1; i++) {
    const a = add(palm, [i * 0.026 * s, 0.005, 0.025])
    const b = add(a, [i * 0.008 * s, -0.035, 0.05])
    const c = add(b, [0, -0.03, 0.035])
    fingers.push(capsule(a, b, 0.011, 0.009), capsule(b, c, 0.009, 0.006))
  }
  piece(`hand_${side}`, 'soft', union(0.006, sphere(palm, 0.035), ...fingers),
    agedBone, { rigid: { [`hand_${side}`]: 1 } }, 0.004)
}

// ---- Bone legs: thin capsules + knee joints + toe bones ----
for (const [side, { s, Hp, K, A, T }] of Object.entries(LIMB)) {
  piece(`thigh_${side}`, 'soft', capsule(add(Hp, [0, -0.02, 0]), add(K, [0, 0.03, 0]), 0.045, 0.038),
    agedBone, { rigid: { [`thigh_${side}`]: 1 } }, 0.0045)
  piece(`knee_${side}`, 'soft', sphere(K, 0.048), (x, y, z) => shade(C.joint, 0.95 + 0.08 * fbm(x * 100, y * 100, z * 100, 2)), { rigid: { [`thigh_${side}`]: 0.5, [`shin_${side}`]: 0.5 } }, 0.0045)
  const dir = norm(sub(A, K))
  // Shin: two thin parallel bones (tibia + fibula).
  const off = [0.02, 0, 0]
  const shin = union(0.006,
    capsule(add(add(K, scale(dir, 0.03)), off), add(sub(A, scale(dir, 0.03)), off), 0.022, 0.018),
    capsule(add(add(K, scale(dir, 0.03)), scale(off, -1)), add(sub(A, scale(dir, 0.03)), scale(off, -1)), 0.018, 0.015))
  piece(`shin_${side}`, 'soft', shin, agedBone, { rigid: { [`shin_${side}`]: 1 } }, 0.0045)
  // Foot: heel + three toe bones pointing forward.
  const toes = []
  for (let i = -1; i <= 1; i++) {
    const a = [s * 0.16 + i * 0.035, 0.045, 0.1]
    const b = [s * 0.16 + i * 0.035, 0.04, 0.19]
    toes.push(capsule(a, b, 0.013, 0.009))
  }
  piece(`foot_${side}`, 'soft', union(0.008, ellipsoid([s * 0.16, 0.06, 0.02], [0.06, 0.045, 0.08]), ...toes),
    agedBone, { rigid: { [`foot_${side}`]: 1 } }, 0.0045)
}

// Bones that pieces may reference must exist.
const boneNames = new Set(BONES.map((b) => b.name))
for (const p of PIECES) {
  const refs = p.skin.rigid ? Object.keys(p.skin.rigid) : p.skin.envelope || []
  for (const r of refs) if (!boneNames.has(r)) throw new Error(`${p.name} references unknown bone ${r}`)
}
void noise3
void star
void offset
void surfacePoint
