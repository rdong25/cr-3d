// Step 3 of the Blender bake: put the UVs and textures Blender produced onto the game model.
//
//   node tools/blender/assemble.mjs hero [out-name] [texture-size=1024]
//
// Starts from the shipped .glb (skeleton, skin weights and animation clips are left exactly as
// they are), and for every non-glow mesh:
//   - splits vertices along UV seams and adds TEXCOORD_0
//   - adds MikkTSpace tangents, the same tangent basis Blender baked the normal map in
//   - drops the baked vertex colors (the textures replace them)
//   - points the material at the color / normal / occlusion-roughness-metal textures

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as mikk from 'three/examples/jsm/libs/mikktspace.module.js'
import { readGlb, accessorData, detachViews, addAccessor, writeGlb } from './glb.mjs'
import { GLB_NAME } from './surfaces.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const name = process.argv[2] || 'hero'
const base = GLB_NAME[name] || name
const outName = process.argv[3] || `${base}-baked`
const SIZE = Number(process.argv[4] || 1024) // texture edge in pixels; bake.py writes this size and its double
const work = resolve(here, `../../.cache/bake/${name}`)
const meta = JSON.parse(readFileSync(`${work}/meta.json`, 'utf8'))
const uvAll = new Float32Array(readFileSync(`${work}/uv.f32`).buffer.slice(0))
const glb = readGlb(readFileSync(resolve(here, `../../public/models/${base}.glb`)))
const { json } = glb
await mikk.ready

const ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963
const old = json.meshes.map((m) => m.primitives.map((p) => ({ ...p, attributes: { ...p.attributes } })))
const source = new Map() // "mesh:prim" -> typed arrays, read before the views are detached
for (const p of meta.low.prims) {
  const prim = old[p.mesh][p.prim]
  source.set(`${p.mesh}:${p.prim}`, {
    pos: accessorData(glb, prim.attributes.POSITION), nrm: accessorData(glb, prim.attributes.NORMAL),
    joints: accessorData(glb, prim.attributes.JOINTS_0), weights: accessorData(glb, prim.attributes.WEIGHTS_0),
    idx: accessorData(glb, prim.indices),
  })
}
detachViews(glb)

let trisTotal = 0, vertsBefore = 0, vertsAfter = 0
for (const p of meta.low.prims) {
  const src = source.get(`${p.mesh}:${p.prim}`)
  const corners = src.idx.length
  // Per-corner arrays for MikkTSpace (it wants unindexed triangles). UVs are in Blender's
  // convention here (v up), which is the convention the normal map was baked in.
  const cp = new Float32Array(corners * 3), cn = new Float32Array(corners * 3), cu = new Float32Array(corners * 2)
  for (let c = 0; c < corners; c++) {
    const v = src.idx[c]
    cp.set(src.pos.subarray(v * 3, v * 3 + 3), c * 3)
    cn.set(src.nrm.subarray(v * 3, v * 3 + 3), c * 3)
    cu[c * 2] = uvAll[(p.indexStart + c) * 2]; cu[c * 2 + 1] = uvAll[(p.indexStart + c) * 2 + 1]
  }
  const ct = mikk.generateTangents(cp, cn, cu)
  // Weld corners back together where vertex, UV and tangent all agree.
  const key = new Map()
  const pos = [], nrm = [], uv = [], tan = [], joints = [], weights = []
  const idx = new Uint32Array(corners)
  const q = (x, s) => Math.round(x * s)
  for (let c = 0; c < corners; c++) {
    const v = src.idx[c]
    const k = `${v}|${q(cu[c * 2], 16384)}|${q(cu[c * 2 + 1], 16384)}|${q(ct[c * 4], 64)}|${q(ct[c * 4 + 1], 64)}|${q(ct[c * 4 + 2], 64)}|${ct[c * 4 + 3] > 0 ? 1 : 0}`
    let n = key.get(k)
    if (n === undefined) {
      n = pos.length / 3
      key.set(k, n)
      pos.push(src.pos[v * 3], src.pos[v * 3 + 1], src.pos[v * 3 + 2])
      nrm.push(src.nrm[v * 3], src.nrm[v * 3 + 1], src.nrm[v * 3 + 2])
      uv.push(cu[c * 2], 1 - cu[c * 2 + 1]) // glTF's v runs down
      tan.push(ct[c * 4], ct[c * 4 + 1], ct[c * 4 + 2], ct[c * 4 + 3])
      for (let j = 0; j < 4; j++) { joints.push(src.joints[v * 4 + j]); weights.push(src.weights[v * 4 + j]) }
    }
    idx[c] = n
  }
  // Quantize what tolerates it (KHR_mesh_quantization): about 40% less geometry to download.
  const nv = pos.length / 3
  const tan16 = new Int16Array(nv * 4), uv16 = new Uint16Array(nv * 2), w8 = new Uint8Array(nv * 4)
  for (let i = 0; i < nv * 4; i++) tan16[i] = Math.round(Math.max(-1, Math.min(1, tan[i])) * 32767)
  for (let i = 0; i < nv * 2; i++) uv16[i] = Math.round(Math.max(0, Math.min(1, uv[i])) * 65535)
  for (let v = 0; v < nv; v++) {
    // Bytes that still sum to exactly 255, so the weights stay normalized.
    let sum = 0, big = 0
    for (let j = 0; j < 4; j++) { w8[v * 4 + j] = Math.round(weights[v * 4 + j] * 255); sum += w8[v * 4 + j]; if (w8[v * 4 + j] > w8[v * 4 + big]) big = j }
    w8[v * 4 + big] += 255 - sum
  }
  const smallJoints = joints.every((j) => j < 256)
  const prim = json.meshes[p.mesh].primitives[p.prim]
  prim.attributes = {
    POSITION: addAccessor(json, new Float32Array(pos), 'VEC3', { target: ARRAY_BUFFER, minMax: true }),
    NORMAL: addAccessor(json, new Float32Array(nrm), 'VEC3', { target: ARRAY_BUFFER }),
    TANGENT: addAccessor(json, tan16, 'VEC4', { target: ARRAY_BUFFER, normalized: true }),
    TEXCOORD_0: addAccessor(json, uv16, 'VEC2', { target: ARRAY_BUFFER, normalized: true }),
    JOINTS_0: addAccessor(json, smallJoints ? new Uint8Array(joints) : new Uint16Array(joints), 'VEC4', { target: ARRAY_BUFFER }),
    WEIGHTS_0: addAccessor(json, w8, 'VEC4', { target: ARRAY_BUFFER, normalized: true }),
  }
  prim.indices = addAccessor(json, nv < 65536 ? new Uint16Array(idx) : idx, 'SCALAR', { target: ELEMENT_ARRAY_BUFFER })
  trisTotal += corners / 3; vertsBefore += src.pos.length / 3; vertsAfter += pos.length / 3
}

