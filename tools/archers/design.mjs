// THE ARCHERS — a slim female archer hero (one .glb reused for both archers).
//
// Same 22-bone Knight skeleton and pipeline as the Ember Warden:
// SDF pieces -> Surface Nets -> decimation -> baked AO -> skin -> clips.
// Faces +Z, feet at y = 0, ~1.6 units tall. Bow in the LEFT hand, quiver on
// the back, magenta ponytail, leather tunic with team trim.

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
// Palette (sRGB).
// ---------------------------------------------------------------------------
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
const C = {
  skin: hex(0xe8b88a), skinShade: hex(0xc98f5f),
  hair: hex(0xc2276b), hairDeep: hex(0x8a1450),
  leather: hex(0x7a4a26), leatherDark: hex(0x4a2c16), tunic: hex(0x8a5a2e),
  boot: hex(0x3a2418), wood: hex(0x6b4423), woodDark: hex(0x4a2c14),
  steel: hex(0x9aa2ad), steelDark: hex(0x5d6570), gold: hex(0xe3a93f),
  eye: hex(0x3fae5a), fletch: hex(0xd23c3c), ivory: hex(0xeee2c6), team: hex(0xf4f4f4),
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k]
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const flat = (c) => () => c
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
// Pieces. material: 'soft' | 'metal' | 'team' | 'glow'
// ---------------------------------------------------------------------------
export const PIECES = []
const piece = (name, material, sdf, paint, skin, res) => PIECES.push({ name, material, sdf, paint, skin, res })

// ---- Slim body under the tunic: skin arms/neck, dark leather leggings ----
const torsoUpper = ellipsoid([0, 0.85, 0], [0.23, 0.26, 0.16])
const pelvis = ellipsoid([0, 0.6, 0], [0.16, 0.12, 0.13])
const torso = union(0.08, torsoUpper, pelvis)
{
  const parts = [torso, capsule([0, 1.0, 0], [0, 1.2, 0], 0.055, 0.05)]
  for (const { S, E, W, Hp, K, A } of Object.values(LIMB)) {
    parts.push(sphere(S, 0.075), capsule(S, E, 0.068, 0.06), capsule(E, W, 0.056, 0.048))
    parts.push(capsule(Hp, K, 0.082, 0.068), capsule(K, A, 0.06, 0.052))
  }
  const bodyPaint = (x, y, z) => {
    if (y < 0.58) return shade(C.leatherDark, 0.9 + 0.15 * fbm(x * 50, y * 50, z * 50, 3)) // leggings
    return shade(C.skin, 0.95 + 0.08 * fbm(x * 40, y * 40, z * 40, 3))
  }
  piece('undersuit', 'soft', union(0.05, ...parts), bodyPaint,
    { envelope: ['hips', 'spine', 'chest', 'neck', 'upperarm_L', 'forearm_L', 'upperarm_R', 'forearm_R', 'thigh_L', 'shin_L', 'thigh_R', 'shin_R'] })
}

// ---- Face: skin, nose, ears, green eyes, dark brows ----
{
  const face = union(0.02,
    ellipsoid([0, 1.32, 0.02], [0.105, 0.12, 0.1]),
    ellipsoid([0, 1.31, 0.115], [0.018, 0.025, 0.02]),
    sphere([0.105, 1.32, 0], 0.022), sphere([-0.105, 1.32, 0], 0.022))
  piece('face', 'soft', face, grain(C.skin, 0.06, 50), { rigid: { head: 1 } })
  for (const s of [1, -1]) {
    piece(`eye_${s > 0 ? 'L' : 'R'}`, 'soft', ellipsoid([s * 0.042, 1.335, 0.105], [0.018, 0.012, 0.01]), flat(C.eye), { rigid: { head: 1 } }, 0.004)
    piece(`brow_${s > 0 ? 'L' : 'R'}`, 'soft', capsule([s * 0.02, 1.362, 0.104], [s * 0.064, 1.362, 0.104], 0.006), flat(C.hairDeep), { rigid: { head: 1 } }, 0.004)
  }
}

