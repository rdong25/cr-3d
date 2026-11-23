// Arena props: Princess tower, King tower, bridge.
//
// Same sculpting approach as tools/hero (signed-distance pieces, baked
// lighting), but static: no skeleton. Stone, wood and roof surfaces get their
// brick / plank / shingle detail from tiled textures at runtime
// (src/arena.ts, projected from three sides), so the meshes stay light. Vertex
// colors carry the baked occlusion and broad tints (moss, soot, trim).
//
// Conventions: Y up, feet at y = 0, the tower's FRONT (gate, banners) faces +Z.
// Materials: stone | wood | metal | team (cloth) | roof (team-tinted) | glow.

import {
  sphere, ellipsoid, capsule, roundBox, torus, cylinder, halfspace, star, cappedCone, repeatAround,
  union, subtract, intersect, offset, band, euler, node, fbm,
} from '../hero/sdf.mjs'

const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k]
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const flat = (c) => () => c

const C = {
  stone: hex(0xf2ece2), moss: hex(0x8fa65a), soot: hex(0x8d8a84),
  wood: hex(0xf0e6da), iron: hex(0x3c4048), gold: hex(0xe8b04a), goldDeep: hex(0xb97d26),
  cloth: hex(0xf4f4f4), roof: hex(0xf4f4f4), glow: hex(0xffc46a),
}
/** Stone tint: a little moss creeping up from the ground, soot toward the top. */
const stoneTint = (top) => (x, y, z) => {
  const n = fbm(x * 2.2, y * 2.2, z * 2.2, 3)
  const moss = sstep(0.55, 0.05, y) * sstep(0.35, 0.65, n)
  const soot = sstep(top - 0.6, top, y) * 0.25
  return shade(mix(C.stone, C.moss, moss * 0.7), 1 - soot - 0.08 * fbm(x * 9, y * 9, z * 9, 2))
}
const woodTint = (k = 1) => (x, y, z) => shade(C.wood, k * (0.9 + 0.1 * fbm(x * 6, y * 6, z * 6, 2)))

/** A banner hanging flat against a round wall: angular width, pointed hem. */
function wallBanner(wall, thetaC, halfWidth, yTop, yBottom) {
  return node((x, y, z) => {
    const shell = Math.abs(wall.d(x, y, z) - 0.035) - 0.012
    let dth = Math.atan2(z, x) - thetaC
    dth = Math.atan2(Math.sin(dth), Math.cos(dth))
    const r = Math.hypot(x, z)
    const side = (Math.abs(dth) - halfWidth) * r
    const hem = yBottom + 0.22 * (Math.abs(dth) / halfWidth)
    return Math.max(shell, side, hem - y, y - yTop)
  }, wall.min.map((v) => v - 0.1), wall.max.map((v) => v + 0.1))
}
function bannerPaint(thetaC, halfWidth, yTop, yBottom, emblemY, emblemR) {
  return (x, y, z) => {
    let dth = Math.atan2(z, x) - thetaC
    dth = Math.atan2(Math.sin(dth), Math.cos(dth))
    const r = Math.hypot(x, z)
    const edge = Math.min((halfWidth - Math.abs(dth)) * r, yTop - y, (y - yBottom - 0.22 * Math.abs(dth) / halfWidth) * 0.8)
    let k = 0.93 - 0.08 * fbm(x * 20, y * 40, z * 20, 2) - 0.05 * (0.5 + 0.5 * Math.sin(dth * r * 40))
    if (edge < 0.035) k *= 0.45
    // Five-point star emblem, in banner-local (arc, height) coordinates.
    const u = dth * r, v = y - emblemY
    const a = Math.atan2(u, v), rr = Math.hypot(u, v)
    const sectorA = ((a % (Math.PI * 0.4)) + Math.PI * 0.4) % (Math.PI * 0.4) - Math.PI * 0.2
    const starR = emblemR * (0.45 + 0.55 * Math.pow(Math.cos(sectorA * 2.5), 6))
    if (rr < starR) k *= 0.45
    return [k, k, k]
  }
}

export const MODELS = {}

