// THE GIANT — a towering siege brute, slow and unstoppable.
//
// Same 22-bone skeleton as the Ember Warden, scaled x1.35 (~2.2 units tall).
// Every piece is authored directly at Giant scale. Read from the top down:
// iron half-helm with broken horns and ember eye slits, a fur mantle over
// sloped shoulders, riveted iron shoulder caps, a scarred barrel chest, a wide
// studded war-belt with a big buckle and chains, oversized iron gauntlets
// (his fists are the weapon), hide skirt, team loincloth / sash / back banner,
// iron greaves and iron-shod boots.
//
// The body is built like a ball-jointed figure: torso, each arm and each leg
// are separate meshes whose joint ends are spheres buried in the neighbour.
// Each limb is its own `occluder` group, so the buried joint surface is kept
// and nothing tears or opens up when a limb swings far from the rest pose.
//
// Conventions (same as glTF / Three.js): Y up, character faces +Z,
// ground at y = 0. The character's LEFT is +X, RIGHT is -X.

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
// Palette (sRGB). Muted and grounded: weathered skin, worn iron, dark hide and
// fur, bone, one accent metal (brass) and the team color (painted in greys).
// ---------------------------------------------------------------------------
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
const C = {
  iron: hex(0x7d828b), ironDark: hex(0x4b4f56), ironBlack: hex(0x2c2e33), rust: hex(0x6e4a34),
  brass: hex(0xc9973f), brassDeep: hex(0x8c6426),
  skin: hex(0xb48b6e), skinLight: hex(0xd6b091), skinDeep: hex(0x80594a), skinRed: hex(0xa66a58),
  grime: hex(0x6a5a50), scar: hex(0xd6aa9a), scarRim: hex(0x5e342c), stubble: hex(0x4a3a33),
  leather: hex(0x5c3c26), leatherDark: hex(0x33221a), hide: hex(0x7c6449), hideDark: hex(0x4a3a2b),
  furDark: hex(0x2c2521), fur: hex(0x65564a), furLight: hex(0xb4a48c),
  cloth: hex(0x3b3531), clothDark: hex(0x26221f),
  bone: hex(0xd2c6a6), boneDark: hex(0x4c3b2c), marrow: hex(0x7a5a44),
  ember: hex(0xffb04a), shadow: hex(0x0c0a09),
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k]
const clamp01 = (t) => Math.min(1, Math.max(0, t))
const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t) }
const flat = (c) => () => c
/** Worn iron: hammered dents, fine grain and blotches of rust. */
const iron = (c = C.iron, k = 1, rust = 0.45) => (x, y, z) => {
  const h = 0.84 + 0.14 * fbm(x * 15, y * 15, z * 15, 2) + 0.04 * noise3(x * 110, y * 110, z * 110)
  const r = sstep(0.5, 0.75, fbm(x * 6 + 3.1, y * 6 + 1.7, z * 6 + 9.3, 2))
  return shade(mix(c, C.rust, r * rust), k * h)
}
// Small trims and rivets are painted flat: paint noise costs triangles, and
// the build's baked edge wear already gives them life.
const brass = (k = 1) => flat(shade(C.brass, k))
const darkIron = (k = 1) => flat(shade(C.ironDark, k))
const grain = (c, amt = 0.08, freq = 60) => (x, y, z) => shade(c, 1 - amt / 2 + amt * fbm(x * freq, y * freq, z * freq, 3))
/** Worn leather: grain, darker scuffed blotches. */
const leather = (c = C.leather, k = 1) => (x, y, z) => shade(mix(c, C.leatherDark, 0.6 * sstep(0.45, 0.75, fbm(x * 9, y * 9, z * 9, 3))), k)
/** Team cloth is painted in greys: white = full team color, dark grey = darker. */
const teamGrey = (k) => [k, k, k]

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
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const lerp3 = (a, b, t) => add(a, mul(sub(b, a), t))
/**
 * Orthonormal frame along a limb: h = along the limb, f = as forward (+Z) as
 * possible, o = outward (away from the body on side s). Not necessarily
 * right-handed: only used with mirror-symmetric primitives.
 */
function frame(s, axis) {
  const h = norm(axis)
  const f = norm(sub([0, 0, 1], mul(h, h[2])))
  let o = cross(h, f)
  if (o[0] * s < 0) o = mul(o, -1)
  const at = (c, a, b, cc) => add(c, add(mul(o, a), add(mul(h, b), mul(f, cc))))
  return { o, h, f, R: basis(o, h, f), at }
}
/** Rotation with local Y along `dir` (for tori / cylinders around an axis). */
function frameY(dir, hintX = [1, 0, 0]) {
  const y = norm(dir)
  const z = norm(cross(hintX, y))
  const x = cross(y, z)
  return basis(x, y, z)
}
/**
 * Smooth union that evaluates every node. sdf.mjs's union skips nodes by
 * bounding box, which is only safe for exact distances: the ellipsoid distance
 * is an approximation, and with a wide blend the skip leaves a visible step.
 */