// ---- Magenta hair: cap + topknot + gold pin + side locks + ponytail ----
{
  const cap = intersect(0.01,
    union(0.03, ellipsoid([0, 1.37, -0.01], [0.125, 0.13, 0.125]), ellipsoid([0, 1.32, -0.08], [0.11, 0.13, 0.09])),
    halfspace([0, 1.335, 0], [0, -1, 0]))
  piece('hair_cap', 'soft', cap, (x, y, z) => shade(mix(C.hair, C.hairDeep, sstep(1.3, 1.5, y)), 0.95 + 0.1 * fbm(x * 50, y * 50, z * 50, 3)), { rigid: { head: 1 } })
  piece('hair_bun', 'soft', sphere([0, 1.52, -0.03], 0.05), grain(C.hair, 0.1, 60), { rigid: { head: 1 } })
  piece('hairpin', 'metal', union(0, capsule([-0.04, 1.5, 0.02], [0.05, 1.6, 0.05], 0.008), sphere([0.05, 1.6, 0.05], 0.014)), flat(C.gold), { rigid: { head: 1 } }, 0.004)
  for (const s of [1, -1]) {
    piece(`hair_lock_${s > 0 ? 'L' : 'R'}`, 'soft', capsule([s * 0.11, 1.38, 0.02], [s * 0.12, 1.18, 0.05], 0.03, 0.02), grain(C.hair, 0.1, 60), { rigid: { head: 1 } })
  }
  piece('hair_band', 'metal', torus([0, 1.46, -0.08], 0.055, 0.014, euler(0.5, 0, 0)), flat(C.gold), { rigid: { head: 1 } }, 0.004)
  // Ponytail: three strands arcing off the top of the head down the back.
  // Skin: head at the top, blending to chest below y ~1.0.
  const hairSkin = (x, y, z) => { const t = sstep(1.15, 0.95, y); return { head: 1 - t, chest: t } }
  const strands = [
    [[0, 1.47, -0.08], [0, 1.42, -0.22], [0.02, 1.05, -0.3], [0.03, 0.78, -0.26], 0.05, 0.022],
    [[-0.04, 1.45, -0.07], [-0.08, 1.35, -0.24], [-0.06, 1.0, -0.3], [-0.03, 0.82, -0.24], 0.04, 0.018],
    [[0.04, 1.45, -0.07], [0.08, 1.38, -0.22], [0.07, 1.08, -0.29], [0.05, 0.86, -0.25], 0.04, 0.018],
  ]
  strands.forEach(([p0, p1, p2, p3, r0, r1], i) => {
    piece(`ponytail_${i}`, 'soft', bezierTube(p0, p1, p2, p3, r0, r1, 12, 0.015),
      (x, y, z) => shade(mix(C.hair, C.hairDeep, sstep(1.4, 0.8, y)), 0.95 + 0.08 * fbm(x * 60, y * 60, z * 60, 3)),
      { fn: hairSkin }, 0.005)
  })
}

// ---- Leather tunic (to mid-thigh) + team hem trim, collar, front panel ----
const tunicSdf = intersect(0.01,
  union(0.04, offset(torsoUpper, 0.03), ellipsoid([0, 0.55, 0], [0.2, 0.16, 0.16])),
  halfspace([0, 0.44, 0], [0, -1, 0]))
piece('tunic', 'soft', tunicSdf, (x, y, z) => shade(C.tunic, 0.9 + 0.12 * fbm(x * 40, y * 40, z * 40, 3) + 0.06 * sstep(0.44, 0.7, y)), { envelope: ['hips', 'spine', 'chest'] })
piece('tunic_hem', 'team', band(tunicSdf, 0.004, 0.006, [0, 0.47, 0], [0, 1, 0], 0.018),
  (x, y, z) => { const k = 0.9 + 0.08 * Math.sin(x * 60); return [k, k, k] }, { envelope: ['hips', 'spine'] })
