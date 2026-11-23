// Signed-distance "clay" for sculpting characters in code.
//
// Every node is { d(x, y, z) -> signed distance, min: [x,y,z], max: [x,y,z] }.
// Negative = inside. Nodes compose with smooth unions / subtractions /
// intersections, which is what gives the forms their sculpted, organic,
// beveled look instead of the hard seams you get from gluing primitives.

const { sqrt, abs, max, min, cos, sin } = Math

export const node = (d, mn, mx) => ({ d, min: mn, max: mx })
const len3 = (x, y, z) => sqrt(x * x + y * y + z * z)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

// --- rotation helpers --------------------------------------------------------
/** 3x3 rotation matrix (row-major) from XYZ Euler angles. */
export function euler(rx = 0, ry = 0, rz = 0) {
  const cx = cos(rx), sx = sin(rx), cy = cos(ry), sy = sin(ry), cz = cos(rz), sz = sin(rz)
  // R = Rz * Ry * Rx would be ZYX; we want Three's 'XYZ' order: R = Rx * Ry * Rz
  return [
    cy * cz, -cy * sz, sy,
    cx * sz + sx * sy * cz, cx * cz - sx * sy * sz, -sx * cy,
    sx * sz - cx * sy * cz, sx * cz + cx * sy * sz, cx * cy,
  ]
}
/** Rotation matrix whose columns are the given local axes (expressed in world space). */
export function basis(xAxis, yAxis, zAxis) {
  return [xAxis[0], yAxis[0], zAxis[0], xAxis[1], yAxis[1], zAxis[1], xAxis[2], yAxis[2], zAxis[2]]
}
export const norm = (v) => { const l = len3(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l] }
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]

/**
 * Place a node built in its own local frame into the world: p_local = R^T (p - c).
 * Bounds are re-derived from the eight local corners.
 */
export function place(n, c, R) {
  const [a, b, cc, d, e, f, g, h, i] = R
  const out = node((x, y, z) => {
    const px = x - c[0], py = y - c[1], pz = z - c[2]
    return n.d(a * px + d * py + g * pz, b * px + e * py + h * pz, cc * px + f * py + i * pz)
  }, [Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity])
  for (let k = 0; k < 8; k++) {
    const lx = k & 1 ? n.max[0] : n.min[0], ly = k & 2 ? n.max[1] : n.min[1], lz = k & 4 ? n.max[2] : n.min[2]
    const w = [a * lx + b * ly + cc * lz + c[0], d * lx + e * ly + f * lz + c[1], g * lx + h * ly + i * lz + c[2]]
    for (let j = 0; j < 3; j++) { out.min[j] = min(out.min[j], w[j]); out.max[j] = max(out.max[j], w[j]) }
  }
  return out
}

// --- primitives ---------------------------------------------------------------
export function sphere(c, r) {
  return node((x, y, z) => len3(x - c[0], y - c[1], z - c[2]) - r, [c[0] - r, c[1] - r, c[2] - r], [c[0] + r, c[1] + r, c[2] + r])
}

/** Ellipsoid (iq's bound approximation — good enough near the surface). */
export function ellipsoid(c, r, R) {
  const local = node((x, y, z) => {
    const k0 = len3(x / r[0], y / r[1], z / r[2])
    const k1 = len3(x / (r[0] * r[0]), y / (r[1] * r[1]), z / (r[2] * r[2]))
    return k1 === 0 ? -min(r[0], r[1], r[2]) : (k0 * (k0 - 1)) / k1
  }, [-r[0], -r[1], -r[2]], [r[0], r[1], r[2]])
  return R ? place(local, c, R) : place(local, c, [1, 0, 0, 0, 1, 0, 0, 0, 1])
}