// ---------------------------------------------------------------------------
// Princess tower. Platform floor at y = 2.62 (the princess stands on it).
// ---------------------------------------------------------------------------
{
  const P = []
  const piece = (name, material, sdf, paint, res) => P.push({ name, material, sdf, paint, res })
  const plinth = cappedCone([0, 0.17, 0], 0.17, 1.66, 1.56)
  const body = cappedCone([0, 1.38, 0], 1.08, 1.36, 1.2)
  // Arched gate in the front.
  const archCut = union(0.0, roundBox([0, 0.62, 1.32], [0.34, 0.36, 0.34], 0.04), cylinder([0, 0.98, 1.32], 0.34, 0.34, 0, euler(Math.PI / 2, 0, 0)))
  const slitAt = (r) => repeatAround(roundBox([r, 1.72, 0], [0.32, 0.2, 0.045], 0.02), 4, [0, 0], Math.PI / 4)
  let wall = union(0.04, plinth, body)
  wall = subtract(0.02, wall, archCut)
  wall = subtract(0.015, wall, slitAt(1.28))
  piece('wall', 'stone', wall, stoneTint(2.5), 0.02)
  // Corbelled walkway + crenellated parapet.
  const corbels = repeatAround(roundBox([1.27, 2.37, 0], [0.11, 0.1, 0.08], 0.03), 16)
  const ring = subtract(0.02, cylinder([0, 2.8, 0], 1.4, 0.22, 0.05), cylinder([0, 2.9, 0], 1.15, 0.5, 0))
  const merlons = repeatAround(roundBox([1.27, 3.1, 0], [0.13, 0.13, 0.21], 0.04), 8, [0, 0], Math.PI / 8)
  piece('parapet', 'stone', union(0.02, cylinder([0, 2.5, 0], 1.37, 0.08, 0.03), corbels, ring, merlons), stoneTint(3.2), 0.02)
  piece('floor', 'wood', cylinder([0, 2.6, 0], 1.17, 0.05, 0.02), woodTint(0.85), 0.03)
  // Gold trims, gate, arch stones.
  piece('trim', 'metal', union(0, band(body, 0.006, 0.012, [0, 0.4, 0], [0, 1, 0], 0.03), band(body, 0.006, 0.012, [0, 2.4, 0], [0, 1, 0], 0.03)), flat(C.gold), 0.015)
  piece('arch', 'stone', intersect(0.01, torus([0, 0.98, 1.36], 0.42, 0.08, euler(Math.PI / 2, 0, 0)), halfspace([0, 0.95, 0], [0, -1, 0])), (x, y, z) => shade(C.stone, 0.8), 0.015)
  const doorShape = union(0, roundBox([0, 0.62, 1.04], [0.31, 0.34, 0.04], 0.015), cylinder([0, 0.98, 1.04], 0.31, 0.04, 0.015, euler(Math.PI / 2, 0, 0)))
  piece('door', 'wood', intersect(0, doorShape, halfspace([0, 0.0, 0], [0, -1, 0])), woodTint(0.55), 0.012)
  piece('door_iron', 'metal', union(0, roundBox([0, 0.48, 1.09], [0.3, 0.025, 0.02], 0.01), roundBox([0, 0.88, 1.09], [0.3, 0.025, 0.02], 0.01), torus([0.14, 0.68, 1.1], 0.045, 0.012, euler(Math.PI / 2, 0, 0))), flat(C.iron), 0.01)
  // Warm light glowing in the arrow slits.
  piece('slit_glow', 'glow', slitAt(1.02), flat(C.glow), 0.02)
  // Team banners either side of the gate, hung from gold rods.
  for (const s of [-1, 1]) {
    const th = Math.PI / 2 + s * 0.62
    piece(`banner_${s}`, 'team', wallBanner(body, th, 0.2, 2.3, 1.2), bannerPaint(th, 0.2, 2.3, 1.2, 1.85, 0.12), 0.012)
    const rx = Math.cos(th) * 1.27, rz = Math.sin(th) * 1.27, tx = -Math.sin(th), tz = Math.cos(th)
    piece(`rod_${s}`, 'metal', capsule([rx - tx * 0.3, 2.32, rz - tz * 0.3], [rx + tx * 0.3, 2.32, rz + tz * 0.3], 0.025), flat(C.gold), 0.012)
  }
  piece('banner_back', 'team', wallBanner(body, -Math.PI / 2, 0.22, 2.3, 1.15), bannerPaint(-Math.PI / 2, 0.22, 2.3, 1.15, 1.82, 0.13), 0.012)
  piece('rod_back', 'metal', capsule([-0.3, 2.32, -1.27], [0.3, 2.32, -1.27], 0.025), flat(C.gold), 0.012)
  MODELS['tower-princess'] = P
}