function blend(k, ...nodes) {
  const u = union(k, ...nodes)
  return node((x, y, z) => {
    let d = nodes[0].d(x, y, z)
    for (let i = 1; i < nodes.length; i++) {
      const b = nodes[i].d(x, y, z), h = clamp01(0.5 + (0.5 * (b - d)) / k)
      d = b + (d - b) * h - k * h * (1 - h)
    }
    return d
  }, u.min, u.max)
}
const AXIS_Z = euler(Math.PI / 2, 0, 0) // local Y -> world Z for cylinders / tori facing forward
/** Push a surface in and out with a noise function (fur, ragged hide). */
const displace = (n, fn, amp) => node((x, y, z) => n.d(x, y, z) - fn(x, y, z), n.min.map((v) => v - amp), n.max.map((v) => v + amp))
function segDist(x, y, z, a, b) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2], apx = x - a[0], apy = y - a[1], apz = z - a[2]
  const t = clamp01((apx * abx + apy * aby + apz * abz) / (abx * abx + aby * aby + abz * abz))
  return Math.hypot(apx - abx * t, apy - aby * t, apz - abz * t)
}
/** A scar: a polyline of points marched onto a surface. */
function scarPath(sdf, from0, from1, dir0, dir1, n = 6) {
  const pts = []
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push(surfacePoint(sdf, lerp3(from0, from1, t), lerp3(dir0, dir1, t))) }
  for (const p of pts) if (Math.abs(sdf.d(p[0], p[1], p[2])) > 1e-3) throw new Error(`scar ray missed the surface at ${p}`)
  return pts
}
const scarGroove = (paths, r = 0.0075) => union(0, ...paths.flatMap((pts) => pts.slice(1).map((p, i) => capsule(pts[i], p, r))))
const scarDist = (paths, x, y, z) => {
  let d = Infinity
  for (const pts of paths) for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(x, y, z, pts[i - 1], pts[i]))
  return d
}
/** One elongated chain link centred at c, long axis `tangent`, lying in the plane that contains `side`. */
function link(c, tangent, side, R1 = 0.027, r2 = 0.0095, le = 0.013) {
  const t = norm(tangent)
  const n = norm(cross(t, side))
  const b = cross(n, t)
  const local = node((x, y, z) => {
    const qy = Math.max(Math.abs(y) - le, 0)
    return Math.hypot(Math.hypot(x, qy) - R1, z) - r2
  }, [-R1 - r2, -le - R1 - r2, -r2], [R1 + r2, le + R1 + r2, r2])
  return place(local, c, basis(b, t, n))
}
/** Chain along a polyline: links at an even pitch, every other one turned 90 degrees. */
function chain(pts, outward, pitch = 0.061) {
  const links = []
  let acc = pitch / 2, travelled = 0, i = 0
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k], L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    while (acc <= travelled + L) {
      const c = lerp3(a, b, (acc - travelled) / L), t = norm(sub(b, a)), out = outward(c)
      links.push(link(c, t, i % 2 ? out : cross(t, out)))
      acc += pitch; i++
    }
    travelled += L
  }
  return union(0, ...links)
}

// ---------------------------------------------------------------------------
// Pieces. Each piece is meshed on its own, with:
//   material: 'soft' | 'metal' | 'team' | 'glow'
//   sdf:      the sculpted shape
//   paint:    (x,y,z) -> sRGB color, before baked AO/curvature are applied
//   skin:     { rigid: { bone: weight, ... } }  or  { envelope: [bones] }
//             or { fn: (x, y, z) => ({ bone: weight }) }; `occluder: 'name'`
//             puts the piece in its own baking/culling group (each limb here)
//   res:      optional voxel size override (smaller = finer)
// ---------------------------------------------------------------------------
export const PIECES = []
const piece = (name, material, sdf, paint, skin, res) => PIECES.push({ name, material, sdf, paint, skin, res })

// ---- Skin: weathered, blotchy, scarred -----------------------------------
/** Broad tone variation: big warm/cool blotches, mid mottling, fine pores. */
function skinBase(x, y, z) {
  const broad = sstep(0.3, 0.7, fbm(x * 3.3 + 7.1, y * 3.3 + 2.3, z * 3.3 + 3.7, 3))
  const mid = fbm(x * 12, y * 12, z * 12, 3)
  let c = mix(C.skinDeep, C.skinLight, 0.12 + 0.8 * broad)
  c = mix(c, C.skin, 0.2)
  c = mix(c, C.skinRed, 0.35 * sstep(0.5, 0.72, mid))
  c = mix(c, C.skinDeep, 0.4 * sstep(0.55, 0.3, mid))
  c = mix(c, C.grime, 0.45 * sstep(0.52, 0.7, fbm(x * 5.3 + 11.1, y * 5.3 + 4.2, z * 5.3 + 8.6, 2))) // ashen grime
  return shade(c, 0.97 + 0.06 * noise3(x * 50, y * 50, z * 50))
}
function paintScars(c, paths, x, y, z) {
  const d = scarDist(paths, x, y, z)
  if (d > 0.03) return c
  c = mix(c, C.scarRim, 0.6 * sstep(0.028, 0.014, d))
  return mix(c, C.scar, 0.9 * sstep(0.012, 0.005, d))
}

// ---- Torso: barrel chest, lats, thick waist, sloped traps -------------------
const ribcage = ellipsoid([0, 1.26, 0], [0.435, 0.33, 0.285])
const belly = ellipsoid([0, 0.99, 0.03], [0.305, 0.25, 0.24])
const pelvis = ellipsoid([0, 0.78, 0], [0.31, 0.17, 0.235])
const upperBack = ellipsoid([0, 1.38, -0.1], [0.36, 0.2, 0.17])
const neckCol = capsule([0, 1.42, -0.02], [0, 1.6, 0.02], 0.17, 0.15)
const traps = [1, -1].map((s) => capsule([s * 0.12, 1.52, -0.05], [s * 0.4, 1.46, -0.03], 0.11, 0.105))
const pecs = [1, -1].map((s) => ellipsoid([s * 0.19, 1.34, 0.18], [0.215, 0.16, 0.155], euler(0, 0, s * 0.12)))
const lats = [1, -1].map((s) => ellipsoid([s * 0.33, 1.19, -0.08], [0.13, 0.23, 0.17]))
const midriff = ellipsoid([0, 1.1, 0.015], [0.375, 0.26, 0.262])
const torsoCore = blend(0.1, ribcage, midriff, belly, pelvis, upperBack)
// `torsoRaw` is the reference surface every strap, belt and plate hugs.
const torsoRaw = blend(0.045, torsoCore, neckCol, ...traps, ...pecs, ...lats)
/** Spine-chain weights by height: used by the torso and by everything that wraps it. */
const torsoW = (x, y, z) => {
  const a = sstep(0.86, 1.03, y), b = sstep(1.07, 1.26, y)
  const c = sstep(1.42, 1.56, y) * (1 - sstep(0.12, 0.26, Math.abs(x)))
  return { hips: 1 - a, spine: a * (1 - b), chest: a * b * (1 - c), neck: a * b * c }
}
const torsoSkin = { fn: torsoW }
const rigidAt = (p) => ({ rigid: torsoW(p[0], p[1], p[2]) })
// Rough arm volumes, for painting a contact shadow where arm meets torso.
const armRough = Object.values(LIMB).map(({ S, E }) => union(0, sphere(S, 0.19), capsule(S, E, 0.155, 0.125)))
const torsoScars = [
  // long slash from the left collarbone across the sternum
  scarPath(torsoRaw, [0.3, 1.43, 1], [-0.06, 1.2, 1], [0, 0, -1], [0, 0, -1], 8),
  // three claw rakes on the right flank
  ...[0, 1, 2].map((i) => scarPath(torsoRaw, [-0.27 + i * 0.05, 1.17 - i * 0.012, 1], [-0.2 + i * 0.05, 1.03 - i * 0.012, 1], [0, 0, -1], [0, 0, -1], 4)),
  // short nick on the right pec
  scarPath(torsoRaw, [-0.27, 1.37, 1], [-0.15, 1.4, 1], [0, 0, -1], [0, 0, -1], 3),
  // old whip lines across the bare lower back
  scarPath(torsoRaw, [-0.26, 1.14, -1], [0.05, 1.05, -1], [0, 0, 1], [0, 0, 1], 6),
  scarPath(torsoRaw, [0.3, 1.16, -1], [0.1, 1.04, -1], [0, 0, 1], [0, 0, 1], 5),
]
{
  let torso = subtract(0.02, torsoRaw, capsule([0, 1.43, 0.36], [0, 1.2, 0.345], 0.022)) // sternum groove
  torso = subtract(0.012, torso, capsule([0, 1.16, 0.3], [0, 1.0, 0.3], 0.016)) // belly centre line
  torso = subtract(0.005, torso, scarGroove(torsoScars))
  const paint = (x, y, z) => {
    if (y < 0.83) return shade(C.cloth, 0.85 + 0.2 * fbm(x * 40, y * 40, z * 40, 3))
    let c = skinBase(x, y, z)
    // dark body hair down the sternum and belly, grime low on the gut
    const hair = sstep(0.11, 0.02, Math.abs(x)) * sstep(0.1, 0.25, z) * sstep(1.46, 1.3, y) * (0.35 + 0.65 * fbm(x * 70, y * 30, z * 70, 2))
    c = mix(c, C.stubble, 0.5 * hair)
    c = mix(c, C.skinDeep, 0.3 * sstep(1.12, 0.9, y))
    c = paintScars(c, torsoScars, x, y, z)
    const dArm = Math.min(armRough[0].d(x, y, z), armRough[1].d(x, y, z))
    return shade(c, 0.6 + 0.4 * sstep(0, 0.08, dArm))
  }
  piece('torso', 'soft', torso, paint, torsoSkin, 0.0075)
}