/** Round cone / tapered capsule from a (radius ra) to b (radius rb). Exact. */
export function capsule(a, b, ra, rb = ra) {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2]
  const l2 = bax * bax + bay * bay + baz * baz
  const rr = ra - rb, a2 = l2 - rr * rr, il2 = 1 / l2
  const d = (x, y, z) => {
    const pax = x - a[0], pay = y - a[1], paz = z - a[2]
    const yv = pax * bax + pay * bay + paz * baz
    const zv = yv - l2
    const qx = pax * l2 - bax * yv, qy = pay * l2 - bay * yv, qz = paz * l2 - baz * yv
    const x2 = qx * qx + qy * qy + qz * qz
    const y2 = yv * yv * l2, z2 = zv * zv * l2
    const k = Math.sign(rr) * rr * rr * x2
    if (Math.sign(zv) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - rb
    if (Math.sign(yv) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - ra
    return (sqrt(x2 * a2 * il2) + yv * rr) * il2 - ra
  }
  const r = max(ra, rb)
  return node(d, [min(a[0], b[0]) - r, min(a[1], b[1]) - r, min(a[2], b[2]) - r], [max(a[0], b[0]) + r, max(a[1], b[1]) + r, max(a[2], b[2]) + r])
}

/** Rounded box with half-extents h and corner radius rad (rad is inside h). */
export function roundBox(c, h, rad = 0, R) {
  const hx = h[0] - rad, hy = h[1] - rad, hz = h[2] - rad
  const local = node((x, y, z) => {
    const qx = abs(x) - hx, qy = abs(y) - hy, qz = abs(z) - hz
    return len3(max(qx, 0), max(qy, 0), max(qz, 0)) + min(max(qx, qy, qz), 0) - rad
  }, [-h[0], -h[1], -h[2]], [h[0], h[1], h[2]])
  return place(local, c, R || [1, 0, 0, 0, 1, 0, 0, 0, 1])
}

/** Torus in the local XZ plane (ring axis = local Y). */
export function torus(c, ringR, tubeR, R) {
  const local = node((x, y, z) => {
    const q = sqrt(x * x + z * z) - ringR
    return sqrt(q * q + y * y) - tubeR
  }, [-ringR - tubeR, -tubeR, -ringR - tubeR], [ringR + tubeR, tubeR, ringR + tubeR])
  return place(local, c, R || [1, 0, 0, 0, 1, 0, 0, 0, 1])
}

/** Capped cylinder along local Y with rounded rim. */
export function cylinder(c, r, halfH, rad = 0, R) {
  const local = node((x, y, z) => {
    const dx = sqrt(x * x + z * z) - (r - rad), dy = abs(y) - (halfH - rad)
    return min(max(dx, dy), 0) + len3(max(dx, 0), max(dy, 0), 0) - rad
  }, [-r, -halfH, -r], [r, halfH, r])
  return place(local, c, R || [1, 0, 0, 0, 1, 0, 0, 0, 1])
}

/** Half-space: inside where dot(p - c, n) < 0. Unbounded — only use inside intersect/subtract. */
export function halfspace(c, n) {
  const [nx, ny, nz] = norm(n)
  return node((x, y, z) => (x - c[0]) * nx + (y - c[1]) * ny + (z - c[2]) * nz, [-Infinity, -Infinity, -Infinity], [Infinity, Infinity, Infinity])
}

/** Five-point star in the local XY plane (point up = +Y), extruded along local Z (half depth hz). */
export function star(c, rOuter, innerRatio, hz, R) {
  // iq's sdStar5, extruded.
  const k1x = 0.809016994375, k1y = -0.587785252292, k2x = -k1x, k2y = k1y
  const bax = innerRatio * -k1y - 0, bay = innerRatio * k1x - 1
  const bb = bax * bax + bay * bay
  const local = node((x, y, z) => {
    let px = abs(x / rOuter), py = y / rOuter
    let t = 2 * max(k1x * px + k1y * py, 0); px -= t * k1x; py -= t * k1y
    t = 2 * max(k2x * px + k2y * py, 0); px -= t * k2x; py -= t * k2y
    px = abs(px); py -= 1
    const h = clamp((px * bax + py * bay) / bb, 0, 1)
    const d2 = sqrt((px - bax * h) ** 2 + (py - bay * h) ** 2) * Math.sign(py * bax - px * bay) * rOuter
    const dz = abs(z) - hz
    return min(max(d2, dz), 0) + len3(max(d2, 0), max(dz, 0), 0)
  }, [-rOuter, -rOuter, -hz], [rOuter, rOuter, hz])
  return place(local, c, R || [1, 0, 0, 0, 1, 0, 0, 0, 1])
}

/**
 * Tube along a cubic Bezier, radius tapering r0 -> r1. Exposes .param(x,y,z)
 * returning the curve parameter of the nearest segment (for painting gradients).
 */
export function bezierTube(p0, p1, p2, p3, r0, r1, segments = 10, k = 0.012) {
  const pt = (t) => {
    const u = 1 - t
    return [0, 1, 2].map((i) => u * u * u * p0[i] + 3 * u * u * t * p1[i] + 3 * u * t * t * p2[i] + t * t * t * p3[i])
  }
  const segs = []
  for (let i = 0; i < segments; i++) {
    const ta = i / segments, tb = (i + 1) / segments
    segs.push({ cap: capsule(pt(ta), pt(tb), r0 + (r1 - r0) * ta, r0 + (r1 - r0) * tb), ta, tb })
  }
  const u = union(k, ...segs.map((s) => s.cap))
  u.param = (x, y, z) => {
    let best = Infinity, bt = 0
    for (const s of segs) { const d = s.cap.d(x, y, z); if (d < best) { best = d; bt = (s.ta + s.tb) / 2 } }
    return bt
  }
  return u
}

// --- operators ----------------------------------------------------------------
function smin(a, b, k) {
  if (k <= 0) return min(a, b)
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1)
  return b + (a - b) * h - k * h * (1 - h)
}
function smax(a, b, k) { return -smin(-a, -b, k) }