// ---------------------------------------------------------------------------
// King tower. Bigger, gold-capped battlements, portcullis gate, crown crest,
// side turrets with team-colored roofs. Platform floor at y = 3.42.
// ---------------------------------------------------------------------------
{
  const P = []
  const piece = (name, material, sdf, paint, res) => P.push({ name, material, sdf, paint, res })
  const plinth = cappedCone([0, 0.2, 0], 0.2, 2.18, 2.05)
  const body = cappedCone([0, 1.72, 0], 1.33, 1.8, 1.6)
  const archCut = union(0, roundBox([0, 0.78, 1.78], [0.48, 0.46, 0.4], 0.05), cylinder([0, 1.24, 1.78], 0.48, 0.4, 0, euler(Math.PI / 2, 0, 0)))
  const slitAt = (r) => repeatAround(roundBox([r, 2.15, 0], [0.38, 0.24, 0.05], 0.02), 6, [0, 0], Math.PI / 6 + Math.PI / 2)
  const turretAt = (s) => [s * 1.72, 0, 0]
  let wall = union(0.05, plinth, body)
  for (const s of [-1, 1]) wall = union(0.08, wall, cylinder([turretAt(s)[0], 2.2, 0], 0.5, 1.2, 0.08))
  wall = subtract(0.02, wall, archCut)
  wall = subtract(0.015, wall, slitAt(1.7))
  piece('wall', 'stone', wall, stoneTint(3.4), 0.024)
  const corbels = repeatAround(roundBox([1.7, 3.12, 0], [0.13, 0.12, 0.1], 0.035), 20)
  const ring = subtract(0.02, cylinder([0, 3.55, 0], 1.84, 0.24, 0.05), cylinder([0, 3.7, 0], 1.55, 0.5, 0))
  const merlons = repeatAround(roundBox([1.7, 3.9, 0], [0.15, 0.15, 0.24], 0.045), 10, [0, 0], Math.PI / 10)
  piece('parapet', 'stone', union(0.02, cylinder([0, 3.24, 0], 1.81, 0.09, 0.03), corbels, ring, merlons), stoneTint(4), 0.024)
  piece('merlon_caps', 'metal', repeatAround(ellipsoid([1.7, 4.07, 0], [0.11, 0.06, 0.16]), 10, [0, 0], Math.PI / 10), flat(C.gold), 0.015)
  piece('floor', 'wood', cylinder([0, 3.4, 0], 1.57, 0.06, 0.02), woodTint(0.85), 0.03)
  piece('trim', 'metal', union(0, band(body, 0.006, 0.014, [0, 0.46, 0], [0, 1, 0], 0.035), band(body, 0.006, 0.014, [0, 3.0, 0], [0, 1, 0], 0.035)), flat(C.gold), 0.016)
  // Gate: arch stones, recessed doors, iron portcullis.
  piece('arch', 'stone', intersect(0.01, torus([0, 1.24, 1.82], 0.58, 0.1, euler(Math.PI / 2, 0, 0)), halfspace([0, 1.2, 0], [0, -1, 0])), (x, y, z) => shade(C.stone, 0.78), 0.016)
  piece('gate_doors', 'wood', union(0, roundBox([0, 0.78, 1.42], [0.45, 0.44, 0.04], 0.015), cylinder([0, 1.24, 1.42], 0.45, 0.04, 0.015, euler(Math.PI / 2, 0, 0))), woodTint(0.5), 0.014)
  const bars = []
  for (let i = -3; i <= 3; i++) bars.push(roundBox([i * 0.12, 0.95, 1.5], [0.018, 0.62, 0.018], 0.01))
  for (const y of [0.55, 0.95, 1.35]) bars.push(roundBox([0, y, 1.5], [0.44, 0.018, 0.018], 0.01))
  piece('portcullis', 'metal', intersect(0, union(0, ...bars), offset(archCut, -0.02)), flat(C.iron), 0.01)
  // Crown crest above the gate.
  const cz = 1.62, cy = 2.42
  const crown = union(0.02,
    roundBox([0, cy, cz], [0.3, 0.07, 0.06], 0.03),
    capsule([0, cy + 0.05, cz], [0, cy + 0.34, cz], 0.07, 0.02), capsule([-0.2, cy + 0.05, cz], [-0.26, cy + 0.28, cz], 0.06, 0.02), capsule([0.2, cy + 0.05, cz], [0.26, cy + 0.28, cz], 0.06, 0.02),
    sphere([0, cy + 0.37, cz], 0.05), sphere([-0.27, cy + 0.3, cz], 0.045), sphere([0.27, cy + 0.3, cz], 0.045))
  piece('crown', 'metal', crown, flat(C.gold), 0.01)
  piece('crown_gem', 'glow', sphere([0, cy, cz + 0.07], 0.045), flat(hex(0xff6a4a)), 0.008)
  piece('slit_glow', 'glow', slitAt(1.42), flat(C.glow), 0.022)
  // Side turrets: team roofs + gold finials.
  for (const s of [-1, 1]) {
    const [tx] = turretAt(s)
    piece(`turret_ring_${s}`, 'stone', cylinder([tx, 3.45, 0], 0.6, 0.1, 0.04), stoneTint(4), 0.02)
    piece(`roof_${s}`, 'roof', cappedCone([tx, 3.95, 0], 0.42, 0.68, 0.02), flat(C.roof), 0.02)
    piece(`finial_${s}`, 'metal', union(0.02, sphere([tx, 4.42, 0], 0.07), capsule([tx, 4.4, 0], [tx, 4.62, 0], 0.025, 0.01)), flat(C.gold), 0.01)
  }
  for (const s of [-1, 1]) {
    const th = Math.PI / 2 + s * 0.6
    piece(`banner_${s}`, 'team', wallBanner(body, th, 0.22, 2.85, 1.35), bannerPaint(th, 0.22, 2.85, 1.35, 2.2, 0.14), 0.012)
    const rx = Math.cos(th) * 1.68, rz = Math.sin(th) * 1.68, tx = -Math.sin(th), tz = Math.cos(th)
    piece(`rod_${s}`, 'metal', capsule([rx - tx * 0.4, 2.88, rz - tz * 0.4], [rx + tx * 0.4, 2.88, rz + tz * 0.4], 0.03), flat(C.gold), 0.012)
  }
  piece('banner_back', 'team', wallBanner(body, -Math.PI / 2, 0.26, 2.85, 1.3), bannerPaint(-Math.PI / 2, 0.26, 2.85, 1.3, 2.18, 0.16), 0.012)
  piece('rod_back', 'metal', capsule([-0.45, 2.88, -1.68], [0.45, 2.88, -1.68], 0.03), flat(C.gold), 0.012)
  MODELS['tower-king'] = P
}

