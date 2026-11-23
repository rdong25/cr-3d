// BABY DRAGON — a young but dangerous drake.
//
// Deep keeled chest tapering to a narrow waist, an arched neck carrying a
// sculpted reptilian head (brow ridges, nostrils, toothed jaw, ember eyes),
// a crown of swept-back horns, a row of dorsal spines from nape to tail, a
// thick tail ending in a flat spade, and big bat wings (arm + four fingers,
// scalloped membrane, team-colored war band) on the wing_L / wing_R bones.
// The hide is painted scales (big plates along the back, small on the
// flanks) over a paler segmented belly; the throat plates part over a
// glowing ember seam where the fire comes from.
// Follows the Ember Warden pipeline (see tools/hero/design.mjs).
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
// Palette (sRGB). Dark, grounded: teal-green hide, bone belly, wine membranes.
// ---------------------------------------------------------------------------
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]
const C = {
  hide: hex(0x488271), hideDark: hex(0x20413f), hideLight: hex(0x6f9a78),
  plate: hex(0xb9aa8a), plateDark: hex(0x6a5c46), scorch: hex(0x4a2616),
  membrane: hex(0x57392f), membraneLit: hex(0x8f6540), membraneDark: hex(0x24150f), vein: hex(0x1f0f0b),
  horn: hex(0x40342d), hornTip: hex(0xdccfa8), claw: hex(0xd8ccaa), clawBase: hex(0x4c3e33),
  tooth: hex(0xeee4c6), gum: hex(0x55202a), scar: hex(0xa88c84),
  brass: hex(0xcf9a3c), leather: hex(0x4a2f1c), ember: hex(0xffa63a), eye: hex(0xffc85a),
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k]
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const flat = (c) => () => c
const grain = (c, amt = 0.08, freq = 60) => (x, y, z) => shade(c, 1 - amt / 2 + amt * fbm(x * freq, y * freq, z * freq, 3))

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k]
const lerp3 = (a, b, t) => add(a, scale(sub(b, a), t))
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

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
function grad3(n, p, e = 0.002) {
  return norm([
    n.d(p[0] + e, p[1], p[2]) - n.d(p[0] - e, p[1], p[2]),
    n.d(p[0], p[1] + e, p[2]) - n.d(p[0], p[1] - e, p[2]),
    n.d(p[0], p[1], p[2] + e) - n.d(p[0], p[1], p[2] - e)])
}
/** Tapered tube through a list of points. */
function chain(pts, r0, r1, k = 0.008) {
  const caps = []
  for (let i = 0; i < pts.length - 1; i++) {
    const ta = i / (pts.length - 1), tb = (i + 1) / (pts.length - 1)
    caps.push(capsule(pts[i], pts[i + 1], r0 + (r1 - r0) * ta, r0 + (r1 - r0) * tb))
  }
  return union(k, ...caps)
}
/** Exact signed distance to a 2D polygon (iq). Negative inside. */
function poly2(pts) {
  const n = pts.length
  return (px, py) => {
    let d = (px - pts[0][0]) ** 2 + (py - pts[0][1]) ** 2, s = 1
    for (let i = 0, j = n - 1; i < n; j = i, i++) {
      const vi = pts[i], vj = pts[j]
      const ex = vj[0] - vi[0], ey = vj[1] - vi[1], wx = px - vi[0], wy = py - vi[1]
      const t = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1)
      const bx = wx - ex * t, by = wy - ey * t
      d = Math.min(d, bx * bx + by * by)
      const c1 = py >= vi[1], c2 = py < vj[1], c3 = ex * wy > ey * wx
      if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) s = -s
    }
    return s * Math.sqrt(d)
  }
}
function segDist2(px, py, a, b) {
  const ex = b[0] - a[0], ey = b[1] - a[1], wx = px - a[0], wy = py - a[1]
  const t = clamp((wx * ex + wy * ey) / (ex * ex + ey * ey), 0, 1)
  return Math.hypot(wx - ex * t, wy - ey * t)
}

// --- cellular noise: irregular reptile scales on any surface -----------------
function hsh(i, j, k, salt) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1274126177) + Math.imul(salt, 974711)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}
/** [distance to nearest cell point, distance to second nearest, random id of the nearest cell]. */
function cells(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
  let f1 = 9, f2 = 9, id = 0
  for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const cx = xi + dx, cy = yi + dy, cz = zi + dz
    const px = cx + 0.15 + 0.7 * hsh(cx, cy, cz, 1) - x, py = cy + 0.15 + 0.7 * hsh(cx, cy, cz, 2) - y, pz = cz + 0.15 + 0.7 * hsh(cx, cy, cz, 3) - z
    const d = px * px + py * py + pz * pz
    if (d < f1) { f2 = f1; f1 = d; id = hsh(cx, cy, cz, 4) } else if (d < f2) f2 = d
  }
  return [Math.sqrt(f1), Math.sqrt(f2), id]
}
/** Brightness of one scale pattern: dark grooves between scales, per-scale tone, domed highlight. */
function scaleTone(x, y, z, size) {
  const [f1, f2, id] = cells(x / size, y / size, z / (size * 1.35))
  const groove = sstep(0.03, 0.2, f2 - f1)
  return (0.5 + 0.5 * groove) * (0.84 + 0.3 * id) * (1.1 - 0.22 * f1)
}
/** Scaled hide. back: 0 = flank (small scales) .. 1 = dorsal (big dark plates). light: 0..1 toward the pale underside. */
function hide(x, y, z, back, light = 0) {
  const small = scaleTone(x, y, z, 0.034), big = scaleTone(x + 7.3, y, z, 0.072)
  const k = small + (big - small) * sstep(0.35, 0.65, back)
  let c = mix(C.hide, C.hideDark, back * 0.85)
  c = mix(c, C.hideLight, light)
  return shade(c, k * (0.84 + 0.32 * fbm(x * 7 + 3, y * 7, z * 7, 3)))
}

// ---------------------------------------------------------------------------
// Pieces.
// ---------------------------------------------------------------------------
export const PIECES = []
// `opt` may carry { ratio, err, cw }: this piece's own decimation target / error / color weight (see build.mjs).
const piece = (name, material, sdf, paint, skin, res, opt = {}) => PIECES.push({ name, material, sdf, paint, skin, res, ...opt })