// ---- War-belt: wide leather girdle, iron rims and splints, brass studs ------
const BELT_Y = 0.885
const beltOuter = offset(torsoRaw, 0.04)
{
  const beltPaint = leather(C.leather)
  piece('belt', 'soft', band(torsoRaw, 0.014, 0.026, [0, BELT_Y, 0], [0, 1, 0], 0.088),
    (x, y, z) => shade(beltPaint(x, y, z), 0.8 + 0.2 * sstep(0.088, 0.05, Math.abs(y - BELT_Y))), torsoSkin, 0.008)
  const rims = union(0, band(torsoRaw, 0.022, 0.025, [0, BELT_Y + 0.074, 0], [0, 1, 0], 0.02, 0.016), band(torsoRaw, 0.022, 0.025, [0, BELT_Y - 0.074, 0], [0, 1, 0], 0.02, 0.016))
  // Vertical iron splints and brass studs all the way round, skipping the buckle.
  const splints = [], studs = []
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2
    if (Math.abs(Math.sin(a / 2)) < 0.22) continue // front centre: the buckle sits here
    const dir = [Math.sin(a), 0, Math.cos(a)]
    const top = surfacePoint(beltOuter, add([0, BELT_Y + 0.06, 0], mul(dir, 1)), mul(dir, -1))
    const bot = surfacePoint(beltOuter, add([0, BELT_Y - 0.06, 0], mul(dir, 1)), mul(dir, -1))
    void top; void bot
    studs.push(sphere(surfacePoint(beltOuter, add([0, BELT_Y, 0], mul(dir, 1)), mul(dir, -1)), i % 2 ? 0.02 : 0.027))
  }
  piece('belt_iron', 'metal', union(0.006, rims, ...splints), darkIron(1.1), torsoSkin, 0.008)
  piece('belt_studs', 'metal', union(0, ...studs), brass(), torsoSkin)
}
// Big round buckle plate: iron disc, brass rim and boss, ring of rivets.
const buckleC = add(surfacePoint(beltOuter, [0, BELT_Y, 1], [0, 0, -1]), [0, 0, 0.012])
{
  const skin = rigidAt(buckleC)
  let plate = cylinder(buckleC, 0.135, 0.022, 0.008, AXIS_Z)
  plate = subtract(0.004, plate, torus(add(buckleC, [0, 0, 0.024]), 0.078, 0.01, AXIS_Z)) // engraved ring
  piece('buckle', 'metal', plate, iron(C.iron, 1.05, 0.3), skin)
  const rivets = []
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 8; rivets.push(sphere(add(buckleC, [Math.cos(a) * 0.106, Math.sin(a) * 0.106, 0.022]), 0.015)) }
  piece('buckle_brass', 'metal', union(0, torus(add(buckleC, [0, 0, 0.012]), 0.135, 0.017, AXIS_Z), ellipsoid(add(buckleC, [0, 0, 0.022]), [0.052, 0.052, 0.034]), ...rivets), brass(), skin)
}

// ---- Hide skirt under the belt: flared, ragged hem, follows the thighs ------
const SKIRT_TOP = 0.835
const skirtRadii = (y) => { const u = Math.max(0, SKIRT_TOP - y); return [0.335 + 0.3 * u, 0.262 + 0.13 * u] }
{
  const hem = (phi) => 0.565 + 0.06 * Math.abs(Math.sin(phi * 4))
  const shape = (x, y, z) => {
    const [a, b] = skirtRadii(y)
    const qx = x / a, qz = z / b
    const k0 = Math.hypot(qx, qz), k1 = Math.hypot(qx / a, qz / b)
    const ell = k1 === 0 ? -b : (k0 * (k0 - 1)) / k1
    return Math.max(ell - 0.013, Math.min(-(ell + 0.013), 0.75 - y), hem(Math.atan2(x, z)) - y, y - SKIRT_TOP)
  }
  const skirt = node(shape, [-0.46, 0.5, -0.34], [0.46, SKIRT_TOP, 0.34])
  const paint = (x, y, z) => {
    const phi = Math.atan2(x, z)
    let c = mix(C.hide, C.hideDark, sstep(0.3, 0.7, noise3(x * 7, y * 7, z * 7)))
    return mix(c, C.furDark, 0.75 * sstep(0.06, 0.015, y - hem(phi))) // dark fur fringe
  }
  const skirtW = (x, y, z) => {
    const t = 0.5 * sstep(0.05, 0.2, Math.abs(x)) * sstep(SKIRT_TOP, 0.64, y)
    return x > 0 ? { hips: 1 - t, thigh_L: t } : { hips: 1 - t, thigh_R: t }
  }
  piece('skirt', 'soft', skirt, paint, { fn: skirtW }, 0.009)
}

