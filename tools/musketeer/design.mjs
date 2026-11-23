// THE MUSKETEER — a hardened marksman-duelist with a long flintlock.
//
// Same 22-bone Knight skeleton and pipeline as the Ember Warden:
// SDF pieces -> Surface Nets -> decimation -> baked AO -> skin -> clips.
// Faces +Z, feet at y = 0, ~1.7 units tall.
//
// Layering, inside out: body (ribcage / waist / pelvis) -> long charcoal coat
// (torso, sleeves, flared split skirts) -> team facings, cuffs, sash and
// turnbacks -> gorget, left pauldron, bandolier with powder charges, belt,
// flask and pouch -> gold buttons, braid, buckles and rivets. A scarf mask and
// a wide cavalier hat (right brim pinned up, long team plume) leave only a
// shadowed band of face with small dark eyes.
//
// The musket is rigid to hand_R. In the bind pose its grip is at
// g = W_R + [0.02, 0.02, 0.02] and the barrel runs along
// d = norm([0.25, -0.55, 0.8]); animations.mjs solves both arms onto it with
// IK using exactly those constants, so the gun is only ever reshaped ALONG
// that axis (local frame: X = lock side, Y = barrel, Z = top).

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
  // Cape chain: here it gives the back of the coat skirts their trailing sway.
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
// Palette (sRGB): weathered charcoal cloth, dark leather, worn steel, one
// accent metal (gold). Team parts are painted in greys.
// ---------------------------------------------------------------------------
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
const C = {
  skin: hex(0xb88a68), skinDark: hex(0x4a3128), eye: hex(0x120d0c),
  hair: hex(0x2a1a13), hairLight: hex(0x4a3021),
  coat: hex(0x3f4452), coatDark: hex(0x282b35), shirt: hex(0x25232a), breeches: hex(0x3d352f),
  felt: hex(0x2b2729), feltDark: hex(0x1c191b), scarf: hex(0x74695a), scarfDark: hex(0x4d453c),
  leather: hex(0x6a4327), leatherDark: hex(0x3f2617), boot: hex(0x4a2e1c), bootLight: hex(0x7b5837),
  wood: hex(0x6e4424), woodDark: hex(0x3c2311), charge: hex(0xb08d5c),
  steel: hex(0x929cab), steelDark: hex(0x5d6570), iron: hex(0x3e434b),
  gold: hex(0xe3a93f), goldDeep: hex(0xb87a24), braid: hex(0xc29a45),
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k]
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const grey = (k) => [k, k, k]
const flat = (c) => () => c
/** Hammered metal: soft low-frequency dents plus fine grain. */
const hammered = (c, k = 1) => (x, y, z) => shade(c, k * (0.86 + 0.1 * fbm(x * 22, y * 22, z * 22, 3) + 0.06 * noise3(x * 140, y * 140, z * 140)))
const grain = (c, amt = 0.08, freq = 60) => (x, y, z) => shade(c, 1 - amt / 2 + amt * fbm(x * freq, y * freq, z * freq, 3))
/** Worn cloth: broad blotches plus a faint weave. */
const cloth = (c, k = 1) => (x, y, z) => shade(c, k * (0.86 + 0.24 * fbm(x * 16, y * 16, z * 16, 3)))
const smax = (a, b, k) => { const h = Math.min(1, Math.max(0, 0.5 - (0.5 * (b - a)) / k)); return b + (a - b) * h + k * h * (1 - h) }

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
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const lerp3 = (a, b, t) => add(a, scale(sub(b, a), t))
/**
 * A layer lying on `n`: a closed solid from `inner` to `lift + th` above the
 * surface. The default inner face sits 3 mm inside n: hidden, but shallower
 * than the build's 4 mm burial cull. Stacked layers pass an `inner` just under
 * the outer face of the layer below, so nothing underneath is buried either
 * (culled patches leave ragged borders that cost hundreds of triangles).
 */
const shell = (n, lift, th, inner = -0.003) => {
  const o = lift + th
  return node((x, y, z) => { const d = n.d(x, y, z); return Math.max(d - o, inner - d) }, n.min.map((v) => v - o), n.max.map((v) => v + o))
}
/** A strap of that layer: clipped to |distance from a plane| < halfWidth (like sdf.mjs band). */
const wrap = (n, lift, th, planePoint, planeNormal, halfWidth, inner = -0.003, rad = 0.004) => {
  const [nx, ny, nz] = norm(planeNormal)
  const slab = node((x, y, z) => Math.abs((x - planePoint[0]) * nx + (y - planePoint[1]) * ny + (z - planePoint[2]) * nz) - halfWidth, [-Infinity, -Infinity, -Infinity], [Infinity, Infinity, Infinity])
  return intersect(rad, shell(n, lift, th, inner), slab)
}

// ---------------------------------------------------------------------------
// Pieces. material: 'soft' | 'metal' | 'team' | 'glow'
// ---------------------------------------------------------------------------
export const PIECES = []
const piece = (name, material, sdf, paint, skin, res) => PIECES.push({ name, material, sdf, paint, skin, res })
const TORSO = ['hips', 'spine', 'chest']

// ---- Body: ribcage over a narrow waist over the pelvis, limbs with mass ----
const ribcage = ellipsoid([0, 0.9, 0.005], [0.212, 0.175, 0.142])
const shoulderLine = capsule([-0.25, 1.02, 0], [0.25, 1.02, 0], 0.072)
const waist = ellipsoid([0, 0.72, 0], [0.152, 0.13, 0.116])
const pelvis = ellipsoid([0, 0.59, 0], [0.186, 0.115, 0.142])
const bust = union(0.03, ellipsoid([0.085, 0.925, 0.095], [0.082, 0.072, 0.066]), ellipsoid([-0.085, 0.925, 0.095], [0.082, 0.072, 0.066]))
const torso = union(0.06, ribcage, shoulderLine, waist, pelvis, bust)
// Only the legs are ever seen (through the split skirts); torso and arms live inside the coat.
{
  const parts = [intersect(0.02, pelvis, halfspace([0, 0.63, 0], [0, 1, 0]))]
  for (const { Hp, K } of Object.values(LIMB)) parts.push(capsule(Hp, K, 0.108, 0.086))
  const bodyPaint = (x, y, z) => {
    const seam = sstep(0.012, 0.004, Math.abs(Math.abs(x) - 0.245 + 0.1 * (0.55 - y))) // outer seam
    return shade(C.breeches, (0.88 + 0.18 * fbm(x * 16, y * 16, z * 16, 3)) * (1 - 0.3 * seam))
  }
  piece('breeches', 'soft', union(0.05, ...parts), bodyPaint, { envelope: ['hips', 'thigh_L', 'shin_L', 'thigh_R', 'shin_R'] }, 0.009)
}

// ---- Coat, upper half: fitted body, cut at the waist where the skirts start ----
const coatBody = offset(torso, 0.026)
{
  const body = intersect(0.01, coatBody, halfspace([0, 0.655, 0], [0, -1, 0]))
  // Centre-front seam and two side-back seams read as tailoring.
  const coatPaint = (x, y, z) => {
    const base = cloth(C.coat)(x, y, z)
    const seam = z < 0 ? sstep(0.01, 0.003, Math.abs(Math.abs(x) - 0.09 - 0.08 * sstep(0.7, 1.0, y))) : 0
    return shade(base, (1 - 0.35 * seam) * (0.92 + 0.12 * sstep(0.66, 1.05, y)))
  }
  piece('coat', 'soft', body, coatPaint, { envelope: TORSO }, 0.009)
}
// Sleeves: their own soft pieces so the chest (and everything pinned to it) stays put when the arms rise.
// Pieces that overlap across a moving joint (sleeves, gloves, boots, neck scarf) get their own occluder
// group: otherwise the build culls the buried halves of BOTH sides and the joint opens when it bends.
for (const [side, { S, E, W }] of Object.entries(LIMB)) {
  const dir = norm(sub(W, E))
  const sleeve = union(0.03, sphere(S, 0.098), capsule(S, E, 0.097, 0.086), capsule(E, sub(W, scale(dir, 0.07)), 0.083, 0.076))
  piece(`sleeve_${side}`, 'soft', sleeve, (x, y, z) => {
    const base = cloth(C.coat)(x, y, z)
    const q = sub([x, y, z], E)
    const fold = 0.5 + 0.5 * Math.sin(dot(q, dir) * 80)
    return shade(base, 0.92 + 0.1 * fold * sstep(0.12, 0.02, Math.hypot(q[0], q[1], q[2])))
  }, { envelope: [`upperarm_${side}`, `forearm_${side}`], occluder: 'sleeve' }, 0.008)
}