// ===========================================================================
// TRUNK: chest, waist, haunches, neck and tail as one continuous skin.
// ===========================================================================
const NB = [0, 0.84, 0.02], HB = [0, 0.94, 0.22] // neck and head bones
const ND = norm(sub(HB, NB)) // neck axis
const NP = [0, -ND[2], ND[1]] // perpendicular to it, pointing at the throat (down-forward)
/** Point `s` along the neck bone from its root, pushed `lift` toward the throat. */
const neckAt = (s, lift = 0) => add(add(NB, scale(ND, s)), scale(NP, lift))

const chestE = ellipsoid([0, 0.645, -0.13], [0.255, 0.245, 0.27])
const neckSdf = union(0.03,
  capsule([0, 0.77, -0.10], neckAt(0, -0.025), 0.16, 0.116),
  capsule(neckAt(0, -0.025), neckAt(0.224, -0.02), 0.116, 0.10),
  capsule(neckAt(0.224, -0.02), neckAt(0.36, -0.012), 0.10, 0.092))
const tailSdf = bezierTube([0, 0.62, -0.50], [0, 0.56, -0.74], [0, 0.47, -1.0], [0, 0.52, -1.24], 0.145, 0.03, 14, 0.02)
const trunk = union(0.045,
  chestE,
  ellipsoid([0.15, 0.775, -0.15], [0.11, 0.11, 0.15]), ellipsoid([-0.15, 0.775, -0.15], [0.11, 0.11, 0.15]), // withers under the wing roots
  ellipsoid([0.13, 0.60, 0.0], [0.11, 0.15, 0.13]), ellipsoid([-0.13, 0.60, 0.0], [0.11, 0.15, 0.13]), // pectorals
  ellipsoid([0, 0.665, -0.36], [0.185, 0.18, 0.2]), // waist, tucked up
  ellipsoid([0.125, 0.585, -0.39], [0.12, 0.155, 0.15]), ellipsoid([-0.125, 0.585, -0.39], [0.12, 0.155, 0.15]), // haunches
  ellipsoid([0, 0.66, -0.50], [0.16, 0.165, 0.16]), // rump
  neckSdf, tailSdf)

/** One weight function for everything that lies on the trunk, so skin, plates, collar and spines never separate. */
function trunkSkin(x, y, z) {
  const ry = y - NB[1], rz = z - NB[2]
  const s = ry * ND[1] + rz * ND[2]
  const col = sstep(0.27, 0.16, Math.hypot(x, ry * NP[1] + rz * NP[2])) // only the neck column
  const wn = sstep(-0.05, 0.09, s) * col, wh = sstep(0.18, 0.27, s)
  const c1 = sstep(-0.37, -0.53, z), c2 = sstep(-0.64, -0.80, z), c3 = sstep(-0.90, -1.06, z)
  const body = (1 - wn) * (1 - c1)
  const hip = 0.65 * sstep(0.74, 0.54, y) * sstep(0.0, -0.16, z)
  const sp = 0.6 * sstep(-0.05, -0.3, z) * sstep(0.85, 0.65, y)
  return {
    head: wn * wh, neck: wn * (1 - wh),
    cape_3: (1 - wn) * c3, cape_2: (1 - wn) * c2 * (1 - c3), cape_1: (1 - wn) * c1 * (1 - c2),
    hips: body * hip, spine: body * (1 - hip) * sp, chest: body * (1 - hip) * (1 - sp),
  }
}
const TRUNK_SKIN = { fn: trunkSkin }

// --- midline curves, traced on the surface: dorsal ridge and ventral (belly) line ---
function traceMid(start, sign) {
  const g2 = (p) => {
    const e = 0.002
    const gy = trunk.d(0, p[1] + e, p[2]) - trunk.d(0, p[1] - e, p[2]), gz = trunk.d(0, p[1], p[2] + e) - trunk.d(0, p[1], p[2] - e)
    const l = Math.hypot(gy, gz) || 1
    return [gy / l, gz / l]
  }
  const pts = [start]
  let p = start
  for (let i = 0; i < 400 && p[2] > -1.225; i++) {
    const g = g2(p)
    let q = [0, p[1] + sign * g[1] * 0.02, p[2] - sign * g[0] * 0.02]
    for (let k = 0; k < 3; k++) { const d = trunk.d(0, q[1], q[2]), n = g2(q); q = [0, q[1] - n[0] * d, q[2] - n[1] * d] }
    pts.push(q); p = q
  }
  const L = [0]
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + dist3(pts[i], pts[i - 1]))
  return { pts, L }
}
/** Nearest point on a traced line: [distance, arc length along the line]. */
function nearLine(line, x, y, z) {
  let best = Infinity, bl = 0
  const { pts, L } = line
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    const ey = b[1] - a[1], ez = b[2] - a[2], wy = y - a[1], wz = z - a[2]
    const t = clamp((wy * ey + wz * ez) / (ey * ey + ez * ez), 0, 1)
    const dy = wy - ey * t, dz = wz - ez * t
    const d = x * x + dy * dy + dz * dz
    if (d < best) { best = d; bl = L[i] + (L[i + 1] - L[i]) * t }
  }
  return [Math.sqrt(best), bl]
}
const lineAt = (line, l) => {
  const { pts, L } = line
  for (let i = 0; i < pts.length - 1; i++) if (l <= L[i + 1]) return lerp3(pts[i], pts[i + 1], clamp((l - L[i]) / (L[i + 1] - L[i]), 0, 1))
  return pts[pts.length - 1]
}
const dorsal = traceMid(surfacePoint(trunk, neckAt(0.27, -0.4), NP), 1)
const ventral = traceMid(surfacePoint(trunk, neckAt(0.27, 0.4), scale(NP, -1)), -1)

// Where the runtime hangs the chest glow sprite (chest bone + [0, 0.05, 0.25]): the ember seam is built around it.
const EMBER = [0, 0.77, 0.15]
const L_EMBER = nearLine(ventral, ...EMBER)[1]

