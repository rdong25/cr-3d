// Builds public/models/ember-warden.glb from design.mjs + animations.mjs.
//
//   npm run build:hero
//
// Pipeline (the same stages an artist's tools run, just in code):
//   sculpt (SDF pieces) -> remesh (surface nets) -> decimate (meshoptimizer)
//   -> bake (ambient occlusion, curvature edge-wear, top-down gradient into
//   vertex colors) -> skin (bone weights) -> keyframe clips -> export glTF.

import * as THREE from 'three'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BONES, PIECES } from './design.mjs'
import { CLIPS } from './animations.mjs'
import { surfaceNets, simplify, gradient } from './mesher.mjs'
import { union } from './sdf.mjs'

// GLTFExporter is browser code; give it the one browser API it needs in Node.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((r) => { this.result = r; this.onloadend?.() }) }
  readAsDataURL(blob) { blob.arrayBuffer().then((r) => { this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(r).toString('base64')}`; this.onloadend?.() }) }
}
const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')

const here = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(here, '../../public/models/giant.glb')
const DEFAULT_RES = 0.0065 // voxel size, model units (~6.5 mm on a 1.8 m hero)
const DECIMATE_RATIO = 0.05 // ask for a lot; the error bound decides where detail stays
const DECIMATE_ERROR = 0.0022
const COLOR_WEIGHT = 0.6

const t0 = Date.now()
const boneIndex = new Map(BONES.map((b, i) => [b.name, i]))
// Separately-moving props (shield, sword) only occlude themselves: in the rest
// pose they sit where the body won't be once animated, so cross-occlusion
// would bake wrong shadows.
const occluderOf = (p) => p.skin.occluder || 'body'
const occluders = new Map()
for (const p of PIECES) occluders.set(occluderOf(p), [...(occluders.get(occluderOf(p)) || []), p.sdf])
for (const [k, list] of occluders) occluders.set(k, union(0, ...list))

// --- bakes -------------------------------------------------------------------
const AO_STEPS = [[0.008, 1], [0.02, 0.7], [0.04, 0.5], [0.07, 0.35], [0.11, 0.25]]
function ambientOcclusion(everything, x, y, z, n) {
  let occ = 0
  for (const [h, w] of AO_STEPS) occ += (w * Math.max(0, h - everything.d(x + n[0] * h, y + n[1] * h, z + n[2] * h))) / h
  return Math.min(1, Math.max(0, 1 - 0.32 * occ))
}
function curvature(sdf, x, y, z, e = 0.006) {
  const c = sdf.d(x, y, z)
  const s = sdf.d(x + e, y, z) + sdf.d(x - e, y, z) + sdf.d(x, y + e, z) + sdf.d(x, y - e, z) + sdf.d(x, y, z + e) + sdf.d(x, y, z - e)
  return (s - 6 * c) / (e * e)
}
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))

function segDist(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]]
  const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)))
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t)
}
function weights(skin, p) {
  let list
  if (skin.rigid) list = Object.entries(skin.rigid)
  else if (skin.fn) list = Object.entries(skin.fn(p[0], p[1], p[2]))
  else {
    const ds = skin.envelope.map((name) => { const b = BONES[boneIndex.get(name)]; return [name, segDist(p, b.pos, b.tail)] })
    const dmin = Math.min(...ds.map((d) => d[1]))
    list = ds.map(([name, d]) => [name, Math.exp(-(d - dmin) / 0.028)])
  }
  list.sort((a, b) => b[1] - a[1])
  list = list.slice(0, 4)
  const sum = list.reduce((s, w) => s + w[1], 0)
  const idx = [0, 0, 0, 0], wt = [0, 0, 0, 0]
  list.forEach(([name, w], i) => { idx[i] = boneIndex.get(name); wt[i] = w / sum })
  return { idx, wt }
}

/** Paint + baked lighting for one surface point, returned in linear RGB. */
function bake(pc, x, y, z, n) {
  let c = pc.paint(x, y, z).map(toLinear)
  if (pc.material === 'glow') return c
  const ao = ambientOcclusion(occluders.get(occluderOf(pc)), x, y, z, n)
  const k = curvature(pc.sdf, x, y, z)
  const convex = sstep(10, 70, k), concave = sstep(-10, -70, k)
  const light = (0.3 + 0.7 * ao) * (0.8 + 0.25 * sstep(0, 1.7, y)) * (1 - 0.35 * concave)
  c = c.map((ch) => ch * light)
  // Painted edge wear: bright highlights on convex edges (strongest on metal).
  const wear = convex * (pc.material === 'metal' ? 0.55 : 0.2)
  return c.map((ch) => ch + (Math.min(1, ch * 1.6 + 0.06) - ch) * wear)
}

// --- mesh every piece ------------------------------------------------------------
const groups = { soft: [], metal: [], team: [], glow: [] }
const stats = []
for (const pc of PIECES) {
  const raw = surfaceNets(pc.sdf, pc.res || DEFAULT_RES)
  // Drop triangles fully buried inside other pieces (never visible).
  const keep = []
  const buried = new Uint8Array(raw.positions.length / 3)
  const everything = occluders.get(occluderOf(pc))
  for (let v = 0; v < buried.length; v++) buried[v] = everything.d(raw.positions[v * 3], raw.positions[v * 3 + 1], raw.positions[v * 3 + 2]) < -0.004 ? 1 : 0
  for (let i = 0; i < raw.indices.length; i += 3) {
    if (!(buried[raw.indices[i]] && buried[raw.indices[i + 1]] && buried[raw.indices[i + 2]])) keep.push(raw.indices[i], raw.indices[i + 1], raw.indices[i + 2])
  }
  if (keep.length === 0) { console.warn(`  ! ${pc.name}: completely hidden, skipped`); continue }
  // Bake color for every raw vertex first, so decimation can respect paint edges.
  const rv = raw.positions.length / 3
  const bakedColor = new Float32Array(rv * 3)
  for (let v = 0; v < rv; v++) {
    if (buried[v]) continue
    const x = raw.positions[v * 3], y = raw.positions[v * 3 + 1], z = raw.positions[v * 3 + 2]
    bakedColor.set(bake(pc, x, y, z, gradient(pc.sdf, x, y, z)), v * 3)
  }
  const mesh = await simplify({ positions: raw.positions, indices: new Uint32Array(keep) }, DECIMATE_RATIO, DECIMATE_ERROR, bakedColor, 3, COLOR_WEIGHT)
  const nv = mesh.positions.length / 3
  const normal = new Float32Array(nv * 3), color = mesh.attrs
  const skinIndex = new Uint16Array(nv * 4), skinWeight = new Float32Array(nv * 4)
  for (let v = 0; v < nv; v++) {
    const x = mesh.positions[v * 3], y = mesh.positions[v * 3 + 1], z = mesh.positions[v * 3 + 2]
    normal.set(gradient(pc.sdf, x, y, z), v * 3)
    const { idx, wt } = weights(pc.skin, [x, y, z])
    skinIndex.set(idx, v * 4); skinWeight.set(wt, v * 4)
  }
  groups[pc.material].push({ positions: mesh.positions, normal, color, skinIndex, skinWeight, indices: mesh.indices })
  stats.push([pc.name, raw.indices.length / 3, mesh.indices.length / 3])
}

function merge(parts) {
  const nv = parts.reduce((s, p) => s + p.positions.length / 3, 0)
  const ni = parts.reduce((s, p) => s + p.indices.length, 0)
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3)
  const si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4), idx = new Uint32Array(ni)
  let vo = 0, io = 0
  for (const p of parts) {
    const n = p.positions.length / 3
    pos.set(p.positions, vo * 3); nor.set(p.normal, vo * 3); col.set(p.color, vo * 3)
    si.set(p.skinIndex, vo * 4); sw.set(p.skinWeight, vo * 4)
    for (let i = 0; i < p.indices.length; i++) idx[io + i] = p.indices[i] + vo
    vo += n; io += p.indices.length
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4))
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4))
  g.setIndex(new THREE.BufferAttribute(idx, 1))
  g.computeBoundingBox(); g.computeBoundingSphere()
  return g
}

// --- skeleton + skinned meshes ---------------------------------------------------------------
const model = new THREE.Group()
model.name = 'Giant'
const bones = BONES.map((b) => { const bone = new THREE.Bone(); bone.name = b.name; return bone })
BONES.forEach((b, i) => {
  const parent = b.parent ? BONES[boneIndex.get(b.parent)] : null
  bones[i].position.set(b.pos[0] - (parent ? parent.pos[0] : 0), b.pos[1] - (parent ? parent.pos[1] : 0), b.pos[2] - (parent ? parent.pos[2] : 0))
  if (parent) bones[boneIndex.get(b.parent)].add(bones[i])
})
model.add(bones[0])
model.updateMatrixWorld(true)
const skeleton = new THREE.Skeleton(bones)

const MATERIALS = {
  soft: new THREE.MeshStandardMaterial({ name: 'Warden_Soft', vertexColors: true, roughness: 0.78, metalness: 0 }),
  metal: new THREE.MeshStandardMaterial({ name: 'Warden_Metal', vertexColors: true, roughness: 0.33, metalness: 0.9 }),
  team: new THREE.MeshStandardMaterial({ name: 'Warden_Team', vertexColors: true, roughness: 0.7, metalness: 0 }),
  glow: new THREE.MeshStandardMaterial({ name: 'Warden_Glow', vertexColors: true, color: 0x2a1004, emissive: 0xff7a1f, emissiveIntensity: 3.2, roughness: 0.4 }),
}
let totalTris = 0
for (const [mat, parts] of Object.entries(groups)) {
  if (!parts.length) continue
  const geo = merge(parts)
  totalTris += geo.index.count / 3
  const mesh = new THREE.SkinnedMesh(geo, MATERIALS[mat])
  mesh.name = `Warden_${mat[0].toUpperCase()}${mat.slice(1)}`
  model.add(mesh)
  mesh.bind(skeleton)
}

// --- animation clips ----------------------------------------------------------------
const FPS = 30
const clips = CLIPS.map((clip) => {
  const frames = Math.round(clip.duration * FPS) + 1
  const times = new Float32Array(frames)
  const quats = new Map(BONES.map((b) => [b.name, new Float32Array(frames * 4)]))
  const posTracked = ['root', 'hips']
  const poss = new Map(posTracked.map((n) => [n, new Float32Array(frames * 3)]))
  const e = new THREE.Euler(), q = new THREE.Quaternion()
  for (let f = 0; f < frames; f++) {
    const t = f === frames - 1 ? clip.duration : f / FPS
    times[f] = t
    const pose = clip.pose(clip.loop && f === frames - 1 ? 0 : t)
    for (const b of BONES) {
      const r = pose[b.name] || [0, 0, 0]
      e.set(r[0], r[1], r[2], 'XYZ'); q.setFromEuler(e)
      quats.get(b.name).set([q.x, q.y, q.z, q.w], f * 4)
    }
    for (const name of posTracked) {
      const rest = bones[boneIndex.get(name)].position
      const d = (pose.pos && pose.pos[name]) || [0, 0, 0]
      poss.get(name).set([rest.x + d[0], rest.y + d[1], rest.z + d[2]], f * 3)
    }
  }
  const tracks = []
  for (const b of BONES) tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, quats.get(b.name)))
  for (const name of posTracked) tracks.push(new THREE.VectorKeyframeTrack(`${name}.position`, times, poss.get(name)))
  return new THREE.AnimationClip(clip.name, clip.duration, tracks)
})

// --- export -----------------------------------------------------------------------
const glb = await new Promise((res, rej) => new GLTFExporter().parse(model, res, rej, { binary: true, animations: clips }))
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, Buffer.from(glb))

for (const [name, raw, out] of stats) console.log(`  ${name.padEnd(22)} ${String(raw).padStart(7)} -> ${String(out).padStart(6)} tris`)
console.log(`\n${PIECES.length} pieces, ${totalTris} triangles, ${bones.length} bones, ${clips.length} clips (${clips.map((c) => c.name).join(', ')})`)
console.log(`wrote ${OUT} (${(glb.byteLength / 1024).toFixed(0)} KB) in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