// ---- Team cloth: front loincloth, diagonal sash, back banner -----------------
{
  // Front loincloth: a curved panel hanging from under the buckle to the knees.
  const TOP = 0.83, HW = 0.15
  const zs = (x, y) => 0.292 + 0.1 * (TOP - y) - 0.55 * x * x + 0.006 * Math.sin(x * 55)
  const bottom = (x) => 0.4 + 0.07 * Math.abs(Math.sin(x * 21 + 0.6)) + 0.12 * Math.max(0, Math.abs(x) - 0.09)
  const shape = (x, y, z) => Math.max(Math.abs(z - zs(x, y)) - 0.011, Math.abs(x) - HW, y - TOP, bottom(x) - y)
  const paint = (x, y, z) => {
    let k = 0.94 - 0.12 * noise3(x * 7, y * 7, z * 7)
    const edge = Math.min(HW - Math.abs(x), y - bottom(x))
    k *= 0.42 + 0.58 * sstep(0.018, 0.03, edge)
    // emblem: a ring with a bar through it (a battering ram seen end-on)
    const r = Math.hypot(x, y - 0.62)
    if (Math.abs(r - 0.062) < 0.014 || (Math.abs(x) < 0.013 && Math.abs(y - 0.62) < 0.105)) k *= 0.42
    return teamGrey(k * (0.8 + 0.2 * sstep(0.4, 0.6, y)))
  }
  piece('loincloth', 'team', node(shape, [-HW, 0.38, 0.2], [HW, TOP, 0.36]), paint, { rigid: { tabard_F: 1 } }, 0.006)
}
{
  // Diagonal sash, right hip to left shoulder, all the way round the torso.
  const n = norm([-0.6, 0.8, 0]), p0 = [0, 1.2, 0]
  const paint = (x, y, z) => {
    const across = Math.abs((x - p0[0]) * n[0] + (y - p0[1]) * n[1])
    let k = 0.94 - 0.14 * noise3(x * 6, y * 6, z * 6)
    k *= 0.45 + 0.55 * sstep(0.056, 0.044, across)
    return teamGrey(k)
  }
  piece('sash', 'team', band(torsoRaw, 0.006, 0.018, p0, n, 0.068), paint, torsoSkin, 0.008)
}
{
  // Back banner: a tattered strip hanging from under the mantle to the knees.
  const TOP = 1.3, HW = 0.2
  const zs = (x, y) => -0.335 - 0.02 * Math.max(0, 0.9 - y) + 0.014 * Math.sin(x * 26) * sstep(TOP, 1.0, y) + 0.12 * x * x
  const bottom = (x) => 0.47 + 0.09 * Math.abs(Math.sin(x * 17 + 1.1))
  const shape = (x, y, z) => Math.max(Math.abs(z - zs(x, y)) - 0.011, Math.abs(x) - HW, y - TOP, bottom(x) - y)
  const paint = (x, y, z) => {
    let k = 0.94 - 0.14 * noise3(x * 5, y * 5, z * 5)
    const edge = Math.min(HW - Math.abs(x), y - bottom(x))
    k *= 0.42 + 0.58 * sstep(0.022, 0.034, edge)
    // three dark tally bars: towers felled
    if (Math.abs(y - 0.86) < 0.085 && Math.abs(Math.abs(x) - 0.075) < 0.016) k *= 0.42
    if (Math.abs(y - 0.86) < 0.085 && Math.abs(x) < 0.016) k *= 0.42
    return teamGrey(k * (0.8 + 0.2 * sstep(0.5, 0.9, y)))
  }
  piece('banner', 'team', node(shape, [-HW, 0.44, -0.39], [HW, TOP, -0.3]), paint, torsoSkin, 0.007)
}

// ---- Chains: two swags from the buckle to the hips ---------------------------
{
  const swags = []
  for (const s of [1, -1]) {
    const pts = []
    for (let i = 0; i <= 16; i++) {
      const t = i / 16, phi = s * (0.5 + 1.15 * t), y = 0.8 - 0.012 * t - 0.12 * 4 * t * (1 - t)
      const [a, b] = skirtRadii(y)
      pts.push([(a + 0.03) * Math.sin(phi), y, (b + 0.03) * Math.cos(phi)])
    }
    swags.push(chain(pts, (c) => norm([c[0], 0, c[2]])))
  }
  piece('chains', 'metal', union(0, ...swags), darkIron(1.15), { rigid: { hips: 1 } }, 0.005)
}

