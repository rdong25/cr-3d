// SKELETONS — a cheap, fast, brittle undead footsoldier. One .glb reused for
// all three skeletons in a deploy, so it has to read instantly: big skull under
// a dented skullcap, an open ribcage with a visible spine, knobby long bones,
// and scavenged gear (rusted pauldron, broken plank shield, notched falchion,
// team-colored rags).
//
// Same 22-bone Knight skeleton and pipeline as the Ember Warden
// (tools/hero/design.mjs). Y up, faces +Z, feet at y = 0, ~1.55 units tall.
// LEFT is +X, RIGHT is -X. Falchion in the right hand (rigid to hand_R),
// shield strapped to the left forearm (rigid to forearm_L).

import {
  sphere, ellipsoid, capsule, roundBox, torus, cylinder, halfspace, bezierTube,
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
// Palette + paint helpers
// ---------------------------------------------------------------------------
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
const C = {
  bone: hex(0xcbbb92), boneLight: hex(0xe8dec0), boneStain: hex(0x8c7245), boneDeep: hex(0x3a2a19), dirt: hex(0x574932),
  crack: hex(0x2e2216), socket: hex(0x150e09), tooth: hex(0xd6c692), toothRot: hex(0x7d6535),
  iron: hex(0x47494e), steel: hex(0x767c85), rust: hex(0x553626), rustBright: hex(0x7c4a2a), brass: hex(0xa97f38),
  leather: hex(0x5b3b23), leatherDark: hex(0x35221a), rope: hex(0x8d7a52), wood: hex(0x6b4a2c),
  ember: hex(0xffb04a),
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k]
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const flat = (c) => () => c
const grain = (c, amt = 0.08, freq = 60) => (x, y, z) => shade(c, 1 - amt / 2 + amt * fbm(x * freq, y * freq, z * freq, 3))
const tri = (t) => Math.abs(t - Math.floor(t) - 0.5) * 2

/**
 * Aged bone. Ivory on the high points, brown stain blotches, dark brown in the
 * crevices (found from the piece's own curvature), grave dirt toward the
 * ground, and hairline cracks drawn as contour lines of a noise field.
 */
const bonePaint = (sdf, { dirt = 0.5, cracks = 1, tint = 1 } = {}) => (x, y, z) => {
  const e = 0.005
  const lap = (sdf.d(x + e, y, z) + sdf.d(x - e, y, z) + sdf.d(x, y + e, z) + sdf.d(x, y - e, z) + sdf.d(x, y, z + e) + sdf.d(x, y, z - e) - 6 * sdf.d(x, y, z)) / (e * e)
  const crev = sstep(-4, -55, lap), ridge = sstep(60, 220, lap)
  const blotch = fbm(x * 24 + 5.3, y * 24, z * 24 - 2.1, 3)
  let c = mix(C.bone, C.boneStain, sstep(0.4, 0.68, blotch) * 0.75)
  c = mix(c, C.boneLight, ridge * 0.5)
  c = mix(c, C.boneDeep, crev * 0.92)
  c = mix(c, C.dirt, dirt * sstep(0.42, 0.02, y) * (0.45 + 0.4 * fbm(x * 50, y * 50, z * 50, 2)))
  if (cracks > 0) {
    const where = sstep(0.44, 0.56, fbm(x * 9 - 4, y * 9 + 2, z * 9, 2)) // only some regions are cracked
    const line = 1 - sstep(0.016, 0.05, Math.abs(fbm(x * 19 + 9, y * 19 - 3, z * 19, 2) - 0.5))
    c = mix(c, C.crack, Math.min(1, line * where * 0.9 * cracks))
  }
  return shade(c, tint * (0.93 + 0.1 * fbm(x * 110, y * 110, z * 110, 2)))
}
/** Rusted iron: dark plate, brown-orange rust blooms, pitting. */
const rusted = (base = C.iron, amt = 1, k = 1, cover = 0) => (x, y, z) => {
  const n = fbm(x * 17 + 7, y * 17, z * 17 - 3, 4) - cover
  let c = mix(base, C.rust, sstep(0.44, 0.6, n) * amt)
  c = mix(c, C.rustBright, sstep(0.64, 0.8, n) * amt * 0.6)
  return shade(c, k * (0.8 + 0.16 * fbm(x * 45, y * 45, z * 45, 2) + 0.1 * noise3(x * 130, y * 130, z * 130)))
}
const leatherPaint = (c = C.leather) => (x, y, z) => shade(c, 0.78 + 0.3 * fbm(x * 70, y * 70, z * 70, 3))
/** Team cloth, painted in greys: weave noise, dirt toward `dirtY`, dark frayed hem. */
const cloth = (hemFn, dirtLo = 0, dirtHi = 0) => (x, y, z) => {
  let k = 0.9 - 0.14 * fbm(x * 34, y * 80, z * 34, 3) - 0.05 * (0.5 + 0.5 * Math.sin(x * 160))
  if (dirtHi > dirtLo) k *= 0.62 + 0.38 * sstep(dirtLo, dirtHi, y)
  if (hemFn && hemFn(x, y, z) < 0.018) k *= 0.5
  return [k, k, k]
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
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const lerp3 = (a, b, t) => add(a, scale(sub(b, a), t))
/** Tube through a polyline, radius tapering r0 -> r1. */
function tube(pts, r0, r1 = r0, k = 0.004) {
  const caps = []
  for (let i = 0; i < pts.length - 1; i++) {
    const ta = i / (pts.length - 1), tb = (i + 1) / (pts.length - 1)
    caps.push(capsule(pts[i], pts[i + 1], r0 + (r1 - r0) * ta, r0 + (r1 - r0) * tb))
  }
  return union(k, ...caps)
}
/** Two or three leather thongs wound round a limb: the lashings that hold the bones together. */
function lashing(c, dir, ringR, turns = 2, tubeR = 0.0085) {
  const rings = []
  for (let i = 0; i < turns; i++) {
    const o = (i - (turns - 1) / 2) * tubeR * 1.9
    rings.push(torus(add(c, scale(dir, o)), ringR + (i % 2) * 0.0015, tubeR, frameY(add(dir, [0.06 * (i % 2 ? 1 : -1), 0, 0.05 * (i % 2 ? -1 : 1)]))))
  }
  return union(0.003, ...rings)
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------
export const PIECES = []
// `more` may carry { err, colorWeight }: per-piece decimation overrides (see build.mjs).
const piece = (name, material, sdf, paint, skin, res, more) => PIECES.push({ name, material, sdf, paint, skin, res, ...more })
const bone = (name, sdf, skin, res = 0.0045, opts, more) => piece(name, 'soft', sdf, bonePaint(sdf, opts), skin, res, more)

// ===========================================================================
// SKULL — cranium, brow, deep sockets, nasal cavity, cheekbones, teeth, jaw.
// Sculpted at 1:1 around HC, then enlarged and thrust forward on the neck (an
// oversized head is what reads from the gameplay camera).
// ===========================================================================
const HC = [0, 1.39, -0.02] // cranium center
const CR = [0.135, 0.125, 0.155] // cranium radii
const HS = 1.15, HO = [0, 1.215, 0], HT = [0, -0.01, 0.03]
const headInv = (x, y, z) => [(x - HT[0] - HO[0]) / HS + HO[0], (y - HT[1] - HO[1]) / HS + HO[1], (z - HT[2] - HO[2]) / HS + HO[2]]
const headFwd = (p) => [(p[0] - HO[0]) * HS + HO[0] + HT[0], (p[1] - HO[1]) * HS + HO[1] + HT[1], (p[2] - HO[2]) * HS + HO[2] + HT[2]]
const headNode = (n) => node((x, y, z) => { const q = headInv(x, y, z); return HS * n.d(q[0], q[1], q[2]) }, headFwd(n.min), headFwd(n.max))
const hpiece = (name, material, sdf, paint, res, more) =>
  piece(name, material, headNode(sdf), (x, y, z) => { const q = headInv(x, y, z); return paint(q[0], q[1], q[2]) }, { rigid: { head: 1 } }, res, more)
{
  const cranium = ellipsoid(HC, CR)
  const forehead = ellipsoid([0, 1.378, 0.058], [0.104, 0.086, 0.082])
  const face = roundBox([0, 1.316, 0.086], [0.066, 0.058, 0.05], 0.03)
  const maxilla = ellipsoid([0, 1.272, 0.1], [0.056, 0.03, 0.045])
  let skull = union(0.024, cranium, forehead, face, maxilla)
  const extras = []
  for (const s of [1, -1]) {
    // Heavy, scowling brow ridge; cheekbone and the arch running back to the ear.
    extras.push(capsule([s * 0.102, 1.41, 0.094], [s * 0.02, 1.379, 0.14], 0.019, 0.022))
    extras.push(ellipsoid([s * 0.09, 1.32, 0.092], [0.036, 0.022, 0.04], euler(0, 0, s * 0.25)))
    extras.push(capsule([s * 0.106, 1.324, 0.07], [s * 0.128, 1.332, -0.025], 0.014, 0.012))
    extras.push(sphere([s * 0.118, 1.3, -0.05], 0.026)) // mastoid lump behind the jaw hinge
  }
  skull = union(0.01, skull, ...extras)
  const SOCK = [1, -1].map((s) => ({ c: [s * 0.052, 1.35, 0.134], r: [0.04, 0.035, 0.056], R: euler(0, 0, -s * 0.32) }))
  for (const k of SOCK) skull = subtract(0.008, skull, ellipsoid(k.c, k.r, k.R))
  // Nasal cavity: one inverted heart.
  const nasal = union(0.006, capsule([0, 1.334, 0.14], [0.014, 1.297, 0.136], 0.009, 0.0165), capsule([0, 1.334, 0.14], [-0.014, 1.297, 0.136], 0.009, 0.0165))
  skull = subtract(0.004, skull, nasal)
  for (const s of [1, -1]) {
    skull = subtract(0.022, skull, sphere([s * 0.168, 1.352, 0.05], 0.056)) // temple pinch behind the brow
    skull = subtract(0.012, skull, sphere([s * 0.08, 1.266, 0.064], 0.033)) // hollow under the cheekbone
  }
  skull = subtract(0.01, skull, sphere([0, 1.235, -0.02], 0.045)) // foramen: where the spine enters
  const base = bonePaint(skull, { dirt: 0, cracks: 1.4 })
  const sockets = SOCK.map((k) => ellipsoid(k.c, k.r, k.R))
  hpiece('skull', 'soft', skull, (x, y, z) => {
    const c = base(x, y, z)
    let dark = 0
    for (const sk of sockets) dark = Math.max(dark, sstep(0.014, -0.004, sk.d(x, y, z)))
    dark = Math.max(dark, sstep(0.01, -0.002, nasal.d(x, y, z)))
    return mix(c, C.socket, dark * 0.95)
  }, 0.004)

  // Small ember eyes sunk deep in the sockets.
  hpiece('eyes', 'glow', union(0, sphere([0.05, 1.35, 0.097], 0.0105), sphere([-0.05, 1.35, 0.097], 0.0105)), flat(C.ember), 0.0026)

  // Jaw: separate bone, hanging a little open.
  const jawParts = [roundBox([0, 1.192, 0.094], [0.038, 0.022, 0.02], 0.016)]
  for (const s of [1, -1]) {
    jawParts.push(capsule([s * 0.032, 1.196, 0.092], [s * 0.09, 1.208, 0.002], 0.017, 0.0155))
    jawParts.push(capsule([s * 0.09, 1.208, 0.002], [s * 0.112, 1.298, -0.014], 0.0165, 0.013))
    jawParts.push(sphere([s * 0.093, 1.202, -0.003], 0.0185))
  }
  const jaw = union(0.01, ...jawParts)
  hpiece('jaw', 'soft', jaw, bonePaint(jaw, { dirt: 0, cracks: 0.6 }), 0.004)

  // Teeth: an uneven, gappy row top and bottom.
  const teeth = []
  const upper = [-3.5, -2.5, -1.5, -0.5, 0.5, 2.5, 3.5], lower = [-3, -2, -1, 1, 2, 3]
  for (const i of upper) {
    const a = i * 0.25, long = 1 - 0.07 * Math.abs(i) + (Math.abs(i) === 1.5 ? 0.25 : 0) // long canines
    teeth.push(roundBox([0.053 * Math.sin(a), 1.2545 - 0.012 * long, 0.1 + 0.042 * Math.cos(a)], [0.0068, 0.012 * long, 0.006], 0.004, euler(0, a, 0)))
  }
  for (const i of lower) {
    const a = i * 0.26
    teeth.push(roundBox([0.045 * Math.sin(a), 1.2175, 0.072 + 0.044 * Math.cos(a)], [0.0064, 0.011, 0.0058], 0.0038, euler(0, a, 0)))
  }
  hpiece('teeth', 'soft', union(0, ...teeth), (x, y, z) => {
    const rot = sstep(0.5, 0.72, fbm(x * 60 + 3, y * 30, z * 60, 2))
    return shade(mix(C.tooth, C.toothRot, rot * 0.7 + 0.3 * sstep(0.014, 0.0, Math.abs(y - 1.234))), 0.92 + 0.1 * fbm(x * 140, y * 140, z * 140, 2))
  }, 0.0026)
}

// ===========================================================================
// HELMET — dented, rusted skullcap with a rolled rim, a snapped nasal bar and
// half a crest. Built around the cranium, then knocked askew.
// ===========================================================================
{
  const TILT = euler(0.05, 0, 0.1)
  const local = (sdf) => place(sdf, HC, TILT)
  const cr = ellipsoid([0, 0, 0], CR)
  const capFull = offset(cr, 0.016)
  let cap = intersect(0.006, capFull, halfspace([0, 0.004, 0], [0, -1, 0.1]))
  // Dents: big shallow spheres pressed 8 mm into the dome.
  for (const dir of [[0.6, 0.6, 0.5], [-0.75, 0.45, -0.3], [0.1, 0.85, -0.5]]) {
    const dn = norm(dir)
    const p = surfacePoint(capFull, scale(dn, 0.5), scale(dn, -1))
    cap = subtract(0.012, cap, sphere(add(p, scale(dn, 0.045 - 0.008)), 0.045))
  }
  // A sword gash through the plate over the left brow.
  const gp = surfacePoint(capFull, [0.35, 0.3, 0.4], [-0.35, -0.22, -0.4])
  cap = subtract(0.002, cap, roundBox(gp, [0.0045, 0.04, 0.03], 0.002, euler(0.3, 0.7, 0.5)))
  // Nasal bar, snapped off short.
  let nasalBar = roundBox([0, -0.014, 0.176], [0.0125, 0.034, 0.0065], 0.004, euler(0.1, 0, 0))
  nasalBar = subtract(0.003, nasalBar, sphere([0.014, -0.052, 0.178], 0.016))
  // Crest fin along the top; the front half has been broken away.
  let crest = intersect(0.003, offset(cr, 0.052), roundBox([0, 0.12, -0.03], [0.0085, 0.14, 0.2], 0.004))
  crest = intersect(0.003, crest, halfspace([0, 0.1, 0.04], [0, 0.35, 1]))
  crest = subtract(0.003, crest, sphere([0, 0.186, 0.03], 0.024))
  crest = subtract(0.003, crest, sphere([0, 0.166, -0.08], 0.02))
  crest = intersect(0.003, crest, halfspace([0, 0.02, -0.14], [0, -0.8, -1]))
  const helm = union(0.008, cap, nasalBar, crest)
  const hp = rusted(hex(0x565a61), 0.85, 1, 0.05)
  hpiece('helmet', 'metal', local(helm), (x, y, z) => shade(hp(x, y, z), 0.9 + 0.22 * sstep(1.38, 1.56, y)), 0.0045, { err: 0.003 })
  const rim = band(cr, 0.017, 0.009, [0, 0.009, 0], [0, -1, 0.1], 0.011)
  const rivets = []
  for (const a of [-2.5, -1.8, -1.1, -0.45, 0.45, 1.1, 1.8, 2.5]) {
    const dir = [Math.sin(a), 0, Math.cos(a)]
    rivets.push(sphere(surfacePoint(capFull, add([0, 0.036 + 0.1 * 0.15 * dir[2], 0], scale(dir, 0.5)), scale(dir, -1)), 0.0105))
  }
  hpiece('helmet_rim', 'metal', local(union(0.002, rim, ...rivets)), rusted(C.steel, 0.7, 0.95), 0.0045, { err: 0.003 })
}

// ===========================================================================
// SPINE — one piece per vertebra (body disc + spinous + transverse processes),
// so each stays rigid while the column bends between hips, spine and chest.
// ===========================================================================
const CZ = 0.025 // ribcage center line (z)
// Ribcage hull, an egg: [y, half-width, half-depth].
const HULL = [[0.74, 0.165, 0.112], [0.8, 0.195, 0.13], [0.87, 0.202, 0.136], [0.94, 0.182, 0.126], [1.0, 0.145, 0.105], [1.04, 0.105, 0.082], [1.07, 0.06, 0.05]]
function hullAB(y) {
  const T = HULL, n = T.length
  if (y <= T[0][0]) return [T[0][1], T[0][2]]
  if (y >= T[n - 1][0]) return [T[n - 1][1], T[n - 1][2]]
  let i = 0
  while (y > T[i + 1][0]) i++
  const t = (y - T[i][0]) / (T[i + 1][0] - T[i][0])
  return [T[i][1] + (T[i + 1][1] - T[i][1]) * t, T[i][2] + (T[i + 1][2] - T[i][2]) * t]
}
/** Point on the hull at angle phi (0 = front, PI = back) for the given side. */
const hullPt = (s, phi, y, lift = 0) => { const [a, b] = hullAB(y); return [s * (a + lift) * Math.sin(phi), y, CZ + (b + lift) * Math.cos(phi)] }
/** Point on the hull's front face at a given x. */
const hullFront = (x, y, lift = 0) => { const [a, b] = hullAB(y); return [x, y, CZ + (b + lift) * Math.sqrt(Math.max(0, 1 - (x / (a + lift)) ** 2))] }
const ribHull = node((x, y, z) => {
  const [a, b] = hullAB(y)
  const qx = x / a, qz = (z - CZ) / b
  const k0 = Math.hypot(qx, qz), k1 = Math.hypot(qx / a, qz / b)
  return k1 === 0 ? -Math.min(a, b) : (k0 * (k0 - 1)) / k1
}, [-0.26, 0.6, -0.18], [0.26, 1.12, 0.22])

{
  const blend = (knots, y) => {
    if (y <= knots[0][1]) return { [knots[0][0]]: 1 }
    for (let i = 0; i < knots.length - 1; i++) {
      const [a, ya] = knots[i], [b, yb] = knots[i + 1]
      if (y <= yb) { const t = (y - ya) / (yb - ya); return t < 0.02 ? { [a]: 1 } : t > 0.98 ? { [b]: 1 } : { [a]: 1 - t, [b]: t } }
    }
    return { [knots[knots.length - 1][0]]: 1 }
  }
  const KNOTS = [['hips', 0.64], ['spine', 0.72], ['chest', 0.8], ['chest', 1.04], ['neck', 1.1], ['head', 1.19]]
  // [y, z, body radius, half height, spinous length]
  const V = []
  for (const [y, z] of [[0.636, -0.07], [0.678, -0.056], [0.72, -0.054], [0.762, -0.064]]) V.push([y, z, 0.037, 0.016, 0.03])
  for (const y of [0.802, 0.84, 0.878, 0.916, 0.954, 0.992, 1.03]) V.push([y, CZ - hullAB(y)[1] + 0.03 - 0.005, 0.03, 0.0145, 0.034])
  for (const [y, z] of [[1.066, -0.03], [1.102, -0.016], [1.138, -0.005], [1.174, 0.003], [1.21, 0.007], [1.244, 0.008]]) V.push([y, z, 0.0255, 0.0125, 0.02])
  V.forEach(([y, z, r, h, sp], i) => {
    const body = cylinder([0, y, z], r, h, h * 0.55)
    const parts = [body, capsule([0, y - 0.002, z - r * 0.8], [0, y - 0.012, z - r - sp], 0.012, 0.007)]
    for (const s of [1, -1]) parts.push(capsule([s * r * 0.7, y, z - r * 0.55], [s * (r + 0.022), y + 0.004, z - r * 0.95], 0.011, 0.0075))
    bone(`vertebra_${String(i).padStart(2, '0')}`, union(0.007, ...parts), { rigid: blend(KNOTS, y) }, 0.004, { dirt: 0, cracks: 0 }, { err: 0.0034 })
  })
}

// ===========================================================================
// RIBCAGE — seven curved ribs a side sweeping from the spine down and round to
// the sternum, costal arch open at the front, one floating rib.
// ===========================================================================
{
  const RIBS = [
    { yb: 1.034, drop: 0.022 },
    { yb: 0.996, drop: 0.034 },
    { yb: 0.958, drop: 0.046 },
    { yb: 0.92, drop: 0.056 },
    { yb: 0.882, drop: 0.066, phi1: 0.62, tail: [[0.062, 0.836], [0.02, 0.862]] },
    { yb: 0.844, drop: 0.072, phi1: 0.9, tail: [[0.1, 0.792], [0.07, 0.829]] },
    { yb: 0.806, drop: 0.05, phi1: 1.4 },
  ]
  const PHI0 = Math.PI - 0.22
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    const ribs = RIBS.map(({ yb, drop, phi1, tail }, ri) => {
      const yf = yb - drop
      const end = phi1 ?? Math.asin(0.02 / hullAB(yf)[0])
      const pts = []
      const N = 12
      for (let i = 0; i <= N; i++) {
        const u = i / N
        pts.push(hullPt(s, PHI0 + (end - PHI0) * u, yb + 0.006 * Math.sin(Math.PI * Math.min(1, u * 3)) - drop * Math.pow(u, 1.3)))
      }
      for (const [x, y] of tail || []) pts.push(hullFront(s * x, y))
      // The right side took a blow once: one rib is snapped short.
      if (side === 'R' && ri === 5) pts.length = 8
      return tube(pts, 0.0155, tail ? 0.012 : 0.0135, 0.004)
    })
    bone(`ribs_${side}`, union(0, ...ribs), { rigid: { chest: 1 } }, 0.004, { dirt: 0, cracks: 0.5 }, { colorWeight: 0.45 })
  }
  // Sternum: a strip of the hull's front face, wider at the top (manubrium).
  const shell = node((x, y, z) => Math.abs(ribHull.d(x, y, z) - 0.003) - 0.012, [-0.1, 0.8, 0.05], [0.1, 1.08, 0.22])
  const profile = node((x, y, z) => Math.max(Math.abs(x) - (0.021 + 0.016 * sstep(0.985, 1.02, y) - 0.008 * sstep(0.89, 0.85, y)), y - 1.042, 0.845 - y, -z), [-0.06, 0.84, 0.05], [0.06, 1.05, 0.22])
  bone('sternum', intersect(0.006, shell, profile), { rigid: { chest: 1 } }, 0.004, { dirt: 0, cracks: 0.8 })

  // Clavicles: S-curved struts from the sternum out to the shoulder tips.
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    const clav = bezierTube([s * 0.022, 1.032, 0.1], [s * 0.1, 1.05, 0.125], [s * 0.2, 1.065, 0.0], [s * 0.292, 1.058, -0.012], 0.0155, 0.0145, 10, 0.006)
    bone(`clavicle_${side}`, union(0.008, clav, sphere([s * 0.292, 1.058, -0.012], 0.02), sphere([s * 0.024, 1.032, 0.1], 0.019)), { rigid: { chest: 1 } }, 0.004, { dirt: 0, cracks: 0 })
    // Scapula: a triangular plate lying on the back of the ribcage, with its spine ridge.
    const plate = node((x, y, z) => Math.abs(ribHull.d(x, y, z) - 0.02) - 0.0065, [-0.3, 0.8, -0.2], [0.3, 1.1, 0.05])
    const P0 = [s * 0.135, 0.862, 0]
    let blade = intersect(0.008, plate, halfspace(P0, [s * 0.85, -0.5, 0]))
    blade = intersect(0.008, blade, halfspace(P0, [-s * 0.95, -0.3, 0]))
    blade = intersect(0.008, blade, halfspace([0, 1.04, 0], [0, 1, 0]))
    blade = intersect(0.004, blade, halfspace([0, 0, 0.0], [0, 0, 1]))
    const ridge = bezierTube([s * 0.1, 0.99, -0.085], [s * 0.17, 1.01, -0.09], [s * 0.25, 1.04, -0.07], [s * 0.3, 1.056, -0.025], 0.012, 0.015, 8, 0.006)
    bone(`scapula_${side}`, union(0.01, blade, ridge), { rigid: { chest: 1 } }, 0.004, { dirt: 0, cracks: 0.7 })
  }

  // The ember that keeps it walking, caged behind the sternum.
  piece('soul_ember', 'glow', union(0.012, ellipsoid([0, 0.905, 0.045], [0.03, 0.036, 0.03]), capsule([0, 0.93, 0.045], [0.006, 0.972, 0.04], 0.016, 0.004)),
    (x, y, z) => mix(C.ember, [1, 0.93, 0.7], sstep(0.89, 0.93, y) * 0.6), { rigid: { chest: 1 } }, 0.004)
}

// ===========================================================================
// PELVIS — flared iliac wings (a cut shell), sacrum + tailbone, pubic ring
// ===========================================================================
const PH = ellipsoid([0, 0.585, -0.01], [0.172, 0.125, 0.118])
{
  const shell = node((x, y, z) => Math.abs(PH.d(x, y, z)) - 0.0115, PH.min.map((v) => v - 0.02), PH.max.map((v) => v + 0.02))
  let wings = intersect(0.008, shell, halfspace([0, 0.662, 0], [0, 1, 0.25]))
  wings = intersect(0.008, wings, halfspace([0, 0.548, 0], [0, -1, 0]))
  wings = subtract(0.016, wings, roundBox([0, 0.65, 0.14], [0.092, 0.11, 0.1], 0.03))
  wings = subtract(0.02, wings, sphere([0, 0.715, -0.12], 0.06))
  const parts = [wings,
    roundBox([0, 0.6, -0.112], [0.05, 0.052, 0.018], 0.014, euler(0.22, 0, 0)),
    capsule([0, 0.555, -0.122], [0, 0.5, -0.1], 0.016, 0.007),
    sphere([0, 0.51, 0.094], 0.021)]
  for (const s of [1, -1]) {
    parts.push(subtract(0.005, sphere([s * 0.132, 0.555, 0], 0.046), sphere([s * 0.162, 0.552, 0], 0.035))) // hip socket
    parts.push(capsule([s * 0.122, 0.55, 0.03], [s * 0.016, 0.512, 0.094], 0.018, 0.015))
    parts.push(capsule([s * 0.122, 0.54, -0.02], [s * 0.072, 0.478, -0.03], 0.021, 0.018))
    parts.push(capsule([s * 0.072, 0.478, -0.03], [s * 0.016, 0.503, 0.088], 0.014, 0.013))
  }
  bone('pelvis', union(0.014, ...parts), { rigid: { hips: 1 } }, 0.0045, { dirt: 0.2, cracks: 1 }, { err: 0.003 })
}

// ===========================================================================
// ARMS — humerus with ball head and flared elbow, radius + ulna, carpal knot
// ===========================================================================
for (const [side, { s, S, E, W }] of Object.entries(LIMB)) {
  const up = norm(sub(E, S))
  const humerus = union(0.014,
    sphere(add(S, [-s * 0.012, 0.002, 0]), 0.044),
    sphere(add(S, [s * 0.022, -0.012, 0.004]), 0.028), // greater tubercle
    capsule(add(S, scale(up, 0.02)), sub(E, scale(up, 0.03)), 0.031, 0.025),
    sphere(add(E, [s * 0.029, 0.01, 0]), 0.029), sphere(add(E, [-s * 0.027, 0.008, 0]), 0.03))
  bone(`humerus_${side}`, humerus, { rigid: { [`upperarm_${side}`]: 1 } }, 0.0045, { dirt: 0, cracks: 1 })
  const dir = norm(sub(W, E))
  const sx = norm(sub([1, 0, 0], scale(dir, dir[0]))) // across the forearm
  const ulna = union(0.008,
    sphere(add(E, [0, 0.014, -0.032]), 0.024), // olecranon: the point of the elbow
    capsule(add(add(E, scale(dir, 0.004)), scale(sx, -s * 0.014)), add(sub(W, scale(dir, 0.02)), scale(sx, -s * 0.018)), 0.0215, 0.014),
    sphere(add(sub(W, scale(dir, 0.02)), scale(sx, -s * 0.018)), 0.017))
  const radius = union(0.008,
    sphere(add(add(E, scale(dir, 0.028)), scale(sx, s * 0.018)), 0.018),
    capsule(add(add(E, scale(dir, 0.028)), scale(sx, s * 0.018)), add(sub(W, scale(dir, 0.022)), scale(sx, s * 0.015)), 0.0145, 0.02),
    sphere(add(sub(W, scale(dir, 0.02)), scale(sx, s * 0.014)), 0.02))
  bone(`forearm_${side}`, union(0.004, ulna, radius), { rigid: { [`forearm_${side}`]: 1 } }, 0.004, { dirt: 0.15, cracks: 0.7 })
  bone(`carpals_${side}`, ellipsoid(add(W, scale(dir, 0.004)), [0.033, 0.019, 0.024], frameY(dir)), { rigid: { [`forearm_${side}`]: 0.5, [`hand_${side}`]: 0.5 } }, 0.004, { dirt: 0.2, cracks: 0 })
  // Lashings holding the elbow together.
  piece(`elbow_lash_${side}`, 'soft', lashing(sub(E, scale(up, 0.052)), up, 0.033, 3), leatherPaint(), { rigid: { [`upperarm_${side}`]: 1 } }, 0.004)
}

// ---- Left hand: open claw, fingers hooked inward ----
{
  const { s, W, F } = LIMB.L
  const hdir = norm(sub(F, W))
  const parts = []
  for (let j = 0; j < 4; j++) {
    const zj = (j - 1.5) * 0.022 + 0.006
    const base = add(add(W, scale(hdir, 0.018)), [0, 0, zj * 0.45])
    const kn = add(add(W, scale(hdir, 0.072 - 0.006 * Math.abs(j - 1.5))), [0, 0, zj])
    const p1 = add(add(kn, scale(hdir, 0.044)), [-s * 0.014, 0, zj * 0.3])
    const p2 = add(add(p1, scale(hdir, 0.028)), [-s * 0.027, 0, zj * 0.1])
    const p3 = add(add(p2, scale(hdir, 0.012)), [-s * 0.022, 0, 0])
    parts.push(capsule(base, kn, 0.0095, 0.0105), sphere(kn, 0.0135), capsule(kn, p1, 0.0105, 0.0095), sphere(p1, 0.0112),
      capsule(p1, p2, 0.0093, 0.0082), capsule(p2, p3, 0.008, 0.0045))
  }
  const t0 = add(add(W, scale(hdir, 0.02)), [-s * 0.006, 0, 0.03])
  const t1 = add(add(W, scale(hdir, 0.05)), [-s * 0.016, 0, 0.062])
  const t2 = add(add(t1, scale(hdir, 0.032)), [-s * 0.02, 0, 0.012])
  parts.push(capsule(t0, t1, 0.011, 0.0105), sphere(t1, 0.0125), capsule(t1, t2, 0.0098, 0.005))
  bone('hand_L', union(0.004, ...parts), { rigid: { hand_L: 1 } }, 0.003, { dirt: 0.3, cracks: 0 })
}

// ===========================================================================
// LEGS — femur (ball, neck, trochanter, twin condyles), kneecap, tibia +
// fibula with ankle knobs, and a foot of tarsals, metatarsals and toe bones
// ===========================================================================
for (const [side, { s, K, A }] of Object.entries(LIMB)) {
  const femur = union(0.014,
    sphere([s * 0.158, 0.552, 0], 0.031),
    capsule([s * 0.158, 0.552, 0], [s * 0.2, 0.532, -0.003], 0.021, 0.022),
    sphere([s * 0.212, 0.538, -0.006], 0.034),
    capsule([s * 0.2, 0.515, 0], add(K, [s * 0.003, 0.03, 0]), 0.034, 0.028),
    sphere(add(K, [s * 0.03, 0.006, -0.004]), 0.037), sphere(add(K, [-s * 0.029, 0.006, -0.004]), 0.038))
  bone(`femur_${side}`, femur, { rigid: { [`thigh_${side}`]: 1 } }, 0.0045, { dirt: 0.2, cracks: 1 })
  bone(`patella_${side}`, ellipsoid(add(K, [0, 0.004, 0.047]), [0.025, 0.029, 0.016]), { rigid: { [`thigh_${side}`]: 0.4, [`shin_${side}`]: 0.6 } }, 0.004, { dirt: 0.3, cracks: 0 })
  const tibia = union(0.012,
    ellipsoid(add(K, [0, -0.034, -0.002]), [0.058, 0.021, 0.045]),
    capsule(add(K, [-s * 0.004, -0.04, 0.004]), add(A, [-s * 0.002, 0.03, 0]), 0.033, 0.023),
    sphere(add(A, [0, 0.014, 0]), 0.026),
    sphere(add(A, [-s * 0.027, -0.002, 0.002]), 0.019))
  const fibula = union(0.006,
    sphere(add(K, [s * 0.046, -0.05, -0.016]), 0.019),
    capsule(add(K, [s * 0.046, -0.05, -0.016]), add(A, [s * 0.034, 0.012, -0.008]), 0.013, 0.013),
    sphere(add(A, [s * 0.031, -0.004, -0.006]), 0.018))
  bone(`shin_${side}`, union(0.004, tibia, fibula), { rigid: { [`shin_${side}`]: 1 } }, 0.0045, { dirt: 0.6, cracks: 1 })
  piece(`knee_lash_${side}`, 'soft', lashing(add(K, [0, -0.088, 0.002]), [0, 1, 0], 0.041, 2), leatherPaint(), { rigid: { [`shin_${side}`]: 1 } }, 0.004)

  const fx = s * 0.16
  const parts = [
    sphere([fx, 0.084, 0.006], 0.03), // talus
    ellipsoid([fx + s * 0.002, 0.042, -0.04], [0.03, 0.037, 0.05]), // heel
    ellipsoid([fx, 0.057, 0.052], [0.046, 0.03, 0.042]), // tarsals
  ]
  for (let j = 0; j < 4; j++) {
    const o = (j - 1.5) * s // +1.5 = outer toe
    const big = o * s < -1 ? 1.25 : 1
    const m0 = [fx + o * 0.022, 0.055, 0.075], m1 = [fx + o * 0.03, 0.024, 0.148 - 0.006 * Math.abs(j - 1)]
    const t1 = [fx + o * 0.034, 0.017, m1[2] + 0.036], t2 = [fx + o * 0.036, 0.012, m1[2] + 0.058]
    parts.push(capsule(m0, m1, 0.013 * big, 0.011 * big), sphere(m1, 0.0145 * big), capsule(m1, t1, 0.0105 * big, 0.009 * big), sphere(t1, 0.0105 * big), capsule(t1, t2, 0.0085 * big, 0.0055 * big))
  }
  const foot = intersect(0.004, union(0.007, ...parts), halfspace([0, 0.003, 0], [0, -1, 0]))
  bone(`foot_${side}`, foot, { rigid: { [`foot_${side}`]: 1 } }, 0.0035, { dirt: 1, cracks: 0 })
}

// ===========================================================================
// CLOTH — team-colored rags: neck scarf with torn tails, loincloth on a belt
// ===========================================================================
{
  // Scarf: a rolled rag round the neck, lower at the front.
  const ringPts = []
  const NR = 18
  for (let i = 0; i <= NR; i++) {
    const a = (i / NR) * Math.PI * 2
    ringPts.push([0.1 * Math.sin(a), 1.072 - 0.024 * Math.cos(a) + 0.005 * Math.sin(a * 3 + 1), -0.018 + 0.088 * Math.cos(a)])
  }
  const roll = union(0.012, ...ringPts.slice(0, -1).map((p, i) => capsule(p, ringPts[i + 1], 0.027 + 0.005 * Math.sin(i * 2.1), 0.027 + 0.005 * Math.sin((i + 1) * 2.1))))
  const knot = ellipsoid([0.066, 1.044, 0.062], [0.034, 0.03, 0.03], euler(0, 0, 0.5))
  const scarfPaint = (x, y, z) => {
    const a = Math.atan2(x, z + 0.018)
    const k = 0.84 + 0.1 * Math.sin(a * 22 + y * 120) - 0.12 * fbm(x * 40, y * 40, z * 40, 3)
    return [k, k, k]
  }
  piece('scarf', 'team', union(0.01, roll, knot), scarfPaint, { rigid: { chest: 0.85, neck: 0.15 } }, 0.005, { err: 0.003, colorWeight: 0.4 })

  // Front tail: a torn strip lying over the left ribs.
  const TF = 1.04
  const fHem = (x, y) => y - (0.855 + 0.03 * tri(x * 26 + 0.2) + 0.5 * Math.max(0, 0.075 - x))
  const frontTail = node((x, y, z) => {
    const xc = 0.07 + 0.05 * (TF - y), hw = 0.036 + 0.02 * (TF - y)
    return Math.max(Math.abs(ribHull.d(x, y, z) - 0.023 - 0.004 * Math.sin(x * 90)) - 0.0048, Math.abs(x - xc) - hw, -fHem(x, y), y - TF, -z)
  }, [0.0, 0.82, 0.05], [0.18, 1.06, 0.22])
  piece('scarf_tail_F', 'team', frontTail, cloth((x, y) => fHem(x, y), 0.84, 0.98), { rigid: { chest: 1 } }, 0.004)

  // Back tail: a longer rag down the spine, hem shredded.
  const TB = 1.065
  const bHem = (x, y) => y - (0.67 + 0.045 * tri(x * 17 + 0.35) + 0.06 * sstep(-0.01, -0.075, x))
  const backTail = node((x, y, z) => {
    const u = TB - y
    const hw = 0.045 + 0.05 * Math.min(1, u * 4) - 0.02 * u
    const slit = 0.014 * (0.86 - y) / 0.16 - Math.abs(x + 0.01) // V-shaped tear up from the hem
    return Math.max(Math.abs(ribHull.d(x, y, z) - 0.045 - 0.006 * Math.sin(x * 60 + 1)) - 0.005, Math.abs(x + 0.03) - hw, -bHem(x, y), y - TB, z + 0.02, y < 0.86 ? slit : -1)
  }, [-0.14, 0.62, -0.22], [0.14, 1.08, 0.0])
  const capeBones = (x, y) => {
    const knots = [['chest', 1.08], ['cape_1', 1.0], ['cape_2', 0.74], ['cape_3', 0.47]]
    if (y >= knots[0][1]) return { chest: 1 }
    for (let i = 0; i < knots.length - 1; i++) {
      const [a, ya] = knots[i], [b, yb] = knots[i + 1]
      if (y <= ya && y >= yb) { const t = (ya - y) / (ya - yb); return { [a]: 1 - t, [b]: t } }
    }
    return { cape_3: 1 }
  }
  piece('scarf_tail_B', 'team', backTail, cloth((x, y) => bHem(x, y), 0.66, 0.9), { fn: capeBones }, 0.004)

  // Belt on the hip bones, with a rusted ring buckle.
  piece('belt', 'soft', band(PH, 0.0175, 0.011, [0, 0.636, 0], [0, 1, 0.12], 0.017),
    (x, y, z) => mix(C.leather, C.leatherDark, 0.5 * sstep(0.008, 0.016, Math.abs(y + 0.12 * z - 0.636)) + 0.5 * fbm(x * 60, y * 60, z * 60, 3)), { rigid: { hips: 1 } }, 0.0045)
  const bk = surfacePoint(PH, [0.055, 0.63, 1], [0, 0, -1])
  piece('belt_buckle', 'metal', torus(add(bk, [0, 0, 0.034]), 0.023, 0.0075, euler(Math.PI / 2, 0, 0)), rusted(C.brass, 0.6), { rigid: { hips: 1 } }, 0.004)

  // Loincloth front, hinged on tabard_F so it swings between the legs.
  const lHem = (x, y) => y - (0.385 + 0.026 * tri(x * 21 + 0.1) + 0.085 * sstep(0.0, 0.065, x))
  const loinF = node((x, y, z) => {
    const zc = 0.121 + 0.06 * (0.645 - y) + 0.006 * Math.sin(x * 75)
    const slit = 0.011 * (0.5 - y) / 0.1 - Math.abs(x + 0.03)
    return Math.max(Math.abs(z - zc) - 0.0048, Math.abs(x) - (0.08 - 0.02 * (0.645 - y)), -lHem(x, y), y - 0.648, y < 0.5 ? slit : -1)
  }, [-0.1, 0.34, 0.09], [0.1, 0.66, 0.16])
  piece('loincloth_F', 'team', loinF, cloth((x, y) => Math.min(lHem(x, y), 0.08 - 0.02 * (0.645 - y) - Math.abs(x) + 0.006), 0.38, 0.56), { rigid: { tabard_F: 1 } }, 0.004)
  const rHem = (x, y) => y - (0.43 + 0.03 * tri(x * 19 + 0.6) + 0.05 * sstep(0.01, -0.06, x))
  const loinB = node((x, y, z) => {
    const zc = -0.139 - 0.05 * (0.645 - y) + 0.006 * Math.sin(x * 70 + 2)
    return Math.max(Math.abs(z - zc) - 0.0048, Math.abs(x) - 0.072, -rHem(x, y), y - 0.648)
  }, [-0.09, 0.38, -0.18], [0.09, 0.66, -0.11])
  piece('loincloth_B', 'team', loinB, cloth((x, y) => rHem(x, y), 0.42, 0.58), { rigid: { hips: 1 } }, 0.004)
}

// ===========================================================================
// SCAVENGED GEAR — baldric, one rusted pauldron (right), broken shield (left)
// ===========================================================================
{
  // Baldric: a leather strap slung from the right shoulder to the left hip.
  const n = norm([0.69, 0.73, 0]), p0 = [0.05, 0.9125, 0]
  const strap = band(ribHull, 0.019, 0.0065, p0, n, 0.019)
  piece('baldric', 'soft', strap, (x, y, z) => {
    const across = Math.abs((x - p0[0]) * n[0] + (y - p0[1]) * n[1])
    return shade(mix(C.leather, C.leatherDark, sstep(0.011, 0.017, across)), 0.8 + 0.3 * fbm(x * 70, y * 70, z * 70, 3))
  }, { rigid: { chest: 1 } }, 0.0045)
  const studs = []
  for (const t of [-0.11, -0.04, 0.03, 0.1]) {
    const q = add(p0, scale([n[1], -n[0], 0], t))
    studs.push(sphere(add(hullFront(q[0], q[1], 0.026), [0, 0, 0.002]), 0.0105))
  }
  piece('baldric_studs', 'metal', union(0, ...studs), rusted(C.brass, 0.5), { rigid: { chest: 1 } }, 0.004)
}
{
  // Spaulder on the sword shoulder: three overlapping rusted lames (each a slice
  // of a shell round the shoulder, the lower ones tucked under), a raised
  // ridge, a bent stub of a spike, rivets, one dent, a bite out of the last lame.
  const s = -1
  const w = { upperarm_R: 0.5, chest: 0.5 }
  const c = [s * 0.338, 1.018, 0]
  const ax = norm([s * 0.72, -0.69, 0]) // down the arm
  const dome = ellipsoid(c, [0.094, 0.07, 0.1], frameY(scale(ax, -1), [0, 0, 1]))
  const open = halfspace([s * 0.272, 1.02, 0], [-s, 0.35, 0]) // open toward the neck
  const lame = (lift, t0, t1) => {
    const shell = node((x, y, z) => Math.abs(dome.d(x, y, z) - lift) - 0.006, dome.min.map((v) => v - 0.04), dome.max.map((v) => v + 0.04))
    let l = intersect(0.004, shell, halfspace(add(c, scale(ax, t1)), ax))
    if (t0 !== null) l = intersect(0.004, l, halfspace(add(c, scale(ax, t0)), scale(ax, -1)))
    return intersect(0.006, l, open)
  }
  let top = lame(0.03, null, -0.016)
  const dn = norm([s * 0.25, 0.8, 0.55])
  const dp = surfacePoint(offset(dome, 0.036), add(c, scale(dn, 0.5)), scale(dn, -1))
  top = subtract(0.01, top, sphere(add(dp, scale(dn, 0.035 - 0.009)), 0.035))
  const mid = lame(0.021, -0.034, 0.018)
  let low = lame(0.012, 0.0, 0.056)
  low = subtract(0.003, low, sphere(add(c, [s * 0.07, -0.07, -0.075]), 0.04))
  const ridge = intersect(0.003, intersect(0.003, intersect(0.003, offset(dome, 0.043), roundBox(add(c, [0, 0.06, 0]), [0.2, 0.2, 0.0065], 0.004)), halfspace(add(c, scale(ax, -0.02)), ax)), open)
  const pp = rusted(C.iron, 0.9, 1, 0.04)
  piece('pauldron', 'metal', union(0.003, top, ridge, mid, low), (x, y, z) => {
    // rust gathers along the lower edge of each lame
    const t = (x - c[0]) * ax[0] + (y - c[1]) * ax[1]
    const seam = Math.max(sstep(-0.03, -0.018, t) * sstep(-0.012, -0.018, t), sstep(0.006, 0.016, t) * sstep(0.022, 0.016, t), sstep(0.044, 0.054, t))
    return shade(mix(pp(x, y, z), C.rust, seam * 0.6), 0.92 + 0.2 * sstep(0.98, 1.12, y))
  }, { rigid: w }, 0.004, { err: 0.003 })
  const studs = []
  for (const [lift, t] of [[0.03, -0.028], [0.021, 0.006], [0.012, 0.044]]) {
    for (const zz of [-0.062, 0, 0.062]) {
      const target = add(add(c, scale(ax, t)), [0, 0, zz])
      const from = add(target, add(scale(ax, 0), [s * 0.2, 0.21, zz * 2.4]))
      studs.push(sphere(surfacePoint(offset(dome, lift + 0.006), from, sub(target, from)), 0.008))
    }
  }
  const tp = surfacePoint(offset(dome, 0.036), add(c, [s * 0.0, 0.4, -0.028]), [0, -1, 0])
  studs.push(capsule(add(tp, [0, -0.008, 0]), add(tp, [s * 0.03, 0.046, -0.014]), 0.018, 0.0075))
  piece('pauldron_studs', 'metal', union(0.004, ...studs), rusted(C.steel, 0.6), { rigid: w }, 0.004)
  // Leather strap under the arm keeps it on.
  piece('pauldron_strap', 'soft', torus(add(c, [s * 0.012, -0.07, 0]), 0.05, 0.009, euler(0, 0, s * 0.35)), leatherPaint(C.leatherDark), { rigid: { upperarm_R: 0.7, chest: 0.3 } }, 0.0045)
}
{
  // A broken arrow still lodged in the back of the left shoulder blade.
  const a = [0.12, 0.95, -0.09], b = [0.2, 1.1, -0.27]
  const dir = norm(sub(b, a))
  const side = norm(cross(dir, [0, 1, 0])), upv = cross(side, dir)
  const fins = []
  for (const ang of [0.3, 2.4, 4.5]) {
    const v = add(scale(side, Math.cos(ang)), scale(upv, Math.sin(ang)))
    fins.push(ellipsoid(add(lerp3(a, b, 0.8), scale(v, 0.017)), [0.0042, 0.042, 0.017], basis(cross(dir, v), dir, v)))
  }
  const fletch = union(0.002, ...fins)
  piece('arrow', 'soft', union(0.003, capsule(a, b, 0.0078), fletch), (x, y, z) =>
    (fletch.d(x, y, z) < 0.0015 ? shade([0.66, 0.63, 0.56], 0.65 + 0.45 * tri(dot(sub([x, y, z], a), dir) * 60)) : shade(C.wood, 0.8 + 0.3 * fbm(x * 90, y * 90, z * 90, 2))),
  { rigid: { chest: 1 } }, 0.003)
}
{
  // Belt pouch on the right hip.
  const p = surfacePoint(PH, [-0.3, 0.6, 0.22], [0.3 - 0.115, 0, -0.22 + 0.075])
  const o = norm([p[0], 0, p[2] + 0.01])
  const c = add(p, scale(o, 0.03))
  const R = basis(cross([0, 1, 0], o), [0, 1, 0], o)
  const bag = union(0.012, roundBox(add(c, [0, -0.012, 0]), [0.038, 0.04, 0.022], 0.018, R), roundBox(add(c, [0, 0.012, 0]), [0.041, 0.022, 0.025], 0.014, R))
  piece('pouch', 'soft', bag, (x, y, z) => shade(mix(C.leather, C.leatherDark, sstep(0.006, -0.004, y - c[1]) * 0.6), 0.78 + 0.3 * fbm(x * 70, y * 70, z * 70, 3)), { rigid: { hips: 1 } }, 0.0045)
  piece('pouch_stud', 'metal', sphere(add(c, scale(o, 0.027)), 0.0085), rusted(C.brass, 0.4), { rigid: { hips: 1 } }, 0.004)
}
{
  // Broken round shield strapped along the left forearm. The arm hangs at the
  // side in every pose, so the face is aimed out and forward, not straight ahead.
  const { E, W } = LIMB.L
  const n = norm([0.64, 0.06, 0.77])
  const fdir = norm(sub(W, E))
  const upv = norm(sub(scale(fdir, -1), scale(n, dot(scale(fdir, -1), n))))
  const xv = cross(upv, n)
  const R = basis(xv, upv, n)
  const c = add(lerp3(E, W, 0.5), scale(n, 0.055))
  const local = (sdf) => place(sdf, c, R)
  const toLocal = (x, y, z) => { const q = [x - c[0], y - c[1], z - c[2]]; return [dot(q, xv), dot(q, upv), dot(q, n)] }
  const toZ = euler(Math.PI / 2, 0, 0)
  const RAD = 0.158
  const faceDome = sphere([0, 0, -0.55], 0.575)
  // What is missing: half a plank at the top, and a bite out of the lower rim.
  const breaks = union(0.004,
    roundBox([0.047, 0.16, 0], [0.0155, 0.11, 0.1], 0.003, euler(0, 0, 0.06)),
    roundBox([0.078, 0.12, 0], [0.0155, 0.11, 0.1], 0.003, euler(0, 0, -0.05)),
    sphere([-0.15, -0.105, 0], 0.062), sphere([-0.095, -0.165, 0], 0.04))
  let disc = intersect(0.004, intersect(0.004, faceDome, cylinder([0, 0, 0], RAD, 0.3, 0, toZ)), halfspace([0, 0, -0.012], [0, 0, -1]))
  const GROOVES = [-0.095, -0.033, 0.031, 0.093]
  for (const gx of GROOVES) disc = subtract(0.002, disc, band(faceDome, 0, 0.0065, [gx, 0, 0], [1, 0, 0], 0.0032))
  disc = subtract(0.003, disc, breaks)
  const facePaint = (x, y, z) => {
    const [qx, qy] = toLocal(x, y, z)
    let pl = 0
    for (const gx of GROOVES) if (qx > gx) pl++
    let k = 0.62 + 0.16 * noise3(pl * 7.3, 1.7, 0.2) + 0.08 * fbm(qx * 90, qy * 10, pl, 2)
    if (Math.abs(qy + 0.25 * qx) < 0.03) k += 0.3 // a crude painted stripe
    k *= 1 - 0.45 * sstep(0.5, 0.68, fbm(qx * 30 + 2, qy * 30, 3.3, 3)) // paint flaked off
    k *= 1 - 0.3 * sstep(0.11, 0.155, Math.hypot(qx, qy))
    return [k, k, k]
  }
  const skin = { rigid: { forearm_L: 1 }, occluder: 'shield' }
  piece('shield_face', 'team', local(disc), facePaint, skin, 0.0045, { colorWeight: 0.35 })
  const rimRing = subtract(0.003, torus([0, 0, 0.002], RAD, 0.0125, toZ), offset(breaks, 0.006))
  const boss = union(0.006, cylinder([0, 0, 0.024], 0.052, 0.006, 0.003, toZ), ellipsoid([0, 0, 0.03], [0.04, 0.04, 0.03]))
  const rivets = []
  for (const [px, py] of [[-0.064, 0.105], [0.0, 0.118], [-0.064, -0.09], [0.0, -0.118], [0.062, -0.1], [0.115, -0.03], [-0.12, 0.03]]) {
    rivets.push(sphere(surfacePoint(faceDome, [px, py, 0.3], [0, 0, -1]), 0.0095))
  }
  piece('shield_iron', 'metal', local(union(0, rimRing, boss, ...rivets)), rusted(C.iron, 1), skin, 0.0045)
  // Two leather loops binding it to the forearm.
  for (const [i, t] of [[0, 0.24], [1, 0.76]]) {
    piece(`shield_strap_${i}`, 'soft', torus(add(lerp3(E, W, t), scale(n, 0.006)), 0.036, 0.009, frameY(fdir)), leatherPaint(C.leatherDark), { rigid: { forearm_L: 1 } }, 0.004)
  }
}

// ===========================================================================
// FALCHION in the right hand — notched, rusted chopper; bony fingers wrapped
// round the grip. Rigid to hand_R.
// ===========================================================================
{
  const { W, F } = LIMB.R
  const hdir = norm(sub(F, W))
  const g = add(W, scale(hdir, 0.06))
  // Rest pose: blade forward, a little down and outward. The cutting edge faces
  // down-and-back, so that when the arm whips forward at the hit it leads.
  const d = norm([-0.25, -0.45, 1])
  const eHint = [0, -1, -0.4]
  const wAxis = norm(sub(eHint, scale(d, dot(eHint, d)))), tAxis = cross(wAxis, d)
  const R = basis(wAxis, d, tAxis)
  const local = (sdf) => place(sdf, g, R)
  const toLocal = (x, y, z) => { const q = [x - g[0], y - g[1], z - g[2]]; return [dot(q, wAxis), dot(q, d), dot(q, tAxis)] }
  const rigid = { rigid: { hand_R: 1 }, occluder: 'sword' }

  piece('sword_grip', 'soft', local(capsule([0, -0.068, 0], [0, 0.048, 0], 0.0195, 0.0185)),
    (x, y, z) => { const t = toLocal(x, y, z)[1]; return shade(C.leatherDark, 0.75 + 0.4 * (0.5 + 0.5 * Math.sin(t * 240 + Math.atan2(toLocal(x, y, z)[2], toLocal(x, y, z)[0])))) }, rigid, 0.004)
  const guard = union(0.008,
    roundBox([0.004, 0.058, 0], [0.066, 0.0125, 0.019], 0.009, euler(0, 0, 0.12)),
    sphere([0.07, 0.068, 0], 0.017), sphere([-0.062, 0.05, 0], 0.016),
    cylinder([0, -0.086, 0], 0.027, 0.012, 0.007))
  piece('sword_guard', 'metal', local(guard), rusted(C.steel, 0.8), rigid, 0.004)

  const edgeX = (y) => 0.046 + 0.13 * (y - 0.06)
  const wedge = node((x, y, z) => Math.abs(z) - (0.0125 - 0.072 * Math.max(0, x + 0.012)), [-1, -1, -1], [1, 2, 1])
  let blade = intersect(0.002, roundBox([0.04, 0.325, 0], [0.085, 0.265, 0.0125], 0.003), wedge)
  blade = intersect(0.002, blade, halfspace([edgeX(0.06), 0.06, 0], [1, -0.13, 0]))
  blade = intersect(0.002, blade, halfspace([-0.045, 0.45, 0], [-0.65, 0.76, 0])) // clipped point
  for (const zs of [1, -1]) blade = subtract(0.003, blade, roundBox([-0.016, 0.27, zs * 0.0135], [0.009, 0.17, 0.0055], 0.004)) // fuller
  for (const [ny, nr] of [[0.19, 0.012], [0.305, 0.016], [0.34, 0.009], [0.44, 0.013]]) blade = subtract(0.0015, blade, sphere([edgeX(ny) + nr * 0.45, ny, 0], nr))
  blade = subtract(0.002, blade, sphere([0.118, 0.585, 0], 0.03)) // tip snapped off
  const rp = rusted(C.steel, 0.9, 1.05, 0.05)
  piece('sword_blade', 'metal', local(blade), (x, y, z) => {
    const [qx, qy] = toLocal(x, y, z)
    const e = edgeX(qy) - qx
    return mix(rp(x, y, z), [0.78, 0.8, 0.82], sstep(0.016, 0.004, e) * (0.6 + 0.4 * noise3(qy * 60, 0, 0)))
  }, rigid, 0.003, { colorWeight: 0.35 })

  // Right hand, modelled in the sword's frame: metacarpals from the wrist to
  // the knuckles, then each finger hooked round the grip; thumb the other way.
  const wl = toLocal(W[0], W[1], W[2])
  const th = Math.atan2(wl[2], wl[0])
  const ring = (y, a, rho) => [rho * Math.cos(a), y, rho * Math.sin(a)]
  const parts = []
  for (let i = 0; i < 4; i++) {
    const y = -0.043 + i * 0.027
    const pts = [0, 1, 2, 3, 4].map((j) => ring(y + (j > 2 ? 0.003 : 0), th + 0.95 + j * 0.82, 0.0315 - (j === 4 ? 0.003 : 0)))
    const carp = [wl[0] * 0.78, wl[1] * 0.78 + (i - 1.5) * 0.012, wl[2] * 0.78]
    parts.push(capsule(carp, pts[0], 0.0095, 0.0105), sphere(pts[0], 0.0138))
    const rr = [0.0108, 0.0098, 0.0088, 0.0078, 0.0055]
    for (let j = 0; j < 4; j++) parts.push(capsule(pts[j], pts[j + 1], rr[j], rr[j + 1]))
    parts.push(sphere(pts[2], 0.0108))
  }
  const tp = [ring(0.012, th - 0.75, 0.033), ring(0.03, th - 1.6, 0.032), ring(0.036, th - 2.4, 0.03)]
  parts.push(capsule([wl[0] * 0.78, wl[1] * 0.78 + 0.02, wl[2] * 0.78], tp[0], 0.0105, 0.011), sphere(tp[0], 0.013), capsule(tp[0], tp[1], 0.0105, 0.0095), capsule(tp[1], tp[2], 0.009, 0.0055))
  const handR = local(union(0.004, ...parts))
  bone('hand_R', handR, { rigid: { hand_R: 1 } }, 0.003, { dirt: 0.3, cracks: 0 })
  // A thong lashes the sword hand's wrist.
  const fdir = norm(sub(W, LIMB.R.E))
  piece('wrist_lash_R', 'soft', lashing(sub(W, scale(fdir, 0.03)), fdir, 0.03, 2), leatherPaint(), { rigid: { forearm_R: 1 } }, 0.004)
}

// Bones that pieces may reference must exist.
const boneNames = new Set(BONES.map((b) => b.name))
for (const p of PIECES) {
  const refs = p.skin.rigid ? Object.keys(p.skin.rigid) : p.skin.envelope || []
  for (const r of refs) if (!boneNames.has(r)) throw new Error(`${p.name} references unknown bone ${r}`)
}
void grain
