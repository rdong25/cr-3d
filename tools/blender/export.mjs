// Step 1 of the Blender bake: export what Blender needs.
//
//   node tools/blender/export.mjs hero [voxel=0.003]
//
// Writes to .cache/bake/<name>/:
//   high.<group>.{pos,idx,col,attr}   the sculpt re-meshed at ~8x the game density, one
//                                     object per occluder group, with raw paint (no baked
//                                     light) plus per-vertex [kind, curvature]
//   low.{pos,nrm,idx}                 the game mesh as it ships (read from the .glb), minus
//                                     glow parts, in bind pose
//   meta.json                         counts, groups, per-primitive ranges
//
// The sculpt is the same SDF the game mesh comes from, so the two line up exactly;
// Blender then transfers the fine one onto the coarse one as textures.

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cpus } from 'node:os'
import { readGlb, accessorData } from './glb.mjs'
import { SURFACES, GLB_NAME } from './surfaces.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const KINDS = { steel: 0, gold: 1, leather: 2, cloth: 3, mail: 4, bone: 5, painted: 6, skin: 7, wood: 8 }

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

/** Which smart material a piece gets in Blender. A table entry wins; otherwise guess from the material key. */
function kindOf(name, piece, rgb) {
  const table = SURFACES[name] || {}
  for (const [pattern, kind] of Object.entries(table)) if (new RegExp(`^(?:${pattern})$`).test(piece.name)) return KINDS[kind]
  if (piece.material === 'metal') {
    // Warm, saturated paint on a metal piece is gold or brass.
    return rgb[0] > rgb[2] * 1.5 ? KINDS.gold : KINDS.steel
  }
  if (piece.material === 'team') return KINDS.cloth
  return KINDS.leather
}