// --- scars: pale slashes painted on one flank (2D in the Y/Z side view) ---
const SCARS = [
  { side: 1, a: [0.80, -0.04], b: [0.63, -0.17], w: 0.008 },
  { side: 1, a: [0.82, -0.11], b: [0.62, -0.26], w: 0.009 },
  { side: 1, a: [0.80, -0.19], b: [0.66, -0.31], w: 0.007 },
  { side: -1, a: [0.74, -0.32], b: [0.58, -0.50], w: 0.009 },
  { side: -1, a: [0.92, 0.10], b: [0.81, 0.03], w: 0.007 },
]
function scarred(c, x, y, z) {
  for (const sc of SCARS) {
    if (x * sc.side < 0.05) continue
    const ey = sc.b[0] - sc.a[0], ez = sc.b[1] - sc.a[1]
    const t = clamp(((y - sc.a[0]) * ey + (z - sc.a[1]) * ez) / (ey * ey + ez * ez), 0, 1)
    const w = sc.w * (0.25 + 0.75 * Math.sin(Math.PI * t)) // tapers to both ends
    const d = segDist2(y, z, sc.a, sc.b) + 0.004 * (noise3(y * 60, z * 60, 0) - 0.5)
    if (d > w * 2.4) continue
    c = shade(c, 1 - 0.45 * sstep(w * 2.4, w, d))
    c = mix(c, C.scar, 0.8 * sstep(w, w * 0.4, d))
  }
  return c
}
const trunkPaint = (x, y, z) => {
  const back = sstep(0.2, 0.07, nearLine(dorsal, x, y, z)[0])
  const [dv, lv] = nearLine(ventral, x, y, z)
  let c = hide(x, y, z, back, 0.55 * sstep(0.27, 0.12, dv))
  // Broken dark bands across the back and tail.
  const stripe = sstep(0.55, 0.85, 0.5 + 0.5 * Math.sin(z * 31 + 5 * fbm(x * 4, y * 4, z * 4, 2))) * back
  c = shade(c, 1 - 0.32 * stripe)
  // Ember light bleeding onto the hide around the throat seam.
  const warm = sstep(0.16, 0.03, dv) * sstep(0.2, 0.05, Math.abs(lv - L_EMBER - 0.05))
  c = mix(c, [0.62, 0.24, 0.08], 0.4 * warm)
  return scarred(c, x, y, z)
}
piece('trunk', 'soft', trunk, trunkPaint, TRUNK_SKIN)

// ---- Belly: overlapping pale plates from the throat to the tail tip ----
const SEG = 0.064
// Half-width of the plated strip at each point of the ventral line.
const ventralWidth = (() => {
  const raw = ventral.pts.map(([, y, z]) => {
    if (z > 0.0 && y > 0.70) return 0.07 // throat
    if (z > -0.30) return 0.15 // chest
    if (z > -0.5) return 0.15 - 0.045 * (-0.30 - z) / 0.2
    return 0.105 - 0.075 * Math.min(1, (-0.5 - z) / 0.7)
  })
  const sm = raw.map((_, i) => { let s = 0, n = 0; for (let j = Math.max(0, i - 3); j <= Math.min(raw.length - 1, i + 3); j++) { s += raw[j]; n++ } return s / n })
  return (l) => {
    const { L } = ventral
    for (let i = 0; i < L.length - 1; i++) if (l <= L[i + 1]) return sm[i] + (sm[i + 1] - sm[i]) * clamp((l - L[i]) / (L[i + 1] - L[i]), 0, 1)
    return sm[sm.length - 1]
  }
})()
/** How far the plates part over the ember: 1 at the throat seam, 0 elsewhere. */
const emberAt = (l) => sstep(-0.07, -0.02, l - L_EMBER) * sstep(0.2, 0.07, l - L_EMBER)
const L_END = ventral.L[ventral.L.length - 1]
/** Position 0..1 along a belly plate; the plate edges bow toward the tail at the midline. */
const plateF = (dv, l) => { const q = (l + 1.6 * dv * dv - L_EMBER) / SEG; return q - Math.floor(q) }
const trunkBox = { min: [-0.3, 0.3, -1.3], max: [0.3, 1.12, 0.45] }
const smax = (a, b, k) => { const h = clamp(0.5 - (0.5 * (b - a)) / k, 0, 1); return b + (a - b) * h + k * h * (1 - h) }
const bellyPlates = node((x, y, z) => {
  const dt = trunk.d(x, y, z)
  const far = Math.abs(dt - 0.008) - 0.016
  if (far > 0.02) return far
  const [dv, l] = nearLine(ventral, x, y, z)
  const f = plateF(dv, l)
  const gap = 0.006 + 0.008 * emberAt(l)
  const slab = Math.abs(f - 0.5) * SEG - (SEG - gap) / 2
  const shell = Math.abs(dt - (0.003 + 0.008 * f)) - 0.006 // each plate rises toward its rear edge, like a shingle
  return smax(smax(shell, slab, 0.003), Math.max(dv - ventralWidth(l), 0.03 - l, l - (L_END - 0.03)), 0.014)
}, trunkBox.min, trunkBox.max)
piece('belly_plates', 'soft', bellyPlates, (x, y, z) => {
  const [dv, l] = nearLine(ventral, x, y, z)
  const f = plateF(dv, l)
  const edge = sstep(0.0, 0.035, ventralWidth(l) - dv)
  let c = mix(C.plateDark, C.plate, (0.3 + 0.7 * edge) * (0.6 + 0.4 * sstep(0.0, 0.45, f)))
  c = shade(c, 0.88 + 0.2 * fbm(x * 14, y * 14, z * 14, 2))
  // Scorched and lit from within where the plates part over the ember.
  const e = emberAt(l)
  c = mix(c, C.scorch, 0.55 * e)
  return mix(c, [0.9, 0.36, 0.08], 0.45 * e * Math.max(sstep(0.25, 0.02, f), sstep(0.75, 0.98, f)))
}, TRUNK_SKIN, undefined, { err: 0.003, cw: 0.4 })
// The ember itself: a glowing layer under the throat and chest plates, seen through the gaps between them.
const emberSeam = node((x, y, z) => {
  const dt = trunk.d(x, y, z)
  const shell = Math.abs(dt - 0.003) - 0.0045
  if (shell > 0.02) return shell
  const [dv, l] = nearLine(ventral, x, y, z)
  return Math.max(shell, dv - (ventralWidth(l) - 0.016), (L_EMBER - 0.07) - l, l - (L_EMBER + 0.2))
}, [-0.2, 0.4, -0.2], [0.2, 0.95, 0.4])
piece('ember_seam', 'glow', emberSeam, flat(C.ember), TRUNK_SKIN)