// ---- Arms: deltoid ball, heavy upper arm, huge forearm ------------------------
for (const [side, { s, S, E, W, F }] of Object.entries(LIMB)) {
  const group = `arm${side}`
  const up = `upperarm_${side}`, fo = `forearm_${side}`, ha = `hand_${side}`
  const uDir = norm(sub(E, S)), fDir = norm(sub(W, E)), hDir = norm(sub(F, W))
  const U = frame(s, uDir), Fr = frame(s, fDir), H = frame(s, hDir)
  const delt = sphere(S, 0.19)
  const upper = capsule(S, E, 0.155, 0.125)
  const armRaw = union(0.04, delt, upper,
    ellipsoid(U.at(S, -0.01, 0.17, 0.045), [0.115, 0.15, 0.115]), // biceps
    ellipsoid(U.at(S, 0.03, 0.15, -0.055), [0.11, 0.16, 0.1]), // triceps
    sphere(add(E, [0, 0, -0.02]), 0.118),
    capsule(E, W, 0.13, 0.135),
    ellipsoid(Fr.at(E, 0.015, 0.09, 0.01), [0.145, 0.13, 0.14]))
  const scars = [
    scarPath(armRaw, U.at(S, 0.5, 0.03, 0.1), U.at(S, 0.5, 0.2, 0.0), mul(U.o, -1), mul(U.o, -1), 5),
    scarPath(armRaw, U.at(S, 0.08, 0.1, 0.5), U.at(S, 0.02, 0.24, 0.5), mul(U.f, -1), mul(U.f, -1), 4),
  ]
  if (s < 0) scars.push(scarPath(armRaw, U.at(S, 0.5, 0.06, 0.06), U.at(S, 0.5, 0.2, -0.06), mul(U.o, -1), mul(U.o, -1), 4))
  const bis = norm(add(uDir, fDir))
  const armW = (x, y, z) => { const f = sstep(-0.075, 0.075, dot(sub([x, y, z], E), bis)); return { [up]: 1 - f, [fo]: f } }
  const paint = (x, y, z) => {
    let c = skinBase(x, y, z)
    const along = dot(sub([x, y, z], E), bis)
    c = mix(c, C.skinRed, 0.3 * sstep(0.1, 0, Math.abs(along))) // raw elbows
    c = mix(c, C.skinDeep, 0.35 * sstep(-0.02, 0.12, along)) // grimy forearms
    c = paintScars(c, scars, x, y, z)
    return shade(c, 0.68 + 0.32 * sstep(0, 0.07, torsoRaw.d(x, y, z)))
  }
  piece(`arm_${side}`, 'soft', subtract(0.005, armRaw, scarGroove(scars)), paint, { fn: armW, occluder: group }, 0.0085)

  // Iron shoulder cap, concentric with the joint so it stays seated as the arm swings.
  const rigidUp = { rigid: { [up]: 1 }, occluder: group }
  const capN = norm([s, 0.42, 0]), capCut = add(S, mul(capN, -0.06))
  const capShell = offset(delt, 0.034)
  let cap = intersect(0.008, capShell, halfspace(capCut, mul(capN, -1)))
  // a second, smaller lame riveted on top
  const lameShell = offset(delt, 0.053)
  cap = union(0.004, cap, intersect(0.006, lameShell, halfspace(add(S, mul(capN, 0.075)), mul(capN, -1))))
  if (s < 0) cap = subtract(0.006, cap, capsule(add(S, [-0.13, 0.2, 0.12]), add(S, [-0.24, 0.02, 0.17]), 0.014)) // sword gash
  piece(`shoulder_cap_${side}`, 'metal', cap, iron(C.iron), rigidUp, 0.0075)
  const capFrame = frameY(capN), capRivets = []
  const capX = norm(cross(capN, [0, 0, 1])), capZ = cross(capX, capN)
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.3, lift = -0.02
    const d = norm(add(mul(capN, lift), add(mul(capX, Math.cos(a)), mul(capZ, Math.sin(a)))))
    capRivets.push(sphere(add(S, mul(d, 0.224)), 0.017))
  }
  const spikeD = norm([s, 0.3, 0])
  piece(`shoulder_trim_${side}`, 'metal', union(0, torus(add(S, mul(capN, -0.052)), 0.201, 0.017, capFrame), ...capRivets), brass(), rigidUp)
  piece(`shoulder_spike_${side}`, 'metal', union(0.012, capsule(add(S, mul(spikeD, 0.2)), add(S, mul(spikeD, s > 0 ? 0.36 : 0.31)), 0.05, s > 0 ? 0.008 : 0.022), cylinder(add(S, mul(spikeD, 0.235)), 0.062, 0.014, 0.006, frameY(spikeD))),
    darkIron(1.1), rigidUp)

  // Iron armlet above the elbow.
  const armletC = lerp3(S, E, 0.74)
  piece(`armlet_${side}`, 'metal', band(upper, 0.006, 0.02, armletC, uDir, 0.036), darkIron(1.15), rigidUp)
  const armletStuds = []
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    const d = add(mul(U.o, Math.cos(a)), mul(U.f, Math.sin(a)))
    armletStuds.push(sphere(surfacePoint(offset(upper, 0.026), add(armletC, mul(d, 0.5)), mul(d, -1)), 0.017))
  }
  piece(`armlet_studs_${side}`, 'metal', union(0, ...armletStuds), brass(), rigidUp)

  // Gauntlet cuff: a flared, splinted iron sleeve over the forearm.
  const rigidFo = { rigid: { [fo]: 1 }, occluder: group }
  const ca = add(E, mul(fDir, 0.075)), cb = add(W, mul(fDir, 0.03))
  const cuffBody = capsule(ca, cb, 0.15, 0.18)
  const cuffLen = Math.hypot(...sub(cb, ca))
  const splints = []
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6
    const d = add(mul(Fr.o, Math.cos(a)), mul(Fr.f, Math.sin(a)))
    splints.push(capsule(add(add(ca, mul(fDir, 0.05)), mul(d, 0.158)), add(add(ca, mul(fDir, cuffLen - 0.05)), mul(d, 0.178)), 0.017))
  }
  let cuff = union(0.008, cuffBody, ...splints, torus(add(ca, mul(fDir, 0.03)), 0.158, 0.02, frameY(fDir)))
  cuff = intersect(0.008, intersect(0.008, cuff, halfspace(ca, mul(fDir, -1))), halfspace(cb, fDir))
  piece(`gauntlet_cuff_${side}`, 'metal', cuff, iron(C.iron), rigidFo, 0.0075)
  const cuffRivets = []
  for (const [t, r] of [[cuffLen - 0.03, 0.176]]) for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    const d = add(mul(Fr.o, Math.cos(a)), mul(Fr.f, Math.sin(a)))
    cuffRivets.push(sphere(add(add(ca, mul(fDir, t)), mul(d, r + 0.016)), 0.016))
  }
  piece(`gauntlet_bands_${side}`, 'metal', union(0,
    band(cuffBody, 0.002, 0.017, add(ca, mul(fDir, cuffLen - 0.03)), fDir, 0.026, 0.008), ...cuffRivets), brass(), rigidFo)
  // three blunt spikes down the outside of the cuff
  const cuffSpikes = [0.3, 0.52, 0.74].map((t) => {
    const base = add(add(ca, mul(fDir, cuffLen * t)), mul(Fr.o, 0.15 + 0.03 * t))
    return capsule(base, add(base, mul(Fr.o, 0.075)), 0.03, 0.007)
  })
  piece(`gauntlet_spikes_${side}`, 'metal', union(0, ...cuffSpikes), darkIron(1.1), rigidFo)

  // Iron fist: segmented plates, knuckle bosses with studs, plated back of the hand.
  const rigidHa = { rigid: { [ha]: 1 }, occluder: group }
  const fistC = add(W, mul(hDir, 0.105))
  const fistBox = roundBox(fistC, [0.125, 0.135, 0.15], 0.06, H.R)
  let fist = union(0.02, fistBox, capsule(H.at(fistC, 0.02, -0.03, 0.15), H.at(fistC, -0.075, 0.07, 0.165), 0.046, 0.04)) // thumb
  const KZ = [-0.108, -0.036, 0.036, 0.108]
  for (const kz of KZ) fist = union(0.014, fist, sphere(H.at(fistC, 0.078, 0.108, kz), 0.042))
  for (const gz of [-0.072, 0, 0.072]) {
    fist = subtract(0.004, fist, intersect(0, band(fistBox, 0, 0.014, H.at(fistC, 0, 0, gz), H.f, 0.0065), halfspace(H.at(fistC, 0, -0.03, 0), mul(H.h, -1))))
  }
  piece(`fist_${side}`, 'metal', fist, iron(C.ironDark, 1.3), rigidHa, 0.0072)
  const studs = KZ.map((kz) => capsule(H.at(fistC, 0.085, 0.135, kz), H.at(fistC, 0.105, 0.195, kz), 0.024, 0.007))
  piece(`fist_studs_${side}`, 'metal', union(0, ...studs), brass(), rigidHa)
  const plateC = H.at(fistC, 0.122, -0.02, 0)
  piece(`fist_plate_${side}`, 'metal', roundBox(plateC, [0.02, 0.078, 0.112], 0.012, H.R), iron(C.iron), rigidHa)
  const plateRivets = [[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([a, b]) => sphere(H.at(fistC, 0.142, -0.02 + a * 0.052, b * 0.085), 0.014))
  piece(`fist_rivets_${side}`, 'metal', union(0, ...plateRivets), brass(), rigidHa)
}