// ---- Team facings: a buttoned-back plastron on the chest, gold buttons and braid ----
const facingHW = (y) => 0.062 + 0.095 * sstep(0.72, 1.0, y)
{
  const region = node((x, y, z) => Math.max(Math.abs(x) - facingHW(y), 0.7 - y, y - 1.035, -z), [-0.2, 0.69, 0], [0.2, 1.04, 0.3])
  piece('coat_facing', 'team', intersect(0.006, shell(coatBody, 0.005, 0.006), region), (x, y, z) => {
    const edge = Math.min(facingHW(y) - Math.abs(x), y - 0.7)
    let k = 0.94 - 0.04 * fbm(x * 10, y * 10, z * 10, 2)
    if (edge < 0.014) k *= 0.5 // dark piping
    return grey(k)
  }, { envelope: TORSO }, 0.0055)
  const metal = []
  for (const by of [0.755, 0.835, 0.915, 0.992]) {
    const bx = facingHW(by) - 0.026
    for (const s of [1, -1]) {
      const p = surfacePoint(coatBody, [s * bx, by, 1], [0, 0, -1])
      metal.push(ellipsoid(add(p, [0, 0, 0.012]), [0.017, 0.017, 0.011]))
    }
    // Braid loop from button to button, hugging the chest.
    const bar = node((x, y, z) => Math.max(Math.abs(y - by + 0.012 * Math.cos((x / bx) * 1.57)) - 0.0055, Math.abs(x) - bx, -z), [-bx, by - 0.02, 0], [bx, by + 0.02, 0.3])
    metal.push(intersect(0.003, shell(coatBody, 0.012, 0.004, 0.008), bar))
  }
  for (const s of [1, -1]) metal.push(sphere(add(surfacePoint(coatBody, [s * 0.055, 0.745, -1], [0, 0, 1]), [0, 0, -0.008]), 0.016))
  piece('coat_braid', 'metal', union(0.004, ...metal), (x, y, z) => shade(C.gold, 0.9 + 0.15 * noise3(x * 60, y * 60, z * 60)), { envelope: TORSO }, 0.005)
}

// ---- Steel gorget under the collar, gold rim and rivets ----
const gorgetRegion = ellipsoid([0, 1.075, 0.02], [0.19, 0.085, 0.2], euler(0.3, 0, 0))
{
  const plate = subtract(0.01, intersect(0.008, shell(coatBody, 0.009, 0.008, 0.008), gorgetRegion), cylinder([0, 1.12, -0.005], 0.112, 0.12, 0.01))
  const hp = hammered(C.steel)
  piece('gorget', 'metal', plate, (x, y, z) => {
    const e = gorgetRegion.d(x, y, z)
    return e > -0.016 ? shade(C.gold, 0.95) : shade(hp(x, y, z), 0.95)
  }, { rigid: { chest: 1 } }, 0.0055)
  const rivets = []
  for (const a of [-0.9, -0.3, 0.3, 0.9]) {
    const p = surfacePoint(offset(coatBody, 0.017), [Math.sin(a) * 0.115, 1.6, 0.03 + Math.cos(a) * 0.115], [0, -1, -0.25])
    rivets.push(sphere(p, 0.012))
  }
  piece('gorget_rivets', 'metal', union(0, ...rivets), flat(C.gold), { rigid: { chest: 1 } }, 0.004)
}

// ---- High standing collar, open in a V at the throat, braided top edge ----
{
  const topAt = (z) => 1.17 + 0.06 * sstep(0.06, -0.1, z)
  const collar = node((x, y, z) => {
    const t = (y - 1.04) / 0.16
    const R = 0.12 + 0.024 * t
    const r = Math.hypot(x, z + 0.005)
    const open = Math.min(0.012 + 0.11 * Math.max(0, t - 0.15) - Math.abs(x), z)
    return smax(Math.max(Math.abs(r - R) - 0.011, 1.04 - y, open), y - topAt(z), 0.008)
  }, [-0.18, 1.03, -0.18], [0.18, 1.25, 0.18])
  piece('collar', 'soft', collar, (x, y, z) => {
    const inside = Math.hypot(x, z + 0.005) < 0.12 + 0.024 * ((y - 1.04) / 0.16)
    if (y > topAt(z) - 0.017 && !inside) return shade(C.braid, 0.92)
    return inside ? shade(C.coatDark, 0.9) : cloth(C.coat, 1.05)(x, y, z)
  }, { rigid: { chest: 1 } }, 0.007)
}

// ---- Left pauldron: three overlapping lames, gold edges, rivets (the right shoulder takes the musket butt) ----
{
  const { s } = LIMB.L
  // Articulated: the top lame stays on the shoulder, the lower ones follow the arm out from under it.
  const wTop = { upperarm_L: 0.2, chest: 0.8 }, w = { upperarm_L: 0.85, chest: 0.15 }
  const c1 = [s * 0.36, 1.068, 0]
  const dome1 = ellipsoid(c1, [0.132, 0.086, 0.14], euler(0, 0, -s * 0.42))
  const c2 = [s * 0.428, 0.995, 0], R2 = euler(0, 0, -s * 0.8)
  const dome2 = ellipsoid(c2, [0.114, 0.064, 0.129], R2)
  const c3 = [s * 0.46, 0.93, 0.003], R3 = euler(0, 0, -s * 1.02)
  const dome3 = ellipsoid(c3, [0.1, 0.052, 0.115], R3)
  const hollow = ellipsoid([s * 0.335, 0.9, 0], [0.15, 0.14, 0.128])
  const hp = hammered(C.steel)
  const lamePaint = (dome) => (x, y, z) => {
    const rim = sstep(0.022, 0.012, hollowEdge(dome, x, y, z))
    return mix(shade(hp(x, y, z), 0.9 + 0.2 * sstep(0.9, 1.18, y)), C.gold, rim)
  }
  // Distance from the cut edge of a lame (where the hollow bites the dome).
  const hollowEdge = (dome, x, y, z) => Math.abs(hollow.d(x, y, z) - 0.006)
  piece('pauldron_top', 'metal', subtract(0.008, dome1, hollow), lamePaint(dome1), { rigid: wTop }, 0.0075)
  piece('pauldron_mid', 'metal', subtract(0.008, subtract(0.006, dome2, hollow), offset(dome1, -0.004)), lamePaint(dome2), { rigid: w }, 0.0075)
  piece('pauldron_low', 'metal', subtract(0.008, subtract(0.006, dome3, offset(hollow, 0.012)), offset(dome2, -0.004)), lamePaint(dome3), { rigid: { upperarm_L: 1 } })
  // Raised crest ridge over the top lame + rivets on the lower rims.
  const ridge = intersect(0.004, offset(dome1, 0.01), roundBox(c1, [0.3, 0.3, 0.012], 0.008))
  const studs = []
  for (const a of [-0.95, -0.35, 0.35, 0.95]) {
    const l = [s * Math.cos(a) * 0.85, -0.35, Math.sin(a)]
    const dir = norm([R2[0] * l[0] + R2[1] * l[1] + R2[2] * l[2], R2[3] * l[0] + R2[4] * l[1] + R2[5] * l[2], R2[6] * l[0] + R2[7] * l[1] + R2[8] * l[2]])
    studs.push(sphere(surfacePoint(dome2, add(c2, scale(dir, 0.5)), scale(dir, -1)), 0.013))
  }
  piece('pauldron_ridge', 'metal', subtract(0.004, ridge, hollow), flat(C.gold), { rigid: wTop }, 0.005)
  piece('pauldron_studs', 'metal', union(0, ...studs), flat(C.gold), { rigid: w }, 0.004)
}
// Right shoulder: a braided roll over the sleeve seam.
{
  const { s, S } = LIMB.R
  const n = norm([s, 0.45, 0])
  const wing = torus(add(S, scale(n, -0.012)), 0.1, 0.027, frameY(n))
  const wc = add(S, scale(n, -0.012))
  piece('shoulder_wing', 'soft', wing, (x, y, z) => {
    const q = sub([x, y, z], wc)
    const along = dot(q, n), radial = Math.hypot(q[0] - n[0] * along, q[1] - n[1] * along, q[2] - n[2] * along)
    return Math.abs(along) < 0.007 && radial > 0.1 ? shade(C.braid, 0.95) : cloth(C.coatDark, 1.25)(x, y, z)
  }, { rigid: { upperarm_R: 0.45, chest: 0.55 } }, 0.0055)
}
// Slashed upper sleeves: team lining showing through four cuts.
for (const [side, { s, S, E }] of Object.entries(LIMB)) {
  const A = norm(sub(E, S))
  const e1 = norm(sub([s, 0, 0], scale(A, A[0] * s))), e2 = cross(A, e1)
  const mid = lerp3(S, E, side === 'L' ? 0.66 : 0.56)
  const cuts = [-1.3, -0.65, 0, 0.65, 1.3].map((a) => {
    const radial = add(scale(e1, Math.cos(a)), scale(e2, Math.sin(a)))
    return ellipsoid(add(mid, scale(radial, 0.084)), [0.013, side === 'L' ? 0.05 : 0.075, 0.0085], basis(radial, A, cross(radial, A)))
  })
  piece(`sleeve_slash_${side}`, 'team', union(0, ...cuts), () => grey(0.88), { envelope: [`upperarm_${side}`, `forearm_${side}`] }, 0.004)
}