// ---- War collar: team cloth wrap between brass rims, studs, and a ring at the throat ----
{
  const cs = 0.158
  const Cc = neckAt(cs)
  const inNeck = sphere(Cc, 0.2)
  const wrap = intersect(0.004, band(trunk, 0.012, 0.01, Cc, ND, 0.027), inNeck)
  piece('collar', 'team', wrap, (x, y, z) => {
    const s = (y - NB[1]) * ND[1] + (z - NB[2]) * ND[2] - cs
    const k = (0.92 - 0.14 * fbm(x * 16, y * 16, z * 16, 2)) * (0.5 + 0.5 * sstep(0.004, 0.009, Math.abs(s)))
    return [k, k, k]
  }, TRUNK_SKIN, undefined, { cw: 0.25 })
  const rims = union(0, ...[-0.031, 0.031].map((o) => intersect(0.003, band(trunk, 0.016, 0.011, neckAt(cs + o), ND, 0.0075), inNeck)))
  const studs = []
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + Math.PI / 7
    const dir = add(scale([1, 0, 0], Math.sin(a)), scale(NP, Math.cos(a)))
    if (Math.cos(a) > 0.9) continue // the ring hangs there
    studs.push(sphere(surfacePoint(wrap, add(Cc, scale(dir, 0.4)), scale(dir, -1)), 0.0125))
  }
  const front = surfacePoint(wrap, add(Cc, scale(NP, 0.4)), scale(NP, -1))
  const ring = torus(add(front, add(scale(NP, 0.012), scale(ND, -0.03))), 0.024, 0.007, frameY(NP))
  piece('collar_brass', 'metal', union(0.003, rims, ring, sphere(front, 0.016), ...studs),
    (x, y, z) => shade(C.brass, 0.85 + 0.25 * fbm(x * 14, y * 14, z * 14, 2)), TRUNK_SKIN, 0.0055, { err: 0.003, cw: 0.2 })
}

// ---- Dorsal spines: swept-back blades from the nape to the tail tip ----
{
  const spines = []
  const tangentAt = (l) => norm(sub(lineAt(dorsal, l + 0.01), lineAt(dorsal, l - 0.01)))
  for (let l = 0.07; l < dorsal.L[dorsal.L.length - 1] - 0.05; l += 0.082) {
    const b = lineAt(dorsal, l)
    const s = (b[1] - NB[1]) * ND[1] + (b[2] - NB[2]) * ND[2]
    if (Math.abs(s - 0.158) < 0.05 && b[2] > 0) continue // collar sits here
    // Tallest over the withers, shrinking along the tail.
    const h = b[2] > -0.1 ? 0.07 + 0.05 * sstep(0.3, -0.1, b[2]) : 0.12 - 0.085 * sstep(-0.1, -1.2, b[2])
    const t = tangentAt(l), n = grad3(trunk, b)
    const tip = add(b, add(scale(n, h * 0.8), scale(t, h * 0.75)))
    const base = sub(b, scale(n, 0.012))
    const r = clamp(h * 0.3, 0.011, 0.034)
    const blade = intersect(0.004, capsule(base, tip, r, 0.0035), roundBox([0, b[1], b[2]], [r * 0.42 + 0.004, 0.3, 0.3], 0.004))
    spines.push({ sdf: blade, base: b, h, w: trunkSkin(b[0], b[1], b[2]) })
  }
  const nearest = (x, y, z) => { let best = spines[0], bd = Infinity; for (const sp of spines) { const d = dist3(sp.base, [x, y, z]); if (d < bd) { bd = d; best = sp } } return [best, bd] }
  piece('dorsal_spines', 'soft', union(0, ...spines.map((s) => s.sdf)), (x, y, z) => {
    const [sp, d] = nearest(x, y, z)
    return shade(mix(C.horn, C.hornTip, sstep(0.25, 1.0, d / sp.h)), 0.9 + 0.2 * fbm(x * 60, y * 60, z * 60, 2))
  }, { fn: (x, y, z) => nearest(x, y, z)[0].w }, 0.005)
}

// ---- Tail spade: a flat barbed blade, horizontal so it reads from above ----
{
  const half = [[0.03, -1.19], [0.045, -1.25], [0.15, -1.285], [0.10, -1.41], [0, -1.56]]
  const outline = poly2([...half, ...half.slice(0, -1).reverse().map(([x, z]) => [-x, z])])
  const yc = (z) => 0.52 + 0.12 * (-1.22 - z)
  const spade = node((x, y, z) => {
    const d2 = outline(x, z)
    return Math.max(Math.abs(y - yc(z)) - (0.006 + 0.02 * sstep(0, -0.06, d2)), d2) - 0.003
  }, [-0.17, 0.45, -1.58], [0.17, 0.63, -1.17])
  piece('tail_spade', 'soft', spade, (x, y, z) => {
    const e = sstep(-0.016, -0.002, outline(x, z))
    return shade(mix(mix(C.hideDark, C.horn, sstep(-1.22, -1.3, z)), C.hornTip, 0.6 * e), 0.9 + 0.2 * fbm(x * 20, y * 20, z * 20, 2))
  }, { rigid: { cape_3: 1 } }, 0.005)
}