/** Smooth union with blend radius k (k = 0 -> hard union). */
export function union(k, ...nodes) {
  const mn = [0, 1, 2].map((i) => min(...nodes.map((n) => n.min[i])) - k)
  const mx = [0, 1, 2].map((i) => max(...nodes.map((n) => n.max[i])) + k)
  // Bounding-box culling: a node whose box is farther than the current best
  // distance can't affect the result, so skip evaluating it.
  return node((x, y, z) => {
    let d = Infinity
    for (const n of nodes) {
      const bx = max(n.min[0] - x, 0, x - n.max[0]), by = max(n.min[1] - y, 0, y - n.max[1]), bz = max(n.min[2] - z, 0, z - n.max[2])
      const boxD = len3(bx, by, bz)
      if (boxD > d + k + 1e-3) continue
      d = d === Infinity ? n.d(x, y, z) : smin(d, n.d(x, y, z), k)
    }
    return d
  }, mn, mx)
}
/** Carve b out of a with smooth edge k. */
export function subtract(k, a, b) {
  return node((x, y, z) => smax(a.d(x, y, z), -b.d(x, y, z), k), a.min, a.max)
}
/** Keep only where both a and b are solid. */
export function intersect(k, a, b) {
  return node((x, y, z) => smax(a.d(x, y, z), b.d(x, y, z), k),
    [0, 1, 2].map((i) => max(a.min[i], b.min[i])), [0, 1, 2].map((i) => min(a.max[i], b.max[i])))
}
/** Inflate (r > 0) or shrink a node. */
export function offset(n, r) {
  return node((x, y, z) => n.d(x, y, z) - r, n.min.map((v) => v - max(r, 0)), n.max.map((v) => v + max(r, 0)))
}
/**
 * A strip that hugs the surface of `n`: the shell of n inflated by `lift`,
 * limited to |plane distance| < halfWidth. Used for trims, belts and bands that
 * must follow a curved form exactly.
 */
export function band(n, lift, thickness, planePoint, planeNormal, halfWidth, rad = 0.004) {
  const shell = node((x, y, z) => abs(n.d(x, y, z) - lift) - thickness, n.min.map((v) => v - lift - thickness), n.max.map((v) => v + lift + thickness))
  const [nx, ny, nz] = norm(planeNormal)
  const slab = node((x, y, z) => abs((x - planePoint[0]) * nx + (y - planePoint[1]) * ny + (z - planePoint[2]) * nz) - halfWidth, [-Infinity, -Infinity, -Infinity], [Infinity, Infinity, Infinity])
  return intersect(rad, shell, slab)
}

// --- noise for painting -----------------------------------------------------
function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}
/** Smooth value noise in [0,1]. */
export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
  const xf = x - xi, yf = y - yi, zf = z - zi
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf)
  let acc = 0
  for (let k = 0; k < 8; k++) {
    const dx = k & 1, dy = (k >> 1) & 1, dz = (k >> 2) & 1
    acc += hash3(xi + dx, yi + dy, zi + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w)
  }
  return acc
}
export function fbm(x, y, z, octaves = 4) {
  let a = 0.5, f = 1, s = 0, n = 0
  for (let i = 0; i < octaves; i++) { s += a * noise3(x * f, y * f, z * f); n += a; a *= 0.5; f *= 2 }
  return s / n
}

// --- extras used by the arena props ------------------------------------------
/** Capped cone along local Y, centred at c: bottom radius r1, top radius r2, half height h (iq). */
export function cappedCone(c, h, r1, r2) {
  const k2x = r2 - r1, k2y = 2 * h, k2l = k2x * k2x + k2y * k2y
  const r = Math.max(r1, r2)
  return node((x, y, z) => {
    const qx = Math.hypot(x - c[0], z - c[2]), qy = y - c[1]
    const cax = qx - Math.min(qx, qy < 0 ? r1 : r2), cay = Math.abs(qy) - h
    const t = Math.max(0, Math.min(1, ((r2 - qx) * k2x + (h - qy) * k2y) / k2l))
    const cbx = qx - r2 + k2x * t, cby = qy - h + k2y * t
    const s = cbx < 0 && cay < 0 ? -1 : 1
    return s * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby))
  }, [c[0] - r, c[1] - h, c[2] - r], [c[0] + r, c[1] + h, c[2] + r])
}

/**
 * Repeat a node `count` times around the Y axis through `axis` ([x, z]).
 * Build the template at angle 0, i.e. on the +X side of the axis.
 * `offset` rotates the whole ring (radians).
 */
export function repeatAround(n, count, axis = [0, 0], offset = 0, reach = null) {
  const sector = (2 * Math.PI) / count
  const R = reach ?? Math.max(Math.abs(n.min[0] - axis[0]), Math.abs(n.max[0] - axis[0]), Math.abs(n.min[2] - axis[1]), Math.abs(n.max[2] - axis[1]))
  return node((x, y, z) => {
    const dx = x - axis[0], dz = z - axis[1]
    let a = Math.atan2(dz, dx) - offset
    a = a - sector * Math.round(a / sector)
    const r = Math.hypot(dx, dz)
    return n.d(axis[0] + r * Math.cos(a), y, axis[1] + r * Math.sin(a))
  }, [axis[0] - R, n.min[1], axis[1] - R], [axis[0] + R, n.max[1], axis[1] + R])
}
