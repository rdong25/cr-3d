// Builds the static arena props in design.mjs into public/models/arena/*.glb.
//
//   npm run build:arena
//
// Same sculpt -> remesh -> bake -> decimate steps as tools/hero/build.mjs,
// minus skinning and animation. One mesh per material per model.

import * as THREE from 'three'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODELS } from './design.mjs'
import { surfaceNets, simplify, gradient } from '../hero/mesher.mjs'
import { union } from '../hero/sdf.mjs'

globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((r) => { this.result = r; this.onloadend?.() }) }
  readAsDataURL(blob) { blob.arrayBuffer().then((r) => { this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(r).toString('base64')}`; this.onloadend?.() }) }
}
const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js')

const here = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(here, '../../public/models/arena')
const DECIMATE_ERROR = 0.004
const COLOR_WEIGHT = 0.5

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
const AO_STEPS = [[0.02, 1], [0.05, 0.7], [0.1, 0.5], [0.18, 0.35], [0.3, 0.25]]

const MATERIALS = {
  stone: () => new THREE.MeshStandardMaterial({ name: 'Arena_Stone', vertexColors: true, roughness: 0.92 }),
  wood: () => new THREE.MeshStandardMaterial({ name: 'Arena_Wood', vertexColors: true, roughness: 0.85 }),
  metal: () => new THREE.MeshStandardMaterial({ name: 'Arena_Metal', vertexColors: true, roughness: 0.35, metalness: 0.85 }),
  team: () => new THREE.MeshStandardMaterial({ name: 'Arena_Team', vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }),
  roof: () => new THREE.MeshStandardMaterial({ name: 'Arena_Roof', vertexColors: true, roughness: 0.7 }),
  glow: () => new THREE.MeshStandardMaterial({ name: 'Arena_Glow', vertexColors: true, color: 0x2a1404, emissive: 0xffb04a, emissiveIntensity: 1.6 }),
}

for (const [name, pieces] of Object.entries(MODELS)) {
  const t0 = Date.now()
  const everything = union(0, ...pieces.map((p) => p.sdf))
  const height = everything.max[1]
  const groups = {}
  let tris = 0
  for (const pc of pieces) {
    const raw = surfaceNets(pc.sdf, pc.res || 0.02)
    const rv = raw.positions.length / 3
    const buried = new Uint8Array(rv)
    for (let v = 0; v < rv; v++) buried[v] = everything.d(raw.positions[v * 3], raw.positions[v * 3 + 1], raw.positions[v * 3 + 2]) < -0.01 ? 1 : 0
    const keep = []
    for (let i = 0; i < raw.indices.length; i += 3) {
      if (!(buried[raw.indices[i]] && buried[raw.indices[i + 1]] && buried[raw.indices[i + 2]])) keep.push(raw.indices[i], raw.indices[i + 1], raw.indices[i + 2])
    }
    if (!keep.length) { console.warn(`  ! ${name}/${pc.name}: hidden, skipped`); continue }
    const color = new Float32Array(rv * 3)
    for (let v = 0; v < rv; v++) {
      if (buried[v]) continue
      const x = raw.positions[v * 3], y = raw.positions[v * 3 + 1], z = raw.positions[v * 3 + 2]
      let c = pc.paint(x, y, z).map(toLinear)
      if (pc.material !== 'glow') {
        const n = gradient(pc.sdf, x, y, z)
        let occ = 0
        for (const [h, w] of AO_STEPS) occ += (w * Math.max(0, h - everything.d(x + n[0] * h, y + n[1] * h, z + n[2] * h))) / h
        const ao = Math.min(1, Math.max(0, 1 - 0.3 * occ))
        const light = (0.35 + 0.65 * ao) * (0.85 + 0.2 * sstep(0, height, y))
        c = c.map((ch) => ch * light)
      }
      color.set(c, v * 3)
    }
    const mesh = await simplify({ positions: raw.positions, indices: new Uint32Array(keep) }, 0.04, DECIMATE_ERROR, color, 3, COLOR_WEIGHT)
    const nv = mesh.positions.length / 3
    const normal = new Float32Array(nv * 3)
    for (let v = 0; v < nv; v++) normal.set(gradient(pc.sdf, mesh.positions[v * 3], mesh.positions[v * 3 + 1], mesh.positions[v * 3 + 2]), v * 3)
    ;(groups[pc.material] ||= []).push({ positions: mesh.positions, normal, color: mesh.attrs, indices: mesh.indices })
    tris += mesh.indices.length / 3
  }

  const model = new THREE.Group()
  model.name = name
  for (const [mat, parts] of Object.entries(groups)) {
    const nv = parts.reduce((s, p) => s + p.positions.length / 3, 0)
    const ni = parts.reduce((s, p) => s + p.indices.length, 0)
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), idx = new Uint32Array(ni)
    let vo = 0, io = 0
    for (const p of parts) {
      pos.set(p.positions, vo * 3); nor.set(p.normal, vo * 3); col.set(p.color, vo * 3)
      for (let i = 0; i < p.indices.length; i++) idx[io + i] = p.indices[i] + vo
      vo += p.positions.length / 3; io += p.indices.length
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3))
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    g.setIndex(new THREE.BufferAttribute(idx, 1))
    const m = new THREE.Mesh(g, MATERIALS[mat]())
    m.name = `${name}_${mat}`
    model.add(m)
  }
  const glb = await new Promise((res, rej) => new GLTFExporter().parse(model, res, rej, { binary: true }))
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(resolve(OUT_DIR, `${name}.glb`), Buffer.from(glb))
  console.log(`${name}: ${pieces.length} pieces, ${tris} triangles, ${(glb.byteLength / 1024).toFixed(0)} KB, ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}
