// THE BOMBER — a hooded skull-faced bomber with a fused bomb.
//
// Same 22-bone Knight skeleton and pipeline as the Ember Warden
// (tools/hero/design.mjs). Y up, faces +Z, feet at y = 0, ~1.5 units tall.
// LEFT is +X, RIGHT is -X. Bomb in the right hand.

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
  robe: hex(0x1c1a22), robeDark: hex(0x100e14), bone: hex(0xe8ddc0), boneDark: hex(0xb9a67e),
  boneShadow: hex(0x8a7648), iron: hex(0x2e2e33), ironDark: hex(0x1a1a1e),
  fuse: hex(0x6b4a26), spark: hex(0xffc23d), team: hex(0xf4f4f4),
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
// Pieces
// ---------------------------------------------------------------------------
export const PIECES = []
const piece = (name, material, sdf, paint, skin, res) => PIECES.push({ name, material, sdf, paint, skin, res })

// ---- Dark underbody (thin, mostly hidden under the robe) ----
{
  const parts = [
    ellipsoid([0, 0.85, 0], [0.22, 0.26, 0.16]),
    ellipsoid([0, 0.6, 0], [0.16, 0.12, 0.13]),
    capsule([0, 1.0, 0], [0, 1.2, 0], 0.09, 0.085),
  ]
  for (const { S, E, W, Hp, K, A } of Object.values(LIMB)) {
    parts.push(capsule(S, E, 0.07, 0.06), capsule(E, W, 0.055, 0.05))
    parts.push(capsule(Hp, K, 0.085, 0.07), capsule(K, A, 0.06, 0.05))
  }
  piece('undersuit', 'soft', union(0.05, ...parts), grain(C.robeDark, 0.12, 50),
    { envelope: ['hips', 'spine', 'chest', 'neck', 'upperarm_L', 'forearm_L', 'upperarm_R', 'forearm_R', 'thigh_L', 'shin_L', 'thigh_R', 'shin_R'] })
}

// ---- Hooded robe: flared body + skirt, soft, near-black ----
const robeTorso = ellipsoid([0, 0.78, 0], [0.27, 0.33, 0.21])
const robeSkirt = ellipsoid([0, 0.32, 0], [0.31, 0.32, 0.25])
{
  const skirt = intersect(0.01, robeSkirt, halfspace([0, 0.04, 0], [0, -1, 0]))
  const robe = union(0.06, robeTorso, skirt)
  piece('robe', 'soft', robe, (x, y, z) => {
    const fold = 0.5 + 0.5 * Math.sin(Math.atan2(x, z) * 6 + y * 4)
    return shade(C.robe, 0.85 + 0.18 * fold + 0.08 * fbm(x * 30, y * 30, z * 30, 3))
  }, { envelope: ['hips', 'spine', 'chest'] })
  // Team trim: waist band + hem band on the skirt.
  piece('robe_belt', 'team', band(robeTorso, 0.01, 0.014, [0, 0.62, 0], [0, 1, 0], 0.03),
    (x, y, z) => { const k = 0.9 - 0.1 * fbm(x * 40, y * 40, z * 40, 3); return [k, k, k] }, { envelope: ['hips', 'spine'] })
  piece('robe_hem', 'team', band(robeSkirt, 0.008, 0.012, [0, 0.13, 0], [0, 1, 0], 0.022),
    (x, y, z) => { const k = 0.88 - 0.1 * fbm(x * 40, y * 40, z * 40, 3); return [k, k, k] }, { envelope: ['hips', 'thigh_L', 'thigh_R'] })
}

// ---- Hood: shell around the skull with a carved face opening ----
{
  const outer = ellipsoid([0, 1.38, -0.02], [0.215, 0.235, 0.215])
  const inner = ellipsoid([0, 1.36, 0.02], [0.175, 0.195, 0.175])
  let hood = subtract(0.01, outer, inner)
  // Face opening: carve a forward sphere out of the shell.
  hood = subtract(0.015, hood, sphere([0, 1.35, 0.16], 0.145))
  // Pointed tip drooping at the back.
  hood = union(0.02, hood, capsule([0, 1.56, -0.08], [0, 1.62, -0.2], 0.07, 0.01))
  piece('hood', 'soft', hood, (x, y, z) => shade(C.robe, 0.85 + 0.15 * fbm(x * 35, y * 35, z * 35, 3) + 0.1 * sstep(1.4, 1.62, y)), { rigid: { head: 1 } }, 0.0055)
  // Team trim ring around the face opening.
  piece('hood_trim', 'team', torus([0, 1.35, 0.14], 0.155, 0.018, euler(Math.PI / 2, 0, 0)),
    (x, y, z) => { const k = 0.9 - 0.08 * fbm(x * 50, y * 50, z * 50, 3); return [k, k, k] }, { rigid: { head: 1 } })
}