// ---------------------------------------------------------------------------
// Bridge, spanning the river along Z (2.6 wide river, 3.6 long deck).
// ---------------------------------------------------------------------------
{
  const P = []
  const piece = (name, material, sdf, paint, res) => P.push({ name, material, sdf, paint, res })
  const L = 1.95, W = 1.15
  const deckY = (z) => 0.26 + 0.16 * (1 - (z / L) ** 2)
  const planks = []
  for (let i = 0; i < 13; i++) {
    const z = -L + 0.15 + i * 0.3
    planks.push(roundBox([0, deckY(z), z], [W - (i % 2) * 0.04, 0.05, 0.13], 0.025, euler(-(0.32 * z) / L * 0.9, 0, 0)))
  }
  piece('planks', 'wood', union(0, ...planks), (x, y, z) => shade(C.wood, 0.75 + 0.2 * fbm(x * 3, 0, z * 7, 2)), 0.018)
  const beams = [], posts = [], rails = []
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      const z0 = -L + (i / 6) * 2 * L, z1 = -L + ((i + 1) / 6) * 2 * L
      beams.push(capsule([s * (W + 0.02), deckY(z0) - 0.06, z0], [s * (W + 0.02), deckY(z1) - 0.06, z1], 0.07))
    }
    const postZ = [-L + 0.12, -0.65, 0.65, L - 0.12]
    for (const z of postZ) posts.push(roundBox([s * (W + 0.02), deckY(z) + 0.28, z], [0.07, 0.34, 0.07], 0.025))
    for (let i = 0; i < postZ.length - 1; i++) {
      const a = postZ[i], b = postZ[i + 1]
      rails.push(capsule([s * (W + 0.02), deckY(a) + 0.58, a], [s * (W + 0.02), deckY(b) + 0.58, b], 0.045))
    }
  }
  piece('beams', 'wood', union(0.01, ...beams), woodTint(0.55), 0.02)
  piece('posts', 'wood', union(0.01, ...posts, ...rails), woodTint(0.7), 0.016)
  piece('post_caps', 'metal', union(0, ...[-1, 1].flatMap((s) => [-L + 0.12, -0.65, 0.65, L - 0.12].map((z) => sphere([s * (W + 0.02), deckY(z) + 0.64, z], 0.055)))), flat(C.iron), 0.01)
  for (const e of [-1, 1]) piece(`abutment_${e}`, 'stone', roundBox([0, 0.12, e * (L - 0.05)], [W + 0.2, 0.2, 0.34], 0.07), stoneTint(0.5), 0.02)
  MODELS['bridge'] = P
}