// --- worker: mesh one piece at high density -------------------------------------------------
if (!isMainThread) {
  const { name, h } = workerData
  const { PIECES } = await import(`../${name}/design.mjs`)
  const { surfaceNets } = await import(`../${name}/mesher.mjs`)
  const { union } = await import(`../${name}/sdf.mjs`)
  const occluderOf = (p) => p.skin.occluder || 'body'
  const occluders = new Map()
  for (const p of PIECES) occluders.set(occluderOf(p), [...(occluders.get(occluderOf(p)) || []), p.sdf])
  for (const [k, list] of occluders) occluders.set(k, union(0, ...list))
  const curvature = (sdf, x, y, z, e = 0.004) => {
    const c = sdf.d(x, y, z)
    return (sdf.d(x + e, y, z) + sdf.d(x - e, y, z) + sdf.d(x, y + e, z) + sdf.d(x, y - e, z) + sdf.d(x, y, z + e) + sdf.d(x, y, z - e) - 6 * c) / (e * e)
  }
  parentPort.on('message', (i) => {
    const pc = PIECES[i]
    // Keep each piece's own density ratio: pieces the design asked to be finer stay finer.
    const raw = surfaceNets(pc.sdf, h * Math.min(1, (pc.res || 0.0065) / 0.0065))
    const everything = occluders.get(occluderOf(pc))
    const nv = raw.positions.length / 3
    const buried = new Uint8Array(nv)
    for (let v = 0; v < nv; v++) buried[v] = everything.d(raw.positions[v * 3], raw.positions[v * 3 + 1], raw.positions[v * 3 + 2]) < -0.004 ? 1 : 0
    const keep = []
    for (let t = 0; t < raw.indices.length; t += 3) {
      const a = raw.indices[t], b = raw.indices[t + 1], c = raw.indices[t + 2]
      if (!(buried[a] && buried[b] && buried[c])) keep.push(a, b, c)
    }
    // Compact, then color.
    const remap = new Int32Array(nv).fill(-1)
    let n = 0
    for (const v of keep) if (remap[v] < 0) remap[v] = n++
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), attr = new Float32Array(n * 2)
    for (let v = 0; v < nv; v++) {
      const o = remap[v]
      if (o < 0) continue
      const x = raw.positions[v * 3], y = raw.positions[v * 3 + 1], z = raw.positions[v * 3 + 2]
      pos.set([x, y, z], o * 3)
      const rgb = pc.paint(x, y, z)
      col.set(rgb.map(toLinear), o * 3)
      const k = curvature(pc.sdf, x, y, z)
      attr[o * 2] = kindOf(name, pc, rgb)
      attr[o * 2 + 1] = sstep(8, 60, k) - sstep(-8, -60, k)
    }
    const idx = new Uint32Array(keep.length)
    for (let t = 0; t < keep.length; t++) idx[t] = remap[keep[t]]
    parentPort.postMessage({ i, pos, col, attr, idx }, [pos.buffer, col.buffer, attr.buffer, idx.buffer])
  })
} else {
  const name = process.argv[2] || 'hero'
  const h = Number(process.argv[3] || 0.003)
  const t0 = Date.now()
  const out = resolve(here, `../../.cache/bake/${name}`)
  mkdirSync(out, { recursive: true })
  const { PIECES } = await import(`../${name}/design.mjs`)

  // --- high poly: all non-glow pieces, in parallel ---------------------------------------------
  const jobs = PIECES.map((p, i) => i).filter((i) => PIECES[i].material !== 'glow')
  // Biggest first so the long ones don't end up queued behind each other.
  const vol = (p) => (p.sdf.max[0] - p.sdf.min[0]) * (p.sdf.max[1] - p.sdf.min[1]) * (p.sdf.max[2] - p.sdf.min[2])
  jobs.sort((a, b) => vol(PIECES[b]) - vol(PIECES[a]))
  const results = new Map()
  await new Promise((done, fail) => {
    let next = 0, running = 0
    const n = Math.min(jobs.length, Math.max(2, cpus().length - 4))
    for (let w = 0; w < n; w++) {
      const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { name, h } })
      const feed = () => {
        if (next < jobs.length) { running++; worker.postMessage(jobs[next++]) }
        else { worker.terminate(); if (running === 0) done() }
      }
      worker.on('message', (r) => { results.set(r.i, r); running--; feed() })
      worker.on('error', fail)
      feed()
    }
  })
  const groups = new Map()
  for (const i of jobs) {
    const g = PIECES[i].skin.occluder || 'body'
    groups.set(g, [...(groups.get(g) || []), results.get(i)])
  }
  const meta = { name, voxel: h, groups: [], low: null }
  let highTris = 0
  for (const [g, parts] of groups) {
    const nv = parts.reduce((s, p) => s + p.pos.length / 3, 0), ni = parts.reduce((s, p) => s + p.idx.length, 0)
    const pos = new Float32Array(nv * 3), col = new Float32Array(nv * 3), attr = new Float32Array(nv * 2), idx = new Uint32Array(ni)
    let vo = 0, io = 0
    for (const p of parts) {
      pos.set(p.pos, vo * 3); col.set(p.col, vo * 3); attr.set(p.attr, vo * 2)
      for (let k = 0; k < p.idx.length; k++) idx[io + k] = p.idx[k] + vo
      vo += p.pos.length / 3; io += p.idx.length
    }
    for (const [ext, arr] of [['pos', pos], ['col', col], ['attr', attr], ['idx', idx]]) writeFileSync(`${out}/high.${g}.${ext}`, Buffer.from(arr.buffer))
    meta.groups.push({ name: g, vertices: nv, triangles: ni / 3 })
    highTris += ni / 3
  }

  // --- low poly: the shipped game mesh, straight from the .glb ---------------------------------
  const glb = readGlb(readFileSync(resolve(here, `../../public/models/${GLB_NAME[name] || name}.glb`)))
  const prims = []
  for (const [mi, mesh] of glb.json.meshes.entries()) for (const [pi, prim] of mesh.primitives.entries()) {
    const mat = glb.json.materials[prim.material]
    if (/_Glow$/.test(mat.name)) continue
    prims.push({ mesh: mi, prim: pi, material: mat.name, pos: accessorData(glb, prim.attributes.POSITION), nrm: accessorData(glb, prim.attributes.NORMAL), idx: accessorData(glb, prim.indices) })
  }
  const nv = prims.reduce((s, p) => s + p.pos.length / 3, 0), ni = prims.reduce((s, p) => s + p.idx.length, 0)
  const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), idx = new Uint32Array(ni)
  let vo = 0, io = 0
  meta.low = { vertices: nv, triangles: ni / 3, prims: [] }
  for (const p of prims) {
    pos.set(p.pos, vo * 3); nrm.set(p.nrm, vo * 3)
    for (let k = 0; k < p.idx.length; k++) idx[io + k] = p.idx[k] + vo
    meta.low.prims.push({ mesh: p.mesh, prim: p.prim, material: p.material, vertexStart: vo, vertexCount: p.pos.length / 3, indexStart: io, indexCount: p.idx.length })
    vo += p.pos.length / 3; io += p.idx.length
  }
  for (const [ext, arr] of [['pos', pos], ['nrm', nrm], ['idx', idx]]) writeFileSync(`${out}/low.${ext}`, Buffer.from(arr.buffer))
  writeFileSync(`${out}/meta.json`, JSON.stringify(meta, null, 2))
  console.log(`high: ${highTris.toLocaleString()} triangles in ${meta.groups.length} objects (${meta.groups.map((g) => g.name).join(', ')}) at ${h * 1000} mm`)
  console.log(`low:  ${(ni / 3).toLocaleString()} triangles, ${nv.toLocaleString()} vertices in ${prims.length} meshes`)
  console.log(`wrote ${out} in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}