// ---- Bandolier: right shoulder to left hip, with a buckle and hanging powder charges ----
const BANDO = { p: [0, 0.875, 0], n: norm([0.716, 0.698, 0]) }
{
  const strap = intersect(0.006, wrap(coatBody, 0.019, 0.006, BANDO.p, BANDO.n, 0.033, 0.008), halfspace([0, 0.648, 0], [0, -1, 0]))
  piece('bandolier', 'soft', strap, (x, y, z) => {
    const across = Math.abs(dot(sub([x, y, z], BANDO.p), BANDO.n))
    return shade(C.leather, (0.82 + 0.3 * fbm(x * 30, y * 30, z * 30, 3)) * (across > 0.024 ? 0.62 : 1))
  }, { envelope: TORSO }, 0.007)
  // Strap line on the front of the chest: y = 0.875 - 1.026 x.
  const lineY = (x) => 0.875 - (BANDO.n[0] / BANDO.n[1]) * x
  const strapSurf = offset(coatBody, 0.025)
  // Buckle high on the right chest.
  {
    const bx = -0.125
    const p = surfacePoint(strapSurf, [bx, lineY(bx), 1], [0, 0, -1])
    const R = euler(0, 0, 0.78)
    const c = add(p, [0, 0, 0.006])
    const frame = subtract(0.003, roundBox(c, [0.044, 0.03, 0.01], 0.008, R), roundBox(c, [0.027, 0.014, 0.03], 0.005, R))
    piece('bandolier_buckle', 'metal', union(0.004, frame, capsule(add(c, [-0.018, -0.018, 0.006]), add(c, [0.012, 0.012, 0.006]), 0.005)), flat(C.gold), { envelope: TORSO }, 0.004)
  }
  // Powder charges ("apostles"): turned wooden bottles on cords below the strap.
  const xs = [-0.045, 0.01, 0.065, 0.12, 0.172]
  const tops = xs.map((x) => lineY(x) - 0.052)
  const bottles = [], cords = []
  xs.forEach((x, i) => {
    const top = tops[i], len = 0.072
    const p = surfacePoint(coatBody, [x, top - len / 2, 1], [0, 0, -1])
    const z = p[2] + 0.027
    bottles.push(union(0.006, capsule([x, top - 0.012, z], [x, top - len, z], 0.0165, 0.019), cylinder([x, top, z], 0.014, 0.012, 0.004)))
    cords.push(capsule([x, top + 0.05, z - 0.006], [x, top, z], 0.0045))
  })
  const nearest = (x) => { let b = 0; for (let i = 1; i < xs.length; i++) if (Math.abs(x - xs[i]) < Math.abs(x - xs[b])) b = i; return b }
  piece('charges', 'soft', union(0, ...bottles), (x, y, z) => {
    const top = tops[nearest(x)]
    if (y > top - 0.016) return shade(C.leatherDark, 0.9)
    const ring = Math.abs(y - (top - 0.045)) < 0.004 ? 0.7 : 1
    return shade(C.charge, ring * (0.85 + 0.25 * fbm(x * 40, y * 140, z * 40, 2)))
  }, { envelope: TORSO }, 0.0055)
  piece('charge_cords', 'soft', union(0, ...cords), flat(shade(C.leatherDark, 0.8)), { envelope: TORSO }, 0.004)
}