// ===========================================================================
// HEAD: skull, snout, brows, jaw, teeth, eyes, horns. Rigid on the head bone.
// ===========================================================================
// The runtime hangs the eye glow sprite at head bone + [0, 0.19, 0.27]: the forehead sits just under it.
const headParts = [
  ellipsoid([0, 1.022, 0.42], [0.122, 0.094, 0.145]), // cranium
  ellipsoid([0, 0.99, 0.565], [0.093, 0.066, 0.13]), // snout root
  ellipsoid([0, 0.982, 0.675], [0.071, 0.054, 0.105]), // snout
  ellipsoid([0, 0.984, 0.752], [0.058, 0.045, 0.045]), // nose
]
const headFine = [capsule([0, 1.058, 0.52], [0, 1.026, 0.73], 0.024, 0.017)] // nasal ridge
for (const s of [1, -1]) {
  headParts.push(ellipsoid([s * 0.098, 0.985, 0.41], [0.045, 0.065, 0.075])) // jaw muscle
  headFine.push(chain([[s * 0.04, 1.062, 0.60], [s * 0.088, 1.082, 0.52], [s * 0.124, 1.086, 0.41]], 0.017, 0.031, 0.012)) // brow ridge
  headFine.push(sphere([s * 0.034, 1.014, 0.762], 0.023)) // nostril mound
}
const skull = union(0.02, union(0.03, ...headParts), ...headFine)
const eyes = [1, -1].map((s) => {
  const dir = norm([-s * 0.9, 0.02, -0.38])
  const hit = surfacePoint(skull, [s * 0.32, 1.046, 0.63], dir)
  return { s, hit, dir }
})
let headSdf = subtract(0.006, skull, roundBox([0, 0.897, 0.665], [0.2, 0.06, 0.22], 0.01)) // flat upper jaw line
for (const { hit, dir } of eyes) headSdf = subtract(0.008, headSdf, sphere(add(hit, scale(dir, -0.004)), 0.027))
for (const s of [1, -1]) headSdf = subtract(0.004, headSdf, capsule([s * 0.05, 1.026, 0.80], [s * 0.03, 1.012, 0.755], 0.0095))
const headScar = (c, x, y, z) => {
  if (y < 1.0) return c
  const d = segDist2(x, z, [-0.135, 0.63], [-0.02, 0.43])
  return mix(shade(c, 1 - 0.4 * sstep(0.024, 0.011, d)), C.scar, 0.9 * sstep(0.011, 0.005, d))
}
piece('head', 'soft', headSdf, (x, y, z) => {
  const back = sstep(1.02, 1.085, y) * 0.9
  let c = hide(x, y, z, back, 0.5 * sstep(0.99, 0.955, y))
  c = shade(c, 0.75 + 0.25 * sstep(0.955, 0.975, y)) // dark lip line
  return headScar(c, x, y, z)
}, { rigid: { head: 1 } }, 0.005)

// Lower jaw, hanging a little open.
const jawPlaneY = (z) => 0.946 - 0.06 * (z - 0.42)
const jawSdf = intersect(0.006, union(0.02,
  ellipsoid([0, 0.918, 0.53], [0.078, 0.042, 0.14]), ellipsoid([0, 0.912, 0.655], [0.058, 0.036, 0.10]),
  ellipsoid([0, 0.908, 0.735], [0.045, 0.032, 0.038]),
  ellipsoid([0.08, 0.94, 0.42], [0.04, 0.045, 0.06]), ellipsoid([-0.08, 0.94, 0.42], [0.04, 0.045, 0.06])),
halfspace([0, 0.946, 0.42], [0, 1, 0.06]))
piece('jaw', 'soft', jawSdf, (x, y, z) => {
  const under = sstep(0.925, 0.89, y)
  const c = mix(hide(x, y, z, 0, 0.5), shade(C.plate, 0.8 + 0.25 * fbm(x * 40, y * 40, z * 40, 3)), under * 0.8)
  return shade(c, 0.7 + 0.3 * sstep(jawPlaneY(z), jawPlaneY(z) - 0.018, y))
}, { rigid: { head: 1 } }, 0.005)
piece('tongue', 'soft', ellipsoid([0, 0.936, 0.60], [0.036, 0.012, 0.12], euler(0.06, 0, 0)), grain(C.gum, 0.2, 60), { rigid: { head: 1 } }, 0.005)
// Fire banked at the back of the throat, seen between the teeth.
piece('mouth_fire', 'glow', ellipsoid([0, 0.951, 0.51], [0.05, 0.013, 0.075]), flat(C.ember), { rigid: { head: 1 } }, 0.004)

// Small fierce eyes, deep under the brows.
for (const { s, hit, dir } of eyes) {
  piece(`eye_${s > 0 ? 'L' : 'R'}`, 'glow', ellipsoid(add(hit, scale(dir, 0.012)), [0.014, 0.0105, 0.019]), flat(C.eye), { rigid: { head: 1 } }, 0.003)
}

// Teeth: a row along each jaw, fangs toward the front.
{
  const teeth = []
  for (const s of [1, -1]) {
    for (const [z, len] of [[0.49, 0.022], [0.525, 0.026], [0.56, 0.028], [0.595, 0.026], [0.63, 0.03], [0.668, 0.046], [0.705, 0.034], [0.738, 0.026]]) {
      const p = surfacePoint(headSdf, [s * 0.3, 0.964, z], [-s, 0, 0])
      teeth.push(capsule([p[0] - s * 0.008, 0.968, z], [p[0] - s * 0.005, 0.966 - len, z + 0.004], 0.0095, 0.002))
    }
    for (const x of [0.016, 0.042]) {
      const p = surfacePoint(headSdf, [s * x, 0.964, 1.2], [0, 0, -1])
      teeth.push(capsule([s * x, 0.968, p[2] - 0.008], [s * x, 0.94, p[2] - 0.004], 0.008, 0.002))
    }
    for (const [z, len] of [[0.5075, 0.018], [0.5425, 0.02], [0.5775, 0.02], [0.6125, 0.022], [0.649, 0.024], [0.688, 0.038], [0.722, 0.026]]) {
      const yp = jawPlaneY(z)
      const p = surfacePoint(jawSdf, [s * 0.3, yp - 0.006, z], [-s, 0, 0])
      teeth.push(capsule([p[0] - s * 0.008, yp - 0.008, z], [p[0] - s * 0.006, yp + len, z + 0.002], 0.0085, 0.002))
    }
  }
  piece('teeth', 'soft', union(0, ...teeth), (x, y, z) => shade(C.tooth, 0.8 + 0.2 * sstep(0.02, 0.0, Math.abs(y - 0.95))), { rigid: { head: 1 } }, 0.0035)
}