// ---- Skull: cranium + jaw, carved eye sockets and nasal cavity ----
{
  const cranium = ellipsoid([0, 1.37, 0.01], [0.15, 0.165, 0.15])
  const jaw = ellipsoid([0, 1.245, 0.03], [0.105, 0.07, 0.1])
  const cheekL = ellipsoid([0.09, 1.3, 0.09], [0.06, 0.05, 0.05])
  const cheekR = ellipsoid([-0.09, 1.3, 0.09], [0.06, 0.05, 0.05])
  let skull = union(0.03, cranium, jaw, cheekL, cheekR)
  // Eye sockets.
  for (const s of [1, -1]) skull = subtract(0.008, skull, sphere([s * 0.058, 1.375, 0.125], 0.038))
  // Nasal cavity.
  skull = subtract(0.006, skull, roundBox([0, 1.315, 0.135], [0.018, 0.028, 0.03], 0.01, euler(0, 0, 0)))
  // Temple hollows.
  for (const s of [1, -1]) skull = subtract(0.006, skull, sphere([s * 0.145, 1.36, 0.02], 0.035))
  piece('skull', 'soft', skull, agedBone, { rigid: { head: 1 } }, 0.005)
  // Individual teeth: small boxes along the upper and lower jaw front.
  const teeth = []
  for (let i = -2; i <= 2; i++) {
    teeth.push(roundBox([i * 0.032, 1.265, 0.115], [0.013, 0.018, 0.012], 0.006))
    teeth.push(roundBox([i * 0.032, 1.225, 0.105], [0.012, 0.015, 0.011], 0.005))
  }
  piece('teeth', 'soft', union(0, ...teeth), (x, y, z) => shade(C.bone, 0.95 + 0.08 * fbm(x * 120, y * 120, z * 120, 2)), { rigid: { head: 1 } }, 0.004)
  // Glowing eyes deep in the sockets.
  const eyes = union(0, ellipsoid([0.058, 1.375, 0.135], [0.022, 0.026, 0.018]), ellipsoid([-0.058, 1.375, 0.135], [0.022, 0.026, 0.018]))
  piece('eyes', 'glow', eyes, flat(C.spark), { rigid: { head: 1 } }, 0.004)
}

// ---- Robe sleeves (dark, wide) + bony hands ----
for (const [side, { s, S, E, W, F }] of Object.entries(LIMB)) {
  const up = norm(sub(E, S))
  piece(`sleeve_upper_${side}`, 'soft',
    capsule(add(S, scale(up, 0.02)), sub(E, scale(up, 0.02)), 0.105, 0.095),
    grain(C.robe, 0.12, 45), { rigid: { [`upperarm_${side}`]: 1 } })
  const dir = norm(sub(W, E))
  piece(`sleeve_fore_${side}`, 'soft',
    capsule(add(E, scale(dir, 0.02)), sub(W, scale(dir, -0.02)), 0.095, 0.085),
    grain(C.robe, 0.12, 45), { rigid: { [`forearm_${side}`]: 1 } })
  // Bony hand: palm + finger capsules.
  const hdir = norm(sub(F, W))
  const palm = add(W, scale(hdir, 0.05))
  const fingers = []
  for (let i = -1; i <= 1; i++) {
    const a = add(palm, [i * 0.028 * s, 0.01, 0.03])
    const b = add(a, [i * 0.01 * s, -0.045, 0.055])
    fingers.push(capsule(a, b, 0.013, 0.009))
  }
  fingers.push(capsule(add(palm, [-s * 0.04, 0, 0.02]), add(palm, [-s * 0.055, -0.02, 0.05]), 0.012, 0.009))
  piece(`hand_${side}`, 'soft', union(0.008, roundBox(palm, [0.045, 0.04, 0.045], 0.025, frameY(hdir)), ...fingers),
    agedBone, { rigid: { [`hand_${side}`]: 1 } }, 0.0045)
}

// ---- Bomb in the right hand: dark sphere, cap, bezier fuse, glow spark ----
{
  const { W, F } = LIMB.R
  const g = add(W, scale(norm(sub(F, W)), 0.09))
  const rigid = { rigid: { hand_R: 1 }, occluder: 'bomb' }
  piece('bomb', 'metal', sphere(g, 0.115), (x, y, z) => shade(C.iron, 0.85 + 0.25 * fbm(x * 60, y * 60, z * 60, 3)), rigid)
  piece('bomb_cap', 'metal', cylinder(add(g, [0, 0.115, 0]), 0.035, 0.02, 0.008), flat(C.ironDark), rigid)
  // Fuse: bezier tube curling up from the cap.
  const top = add(g, [0, 0.13, 0])
  const fuse = bezierTube(top, add(top, [0.03, 0.09, 0.02]), add(top, [-0.04, 0.15, 0.05]), add(top, [0.01, 0.2, 0.02]), 0.014, 0.008, 10, 0.01)
  piece('bomb_fuse', 'soft', fuse, (x, y, z) => shade(C.fuse, 0.85 + 0.2 * fbm(x * 120, y * 120, z * 120, 2)), rigid, 0.004)
  const tip = add(top, [0.01, 0.2, 0.02])
  piece('bomb_spark', 'glow', union(0, sphere(tip, 0.028), sphere(add(tip, [0.02, 0.012, 0.01]), 0.016), sphere(add(tip, [-0.018, 0.015, -0.008]), 0.014)),
    flat(C.spark), rigid, 0.004)
}

// ---- Shoe tips peeking from under the robe ----
for (const [side, { s }] of Object.entries(LIMB)) {
  piece(`shoe_${side}`, 'soft', ellipsoid([s * 0.16, 0.055, 0.1], [0.075, 0.05, 0.1]), grain(C.robeDark, 0.1, 50), { rigid: { [`foot_${side}`]: 1 } })
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