// ---- Coat skirts: a flared, folded shell from the waist, split front and back ----
const SK = { top: 0.7, th: 0.009 }
function skirtAt(x, y, z) {
  const u = Math.max(0, SK.top - y)
  const cz = -0.008 - 0.04 * u
  const phi = Math.atan2(x, z - cz) // 0 = front, +-PI = back, + = her left
  const fold = 1 + 0.05 * Math.min(1, u * 5) * Math.sin(phi * 10)
  const a = (0.188 + 0.36 * u) * fold, b = (0.146 + 0.31 * u) * fold
  const qx = x / a, qz = (z - cz) / b
  const k0 = Math.hypot(qx, qz), k1 = Math.hypot(qx / a, qz / b)
  const ell = k1 === 0 ? -a : (k0 * (k0 - 1)) / k1
  const hem = 0.368 - 0.06 * Math.max(0, -Math.cos(phi)) + 0.012 * Math.sin(phi * 10 + 1.2)
  const wf = 0.014 + 0.3 * Math.max(0, u - 0.05) // half width of the front opening
  const wb = 0.004 + 0.07 * Math.max(0, u - 0.12) // back vent
  return { u, cz, phi, ell, hem, wf, wb }
}
/** A point on (or `out` beyond) the unfolded skirt at ellipse angle t and height y. */
function skirtPoint(t, y, out = 0) {
  const u = SK.top - y, cz = -0.008 - 0.04 * u
  const a = 0.188 + 0.36 * u, b = 0.146 + 0.31 * u
  const n = norm([Math.sin(t) / a, 0, Math.cos(t) / b])
  return { p: [a * Math.sin(t) + n[0] * out, y, cz + b * Math.cos(t) + n[2] * out], n }
}
/** Skirts hang from the hips, are pushed by the thighs, and the back trails on the cape chain. */
const skirtSkin = (x, y, z) => {
  const t = sstep(0.66, 0.4, y)
  const left = sstep(-0.05, 0.05, x)
  const back = sstep(0.03, -0.12, z)
  const th = (0.5 - 0.2 * back) * t
  const cape = 0.3 * t * back * (1 - Math.min(1, Math.abs(x) / 0.34))
  return { hips: 1 - th - cape, thigh_L: th * left, thigh_R: th * (1 - left), cape_3: cape }
}
{
  const skirt = node((x, y, z) => {
    const k = skirtAt(x, y, z)
    return Math.max(Math.abs(k.ell) - SK.th, k.hem - y, y - SK.top, Math.min(k.wf - Math.abs(x), z - k.cz), Math.min(k.wb - Math.abs(x), k.cz - z))
  }, [-0.36, 0.28, -0.34], [0.36, 0.71, 0.3])
  const coatCloth = cloth(C.coat)
  piece('coat_skirt', 'soft', skirt, (x, y, z) => {
    const k = skirtAt(x, y, z)
    if (k.ell < 0) return shade(C.coatDark, 0.75) // lining
    const above = y - k.hem
    if (above > 0.022 && above < 0.036) return shade(C.braid, 0.85) // braid above the hem
    const f = 0.9 + 0.1 * Math.sin(k.phi * 10)
    return shade(coatCloth(x, y, z), f * (above < 0.022 ? 0.65 : 1) * (0.82 + 0.2 * sstep(0.3, 0.7, y)))
  }, { fn: skirtSkin }, 0.008)
  // Team turnbacks: the front corners folded back and buttoned.
  const tbOuter = (k) => k.wf + 0.026 + 0.27 * Math.max(0, k.u - 0.1)
  const turnback = node((x, y, z) => {
    const k = skirtAt(x, y, z)
    const ax = Math.abs(x)
    return Math.max(k.ell - 0.018, 0.006 - k.ell, k.hem - 0.004 - y, y - 0.61, k.wf - 0.006 - ax, ax - tbOuter(k), k.cz - z)
  }, [-0.26, 0.3, 0.02], [0.26, 0.62, 0.3])
  piece('skirt_turnback', 'team', turnback, (x, y, z) => {
    const k = skirtAt(x, y, z)
    const edge = Math.min(tbOuter(k) - Math.abs(x), y - k.hem + 0.004)
    return grey((edge < 0.013 ? 0.5 : 0.92) - 0.04 * fbm(x * 10, y * 10, z * 10, 2))
  }, { fn: skirtSkin }, 0.0055)
  const btn = []
  for (const s of [1, -1]) for (const [bx, by] of [[0.163, 0.4], [0.1, 0.52]]) {
    const p = surfacePoint(turnback, [s * bx, by, 0.6], [0, 0, -1])
    btn.push(ellipsoid(add(p, [0, 0, 0.004]), [0.016, 0.016, 0.01]))
  }
  piece('skirt_buttons', 'metal', union(0, ...btn), flat(C.gold), { fn: skirtSkin }, 0.004)
}

// ---- Waist: team sash with a knot and hanging tails, sword belt and buckle over it ----
{
  piece('sash', 'team', wrap(coatBody, 0.014, 0.009, [0, 0.672, 0], [0, 1, 0], 0.047), (x, y, z) => {
    const k = 0.92 - 0.1 * fbm(x * 9, y * 40, z * 9, 2) 
    return grey(k)
  }, { envelope: ['hips', 'spine'] })
  // Knot on the left hip and two tails lying on the skirt.
  const knotAt = skirtPoint(0.72, 0.662, 0.03).p
  const tails = node((x, y, z) => {
    const k = skirtAt(x, y, z)
    const v = 0.665 - y
    const strip = (pc, hw, len) => Math.max(Math.abs(k.phi - pc) * 0.24 - hw, v - len + 0.018 * Math.sin(k.phi * 40), -v)
    const s1 = strip(0.6 + 0.25 * v, 0.026 + 0.04 * v, 0.245)
    const s2 = strip(0.86 + 1.0 * v, 0.024 + 0.04 * v, 0.19)
    return Math.max(k.ell - 0.0255, 0.015 - k.ell, Math.min(s1, s2), -x)
  }, [0.02, 0.4, -0.12], [0.36, 0.67, 0.3])
  const sashSkin = (x, y, z) => skirtSkin(x, Math.max(y, 0.5), z)
  piece('sash_tails', 'team', union(0.012, tails, ellipsoid(knotAt, [0.04, 0.034, 0.03])), (x, y, z) => {
    const v = 0.665 - y
    let k = 0.88 - 0.04 * fbm(x * 10, y * 10, z * 10, 2)
    if (v > 0.15 && Math.sin(Math.atan2(x, z) * 40) > 0.2 && v > 0.17) k *= 0.6 // fringe
    return grey(k)
  }, { fn: sashSkin }, 0.0055)
  // Leather belt riding low on the left, where the flask hangs.
  const beltN = [0.14, 1, 0], beltP = [0, 0.668, 0]
  piece('belt', 'soft', wrap(coatBody, 0.028, 0.006, beltP, beltN, 0.021, 0.02),
    (x, y, z) => shade(C.leatherDark, (1 + 0.5 * sstep(0.012, 0.017, Math.abs(dot(sub([x, y, z], beltP), norm(beltN))))) * (0.85 + 0.3 * fbm(x * 50, y * 50, z * 50, 3))), { envelope: ['hips', 'spine'] })
  const front = surfacePoint(offset(coatBody, 0.034), [0, 0.668, 1], [0, 0, -1])
  const c = add(front, [0, 0, 0.006])
  const frame = subtract(0.004, roundBox(c, [0.05, 0.04, 0.013], 0.011), roundBox(c, [0.028, 0.02, 0.04], 0.007))
  piece('buckle', 'metal', union(0.005, frame, capsule(add(c, [-0.026, 0, 0.01]), add(c, [0.012, 0, 0.01]), 0.007)), flat(C.gold), { rigid: { hips: 1 } }, 0.0045)
}

// ---- Powder flask (left hip) and cartridge pouch (right hip, behind the butt of the gun) ----
{
  const { p, n } = skirtPoint(1.75, 0.53, 0.05)
  const R = euler(0, Math.atan2(-n[2], n[0]), 0) // local X = outward
  const loc = (sdf) => place(sdf, p, R)
  const bodyF = union(0.02, ellipsoid([0, -0.012, 0], [0.03, 0.062, 0.052]), capsule([0, 0.03, 0], [0, 0.075, 0.012], 0.022, 0.014))
  const w = skirtSkin(p[0], 0.56, p[2])
  piece('flask', 'soft', loc(bodyF), (x, y, z) => shade(mix(C.bootLight, C.leatherDark, sstep(0.5, 0.58, y) * 0.5 + 0.5 * fbm(x * 30, y * 30, z * 30, 3)), 1.05), { rigid: w, occluder: 'flask' }, 0.005)
  piece('flask_brass', 'metal', loc(union(0.004,
    capsule([0, 0.078, 0.013], [0, 0.105, 0.02], 0.012, 0.008), torus([0, 0.05, 0.005], 0.02, 0.006),
    band(ellipsoid([0, -0.012, 0], [0.03, 0.062, 0.052]), 0.003, 0.004, [0, -0.012, 0], [0, 0, 1], 0.006))), flat(C.goldDeep), { rigid: w, occluder: 'flask' }, 0.004)
  const hang = add(p, [0, 0.105, 0])
  const beltPt = surfacePoint(offset(coatBody, 0.032), [0.6, 0.645, -0.03], [-1, 0, 0])
  piece('flask_cord', 'soft', capsule(add(hang, [0, -0.02, 0]), beltPt, 0.006), flat(C.leatherDark), { rigid: { hips: 1 }, occluder: 'flask' }, 0.004)
}
{
  const { p, n } = skirtPoint(-2.45, 0.575, 0.04)
  const R = euler(0, Math.atan2(-n[2], n[0]), 0)
  const loc = (sdf) => place(sdf, p, R)
  const w = skirtSkin(p[0], 0.6, p[2])
  const box = union(0.01, roundBox([0, 0, 0], [0.03, 0.052, 0.058], 0.016), roundBox([0.008, 0.022, 0], [0.03, 0.034, 0.062], 0.014))
  piece('pouch', 'soft', loc(box), (x, y, z) => shade(y > p[1] - 0.012 ? C.leather : C.leatherDark, 0.85 + 0.3 * fbm(x * 45, y * 45, z * 45, 3)), { rigid: w, occluder: 'pouch' }, 0.005)
  piece('pouch_stud', 'metal', loc(sphere([0.04, -0.004, 0], 0.011)), flat(C.gold), { rigid: w, occluder: 'pouch' }, 0.004)
}