// ---- Legs: dark trousers, knee cops, greaves, iron-shod boots -------------------
for (const [side, { s, Hp, K, A }] of Object.entries(LIMB)) {
  const group = `leg${side}`
  const th = `thigh_${side}`, sh = `shin_${side}`, ft = `foot_${side}`
  const shinCap = capsule(K, add(A, [0, 0.02, 0]), 0.128, 0.115)
  const leg = union(0.04, sphere(Hp, 0.168), capsule(Hp, K, 0.165, 0.128),
    ellipsoid(add(lerp3(Hp, K, 0.45), [0, 0, 0.035]), [0.15, 0.17, 0.15]),
    sphere(add(K, [0, 0, 0.01]), 0.125), shinCap,
    ellipsoid(add(lerp3(K, A, 0.35), [0, 0, -0.04]), [0.115, 0.13, 0.115]))
  const legW = (x, y, z) => { const f = sstep(K[1] + 0.075, K[1] - 0.075, y); return { [th]: 1 - f, [sh]: f } }
  const clothPaint = (x, y, z) => {
    return mix(C.cloth, C.clothDark, 0.7 * sstep(0.3, 0.7, noise3(x * 8, y * 5, z * 8)))
  }
  piece(`leg_${side}`, 'soft', leg, clothPaint, { fn: legW, occluder: group }, 0.01)

  const rigidKnee = { rigid: { [th]: 0.4, [sh]: 0.6 }, occluder: group }
  piece(`kneecop_${side}`, 'metal', union(0.012, ellipsoid(add(K, [0, 0.012, 0.1]), [0.108, 0.118, 0.075]), ellipsoid(add(K, [s * 0.085, 0.005, 0.04]), [0.045, 0.09, 0.07])), iron(C.iron), rigidKnee)
  piece(`kneestud_${side}`, 'metal', capsule(add(K, [0, 0.012, 0.165]), add(K, [0, 0.02, 0.215]), 0.034, 0.009), brass(), rigidKnee)

  // Greave: a ridged iron shin plate strapped over the trousers.
  const rigidSh = { rigid: { [sh]: 1 }, occluder: group }
  const gTop = K[1] - 0.075, gBot = A[1] + 0.035
  let greave = intersect(0.01, offset(shinCap, 0.024), halfspace([0, 0, -0.035], [0, 0, -1]))
  greave = intersect(0.008, intersect(0.008, greave, halfspace([0, gTop, 0], [0, 1, 0])), halfspace([0, gBot, 0], [0, -1, 0]))
  greave = union(0.01, greave, capsule([K[0], gTop - 0.02, 0.145], [A[0], gBot + 0.02, 0.128], 0.02)) // centre ridge
  piece(`greave_${side}`, 'metal', greave, iron(C.iron), rigidSh)
  const straps = [gTop - 0.06].map((y) => band(shinCap, 0.004, 0.018, [0, y, 0], [0, 1, 0], 0.024, 0.008))
  piece(`greave_straps_${side}`, 'soft', union(0, ...straps), flat(shade(C.leatherDark, 1.15)), rigidSh)
  const gRivets = []
  for (const y of [gTop - 0.06, gBot + 0.05]) for (const sx of [1, -1]) gRivets.push(sphere(surfacePoint(offset(shinCap, 0.03), [K[0] + sx * 1, y, 0.035], [-sx, 0, 0]), 0.016))
  void gRivets

  // Boot: heavy hide boot with an iron toe cap, heel plate and sole rim.
  const rigidFt = { rigid: { [ft]: 1 }, occluder: group }
  const fx = A[0]
  const foot = union(0.05, roundBox([fx, 0.08, 0.07], [0.125, 0.08, 0.185], 0.06), ellipsoid([fx, 0.075, 0.2], [0.125, 0.078, 0.1]), sphere(A, 0.125))
  const ground = halfspace([0, 0.003, 0], [0, -1, 0])
  piece(`boot_${side}`, 'soft', intersect(0.006, foot, ground), (x, y, z) => shade(C.leatherDark, 1.05 + 0.3 * noise3(x * 7, y * 7, z * 7)), rigidFt)
  const footOut = offset(foot, 0.013)
  const toe = intersect(0.006, intersect(0.006, footOut, halfspace([0, 0, 0.175], [0, -0.35, -1])), ground)
  const heel = intersect(0.006, intersect(0.006, intersect(0.006, footOut, halfspace([0, 0, -0.06], [0, 0, 1])), halfspace([0, 0.11, 0], [0, 1, 0])), ground)
  const sole = intersect(0.004, band(foot, 0.004, 0.02, [0, 0.022, 0], [0, 1, 0], 0.02), ground)
  piece(`boot_iron_${side}`, 'metal', union(0.004, toe, heel, sole), darkIron(1.2), rigidFt, 0.008)
  const toeRivets = [-0.085, 0, 0.085].map((dx) => sphere(surfacePoint(offset(foot, 0.016), [fx + dx, 0.6, 0.2 - Math.abs(dx) * 0.25], [0, -1, 0]), 0.015))
  piece(`boot_rivets_${side}`, 'metal', union(0, ...toeRivets), brass(), rigidFt)
  // Rolled hide cuff where the boot shaft meets the greave.
  piece(`boot_cuff_${side}`, 'soft', torus(add(A, [0, 0.035, 0]), 0.118, 0.04), (x, y, z) => mix(C.hide, C.hideDark, sstep(0.3, 0.7, noise3(x * 9, y * 9, z * 9))), rigidSh, 0.008)
}

