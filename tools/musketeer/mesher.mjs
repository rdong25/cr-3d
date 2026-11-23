// SDF -> triangle mesh. Naive Surface Nets (one vertex per surface-crossing
// voxel, quads across every sign-changing edge), then each vertex is snapped
// onto the true surface with a Newton step, then the mesh is decimated with
// meshoptimizer. Normals come from the SDF gradient (not the mesh), so even
// the decimated mesh shades perfectly smooth.

import { MeshoptSimplifier } from 'meshoptimizer'

export function gradient(sdf, x, y, z, e = 0.0015) {
  const gx = sdf.d(x + e, y, z) - sdf.d(x - e, y, z)
  const gy = sdf.d(x, y + e, z) - sdf.d(x, y - e, z)
  const gz = sdf.d(x, y, z + e) - sdf.d(x, y, z - e)
  const l = Math.hypot(gx, gy, gz) || 1
  return [gx / l, gy / l, gz / l]
}

/**
 * @param sdf   node from sdf.mjs
 * @param h     voxel size in model units
 * @returns { positions: Float32Array, indices: Uint32Array }
 */
export function surfaceNets(sdf, h) {
  const pad = 2 * h
  const o = sdf.min.map((v) => v - pad)
  const n = sdf.max.map((v, i) => Math.ceil((v + pad - o[i]) / h) + 1)
  const [nx, ny, nz] = n
  const field = new Float32Array(nx * ny * nz)
  const at = (i, j, k) => i + nx * (j + ny * k)
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    field[at(i, j, k)] = sdf.d(o[0] + i * h, o[1] + j * h, o[2] + k * h)
  }

  // One vertex per cell that straddles the surface: average of edge crossings.
  const cellVert = new Int32Array((nx - 1) * (ny - 1) * (nz - 1)).fill(-1)
  const cAt = (i, j, k) => i + (nx - 1) * (j + (ny - 1) * k)
  const pos = []
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]]
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]]
  const v = new Float32Array(8)
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0
    for (let c = 0; c < 8; c++) {
      const [a, b, d] = corners[c]
      v[c] = field[at(i + a, j + b, k + d)]
      if (v[c] < 0) mask |= 1 << c
    }
    if (mask === 0 || mask === 255) continue
    let sx = 0, sy = 0, sz = 0, cnt = 0
    for (const [e0, e1] of edges) {
      if ((v[e0] < 0) === (v[e1] < 0)) continue
      const t = v[e0] / (v[e0] - v[e1])
      const A = corners[e0], B = corners[e1]
      sx += A[0] + (B[0] - A[0]) * t; sy += A[1] + (B[1] - A[1]) * t; sz += A[2] + (B[2] - A[2]) * t; cnt++
    }
    cellVert[cAt(i, j, k)] = pos.length / 3
    pos.push(o[0] + (i + sx / cnt) * h, o[1] + (j + sy / cnt) * h, o[2] + (k + sz / cnt) * h)
  }

  // Quads across every sign-changing grid edge.
  const idx = []
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return
    if (flip) idx.push(a, c, b, a, d, c)
    else idx.push(a, b, c, a, c, d)
  }
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const inside = field[at(i, j, k)] < 0
    // x-edge (i,j,k)-(i+1,j,k): cells around it vary in j,k
    if (inside !== (field[at(i + 1, j, k)] < 0)) {
      quad(cellVert[cAt(i, j - 1, k - 1)], cellVert[cAt(i, j, k - 1)], cellVert[cAt(i, j, k)], cellVert[cAt(i, j - 1, k)], !inside)
    }
    if (inside !== (field[at(i, j + 1, k)] < 0)) {
      quad(cellVert[cAt(i - 1, j, k - 1)], cellVert[cAt(i - 1, j, k)], cellVert[cAt(i, j, k)], cellVert[cAt(i, j, k - 1)], !inside)
    }
    if (inside !== (field[at(i, j, k + 1)] < 0)) {
      quad(cellVert[cAt(i - 1, j - 1, k)], cellVert[cAt(i, j - 1, k)], cellVert[cAt(i, j, k)], cellVert[cAt(i - 1, j, k)], !inside)
    }
  }

  // Snap every vertex onto the exact surface (two Newton steps along the gradient).
  for (let p = 0; p < pos.length; p += 3) {
    for (let it = 0; it < 2; it++) {
      const d = sdf.d(pos[p], pos[p + 1], pos[p + 2])
      const g = gradient(sdf, pos[p], pos[p + 1], pos[p + 2])
      const step = Math.max(-h, Math.min(h, d))
      pos[p] -= g[0] * step; pos[p + 1] -= g[1] * step; pos[p + 2] -= g[2] * step
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) }
}

/**
 * Decimate to `ratio` of the triangles while staying within `error` (model units).
 * `attrs` (per-vertex Float32Array, `stride` floats each) are preserved too —
 * e.g. baked colors — so paint boundaries keep the vertices they need.
 */
export async function simplify(mesh, ratio, error, attrs = null, stride = 0, attrWeight = 1) {
  await MeshoptSimplifier.ready
  MeshoptSimplifier.useExperimentalFeatures = true
  const target = Math.floor((mesh.indices.length * ratio) / 3) * 3
  const scale = MeshoptSimplifier.getScale(mesh.positions, 3)
  const [indices] = attrs
    ? MeshoptSimplifier.simplifyWithAttributes(mesh.indices, mesh.positions, 3, attrs, stride, new Array(stride).fill(attrWeight), null, target, error / scale, [])
    : MeshoptSimplifier.simplify(mesh.indices, mesh.positions, 3, target, error / scale, [])
  // Compact: drop vertices no triangle uses any more.
  const remap = new Int32Array(mesh.positions.length / 3).fill(-1)
  const out = [], outAttr = []
  let nv = 0
  const newIdx = new Uint32Array(indices.length)
  for (let i = 0; i < indices.length; i++) {
    const old = indices[i]
    if (remap[old] < 0) {
      remap[old] = nv++
      out.push(mesh.positions[old * 3], mesh.positions[old * 3 + 1], mesh.positions[old * 3 + 2])
      for (let k = 0; k < stride; k++) outAttr.push(attrs[old * stride + k])
    }
    newIdx[i] = remap[old]
  }
  return { positions: new Float32Array(out), indices: newIdx, attrs: attrs ? new Float32Array(outAttr) : null }
}