// ---- Cuffs and gauntlets ----
const GUN = (() => {
  const g = add(LIMB.R.W, [0.02, 0.02, 0.02]) // grip at the right fist
  const d = norm([0.25, -0.55, 0.8]) // barrel direction in the bind pose
  const u = norm(sub([0, 1, 0], scale(d, d[1]))) // top of the gun (animations use world up as upRest)
  const r = cross(d, u) // lock side (her right)
  return { g, d, u, r, R: basis(r, d, u) }
})()
for (const [side, { s, E, W, F }] of Object.entries(LIMB)) {
  const dir = norm(sub(W, E))
  const up = (t) => sub(W, scale(dir, t)) // t = distance up the forearm from the wrist
  const fore = { rigid: { [`forearm_${side}`]: 1 } }
  // Deep turned-back team cuff with two gold buttons.
  const cuff = intersect(0.006, shell(capsule(E, up(0.07), 0.083, 0.076), 0.008, 0.007),
    intersect(0, halfspace(up(0.165), scale(dir, -1)), halfspace(up(0.088), dir)))
  piece(`cuff_${side}`, 'team', cuff, (x, y, z) => {
    const t = dot(sub(W, [x, y, z]), dir)
    return grey(t > 0.15 ? 0.5 : 0.9)
  }, fore)
  const out = [s, 0.25, 0]
  const cb = [0.115, 0.14].map((t) => sphere(surfacePoint(cuff, add(up(t), scale(out, 0.3)), scale(out, -1)), 0.013))
  piece(`cuff_buttons_${side}`, 'metal', union(0, ...cb), flat(C.gold), fore, 0.004)
  // Long leather gauntlet: flared cuff over the sleeve, stitched rim.
  const flare = intersect(0.005, capsule(up(0.14), up(-0.01), 0.103, 0.064), intersect(0, halfspace(up(0.1), scale(dir, -1)), halfspace(up(0), dir)))
  piece(`gauntlet_${side}`, 'soft', flare, (x, y, z) => {
    const t = dot(sub(W, [x, y, z]), dir)
    const rim = t > 0.084 ? 1.45 : 1
    return shade(C.leather, rim * (0.78 + 0.3 * fbm(x * 45, y * 45, z * 45, 3)) * (0.92 + 0.08 * Math.sin(t * 260)))
  }, fore)
  // Hands. The right fist is modelled closed around the wrist of the stock.
  const glovePaint = (x, y, z) => shade(C.leatherDark, 1.15 * (0.8 + 0.35 * fbm(x * 50, y * 50, z * 50, 3)))
  if (side === 'R') {
    const { g, d, u, r, R } = GUN
    const c = add(g, add(scale(u, -0.012), add(scale(r, 0.004), scale(d, -0.008))))
    const fist = union(0.02, roundBox(c, [0.05, 0.046, 0.058], 0.036, R),
      capsule(add(g, add(scale(u, 0.03), scale(d, -0.03))), add(g, add(scale(u, 0.034), scale(d, 0.035))), 0.021, 0.018), // thumb over the top
      sphere(lerp3(W, g, 0.3), 0.056))
    const knuckles = [-0.03, -0.01, 0.01, 0.03].map((t) => sphere(add(c, add(scale(d, t), add(scale(r, 0.046), scale(u, -0.016)))), 0.017))
    let hand = union(0.008, fist, ...knuckles)
    for (const t of [-0.02, 0, 0.02]) hand = subtract(0.004, hand, roundBox(add(c, add(scale(d, t), add(scale(r, 0.056), scale(u, -0.02)))), [0.022, 0.0045, 0.05], 0.002, R))
    piece('glove_R', 'soft', hand, glovePaint, { rigid: { hand_R: 1 }, occluder: 'hand' }, 0.005)
  } else {
    const hdir = norm(sub(F, W))
    const fistC = add(W, scale(hdir, 0.07))
    const fist = union(0.02, roundBox(fistC, [0.058, 0.07, 0.066], 0.04, frameY(hdir)),
      capsule(add(fistC, [-s * 0.045, 0.02, 0.045]), add(fistC, [-s * 0.03, -0.035, 0.068]), 0.025, 0.021), sphere(W, 0.058))
    const knuckles = [-0.036, -0.012, 0.012, 0.036].map((t) => sphere(add(fistC, [s * 0.05, -0.02, t + 0.004]), 0.018))
    let hand = union(0.008, fist, ...knuckles)
    for (const t of [-0.024, 0, 0.024]) hand = subtract(0.004, hand, roundBox(add(fistC, [s * 0.06, -0.025, t + 0.004]), [0.022, 0.055, 0.0045], 0.002))
    piece('glove_L', 'soft', hand, glovePaint, { rigid: { hand_L: 1 }, occluder: 'hand' }, 0.005)
  }
}

// ---- Tall bucket-top boots with heels and spurs ----
for (const [side, { s, K, A }] of Object.entries(LIMB)) {
  const x = s * 0.16
  const shin = { rigid: { [`shin_${side}`]: 1 }, occluder: 'shaft' }, foot = { rigid: { [`foot_${side}`]: 1 }, occluder: 'foot' }
  const bootPaint = (px, py, pz) => shade(C.boot, (0.8 + 0.32 * fbm(px * 18, py * 18, pz * 18, 3)) * (0.85 + 0.2 * sstep(0.02, 0.3, py))* 1)
  piece(`boot_shaft_${side}`, 'soft', union(0.02, capsule([x, 0.335, 0.008], [x, 0.2, 0.0], 0.09, 0.08), capsule([x, 0.2, 0], [x, 0.1, 0], 0.08, 0.073)), bootPaint, shin, 0.009)
  // Bucket top: a flared cup around the knee, folded lip.
  const cupOuter = intersect(0.006, capsule([x, 0.29, 0.008], [x, 0.44, 0.008], 0.09, 0.136), intersect(0, halfspace([0, 0.405, 0], [0, 1, 0]), halfspace([0, 0.3, 0], [0, -1, 0])))
  const cup = subtract(0.006, cupOuter, capsule([x, 0.345, 0.008], [x, 0.5, 0.008], 0.088, 0.14))
  piece(`boot_cuff_${side}`, 'soft', cup, (px, py, pz) => {
    const inside = Math.hypot(px - x, pz - 0.008) < 0.09 + (py - 0.29) * 0.3
    if (inside) return shade(C.bootLight, 0.8)
    const lip = py > 0.385 ? 1.5 : 1
    return shade(C.boot, lip * (0.85 + 0.3 * fbm(px * 40, py * 40, pz * 40, 3)))
  }, shin, 0.0065)
  const shoe = union(0.03, roundBox([x, 0.06, 0.045], [0.078, 0.058, 0.125], 0.045), ellipsoid([x, 0.052, 0.15], [0.079, 0.052, 0.08]), sphere(A, 0.08))
  const heel = roundBox([x, 0.04, -0.062], [0.062, 0.04, 0.045], 0.014)
  const bootFoot = intersect(0.006, union(0.015, shoe, heel), halfspace([0, 0.002, 0], [0, -1, 0]))
  piece(`boot_foot_${side}`, 'soft', bootFoot, (px, py, pz) => (py < 0.022 ? shade(C.leatherDark, 0.55) : bootPaint(px, py, pz)), foot, 0.008)
  // Spur: strap over the instep, steel heel band and neck, gold rowel.
  const strapN = norm([0, 0.75, 1])
  piece(`spur_strap_${side}`, 'soft', band(shoe, 0.004, 0.005, [x, 0.1, 0.03], strapN, 0.015), flat(shade(C.leatherDark, 0.9)), foot, 0.005)
  const sp = surfacePoint(shoe, [x + s * 0.3, 0.092, 0.045], [-s, 0, 0])
  const spurMetal = union(0.004,
    intersect(0.003, torus([x, 0.075, -0.045], 0.07, 0.008), halfspace([0, 0, -0.03], [0, 0, 1])),
    capsule([x, 0.075, -0.112], [x, 0.092, -0.165], 0.009, 0.006),
    star([x, 0.094, -0.185], 0.032, 0.5, 0.0045, euler(0, Math.PI / 2, 0)),
    roundBox(add(sp, [s * 0.004, 0, 0]), [0.006, 0.016, 0.016], 0.004))
  piece(`spur_${side}`, 'metal', spurMetal, (px, py, pz) => (pz < -0.15 || pz > 0 ? C.gold : shade(C.steel, 0.9)), foot, 0.004)
  void K
}