// Crown of horns: two long main horns, two shorter temple horns, cheek spikes and a nape spike.
{
  const hornPaint = (param) => (x, y, z) => {
    const t = param(x, y, z)
    return shade(mix(C.horn, C.hornTip, sstep(0.35, 1, t)), 0.86 + 0.14 * Math.sin(t * 70) + 0.1 * fbm(x * 50, y * 50, z * 50, 2))
  }
  const brass = []
  for (const s of [1, -1]) {
    const side = s > 0 ? 'L' : 'R'
    const m = [[s * 0.075, 1.08, 0.375], [s * 0.135, 1.17, 0.28], [s * 0.18, 1.25, 0.13], [s * 0.165, 1.295, -0.03]]
    const main = bezierTube(...m, 0.043, 0.007, 12)
    const t2 = [[s * 0.115, 1.03, 0.36], [s * 0.19, 1.05, 0.27], [s * 0.24, 1.09, 0.17], [s * 0.238, 1.145, 0.06]]
    const temple = bezierTube(...t2, 0.03, 0.005, 10)
    const cheekA = capsule([s * 0.11, 0.975, 0.40], [s * 0.175, 0.965, 0.29], 0.021, 0.003)
    const cheekB = capsule([s * 0.095, 0.94, 0.43], [s * 0.145, 0.918, 0.34], 0.017, 0.003)
    const all = union(0, main, temple, cheekA, cheekB)
    const param = (x, y, z) => {
      const dm = main.d(x, y, z), dt = temple.d(x, y, z), da = cheekA.d(x, y, z), db = cheekB.d(x, y, z)
      const mn = Math.min(dm, dt, da, db)
      if (mn === dm) return main.param(x, y, z)
      if (mn === dt) return temple.param(x, y, z)
      return mn === da ? clamp((0.40 - z) / 0.11, 0, 1) : clamp((0.43 - z) / 0.09, 0, 1)
    }
    piece(`horns_${side}`, 'soft', all, hornPaint(param), { rigid: { head: 1 } }, 0.005)
    // Brass band on each main horn.
    const bz = (t) => { const u = 1 - t; return [0, 1, 2].map((i) => u * u * u * m[0][i] + 3 * u * u * t * m[1][i] + 3 * u * t * t * m[2][i] + t * t * t * m[3][i]) }
    const c = bz(0.3), dir = norm(sub(bz(0.33), bz(0.27)))
    brass.push(cylinder(c, 0.043 - 0.036 * 0.3 + 0.006, 0.014, 0.004, frameY(dir)))
  }
  piece('horn_bands', 'metal', union(0, ...brass), (x, y, z) => shade(C.brass, 0.82 + 0.3 * fbm(x * 30, y * 30, z * 30, 3)), { rigid: { head: 1 } }, 0.005)
  const nape = capsule([0, 1.095, 0.37], [0, 1.165, 0.265], 0.024, 0.004)
  piece('nape_spike', 'soft', intersect(0.004, nape, roundBox([0, 1.1, 0.3], [0.014, 0.2, 0.2], 0.004)),
    (x, y, z) => mix(C.horn, C.hornTip, sstep(1.1, 1.165, y)), { rigid: { head: 1 } }, 0.005)
}

// ===========================================================================
// LEGS: muscled, clawed. One skin per leg, blended across the joints.
// ===========================================================================
const clawPaint = (tipOf) => (x, y, z) => shade(mix(C.clawBase, C.claw, tipOf(x, y, z)), 0.9 + 0.15 * fbm(x * 70, y * 70, z * 70, 2))
for (const [side, { s, S, E, W, Hp, K, A }] of Object.entries(LIMB)) {
  // --- front leg ---
  const px = s * 0.328
  const frontToes = [], frontClaws = []
  for (const dx of [-0.043, 0, 0.043]) {
    const a = [px + dx * 0.8, 0.20, 0.10], b = [px + dx * 1.3, 0.146, 0.172]
    frontToes.push(capsule(a, b, 0.028, 0.022))
    frontClaws.push(chain([b, [px + dx * 1.42, 0.116, 0.208], [px + dx * 1.5, 0.08, 0.222]], 0.018, 0.003))
  }
  frontClaws.push(capsule([px - s * 0.05, 0.215, 0.05], [px - s * 0.082, 0.165, 0.075], 0.019, 0.003)) // dewclaw
  const front = union(0.03,
    ellipsoid([s * 0.255, 0.63, -0.045], [0.085, 0.125, 0.105]), capsule(S, E, 0.088, 0.064), sphere(E, 0.066),
    capsule(E, W, 0.063, 0.047), ellipsoid([s * 0.312, 0.395, -0.014], [0.056, 0.078, 0.064]), sphere(W, 0.05),
    ellipsoid([px, 0.215, 0.07], [0.062, 0.05, 0.066]), union(0.012, ...frontToes))
  const legPaint = (x, y, z) => shade(hide(x, y, z, 0.25 * sstep(-0.02, -0.1, z), 0.1), 0.72 + 0.28 * sstep(0.05, 0.4, y))
  piece(`foreleg_${side}`, 'soft', front, legPaint, {
    fn: (x, y, z) => { const f = sstep(0.50, 0.40, y), h = sstep(0.315, 0.245, y); return { [`upperarm_${side}`]: 1 - f, [`forearm_${side}`]: f * (1 - h), [`hand_${side}`]: h } },
  })
  piece(`fore_claws_${side}`, 'soft', union(0, ...frontClaws), clawPaint((x, y, z) => sstep(0.15, 0.09, y)), { rigid: { [`hand_${side}`]: 1 } }, 0.004)
  piece(`elbow_spur_${side}`, 'soft', capsule(add(E, [0, 0.01, -0.045]), add(E, [s * 0.012, 0.05, -0.14]), 0.027, 0.004),
    clawPaint((x, y, z) => sstep(-0.06, -0.13, z - E[2])), { rigid: { [`upperarm_${side}`]: 0.5, [`forearm_${side}`]: 0.5 } }, 0.005)

  // --- hind leg ---
  const hx = s * 0.18
  const hindToes = [], hindClaws = []
  for (const dx of [-0.046, 0, 0.046]) {
    const a = [hx + dx * 0.7, 0.036, -0.15], b = [hx + dx * 1.35, 0.031, -0.062]
    hindToes.push(capsule(a, b, 0.031, 0.025))
    hindClaws.push(chain([b, [hx + dx * 1.45, 0.032, -0.018], [hx + dx * 1.5, 0.009, 0.03]], 0.019, 0.003))
  }
  hindClaws.push(capsule([hx, 0.07, -0.30], [hx, 0.105, -0.375], 0.021, 0.004)) // heel spur
  const footBlock = intersect(0.004, union(0.02, ellipsoid([hx, 0.055, -0.215], [0.068, 0.053, 0.10]), sphere(A, 0.056), union(0.012, ...hindToes)), halfspace([0, 0.001, 0], [0, -1, 0]))
  const hind = union(0.03,
    ellipsoid([s * 0.19, 0.44, -0.30], [0.098, 0.165, 0.14]), capsule(Hp, K, 0.10, 0.078), sphere(add(K, [0, 0, 0.012]), 0.075),
    capsule(K, A, 0.068, 0.05), ellipsoid([hx, 0.235, -0.33], [0.052, 0.085, 0.058]), footBlock)
  piece(`hindleg_${side}`, 'soft', hind, legPaint, {
    fn: (x, y, z) => { const sh = sstep(0.345, 0.255, y), ft = sstep(0.135, 0.075, y); return { [`thigh_${side}`]: 1 - sh, [`shin_${side}`]: sh * (1 - ft), [`foot_${side}`]: ft } },
  })
  piece(`hind_claws_${side}`, 'soft', union(0, ...hindClaws), clawPaint((x, y, z) => Math.max(sstep(-0.04, 0.02, z), sstep(-0.31, -0.37, z))), { rigid: { [`foot_${side}`]: 1 } }, 0.004)
}