json.extensionsUsed = [...new Set([...(json.extensionsUsed || []), 'KHR_mesh_quantization'])]
json.extensionsRequired = [...new Set([...(json.extensionsRequired || []), 'KHR_mesh_quantization'])]

// --- textures ---------------------------------------------------------------------------------
json.images = []; json.textures = []
json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }]
let textureBytes = 0
const texture = (file) => {
  const data = readFileSync(`${work}/${file}`)
  textureBytes += data.byteLength
  json.bufferViews.push({ buffer: 0, _data: new Uint8Array(data) })
  json.images.push({ bufferView: json.bufferViews.length - 1, mimeType: 'image/jpeg', name: file })
  json.textures.push({ sampler: 0, source: json.images.length - 1 })
  return json.textures.length - 1
}
const color = texture(`color.${SIZE}.jpg`), normal = texture(`normal.${SIZE}.jpg`), orm = texture(`orm.${SIZE}.jpg`)
for (const p of meta.low.prims) {
  const m = json.materials[json.meshes[p.mesh].primitives[p.prim].material]
  // Roughness and metalness now come entirely from the map.
  m.pbrMetallicRoughness = { baseColorTexture: { index: color }, metallicRoughnessTexture: { index: orm }, metallicFactor: 1, roughnessFactor: 1 }
  m.normalTexture = { index: normal }
  m.occlusionTexture = { index: orm }
}

// --- drop the data nothing points at any more (old vertex buffers, vertex colors) ---------------
const usedAcc = new Set()
for (const m of json.meshes) for (const p of m.primitives) { Object.values(p.attributes).forEach((a) => usedAcc.add(a)); usedAcc.add(p.indices) }
for (const s of json.skins || []) if (s.inverseBindMatrices !== undefined) usedAcc.add(s.inverseBindMatrices)
for (const a of json.animations || []) for (const s of a.samplers) { usedAcc.add(s.input); usedAcc.add(s.output) }
const accMap = new Map(), viewMap = new Map(), accessors = [], views = []
const keepView = (i) => { if (!viewMap.has(i)) { viewMap.set(i, views.length); views.push(json.bufferViews[i]) } return viewMap.get(i) }
json.accessors.forEach((a, i) => {
  if (!usedAcc.has(i)) return
  accMap.set(i, accessors.length)
  accessors.push({ ...a, bufferView: keepView(a.bufferView) })
})
for (const img of json.images) img.bufferView = keepView(img.bufferView)
for (const m of json.meshes) for (const p of m.primitives) {
  for (const k of Object.keys(p.attributes)) p.attributes[k] = accMap.get(p.attributes[k])
  p.indices = accMap.get(p.indices)
}
for (const s of json.skins || []) if (s.inverseBindMatrices !== undefined) s.inverseBindMatrices = accMap.get(s.inverseBindMatrices)
for (const a of json.animations || []) for (const s of a.samplers) { s.input = accMap.get(s.input); s.output = accMap.get(s.output) }
json.accessors = accessors
json.bufferViews = views

const out = resolve(here, `../../public/models/${outName}.glb`)
mkdirSync(dirname(out), { recursive: true })
const bytes = writeGlb(json)
writeFileSync(out, bytes)
console.log(`${trisTotal.toLocaleString()} triangles, ${vertsBefore.toLocaleString()} -> ${vertsAfter.toLocaleString()} vertices after UV seams`)
console.log(`textures ${(textureBytes / 1024).toFixed(0)} KB; wrote ${out} (${(bytes.byteLength / 1024).toFixed(0)} KB)`)