// ---- Fur mantle across the shoulders ---------------------------------------
{
  const yoke = offset(union(0.05, ...traps, upperBack, capsule([0, 1.42, -0.02], [0, 1.52, 0], 0.17)), 0.05)
  const lobes = [1, -1].map((s) => ellipsoid([s * 0.38, 1.5, -0.02], [0.2, 0.125, 0.21]))
  const lapels = [1, -1].map((s) => ellipsoid([s * 0.25, 1.455, 0.17], [0.17, 0.1, 0.145]))
  const backDrape = ellipsoid([0, 1.33, -0.17], [0.37, 0.2, 0.15])
  let mantle = blend(0.06, yoke, backDrape, ...lobes, ...lapels)
  mantle = intersect(0.02, mantle, halfspace([0, 1.3, 0], [0, -1, 0.35])) // lower edge: low at the back, high in front
  mantle = subtract(0.03, mantle, capsule([0, 1.52, 0.02], [0, 1.95, 0.02], 0.215)) // neck hole
  mantle = subtract(0.03, mantle, ellipsoid([0, 1.45, 0.32], [0.1, 0.22, 0.24])) // open at the throat
  // Pointed tufts of fur all along the lower edge, in two staggered rows.
  const edgeY = (z) => 1.3 + 0.35 * z
  const locks = []
  const N = 22
  for (let row = 0; row < 2; row++) for (let i = 0; i < N; i++) {
    const phi = ((i + row * 0.5) / N) * Math.PI * 2 + 0.09, dir = [Math.sin(phi), 0, Math.cos(phi)]
    const rnd = noise3(i * 3.7 + row * 17.3, 1.3, 0.5), rnd2 = noise3(i * 5.1 + 9.2, row * 3.3, 2.5)
    let y = 1.3, p = null
    for (let it = 0; it < 3; it++) {
      p = surfacePoint(mantle, add([0, y, -0.03], mul(dir, 1.2)), mul(dir, -1))
      y = edgeY(p[2]) + 0.03 + row * 0.07
    }
    if (Math.abs(mantle.d(p[0], p[1], p[2])) > 2e-3) continue
    const len = 0.05 + 0.07 * rnd, side = (rnd2 - 0.5) * 0.07
    const tan = [dir[2], 0, -dir[0]]
    locks.push(capsule(add(p, [0, 0.025, 0]), add(p, [dir[0] * 0.03 + tan[0] * side, -len, dir[2] * 0.03 + tan[2] * side]), 0.036, 0.004))
  }
  mantle = union(0.018, mantle, ...locks)
  const ridged = (x, y, z) => 1 - Math.abs(2 * noise3(x, y, z) - 1)
  const fur = displace(mantle, (x, y, z) => 0.017 * ridged(x * 17, y * 5, z * 17) + 0.03 * (noise3(x * 8, y * 5, z * 8) - 0.5), 0.03)
  const paint = (x, y, z) => {
    const strand = ridged(x * 17, y * 5, z * 17)
    let c = mix(C.furDark, C.fur, sstep(0.25, 0.7, strand))
    c = mix(c, C.furLight, 0.75 * sstep(0.7, 0.95, strand))
    c = mix(c, C.furLight, 0.45 * sstep(0.03, -0.06, y - edgeY(z))) // sun-bleached tips
    c = mix(c, C.furDark, 0.6 * sstep(0.12, 0.02, Math.abs(x)) * sstep(0.05, -0.1, z)) // dark dorsal stripe
    return shade(c, 0.85 + 0.3 * noise3(x * 6, y * 6, z * 6))
  }
  const mantleW = (x, y, z) => { const w = torsoW(x, y, z); return { spine: w.spine, chest: w.chest + w.neck + w.hips } }
  piece('mantle', 'soft', fur, paint, { fn: mantleW }, 0.009)

  // Brass clasp discs on the lapels, joined by a chain across the collarbones.
  const ends = [1, -1].map((s) => surfacePoint(mantle, [s * 0.165, 1.445, 1], [0, 0, -1]))
  const discs = ends.map((p) => union(0.006, cylinder(add(p, [0, 0, 0.012]), 0.047, 0.014, 0.006, AXIS_Z), sphere(add(p, [0, 0, 0.024]), 0.022)))
  piece('mantle_clasps', 'metal', union(0, ...discs), brass(), { rigid: { chest: 1 } })
  const pts = []
  for (let i = 0; i <= 10; i++) {
    const t = i / 10
    const from = [lerp3(ends[1], ends[0], t)[0], 1.44 - 0.085 * 4 * t * (1 - t), 1]
    const p = surfacePoint(union(0, torsoRaw, mantle), from, [0, 0, -1])
    pts.push(add(p, [0, 0, 0.018]))
  }
  piece('mantle_chain', 'metal', chain(pts.slice(1, -1), () => [0, 0, 1], 0.056), darkIron(1.15), { rigid: { chest: 1 } }, 0.005)
}