// ===========================================================================
// WINGS: arm + four fingers, a billowing scalloped membrane, a team war band.
// Built in a mirrored plan (X = outward, z), draped over a height field, and
// rigid on wing_L / wing_R so the flap clips drive them unchanged.
// ===========================================================================
const WO = [0.22, -0.18], WE = [0.47, -0.09], WW = [0.73, 0.11] // shoulder, elbow, wrist (plan view)
const TIPS = [[1.24, -0.17], [1.10, -0.58], [0.80, -0.88], [0.49, -0.94]]
const FCTRL = [[1.04, 0.08], [0.97, -0.18], [0.81, -0.36], [0.62, -0.41]]
const IB = [0.17, -0.64], IR = [0.19, -0.27]
const bez2 = (a, c, b, t) => [(1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]]
const FINGERS = TIPS.map((tip, i) => Array.from({ length: 9 }, (_, k) => bez2(WW, FCTRL[i], tip, k / 8)))
const ARM = [WO, WE, WW]
const angFrom = (p) => Math.atan2(p[1] - WW[1], p[0] - WW[0])
const TH = [...TIPS.map(angFrom), angFrom(IB)] // finger directions from the wrist, decreasing
const FLEN = TIPS.map((t) => Math.hypot(t[0] - WW[0], t[1] - WW[1]))
/** Membrane height: rises to the wrist, droops to the tip and trailing edge, billows between the fingers. */
function wingH(X, z) {
  let h = 0.832 + 0.105 * Math.sin(clamp((X - 0.22) / 0.52, 0, 1) * Math.PI / 2)
  h -= 0.08 * sstep(0.72, 1.3, X) + 0.055 * sstep(-0.05, -0.95, z)
  const rx = X - WW[0], rz = z - WW[1], th = Math.atan2(rz, rx)
  for (let i = 0; i < TH.length - 1; i++) {
    if (th <= TH[i] && th >= TH[i + 1]) {
      const b = Math.sin(Math.PI * (th - TH[i + 1]) / (TH[i] - TH[i + 1]))
      h += 0.026 * b * b * sstep(0.05, 0.3, Math.hypot(rx, rz))
    }
  }
  return h
}
// Outline: leading edge in front of the arm, round the leading finger, then scallops between the finger tips.
const wingOutline = (() => {
  const pts = [IR, [0.22, -0.105], [0.36, -0.05], [0.50, 0.012], [0.62, 0.078], [0.735, 0.138]]
  const f1 = FINGERS[0]
  for (let k = 2; k < f1.length - 1; k++) {
    const t = norm([f1[k + 1][0] - f1[k - 1][0], 0, f1[k + 1][1] - f1[k - 1][1]])
    pts.push([f1[k][0] + t[2] * -0.012, f1[k][1] + t[0] * 0.012])
  }
  const edge = [...TIPS, IB], depth = [0.095, 0.095, 0.07, 0.05]
  for (let i = 0; i < edge.length - 1; i++) {
    const a = edge[i], b = edge[i + 1]
    pts.push(a)
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const inw = norm([WW[0] - mid[0], 0, WW[1] - mid[1]])
    for (let k = 1; k < 7; k++) {
      const u = k / 7, w = 4 * u * (1 - u) * depth[i]
      pts.push([a[0] + (b[0] - a[0]) * u + inw[0] * w, a[1] + (b[1] - a[1]) * u + inw[2] * w])
    }
  }
  pts.push(IB)
  return poly2(pts)
})()
// An old tear in the right wing's trailing edge.
const tearA = poly2([[0.99, -0.80], [0.935, -0.47], [0.90, -0.80]]), tearB = poly2([[0.70, -0.95], [0.665, -0.76], [0.63, -0.95]])
const tear = (X, z) => Math.min(tearA(X, z), tearB(X, z))
const outlineFor = (s) => (s > 0 ? wingOutline : (X, z) => Math.max(wingOutline(X, z), -tear(X, z)))
/** War band: a broad stripe across the finger panels, following the trailing edge. */
function bandDist(X, z) {
  const rx = X - WW[0], rz = z - WW[1], rw = Math.hypot(rx, rz), th = Math.atan2(rz, rx)
  let len = FLEN[0]
  if (th <= TH[3]) len = FLEN[3]
  else for (let i = 0; i < 3; i++) if (th <= TH[i] && th >= TH[i + 1]) len = FLEN[i] + (FLEN[i + 1] - FLEN[i]) * (TH[i] - th) / (TH[i] - TH[i + 1])
  return Math.max((Math.abs(rw / len - 0.59) - 0.085) * len, (TH[3] - 0.012 - th) * rw)
}
const fingerDist = (X, z) => {
  let d = Infinity
  for (const f of [...FINGERS, ARM]) for (let k = 0; k < f.length - 1; k++) d = Math.min(d, segDist2(X, z, f[k], f[k + 1]))
  return d
}
for (const [side, { s }] of Object.entries(LIMB)) {
  const wingBone = `wing_${side}`
  const skin = { rigid: { [wingBone]: 1 }, occluder: wingBone }
  const outline = outlineFor(s)
  const box = s > 0 ? [[0.12, 0.66, -1.0], [1.3, 1.0, 0.18]] : [[-1.3, 0.66, -1.0], [-0.12, 1.0, 0.18]]
  const sheet = (T, cut) => node((x, y, z) => {
    const X = s * x
    const dy = Math.abs(y - wingH(X, z)) - T
    if (dy > 0.03) return dy
    return Math.max(dy, cut(X, z)) - 0.002
  }, box[0], box[1])
  const membrane = sheet(0.006, (X, z) => Math.max(outline(X, z), -(bandDist(X, z) + 0.006)))
  piece(`wing_membrane_${side}`, 'soft', membrane, (x, y, z) => {
    const X = s * x
    const e = -outline(X, z), fd = fingerDist(X, z)
    const rx = X - WW[0], rz = z - WW[1], rw = Math.hypot(rx, rz), th = Math.atan2(rz, rx)
    const warp = fbm(X * 6, 1.7, z * 6, 3)
    // Veins fanning from the wrist, and a fainter branching net between them.
    const q = th * 8.5 + warp * 1.8, v1 = Math.abs(q - Math.floor(q) - 0.5) * rw / 8.5
    const vein = sstep(0.0085, 0.003, v1) * sstep(0.1, 0.22, rw)
    const net = 0.5 * sstep(0.9, 0.975, 1 - Math.abs(2 * fbm(X * 8, 4.2, z * 8, 2) - 1))
    let c = mix(C.membrane, C.membraneLit, 0.75 * sstep(0.015, 0.12, fd) * sstep(0.0, 0.1, e)) // thin skin glows mid-panel
    c = shade(c, 0.86 + 0.28 * fbm(th * 9, rw * 2.5, 0.3, 2)) // fibres
    c = mix(c, C.vein, 0.85 * Math.max(vein, net))
    c = mix(C.membraneDark, c, 0.3 + 0.7 * sstep(0.0, 0.035, e)) // dark hem
    return shade(c, 0.75 + 0.25 * sstep(0.0, 0.03, bandDist(X, z))) // grime along the war band
  }, skin, 0.005, { ratio: 0.02, err: 0.003, cw: 0.5 })
  const bandSheet = sheet(0.008, (X, z) => Math.max(outline(X, z) + 0.004, bandDist(X, z)))
  piece(`wing_band_${side}`, 'team', bandSheet, (x, y, z) => {
    const X = s * x
    const d = -bandDist(X, z)
    const k = (0.95 - 0.16 * fbm(X * 9, 0.5, z * 9, 2)) * (0.42 + 0.58 * sstep(0.008, 0.02, d)) * (0.8 + 0.2 * sstep(0.0, 0.03, fingerDist(X, z)))
    return [k, k, k]
  }, skin, 0.005, { ratio: 0.03, err: 0.003, cw: 0.3 })

  // Arm and finger bones lying in the membrane.
  const up = (p, dy = 0.006) => [s * p[0], wingH(p[0], p[1]) + dy, p[1]]
  const bones = union(0.012,
    sphere([s * 0.22, 0.83, -0.18], 0.058),
    capsule(up(WO, 0.004), up(WE, 0.012), 0.046, 0.036), sphere(up(WE, 0.012), 0.04),
    capsule(up(WE, 0.012), up(WW, 0.012), 0.036, 0.029), sphere(up(WW, 0.012), 0.039),
    ...FINGERS.map((f, i) => chain(f.map((p) => up(p)), i === 0 ? 0.025 : 0.022, 0.008, 0.006)))
  piece(`wing_bones_${side}`, 'soft', bones, (x, y, z) => {
    const X = s * x
    const t = sstep(0.5, 1.1, X) * 0.5 + sstep(0.0, -0.8, z) * 0.5
    return shade(mix(mix(C.hide, C.hideDark, 0.6), C.membraneDark, 0.5 * t), 0.8 + 0.4 * fbm(x * 18, y * 18, z * 18, 2))
  }, skin, undefined, { err: 0.003, cw: 0.3 })
  // Hooked thumb claw at the wrist, and a small claw past each finger tip.
  const claws = [chain([up([0.745, 0.125], 0.014), [s * 0.795, wingH(0.795, 0.2) + 0.03, 0.2], [s * 0.835, wingH(0.835, 0.25) - 0.004, 0.262]], 0.024, 0.004)]
  FINGERS.forEach((f, i) => {
    const a = f[8], b = f[7], d = norm([a[0] - b[0], 0, a[1] - b[1]])
    claws.push(capsule(up(a), add(up([a[0] + d[0] * 0.05, a[1] + d[2] * 0.05]), [0, -0.012, 0]), 0.0095, 0.002))
    void i
  })
  piece(`wing_claws_${side}`, 'soft', union(0, ...claws), clawPaint((x, y, z) => {
    const X = s * x
    const tipD = Math.min(...TIPS.map((t) => Math.hypot(X - t[0], z - t[1])))
    return tipD < 0.09 ? sstep(0.012, 0.045, tipD) : sstep(0.17, 0.25, z)
  }), skin, 0.004)
}

// Bones that pieces may reference must exist.
const boneNames = new Set(BONES.map((b) => b.name))
for (const p of PIECES) {
  const refs = p.skin.rigid ? Object.keys(p.skin.rigid) : p.skin.envelope || []
  for (const r of refs) if (!boneNames.has(r)) throw new Error(`${p.name} references unknown bone ${r}`)
}
void [noise3, star, torus, offset, place, grain, sphere]