piece('tunic_collar', 'team', torus([0, 1.06, 0], 0.13, 0.022), (x, y, z) => { const k = 0.92; return [k, k, k] }, { rigid: { chest: 1 } })
{
  const cut = (n) => intersect(0.006, intersect(0.006, n, halfspace([0, 0.31, 0], [0.5, -1, 0])), halfspace([0, 0.31, 0], [-0.5, -1, 0]))
  const front = cut(roundBox([0, 0.5, 0.185], [0.1, 0.14, 0.01], 0.008, euler(-0.1, 0, 0)))
  piece('tabard_front', 'team', front, (x, y, z) => {
    const edge = Math.min(0.1 - Math.abs(x), 0.14 - Math.abs(y - 0.5))
    let k = 0.94 - 0.06 * fbm(x * 30, y * 90, z * 30, 3)
    if (edge < 0.02) k *= 0.45
    if (Math.abs(x) < 0.018 && y > 0.42 && y < 0.58) k *= 0.5 // painted arrow shaft
    return [k, k, k]
  }, { rigid: { tabard_F: 1 } }, 0.005)
}

// ---- Belt + buckle ----
piece('belt', 'soft', band(torso, 0.02, 0.022, [0, 0.645, 0], [0, 1, 0], 0.036),
  (x, y, z) => mix(C.leather, C.leatherDark, sstep(0.025, 0.036, Math.abs(y - 0.645))), { envelope: ['hips', 'spine'] })
{
  const front = surfacePoint(torso, [0, 0.645, 1], [0, 0, -1])
  const c = add(front, [0, 0, 0.04])
  const frame = subtract(0.004, roundBox(c, [0.055, 0.042, 0.016], 0.013), roundBox(c, [0.03, 0.02, 0.04], 0.008))
  piece('buckle', 'metal', union(0.006, frame, capsule(add(c, [-0.028, 0, 0.012]), add(c, [0.012, 0, 0.012]), 0.008)), flat(C.gold), { rigid: { hips: 1 } })
}

// ---- Slim team shoulder caps ----
for (const [side, { s }] of Object.entries(LIMB)) {
  const w = { [`upperarm_${side}`]: 0.5, chest: 0.5 }
  piece(`shoulder_${side}`, 'team', ellipsoid([s * 0.33, 1.03, 0], [0.1, 0.07, 0.11]),
    (x, y, z) => { const k = 0.92 + 0.06 * sstep(0.98, 1.08, y); return [k, k, k] }, { rigid: w })
}

// ---- Leather bracers, wrist trim, slim hands ----
for (const [side, { s, E, W, F }] of Object.entries(LIMB)) {
  const dir = norm(sub(W, E))
  piece(`bracer_${side}`, 'soft', capsule(add(E, scale(dir, 0.04)), sub(W, scale(dir, 0.02)), 0.066, 0.072),
    grain(C.leather, 0.15, 70), { rigid: { [`forearm_${side}`]: 1 } })
  piece(`bracer_trim_${side}`, 'team', torus(sub(W, scale(dir, 0.02)), 0.072, 0.01, frameY(dir)),
    (x, y, z) => { const k = 0.92; return [k, k, k] }, { rigid: { [`forearm_${side}`]: 1 } })
  const hdir = norm(sub(F, W))
  const fistC = add(W, scale(hdir, 0.06))
  piece(`hand_${side}`, 'soft', union(0.02, roundBox(fistC, [0.05, 0.062, 0.058], 0.035, frameY(hdir)),
    capsule(add(fistC, [-s * 0.038, 0.015, 0.038]), add(fistC, [-s * 0.025, -0.03, 0.06]), 0.022, 0.019)),
    grain(C.skin, 0.06, 50), { rigid: { [`hand_${side}`]: 1 } })
}

// ---- Tall leather boots with team top trim ----
for (const [side, { s, K, A }] of Object.entries(LIMB)) {
  const boot = union(0.03,
    capsule([s * 0.16, 0.34, 0], [s * 0.16, 0.07, 0], 0.072, 0.066),
    roundBox([s * 0.16, 0.055, 0.045], [0.072, 0.055, 0.125], 0.045))
  piece(`boot_${side}`, 'soft', boot, (x, y, z) => shade(C.boot, 0.9 + 0.15 * sstep(0.02, 0.3, y) + 0.08 * fbm(x * 50, y * 50, z * 50, 3)),
    { rigid: { [`shin_${side}`]: 0.6, [`foot_${side}`]: 0.4 } })
  piece(`boot_trim_${side}`, 'team', torus([s * 0.16, 0.33, 0], 0.074, 0.011),
    (x, y, z) => { const k = 0.92; return [k, k, k] }, { rigid: { [`shin_${side}`]: 1 } })
}