// ---- Head: weathered face, brow and nose as forms, eyes sunk in shadow ----
const HEAD = [0, 1.35, 0.015]
const skull = ellipsoid(HEAD, [0.128, 0.145, 0.135])
const faceForm = union(0.025, skull,
  capsule([-0.072, 1.4, 0.118], [0.072, 1.4, 0.118], 0.024), // brow ridge
  capsule([0, 1.392, 0.142], [0, 1.332, 0.172], 0.016, 0.022), // nose
  ellipsoid([0.072, 1.325, 0.1], [0.04, 0.034, 0.032]), ellipsoid([-0.072, 1.325, 0.1], [0.04, 0.034, 0.032]), // cheekbones
  ellipsoid([0, 1.258, 0.08], [0.072, 0.048, 0.062])) // jaw
{
  let face = faceForm
  for (const s of [1, -1]) face = subtract(0.014, face, sphere([s * 0.052, 1.366, 0.158], 0.03))
  piece('face', 'soft', face, (x, y, z) => {
    const socket = Math.min(Math.hypot(x - 0.052, y - 1.366), Math.hypot(x + 0.052, y - 1.366))
    let c = mix(C.skinDark, C.skin, sstep(0.016, 0.045, socket)) // dark around the eyes
    c = shade(c, 0.5 + 0.5 * sstep(1.415, 1.34, y)) // shadow of the brim
    // Old cut through the left brow and cheek.
    const scar = Math.abs((x - 0.07) + 0.35 * (y - 1.37))
    if (scar < 0.0045 && y > 1.33 && y < 1.415) c = mix(c, hex(0x7a4638), 0.8)
    return shade(c, 0.93 + 0.1 * fbm(x * 50, y * 50, z * 50, 3))
  }, { rigid: { head: 1 } }, 0.0045)
  for (const s of [1, -1]) {
    piece(`eye_${s > 0 ? 'L' : 'R'}`, 'soft', ellipsoid([s * 0.052, 1.366, 0.128], [0.02, 0.0115, 0.012]), flat(C.eye), { rigid: { head: 1 } }, 0.0035)
  }
}

// ---- Scarf: a cloth mask over nose, mouth and jaw, bunched around the neck ----
{
  const maskTop = halfspace([0, 1.352, 0.165], [0, 1, -0.3])
  const wrinkled = node((x, y, z) => faceForm.d(x, y, z) - 0.012 - 0.0025 * Math.sin((y + 0.25 * Math.abs(x)) * 130), faceForm.min.map((v) => v - 0.02), faceForm.max.map((v) => v + 0.02))
  const mask = intersect(0.006, intersect(0.008, wrinkled, maskTop), intersect(0, halfspace([0, 0, -0.045], [0, 0, -1]), halfspace([0, 1.2, 0], [0, -1, 0])))
  const scarfPaint = (x, y, z) => {
    const w = 0.5 + 0.5 * Math.sin((y + 0.25 * Math.abs(x)) * 130)
    return shade(mix(C.scarfDark, C.scarf, 0.35 + 0.65 * w), 0.85 + 0.2 * fbm(x * 30, y * 30, z * 30, 3))
  }
  piece('scarf_mask', 'soft', mask, (x, y, z) => {
    const topEdge = -maskTop.d(x, y, z)
    return shade(scarfPaint(x, y, z), topEdge < 0.012 ? 0.6 : 1) // hemmed top edge
  }, { rigid: { head: 1 } }, 0.005)
  const roll = union(0.02,
    torus([0, 1.195, 0.0], 0.066, 0.04), torus([0, 1.24, 0.012], 0.068, 0.034, euler(0.2, 0, 0.08)),
    ellipsoid([0.02, 1.2, 0.09], [0.06, 0.04, 0.04], euler(0, 0, 0.3)))
  piece('scarf_wrap', 'soft', roll, (x, y, z) => {
    const w = 0.5 + 0.5 * Math.sin(y * 150 + Math.atan2(x, z) * 3)
    return shade(mix(C.scarfDark, C.scarf, 0.3 + 0.7 * w), 0.85 + 0.2 * fbm(x * 30, y * 30, z * 30, 3))
  }, { rigid: { neck: 0.6, head: 0.4 }, occluder: 'scarf' }, 0.008)
}

// ---- Hair: swept back under the hat, tied in a queue with a team ribbon ----
{
  const cap = intersect(0.008, offset(skull, 0.014), intersect(0, halfspace([0, 1.35, 0.03], [0, -0.3, 1]), halfspace([0, 1.232, 0], [0, -1, 0])))
  const locks = [1, -1].map((s) => capsule([s * 0.124, 1.41, 0.0], [s * 0.122, 1.262, 0.012], 0.024, 0.015))
  const hairPaint = (x, y, z) => shade(mix(C.hair, C.hairLight, 0.5 + 0.5 * Math.sin(x * 110 + 4 * noise3(x * 12, y * 30, z * 12))), 0.88 + 0.16 * fbm(x * 14, y * 14, z * 14, 2))
  piece('hair', 'soft', union(0.012, cap, ...locks), hairPaint, { rigid: { head: 1 } }, 0.0075)
  const queue = bezierTube([0, 1.27, -0.125], [0, 1.215, -0.225], [0.012, 1.08, -0.205], [0.02, 0.9, -0.218], 0.042, 0.02, 12, 0.015)
  const hairSkin = (x, y, z) => { const t = sstep(1.24, 1.02, y); return { head: 1 - t, chest: t } }
  piece('hair_queue', 'soft', queue, (x, y, z) => {
    const t = queue.param(x, y, z)
    return shade(mix(C.hair, C.hairLight, 0.5 + 0.5 * Math.sin(t * 70 + Math.atan2(x, z + 0.2) * 2)), 0.9)
  }, { fn: hairSkin }, 0.005)
  const bow = union(0.012, ellipsoid([0.042, 1.212, -0.212], [0.042, 0.022, 0.016], euler(0, 0, 0.35)), ellipsoid([-0.042, 1.212, -0.212], [0.042, 0.022, 0.016], euler(0, 0, -0.35)),
    sphere([0, 1.21, -0.215], 0.02), capsule([0.01, 1.2, -0.222], [0.035, 1.12, -0.225], 0.012, 0.009), capsule([-0.01, 1.2, -0.222], [-0.03, 1.13, -0.225], 0.012, 0.009))
  piece('hair_ribbon', 'team', bow, () => grey(0.8), { fn: hairSkin }, 0.0045)
}