// ---- Head: iron half-helm over a shadowed face, heavy bare jaw -----------------
{
  const head = { rigid: { head: 1 } }
  // The head is sculpted around z = 0 and then set forward of the neck (a
  // hunched brute), which also seats the runtime eye-glow halo inside the slits.
  const HZ = 0.055, I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const piece = (name, material, sdf, paint, skin, res) => PIECES.push({ name, material, sdf: place(sdf, [0, 0, HZ], I3), paint: (x, y, z) => paint(x, y, z - HZ), skin, res })
  // Face and jaw. Everything above the mouth sits in the helm's shadow.
  const mouthA = [-0.062, 1.668, 0.2], mouthB = [0.062, 1.668, 0.2]
  let face = union(0.03,
    ellipsoid([0, 1.8, 0.005], [0.2, 0.195, 0.2]),
    ellipsoid([0, 1.685, 0.06], [0.15, 0.11, 0.165]), // jaw
    roundBox([0, 1.63, 0.155], [0.088, 0.046, 0.062], 0.04), // chin
    ellipsoid([0, 1.65, 0.2], [0.075, 0.022, 0.034]), // lower lip
    ellipsoid([0, 1.735, 0.215], [0.042, 0.046, 0.04])) // nose
  face = subtract(0.008, face, union(0, capsule(mouthA, mouthB, 0.014), capsule(mouthA, [-0.085, 1.652, 0.185], 0.01), capsule(mouthB, [0.085, 1.652, 0.185], 0.01)))
  const jawScar = [scarPath(face, [0.1, 1.72, 1], [0.06, 1.61, 1], [0, 0, -1], [0, 0, -1], 4)]
  const facePaint = (x, y, z) => {
    let c = skinBase(x, y, z)
    c = mix(c, C.stubble, 0.55 * sstep(1.71, 1.64, y) * (0.5 + 0.5 * fbm(x * 90, y * 90, z * 90, 2))) // stubble
    c = mix(c, C.scarRim, 0.8 * sstep(0.022, 0.008, Math.min(segDist(x, y, z, mouthA, mouthB), segDist(x, y, z, mouthA, [-0.085, 1.652, 0.185]), segDist(x, y, z, mouthB, [0.085, 1.652, 0.185]))))
    c = paintScars(c, jawScar, x, y, z)
    return mix(c, C.shadow, 0.93 * sstep(1.735, 1.76, y)) // lost in shadow under the helm
  }
  piece('face', 'soft', face, facePaint, head, 0.0055)

  const HC = [0, 1.83, 0.01]
  const dome = ellipsoid(HC, [0.235, 0.225, 0.25])
  const helmShell = union(0.05, dome, roundBox([0, 1.735, 0.015], [0.205, 0.1, 0.215], 0.09))
  const opening = roundBox([0, 1.65, 0.25], [0.118, 0.094, 0.17], 0.04)
  let helm = intersect(0.012, helmShell, halfspace([0, 1.662, 0], [0, -1, 0]))
  helm = subtract(0.014, helm, opening) // open lower face, leaving cheek guards
  helm = union(0.008, helm, roundBox([0, 1.712, 0.238], [0.029, 0.066, 0.02], 0.012, euler(-0.1, 0, 0))) // nasal bar
  for (const s of [1, -1]) helm = subtract(0.008, helm, roundBox([s * 0.09, 1.777, 0.25], [0.054, 0.0155, 0.1], 0.012, euler(0, 0, s * 0.2))) // eye slits
  helm = union(0.012, helm, intersect(0.004, offset(dome, 0.024), roundBox([0, 1.98, -0.03], [0.02, 0.14, 0.3], 0.014))) // crest ridge
  helm = union(0.01, helm, roundBox([0, 1.805, 0.225], [0.17, 0.016, 0.035], 0.014)) // heavy brow
  helm = subtract(0.004, helm, roundBox([-0.115, 1.97, 0.12], [0.006, 0.07, 0.06], 0.004, euler(0.5, 0.2, 0.5))) // axe notch
  helm = subtract(0.03, helm, sphere([0.17, 1.99, -0.1], 0.07)) // dent
  const hp = iron(C.iron, 1, 0.5)
  piece('helmet', 'metal', helm, (x, y, z) => shade(hp(x, y, z), 0.88 + 0.2 * sstep(1.7, 2.05, y)), head, 0.0055)
  // Brass brow band and rim, iron rivets along the band and down the cheek guards.
  const browBand = band(helmShell, 0.0, 0.015, [0, 1.85, 0], [0, 1, -0.1], 0.02)
  const rim = subtract(0, band(helmShell, 0.0, 0.014, [0, 1.677, 0], [0, 1, 0], 0.014), offset(opening, 0.02))
  const rivets = []
  for (const a of [-2.7, -2.2, -1.7, -1.2, -0.7, -0.25, 0.25, 0.7, 1.2, 1.7, 2.2, 2.7]) {
    const dir = [Math.sin(a), 0, Math.cos(a)]
    rivets.push(sphere(surfacePoint(helmShell, add([0, 1.85 - 0.1 * dir[2] * 0.2, 0.01], mul(dir, 0.6)), mul(dir, -1)), 0.016))
  }
  for (const s of [1, -1]) for (const y of [1.7, 1.745]) rivets.push(sphere(surfacePoint(helmShell, [s * 0.155, y, 1], [0, 0, -1]), 0.014))
  piece('helmet_brass', 'metal', union(0, browBand, rim), brass(), head, 0.008)
  piece('helmet_rivets', 'metal', union(0, ...rivets), darkIron(1.25), head)
  for (const s of [1, -1]) {
    const sideName = s > 0 ? 'L' : 'R'
    piece(`eye_${sideName}`, 'glow', ellipsoid([s * 0.09, 1.777, 0.2], [0.034, 0.0105, 0.02], euler(0, 0, s * 0.2)), flat(C.ember), head, 0.004)
    // Horns: the left one whole, the right one snapped off short.
    const p0 = [s * 0.185, 1.9, -0.02], p1 = [s * 0.38, 1.895, -0.035], p2 = [s * 0.51, 1.97, 0.02], p3 = [s * 0.475, 2.185, 0.1]
    const tube = bezierTube(p0, p1, p2, p3, 0.074, 0.014, 12)
    let horn = tube
    const breakAt = [-0.4, 1.925, -0.02], breakN = norm([-1, 0.55, 0.2])
    if (s < 0) {
      horn = node((x, y, z) => Math.max(tube.d(x, y, z), (x - breakAt[0]) * breakN[0] + (y - breakAt[1]) * breakN[1] + (z - breakAt[2]) * breakN[2] + 0.022 * (noise3(x * 45, y * 45, z * 45) - 0.5)),
        [-0.56, 1.8, -0.14], [-0.1, 2.05, 0.1])
    }
    piece(`horn_${sideName}`, 'soft', horn, (x, y, z) => {
      const t = tube.param(x, y, z)
      const ridge = 0.88 + 0.12 * Math.sin(t * 34)
      let c = shade(mix(C.bone, C.boneDark, sstep(0.5, 1, t) * 0.9 + 0.25 * sstep(0.2, 0, t)), ridge)
      if (s < 0) c = mix(c, C.marrow, sstep(0.016, 0.002, -((x - breakAt[0]) * breakN[0] + (y - breakAt[1]) * breakN[1] + (z - breakAt[2]) * breakN[2])))
      return c
    }, head, 0.0055)
    const baseDir = norm(sub(p1, p0))
    piece(`horn_socket_${sideName}`, 'metal', torus(add(p0, mul(baseDir, 0.06)), 0.076, 0.024, frameY(baseDir)), darkIron(1.15), head)
  }
}

// Bones that pieces may reference must exist.
const boneNames = new Set(BONES.map((b) => b.name))
for (const p of PIECES) {
  const refs = p.skin.rigid ? Object.keys(p.skin.rigid) : p.skin.envelope || []
  for (const r of refs) if (!boneNames.has(r)) throw new Error(`${p.name} references unknown bone ${r}`)
}
void grain; void bezierTube
