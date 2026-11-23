// THE MUSKETEER — a long-coated ranged hero with a two-handed musket.
//
// Same 22-bone Knight skeleton and pipeline as the Ember Warden:
// SDF pieces -> Surface Nets -> decimation -> baked AO -> skin -> clips.
// Faces +Z, feet at y = 0, ~1.7 units tall. Wide-brimmed hat with a plume,
// long hair down the back, purple-trimmed team coat, tall leather boots.
//
// The musket is rigid to hand_R. In the bind pose its barrel runs along
// d = norm([0.25, -0.55, 0.8]) from the right fist (stock behind the hand,
// muzzle forward-down across the body). Raising the right arm to aim swings
// the barrel up to level; the attack pose counter-rotates the hand so the
// barrel points straight forward.

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
  skin: hex(0xe8b88a), shirt: hex(0x2a2f45),
  hair: hex(0x3a2418), felt: hex(0x2e2a33),
  purple: hex(0x6b2d8f), purpleDeep: hex(0x4a1e66), plume: hex(0xa02040),
  leather: hex(0x6a4327), leatherDark: hex(0x3f2617), boot: hex(0x4a2c16),
  musketWood: hex(0x5a3a1e), steel: hex(0x929cab), steelDark: hex(0x5d6570),
  gold: hex(0xe3a93f), team: hex(0xf4f4f4),
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

// ---- Body under the coat: dark shirt torso, skin hands/neck, dark legs ----
const torsoUpper = ellipsoid([0, 0.85, 0], [0.26, 0.26, 0.185])
const pelvis = ellipsoid([0, 0.6, 0], [0.18, 0.13, 0.145])
const torso = union(0.08, torsoUpper, pelvis)
{
  const parts = [torso, capsule([0, 1.0, 0], [0, 1.2, 0], 0.06, 0.055)]
  for (const { S, E, W, Hp, K, A } of Object.values(LIMB)) {
    parts.push(sphere(S, 0.085), capsule(S, E, 0.08, 0.07), capsule(E, W, 0.065, 0.055))
    parts.push(capsule(Hp, K, 0.095, 0.075), capsule(K, A, 0.07, 0.06))
  }
  const bodyPaint = (x, y, z) => {
    if (y < 0.58) return shade(C.leatherDark, 0.9 + 0.12 * fbm(x * 50, y * 50, z * 50, 3)) // breeches
    if (y > 1.0) return shade(C.skin, 0.95 + 0.06 * fbm(x * 40, y * 40, z * 40, 3)) // neck
    return shade(C.shirt, 0.9 + 0.1 * fbm(x * 40, y * 40, z * 40, 3))
  }
  piece('undersuit', 'soft', union(0.05, ...parts), bodyPaint,
    { envelope: ['hips', 'spine', 'chest', 'neck', 'upperarm_L', 'forearm_L', 'upperarm_R', 'forearm_R', 'thigh_L', 'shin_L', 'thigh_R', 'shin_R'] })
}

// ---- Face: skin, nose, ears, dark eyes, moustache ----
{
  const face = union(0.02,
    ellipsoid([0, 1.32, 0.02], [0.105, 0.12, 0.1]),
    ellipsoid([0, 1.31, 0.115], [0.018, 0.025, 0.02]),
    sphere([0.105, 1.32, 0], 0.022), sphere([-0.105, 1.32, 0], 0.022))
  piece('face', 'soft', face, grain(C.skin, 0.06, 50), { rigid: { head: 1 } })
  for (const s of [1, -1]) {
    piece(`eye_${s > 0 ? 'L' : 'R'}`, 'soft', ellipsoid([s * 0.042, 1.335, 0.105], [0.017, 0.011, 0.01]), flat(C.hair), { rigid: { head: 1 } }, 0.004)
    // Moustache: two swept capsules under the nose.
    piece(`moustache_${s > 0 ? 'L' : 'R'}`, 'soft',
      capsule([0, 1.282, 0.112], [s * 0.048, 1.288, 0.104], 0.012, 0.008), flat(C.hair), { rigid: { head: 1 } }, 0.004)
  }
}