// ---- Cavalier hat: wide felt brim, right side pinned up, crown, band, brooch, plume ----
const HB = { c: [0, 1.44, 0.015], xf: 0.142, rho: 0.03, th: 1.2 }
/** World -> flat-brim coordinates: undoes the fold that pins the right brim up. */
function brimUnfold(x, y, z) {
  let qx = x - HB.c[0], qy = y - HB.c[1]
  const qz = z - HB.c[2]
  const a = -qx - HB.xf
  if (a > 0) {
    const phi = Math.atan2(a, HB.rho - qy)
    let a2, y2
    if (phi <= HB.th) { a2 = HB.rho * phi; y2 = HB.rho - Math.hypot(a, HB.rho - qy) }
    else {
      const cs = Math.cos(HB.th), sn = Math.sin(HB.th), yy = qy - HB.rho
      a2 = HB.rho * HB.th + a * cs + yy * sn; y2 = -a * sn + yy * cs + HB.rho
    }
    qx = -HB.xf - a2; qy = y2
  }
  return [qx, qy, qz]
}
/** Flat-brim coordinates (L beyond the fold line, height yu, z) -> world, on the pinned flap. */
function flapPoint(L, yu, zu) {
  const s = L - HB.rho * HB.th, cs = Math.cos(HB.th), sn = Math.sin(HB.th), yv = yu - HB.rho
  const a = s * cs - yv * sn + 0, qy = s * sn + yv * cs + HB.rho
  // (s, yv) is measured from the end of the bend arc, whose centre is (0, rho).
  return [HB.c[0] - HB.xf - a, HB.c[1] + qy, HB.c[2] + zu]
}
function brimAt(x, y, z) {
  const [qx, qy, qz] = brimUnfold(x, y, z)
  const r = Math.hypot(qx, qz), phi = Math.atan2(qx, qz)
  const cf = Math.max(0, Math.cos(phi)), cb = Math.max(0, -Math.cos(phi))
  const s2 = sstep(0.13, 0.33, r)
  const h = s2 * (-0.042 * cf * cf - 0.022 * cb * cb + 0.022 * Math.max(0, Math.sin(phi))) + 0.008 * s2 * Math.sin(3 * phi + 0.7)
  const R = 0.305 + 0.03 * cf * cf + 0.012 * cb
  return { r, R, v: qy - h }
}
const crownR = euler(-0.05, 0, 0.04)
const crown = union(0.03,
  place(cylinder([0, 0.07, 0], 0.128, 0.075, 0.02), HB.c, crownR),
  place(ellipsoid([0, 0.135, 0], [0.122, 0.045, 0.122]), HB.c, crownR))
{
  const brim = node((x, y, z) => {
    const k = brimAt(x, y, z)
    return smax(Math.abs(k.v) - 0.008, k.r - k.R, 0.008)
  }, [-0.37, 1.37, -0.34], [0.37, 1.64, 0.38])
  const felt = cloth(C.felt)
  piece('hat_brim', 'soft', brim, (x, y, z) => {
    const k = brimAt(x, y, z)
    if (k.R - k.r < 0.016) return shade(C.braid, 0.78) // braided edge
    return shade(felt(x, y, z), k.v < 0 ? 0.6 : 1) // underside in shadow
  }, { rigid: { head: 1 } }, 0.007)
  // A shallow pinch across the top of the crown.
  const crownCut = subtract(0.02, crown, place(ellipsoid([0, 0.2, 0.01], [0.03, 0.04, 0.1]), HB.c, crownR))
  piece('hat_crown', 'soft', crownCut, (x, y, z) => shade(felt(x, y, z), 0.9 + 0.2 * sstep(1.45, 1.62, y)), { rigid: { head: 1 } }, 0.008)
  piece('hat_band', 'team', wrap(crown, 0.005, 0.006, [0, 1.472, 0.015], [0.04, 1, 0.05], 0.017),
    () => grey(0.62), { rigid: { head: 1 } }, 0.005)
  const bp = surfacePoint(offset(crown, 0.012), [0.07, 1.474, 0.6], [0, 0, -1])
  piece('hat_buckle', 'metal', subtract(0.003, roundBox(bp, [0.03, 0.024, 0.008], 0.006, euler(0, 0.45, 0)), roundBox(bp, [0.017, 0.012, 0.03], 0.004, euler(0, 0.45, 0))), flat(C.gold), { rigid: { head: 1 } }, 0.004)
  // Brooch pinning the flap: a gold boss on the outside of the folded brim.
  const bc = flapPoint(0.095, -0.012, 0.03)
  const outward = norm(sub(flapPoint(0.095, -0.05, 0.03), bc))
  piece('hat_brooch', 'metal', union(0.004,
    ellipsoid(bc, [0.012, 0.032, 0.032], frameY([0, 1, 0], outward)),
    sphere(add(bc, scale(outward, 0.012)), 0.014)), (x, y, z) => (dot(sub([x, y, z], bc), outward) > 0.012 ? C.gold : C.goldDeep), { rigid: { head: 1 } }, 0.004)

  // Long plume from the brooch, arcing up and back over the crown: overlapping flattened fronds.
  const p0 = add(bc, scale(outward, 0.01)), p1 = [-0.31, 1.72, -0.02], p2 = [-0.23, 1.84, -0.32], p3 = [0.0, 1.63, -0.5]
  const bez = (t) => { const k = 1 - t; return [0, 1, 2].map((i) => k * k * k * p0[i] + 3 * k * k * t * p1[i] + 3 * k * t * t * p2[i] + t * t * t * p3[i]) }
  // A broad, slightly twisting vane (overlapping flat lobes), notched along both edges.
  const N = 16
  const frame = (t) => {
    const c = bez(t), T = norm(sub(bez(Math.min(1, t + 0.02)), bez(Math.max(0, t - 0.02))))
    const Wd = norm(cross(T, [0, 1, 0])), Nn = cross(Wd, T)
    const tw = 1.0 - 0.8 * t
    const Wv = add(scale(Wd, Math.cos(tw)), scale(Nn, Math.sin(tw)))
    const fat = Math.pow(Math.sin(Math.PI * Math.min(1, 0.08 + t * 0.9)), 0.7)
    return { c, T, Wv, Nv: cross(Wv, T), fat }
  }
  const lobes = []
  for (let i = 0; i <= N; i++) {
    const { c, T, Wv, Nv, fat } = frame(i / N)
    lobes.push(ellipsoid(c, [0.014 + 0.012 * fat, 0.02 + 0.055 * fat, 0.075], basis(Nv, Wv, T)))
  }
  let plume = union(0.035, ...lobes)
  for (let j = 0; j < 9; j++) {
    const { c, T, Wv, Nv, fat } = frame(0.16 + j * 0.085)
    const sg = j % 2 ? 1 : -1
    const thin = norm(add(T, scale(Wv, -0.9 * sg))) // barbs sweep back toward the root
    const longAx = norm(cross(Nv, thin))
    plume = subtract(0.008, plume, roundBox(add(c, scale(Wv, sg * (0.03 + 0.06 * fat))), [0.06, 0.04 + 0.02 * fat, 0.0075], 0.004, basis(Nv, longAx, thin)))
  }
  piece('hat_plume', 'team', plume, (x, y, z) => grey(0.82 + 0.16 * fbm(x * 9, y * 9, z * 9, 2)), { rigid: { head: 1 } }, 0.008)
}