// ---- Quiver on the back: leather tube + 3 arrows + brass ring ----
{
  const quiver = capsule([0.16, 0.7, -0.22], [0.2, 1.08, -0.27], 0.06, 0.055)
  piece('quiver', 'soft', quiver, grain(C.leatherDark, 0.15, 70), { rigid: { chest: 1 } })
  piece('quiver_ring', 'metal', band(quiver, 0.004, 0.006, [0.19, 1.02, -0.26], [0, 1, 0], 0.015), flat(C.gold), { rigid: { chest: 1 } })
  const shafts = []
  const fletch = []
  for (let i = 0; i < 3; i++) {
    const bx = 0.17 + i * 0.03, bz = -0.26 + (i % 2) * 0.02
    shafts.push(capsule([bx, 1.0, bz], [bx + 0.02, 1.32, bz - 0.01], 0.011))
    fletch.push(ellipsoid([bx + 0.02, 1.29, bz - 0.01], [0.014, 0.035, 0.02]))
  }
  piece('quiver_arrows', 'soft', union(0, ...shafts), grain(C.wood, 0.1, 60), { rigid: { chest: 1 } })
  piece('quiver_fletch', 'soft', union(0, ...fletch), flat(C.fletch), { rigid: { chest: 1 } }, 0.004)
  // (Arrowheads point down inside the quiver, so no visible tip piece.)
}

// ---- Bow in the LEFT hand + nocked arrow -------------------------------------
// Built in the bind pose with the bow's long axis along Z and the arrow along
// -Y (down the hanging arm). When the left arm swings forward to aim, the bow
// stands vertical and the arrow points forward.
{
  const { W } = LIMB.L
  const g = add(W, [0.02, 0, 0]) // grip at the left fist
  const rigid = { rigid: { hand_L: 1 }, occluder: 'bow' }
  // Recurve limbs: tips fore/aft, belly bowed toward -Y (the arrow's side).
  const bow = bezierTube(
    [g[0], g[1], g[2] + 0.47], [g[0], g[1] - 0.26, g[2] + 0.29],
    [g[0], g[1] - 0.26, g[2] - 0.33], [g[0], g[1], g[2] - 0.49],
    0.02, 0.02, 12, 0.02)
  piece('bow', 'soft', bow, (x, y, z) => shade(C.wood, 0.9 + 0.12 * fbm(x * 50, y * 50, z * 50, 3)), rigid, 0.005)
  piece('bow_string', 'soft', capsule([g[0], g[1], g[2] + 0.47], [g[0], g[1], g[2] - 0.49], 0.005),
    flat(C.ivory), rigid, 0.0035)
  piece('bow_grip', 'soft', capsule([g[0], g[1] - 0.07, g[2]], [g[0], g[1] + 0.07, g[2]], 0.028),
    grain(C.woodDark, 0.15, 70), rigid, 0.005)
  // Nocked arrow: shaft down the arm axis, steel head at the tip, red fletching
  // at the string.
  const shaft = capsule([g[0], g[1] + 0.04, g[2]], [g[0], g[1] - 0.54, g[2]], 0.009)
  piece('arrow_shaft', 'soft', shaft, grain(C.wood, 0.1, 60), rigid, 0.0045)
  piece('arrow_head', 'metal', capsule([g[0], g[1] - 0.54, g[2]], [g[0], g[1] - 0.62, g[2]], 0.014, 0.002), flat(C.steel), rigid, 0.004)
  piece('arrow_fletch', 'soft', ellipsoid([g[0], g[1] + 0.0, g[2]], [0.012, 0.035, 0.02]), flat(C.fletch), rigid, 0.004)
}

// Bones that pieces may reference must exist.
const boneNames = new Set(BONES.map((b) => b.name))
for (const p of PIECES) {
  const refs = p.skin.rigid ? Object.keys(p.skin.rigid) : p.skin.envelope || []
  for (const r of refs) if (!boneNames.has(r)) throw new Error(`${p.name} references unknown bone ${r}`)
}
void noise3
void star
void lerp3