// ---- Wide-brimmed hat: brim + tall crown + purple band + crimson plume ----
{
  piece('hat_brim', 'soft', union(0.01,
    cylinder([0, 1.4, 0], 0.23, 0.012, 0.008),
    torus([0, 1.4, 0], 0.225, 0.012)), grain(C.felt, 0.12, 70), { rigid: { head: 1 } })
  piece('hat_crown', 'soft', union(0.02,
    cylinder([0, 1.47, 0], 0.115, 0.07, 0.02),
    ellipsoid([0, 1.545, 0], [0.115, 0.055, 0.115])),
    grain(C.felt, 0.12, 70), { rigid: { head: 1 } })
  piece('hat_band', 'soft', torus([0, 1.415, 0], 0.118, 0.016), flat(C.purple), { rigid: { head: 1 } }, 0.004)
  piece('hat_plume', 'soft', bezierTube(
    [0.1, 1.42, 0.02], [0.16, 1.52, 0.06], [0.18, 1.62, 0.12], [0.14, 1.71, 0.1],
    0.02, 0.005, 10, 0.012),
    (x, y, z) => shade(C.plume, 0.9 + 0.15 * fbm(x * 60, y * 60, z * 60, 3)), { rigid: { head: 1 } }, 0.004)
}

// ---- Long hair down the back, three strands (head -> chest by height) ----
{
  const hairSkin = (x, y, z) => { const t = sstep(1.2, 0.95, y); return { head: 1 - t, chest: t } }
  const strands = [
    [[0, 1.38, -0.1], [0.02, 1.2, -0.22], [0.03, 0.95, -0.28], [0.04, 0.72, -0.24], 0.045, 0.02],
    [[-0.05, 1.36, -0.09], [-0.07, 1.18, -0.22], [-0.06, 0.92, -0.27], [-0.04, 0.74, -0.22], 0.038, 0.016],
    [[0.05, 1.36, -0.09], [0.08, 1.2, -0.21], [0.07, 0.96, -0.26], [0.05, 0.76, -0.22], 0.038, 0.016],
  ]
  strands.forEach(([p0, p1, p2, p3, r0, r1], i) => {
    piece(`hair_${i}`, 'soft', bezierTube(p0, p1, p2, p3, r0, r1, 12, 0.015),
      (x, y, z) => shade(mix(C.hair, C.leatherDark, sstep(1.3, 0.75, y)), 0.95 + 0.08 * fbm(x * 60, y * 60, z * 60, 3)),
      { fn: hairSkin }, 0.005)
  })
}

// ---- Long team coat (to the knees) + purple collar, hem, cuffs, buttons ----
const coatSdf = intersect(0.01,
  union(0.04, offset(torsoUpper, 0.035), ellipsoid([0, 0.5, 0], [0.24, 0.2, 0.19])),
  halfspace([0, 0.32, 0], [0, -1, 0]))
piece('coat', 'team', coatSdf, (x, y, z) => {
  const k = 0.93 - 0.08 * fbm(x * 30, y * 60, z * 30, 3) + 0.05 * sstep(0.32, 0.6, y)
  return [k, k, k]
}, { envelope: ['hips', 'spine', 'chest'] })
piece('coat_collar', 'soft', torus([0, 1.06, 0], 0.14, 0.03), flat(C.purple), { rigid: { chest: 1 } })
piece('coat_hem', 'soft', band(coatSdf, 0.004, 0.006, [0, 0.36, 0], [0, 1, 0], 0.02),
  (x, y, z) => shade(C.purple, 0.9 + 0.1 * Math.sin(x * 60)), { envelope: ['hips', 'spine'] })
{
  // Diagonal sash across the chest, wrapping the torso.
  piece('coat_sash', 'team', band(coatSdf, 0.006, 0.008, [0, 0.88, 0.12], [0.75, 0.65, 0], 0.045),
    (x, y, z) => { const k = 0.9 + 0.06 * Math.sin(y * 50); return [k, k, k] }, { envelope: ['spine', 'chest'] })
  const buttons = []
  for (const by of [0.95, 0.85, 0.75, 0.65]) {
    buttons.push(sphere(surfacePoint(coatSdf, [0, by, 1], [0, 0, -1]), 0.016))
  }
  piece('coat_buttons', 'metal', union(0, ...buttons), flat(C.gold), { rigid: { chest: 1 } }, 0.004)
}
for (const [side, { W }] of Object.entries(LIMB)) {
  piece(`coat_cuff_${side}`, 'soft', torus(add(W, [0, 0.02, 0]), 0.072, 0.018), flat(C.purple), { rigid: { [`forearm_${side}`]: 1 } })
}

// ---- Belt + buckle ----
piece('belt', 'soft', band(torso, 0.02, 0.022, [0, 0.645, 0], [0, 1, 0], 0.036),
  (x, y, z) => mix(C.leather, C.leatherDark, sstep(0.025, 0.036, Math.abs(y - 0.645))), { envelope: ['hips', 'spine'] })
{
  const front = surfacePoint(coatSdf, [0, 0.645, 1], [0, 0, -1])
  const c = add(front, [0, 0, 0.04])
  const frame = subtract(0.004, roundBox(c, [0.055, 0.042, 0.016], 0.013), roundBox(c, [0.03, 0.02, 0.04], 0.008))
  piece('buckle', 'metal', union(0.006, frame, capsule(add(c, [-0.028, 0, 0.012]), add(c, [0.012, 0, 0.012]), 0.008)), flat(C.gold), { rigid: { hips: 1 } })
}