// ---- Flintlock musket, rigid to the right hand ------------------------------
{
  const { g, d, u, r, R } = GUN
  const local = (sdf) => place(sdf, g, R)
  const toLocal = (x, y, z) => { const q = [x - g[0], y - g[1], z - g[2]]; return [dot(q, r), dot(q, d), dot(q, u)] }
  const rigid = { rigid: { hand_R: 1 }, occluder: 'musket' }
  const BZ = 0.011 // barrel axis sits a little above the grip line
  const MUZ = 0.92

  // Barrel: octagonal breech section, round to the muzzle, flared crown, bored out.
  const oct = (y0, y1, ap) => node((x, y, z) => {
    const ax = Math.abs(x), az = Math.abs(z - BZ)
    return smax(Math.max(ax, az, (ax + az) * 0.7071) - ap, Math.max(y0 - y, y - y1), 0.003)
  }, [-ap * 1.1, y0, BZ - ap * 1.1], [ap * 1.1, y1, BZ + ap * 1.1])
  let barrel = union(0.006, oct(0.06, 0.4, 0.0205), capsule([0, 0.38, BZ], [0, MUZ - 0.02, BZ], 0.0185, 0.0165),
    cylinder([0, MUZ - 0.012, BZ], 0.0215, 0.016, 0.005), cylinder([0, 0.4, BZ], 0.0225, 0.007, 0.003))
  barrel = subtract(0.002, barrel, capsule([0, MUZ - 0.03, BZ], [0, MUZ + 0.05, BZ], 0.0105))
  const blued = hammered(C.steelDark, 1.05)
  piece('musket_barrel', 'metal', local(barrel), (x, y, z) => {
    const [lx, ly, lz] = toLocal(x, y, z)
    if (ly > MUZ - 0.006 && Math.hypot(lx, lz - BZ) < 0.012) return [0.03, 0.03, 0.03] // bore
    return shade(blued(x, y, z), 0.9 + 0.25 * sstep(0.3, 0.9, ly))
  }, rigid, 0.005)

  // Stock: butt with a dropped toe, thin wrist, lock swell, long forestock.
  const buttSlab = roundBox([0, -0.17, -0.045], [0.023, 0.115, 0.08], 0.014)
  const butt = intersect(0.012, intersect(0.012, buttSlab, halfspace([0, -0.06, 0.016], [0, -0.1, 1])), halfspace([0, -0.06, -0.034], [0, 0.4, -1]))
  const wrist = capsule([0, -0.085, -0.014], [0, 0.03, -0.006], 0.026, 0.025)
  const swell = roundBox([0, 0.115, -0.011], [0.027, 0.11, 0.03], 0.02)
  const fore = capsule([0, 0.15, -0.013], [0, 0.66, -0.008], 0.026, 0.0195)
  let stock = union(0.02, butt, wrist, swell, fore)
  stock = subtract(0.003, stock, offset(barrel, 0.001))
  piece('musket_stock', 'soft', local(stock), (x, y, z) => {
    const [lx, ly, lz] = toLocal(x, y, z)
    const streak = fbm(lx * 110, ly * 9, lz * 110, 3)
    return shade(mix(C.woodDark, C.wood, 0.25 + 0.75 * streak), 0.95 + 0.12 * noise3(lx * 30, ly * 30, lz * 30))
  }, rigid, 0.0055)

  // Brass furniture: butt plate, trigger guard, three barrel bands, ramrod pipe, side plate.
  const plate = intersect(0.003, offset(butt, 0.004), halfspace([0, -0.268, 0], [0, 1, 0]))
  const wrap = union(0.004, barrel, fore)
  const bands = [0.34, 0.5, 0.645].map((by) => band(wrap, 0.003, 0.0035, [0, by, 0], [0, 1, 0], 0.012))
  const guard = union(0.004,
    intersect(0.003, torus([0, 0.05, -0.036], 0.036, 0.0055, euler(0, 0, Math.PI / 2)), halfspace([0, 0, -0.03], [0, 0, 1])),
    capsule([0, -0.03, -0.04], [0, 0.014, -0.038], 0.0055), capsule([0, 0.086, -0.038], [0, 0.13, -0.04], 0.0055))
  const pipe = cylinder([0, 0.7, -0.033], 0.0105, 0.02, 0.003)
  const sidePlate = roundBox([-0.0265, 0.13, -0.008], [0.004, 0.06, 0.012], 0.004)
  piece('musket_brass', 'metal', local(union(0, plate, guard, pipe, sidePlate, ...bands)), (x, y, z) => shade(C.gold, 0.85 + 0.2 * fbm(x * 30, y * 30, z * 30, 2)), rigid, 0.0045)

  // Flintlock on the right side, just ahead of the gripping hand: lock plate,
  // cock with flint, pan and frizzen, springs, trigger.
  const LX = 0.03, LY = 0.03
  const lockPlate = roundBox([LX, LY + 0.105, -0.004], [0.0055, 0.088, 0.02], 0.005)
  const cock = union(0.006,
    cylinder([LX + 0.009, LY + 0.045, -0.002], 0.016, 0.006, 0.003, euler(0, 0, Math.PI / 2)), // tumbler boss
    capsule([LX + 0.01, LY + 0.045, -0.002], [LX + 0.01, LY + 0.022, 0.036], 0.0095, 0.008), // neck, leaning back
    capsule([LX + 0.01, LY + 0.022, 0.036], [LX + 0.01, LY + 0.05, 0.058], 0.008, 0.007), // gooseneck forward
    roundBox([LX + 0.01, LY + 0.062, 0.06], [0.0085, 0.02, 0.006], 0.003), roundBox([LX + 0.01, LY + 0.062, 0.073], [0.0085, 0.017, 0.004], 0.002), // jaws
    capsule([LX + 0.01, LY + 0.052, 0.07], [LX + 0.01, LY + 0.052, 0.09], 0.005), sphere([LX + 0.01, LY + 0.052, 0.092], 0.0075)) // jaw screw
  const pan = roundBox([LX + 0.008, LY + 0.132, 0.012], [0.012, 0.02, 0.007], 0.004)
  const frizzen = union(0.004, roundBox([LX + 0.008, LY + 0.15, 0.04], [0.0105, 0.0055, 0.03], 0.004, euler(0.3, 0, 0)), roundBox([LX + 0.008, LY + 0.14, 0.019], [0.0105, 0.016, 0.004], 0.003))
  const spring = union(0.003, capsule([LX + 0.008, LY + 0.15, -0.012], [LX + 0.008, LY + 0.19, -0.014], 0.004), capsule([LX + 0.008, LY + 0.19, -0.014], [LX + 0.008, LY + 0.165, -0.02], 0.0035))
  const screws = [0.028, 0.185].map((y) => sphere([LX + 0.006, LY + y, -0.004], 0.006))
  const trigger = capsule([0, 0.058, -0.03], [0, 0.046, -0.062], 0.0048, 0.0035)
  const tang = roundBox([0, 0.035, 0.014], [0.008, 0.035, 0.005], 0.004)
  const sight = roundBox([0, MUZ - 0.045, BZ + 0.02], [0.003, 0.012, 0.007], 0.002)
  const lp = hammered(C.steel, 0.95)
  piece('musket_lock', 'metal', local(union(0.003, lockPlate, cock, pan, frizzen, spring, trigger, tang, sight, ...screws)), (x, y, z) => {
    const [lx, , lz] = toLocal(x, y, z)
    return shade(lp(x, y, z), lx > LX + 0.004 && lz < 0.03 ? 1 : 0.8)
  }, rigid, 0.0032)
  piece('musket_flint', 'soft', local(roundBox([LX + 0.01, LY + 0.086, 0.0665], [0.007, 0.012, 0.0035], 0.002)), flat(hex(0x2b2a2e)), rigid, 0.0032)

  // Ramrod under the barrel, steel with a flared tip.
  piece('musket_ramrod', 'metal', local(union(0.003, capsule([0, 0.3, -0.034], [0, 0.87, -0.022], 0.0062), cylinder([0, 0.874, -0.022], 0.0095, 0.01, 0.003))), flat(shade(C.steel, 0.85)), rigid, 0.0035)
}

// Bones that pieces may reference must exist.
const boneNames = new Set(BONES.map((b) => b.name))
for (const p of PIECES) {
  const refs = p.skin.rigid ? Object.keys(p.skin.rigid) : p.skin.envelope || []
  for (const r of refs) if (!boneNames.has(r)) throw new Error(`${p.name} references unknown bone ${r}`)
}
void torus