// ---- Team epaulettes on the shoulders ----
for (const [side, { s }] of Object.entries(LIMB)) {
  const w = { [`upperarm_${side}`]: 0.5, chest: 0.5 }
  piece(`epaulette_${side}`, 'team', cylinder([s * 0.35, 1.085, 0], 0.09, 0.015, 0.01),
    (x, y, z) => { const k = 0.92; return [k, k, k] }, { rigid: w })
}

// ---- Leather gloves ----
for (const [side, { s, W, F }] of Object.entries(LIMB)) {
  const hdir = norm(sub(F, W))
  const fistC = add(W, scale(hdir, 0.07))
  piece(`glove_${side}`, 'soft', union(0.02, roundBox(fistC, [0.062, 0.075, 0.07], 0.042, frameY(hdir)),
    capsule(add(fistC, [-s * 0.045, 0.02, 0.045]), add(fistC, [-s * 0.03, -0.035, 0.07]), 0.026, 0.022)),
    grain(C.leather, 0.15, 70), { rigid: { [`hand_${side}`]: 1 } })
}

// ---- Tall leather boots with team top trim ----
for (const [side, { s }] of Object.entries(LIMB)) {
  const boot = union(0.03,
    capsule([s * 0.16, 0.36, 0], [s * 0.16, 0.07, 0], 0.08, 0.072),
    roundBox([s * 0.16, 0.06, 0.05], [0.08, 0.06, 0.14], 0.05))
  piece(`boot_${side}`, 'soft', boot, (x, y, z) => shade(C.boot, 0.9 + 0.15 * sstep(0.02, 0.32, y) + 0.08 * fbm(x * 50, y * 50, z * 50, 3)),
    { rigid: { [`shin_${side}`]: 0.6, [`foot_${side}`]: 0.4 } })
  piece(`boot_trim_${side}`, 'team', torus([s * 0.16, 0.35, 0], 0.082, 0.012),
    (x, y, z) => { const k = 0.92; return [k, k, k] }, { rigid: { [`shin_${side}`]: 1 } })
}

// ---- Long musket, held in both hands (rigid to the right hand) --------------
{
  const { W } = LIMB.R
  const g = add(W, [0.02, 0.02, 0.02]) // grip at the right fist
  const d = norm([0.25, -0.55, 0.8]) // barrel direction in the bind pose
  const rigid = { rigid: { hand_R: 1 }, occluder: 'musket' }
  const at = (t) => add(g, scale(d, t))
  // Steel barrel, long and thin, with a gold muzzle ring.
  piece('musket_barrel', 'metal', capsule(at(0.1), at(0.85), 0.016, 0.014),
    (x, y, z) => shade(C.steel, 0.9 + 0.1 * fbm(x * 60, y * 60, z * 60, 3)), rigid, 0.0045)
  piece('musket_muzzle', 'metal', torus(at(0.82), 0.02, 0.008, frameY(d)), flat(C.gold), rigid, 0.004)
  // Wooden stock: tapered body behind the grip + butt plate.
  piece('musket_stock', 'soft', union(0.015,
    capsule(at(-0.28), at(0.14), 0.035, 0.026),
    place(roundBox([0, 0, 0], [0.05, 0.15, 0.035], 0.02), at(-0.3), frameY(d))),
    grain(C.musketWood, 0.15, 70), rigid)
  piece('musket_butt', 'metal', place(roundBox([0, 0, 0], [0.052, 0.03, 0.037], 0.012), at(-0.42), frameY(d)), flat(C.steelDark), rigid, 0.004)
  // Trigger guard: a loop hanging below the stock, ring plane contains the barrel.
  const guardAxis = norm(cross(d, [0, 1, 0]))
  const gx = cross(guardAxis, d)
  piece('musket_guard', 'metal', torus(add(at(0.05), [0, -0.035, 0]), 0.035, 0.006, basis(gx, guardAxis, d)), flat(C.gold), rigid, 0.004)
  // Ramrod running under the barrel.
  piece('musket_ramrod', 'metal', capsule(add(at(0.16), [0, 0.024, 0]), add(at(0.8), [0, 0.024, 0]), 0.006), flat(C.steelDark), rigid, 0.004)
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
