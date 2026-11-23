import * as THREE from 'three'
import { LOW_POWER } from './quality'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Side } from './types'
import { TEAM_COLORS } from './hero'
import { pbrSet, splatGround, triplanarPBR } from './pbr'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { Water } from 'three/examples/jsm/objects/Water.js'

/** Deeper, less toy-like team colors for cloth and roofs in the arena. */
const ARENA_TEAM: Record<Side, number> = { blue: 0x24407e, red: 0x7e1c1c }

// Arena dressing: sculpted towers + bridge (.glb from tools/arena), and the
// field itself (grass, lanes, river, stone curbs) with procedural textures.
//
// Stone / wood / roof surfaces get their small detail from tiled canvas
// textures projected from three sides in the shader ("triplanar"), so curved
// sculpted meshes need no UVs and bricks stay crisp at any distance.

const BASE = `${import.meta.env.BASE_URL}models/arena/`
const MODEL_FILES = { princess: 'tower-princess.glb', king: 'tower-king.glb', bridge: 'bridge.glb' } as const
type PropName = keyof typeof MODEL_FILES

const models = new Map<PropName, THREE.Group>()
let loading: Promise<void> | null = null

export function preloadArena(): Promise<void> {
  if (!loading) {
    const loader = new GLTFLoader()
    loading = Promise.all(
      (Object.keys(MODEL_FILES) as PropName[]).map((k) => loader.loadAsync(BASE + MODEL_FILES[k]).then((g) => { models.set(k, g.scene) })),
    ).then(() => undefined)
    loading.catch((err) => { console.warn('Arena props failed to load; using simple towers.', err); loading = null })
  }
  return loading
}
export const arenaReady = () => models.size === Object.keys(MODEL_FILES).length

// --- procedural textures ------------------------------------------------------
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, r: () => number) => void, seed: number, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = w; c.height = h
  draw(c.getContext('2d')!, rng(seed))
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}
const cache = new Map<string, THREE.Texture>()
const once = (k: string, make: () => THREE.Texture) => cache.get(k) ?? (cache.set(k, make()), cache.get(k)!)




// --- props ----------------------------------------------------------------------
const matCache = new Map<string, THREE.Material>()
function dressMaterial(m: THREE.MeshStandardMaterial, side: Side | null, env: THREE.Texture | null): THREE.Material {
  const key = `${m.uuid}:${side ?? '-'}`
  const hit = matCache.get(key)
  if (hit) return hit
  const c = m.clone()
  c.envMap = null // use scene.environment (the HDR sky once loaded)
  void env
  c.envMapIntensity = c.name === 'Arena_Metal' ? 1.0 : 0.6
  if (c.name === 'Arena_Stone') triplanarPBR(c, pbrSet('stone'), 2.0)
  if (c.name === 'Arena_Wood') triplanarPBR(c, pbrSet('wood'), 1.4)
  if (c.name === 'Arena_Roof') { c.color.setHex(side ? ARENA_TEAM[side] : 0xffffff).multiplyScalar(1.6); triplanarPBR(c, pbrSet('roof'), 1.0) }
  if (c.name === 'Arena_Team' && side) c.color.setHex(ARENA_TEAM[side])
  if (c.name === 'Arena_Metal') c.color.setHex(0xb39a6a) // antique gold rather than toy yellow
  matCache.set(key, c)
  return c
}
function instance(name: PropName, side: Side | null, env: THREE.Texture | null): THREE.Group {
  const g = models.get(name)!.clone(true)
  g.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.material = dressMaterial(mesh.material as THREE.MeshStandardMaterial, side, env)
    mesh.castShadow = true
    mesh.receiveShadow = true
  })
  return g
}
/** Height of the platform the tower's figure stands on. */
export const TOWER_FLOOR = { princess: 2.65, king: 3.46 }
export const makeTower = (kind: 'princess' | 'king', side: Side, env: THREE.Texture | null) => instance(kind, side, env)
export const makeBridge = (env: THREE.Texture | null) => instance('bridge', null, env)

// --- the field --------------------------------------------------------------------
const FIELD_W = 26, FIELD_D = 30

/**
 * Splat mask for the ground: red = how much dirt (lanes, around towers),
 * green = broad brightness variation. Black = grass.
 */
function groundMask(towers: { x: number; z: number; r: number }[]) {
  const W = 520, H = 600, sx = W / FIELD_W, sz = H / FIELD_D
  const toPx = (x: number, z: number) => [(x + FIELD_W / 2) * sx, (z + FIELD_D / 2) * sz]
  return canvasTex(W, H, (g, r) => {
    g.fillStyle = 'rgb(0,128,0)'; g.fillRect(0, 0, W, H)
    // Broad light/dark variation (green channel).
    for (let i = 0; i < 260; i++) {
      const v = Math.floor(70 + r() * 120)
      g.fillStyle = `rgba(0,${v},0,0.18)`
      g.beginPath(); g.arc(r() * W, r() * H, (1 + r() * 3) * sx, 0, Math.PI * 2); g.fill()
    }
    g.globalCompositeOperation = 'lighter'
    const blob = (x: number, z: number, rad: number, a: number) => {
      const [px, pz] = toPx(x, z)
      const grad = g.createRadialGradient(px, pz, 0, px, pz, rad * sx)
      grad.addColorStop(0, `rgba(255,0,0,${a})`); grad.addColorStop(1, 'rgba(255,0,0,0)')
      g.fillStyle = grad; g.beginPath(); g.arc(px, pz, rad * sx, 0, Math.PI * 2); g.fill()
    }
    // Worn lanes from each tower to its bridge, plus scuffs around towers and bridges.
    for (const x of [-4.2, 4.2]) for (const [z0, z1] of [[-11, -1.3], [1.3, 11]]) {
      for (let i = 0; i < 140; i++) blob(x + (r() - 0.5) * 1.4, z0 + (z1 - z0) * r(), 0.5 + r() * 0.7, 0.16)
    }
    for (const t of towers) for (let i = 0; i < 50; i++) {
      const a = r() * Math.PI * 2, d = t.r * (0.7 + r() * 0.6)
      blob(t.x + Math.cos(a) * d, t.z + Math.sin(a) * d, 0.5 + r() * 0.8, 0.2)
    }
    for (const x of [-4.2, 4.2]) for (const z of [-1.8, 1.8]) blob(x, z, 1.4, 0.6)
    g.globalCompositeOperation = 'source-over'
  }, 5, false)
}
/** Tileable ripple normal map for the river. */
const waterNormals = () => once('waterN', () => canvasTex(256, 256, (g, r) => {
  const img = g.createImageData(256, 256)
  const hgt = (x: number, y: number) => {
    let v = 0
    for (let k = 0; k < 5; k++) {
      const fx = (k + 1) * 2, fy = (k + 2) * 1.5, ph = k * 1.7
      v += Math.sin((x / 256) * Math.PI * 2 * fx + Math.sin((y / 256) * Math.PI * 2 * (k + 1)) * 1.3 + ph) * Math.cos((y / 256) * Math.PI * 2 * fy + ph) / (k + 1)
    }
    return v
  }
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const dx = hgt(x + 1, y) - hgt(x - 1, y), dy = hgt(x, y + 1) - hgt(x, y - 1)
    const n = new THREE.Vector3(-dx * 1.2, -dy * 1.2, 1).normalize()
    const i = (y * 256 + x) * 4
    img.data[i] = (n.x * 0.5 + 0.5) * 255; img.data[i + 1] = (n.y * 0.5 + 0.5) * 255; img.data[i + 2] = (n.z * 0.5 + 0.5) * 255; img.data[i + 3] = 255
  }
  g.putImageData(img, 0, 0)
  void r
}, 3, false))

export interface Field { water: THREE.Material; update(t: number): void }

/** Alpha-tested grass blades, painted once. */
const bladeTex = () => once('blades', () => canvasTex(128, 128, (g, r) => {
  g.clearRect(0, 0, 128, 128)
  for (let i = 0; i < 22; i++) {
    const x = 10 + r() * 108, h = 60 + r() * 64, lean = (r() - 0.5) * 30, w = 3 + r() * 3
    const l = 150 + r() * 90
    g.fillStyle = `rgb(${l * 0.72},${l},${l * 0.5})`
    g.beginPath(); g.moveTo(x - w, 128); g.quadraticCurveTo(x + lean * 0.4, 128 - h * 0.6, x + lean, 128 - h); g.lineTo(x + w, 128); g.closePath(); g.fill()
  }
}, 41))

/** Is (x, z) open grass, i.e. not a lane, tower base, river or bridge approach? */
function isOpenGrass(x: number, z: number, towers: { x: number; z: number; r: number }[]) {
  if (Math.abs(z) < 1.8) return false
  if (Math.abs(Math.abs(x) - 4.2) < 1.2 && Math.abs(z) < 11) return false
  for (const t of towers) if (Math.hypot(x - t.x, z - t.z) < t.r + 0.6) return false
  return Math.abs(x) < FIELD_W / 2 - 0.4 && Math.abs(z) < FIELD_D / 2 - 0.4
}

/** Instanced grass tufts (with wind) and pebbles scattered over open grass. */
function scatterClutter(scene: THREE.Scene, towers: { x: number; z: number; r: number }[], phone: boolean) {
  const rand = rng(77)
  const pick = (n: number) => {
    const out: [number, number][] = []
    for (let tries = 0; out.length < n && tries < n * 20; tries++) {
      const x = (rand() - 0.5) * FIELD_W, z = (rand() - 0.5) * FIELD_D
      if (isOpenGrass(x, z, towers)) out.push([x, z])
    }
    return out
  }
  // Grass: three crossed quads per tuft.
  const quads = [0, 1, 2].map((i) => { const q = new THREE.PlaneGeometry(0.5, 0.38); q.translate(0, 0.19, 0); q.rotateY((i * Math.PI) / 3); return q })
  const tuftGeo = mergeGeometries(quads)!
  // Foliage trick: light the cards as if they were the ground they grow from,
  // instead of by their own vertical facing (which renders them nearly black).
  const nrm = tuftGeo.attributes.normal
  for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0)
  const windT = { value: 0 }
  const grassMat = new THREE.MeshStandardMaterial({ map: bladeTex(), alphaTest: 0.45, alphaToCoverage: !phone, side: THREE.DoubleSide, roughness: 0.95, color: 0xffffff })
  grassMat.onBeforeCompile = (sh) => {
    sh.uniforms.windT = windT
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float windT;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 ip = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
        float sway = sin(windT * 1.7 + ip.x * 0.7 + ip.z * 0.4) * 0.06 + sin(windT * 3.1 + ip.z) * 0.02;
        transformed.x += sway * uv.y * uv.y;`)
  }
  const spots = pick(phone ? 900 : 2000)
  const tufts = new THREE.InstancedMesh(tuftGeo, grassMat, spots.length)
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), c = new THREE.Color()
  spots.forEach(([x, z], i) => {
    const k = 0.45 + rand() * 0.6
    m.compose(new THREE.Vector3(x, 0, z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI), sc.set(k, k * (0.7 + rand() * 0.6), k))
    tufts.setMatrixAt(i, m)
    tufts.setColorAt(i, c.setHSL(0.2 + rand() * 0.07, 0.3 + rand() * 0.2, 0.4 + rand() * 0.2))
  })
  tufts.receiveShadow = true
  scene.add(tufts)
  // Pebbles and small stones.
  const pebbleMat = new THREE.MeshStandardMaterial({ color: 0x9c968c, roughness: 0.95, flatShading: true })
  const stones = pick(phone ? 90 : 200)
  const pebbles = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), pebbleMat, stones.length)
  stones.forEach(([x, z], i) => {
    const k = 0.03 + Math.pow(rand(), 3) * 0.1
    m.compose(new THREE.Vector3(x, k * 0.25, z), q.setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3)), sc.set(k * (1 + rand() * 0.6), k * (0.5 + rand() * 0.4), k))
    pebbles.setMatrixAt(i, m)
    pebbles.setColorAt(i, c.setHSL(0.08, 0.06, 0.45 + rand() * 0.25))
  })
  pebbles.castShadow = !phone
  pebbles.receiveShadow = true
  scene.add(pebbles)
  return (t: number) => { windT.value = t }
}

/** Grass, river with stone banks, a stone curb around the field. */
export function buildField(scene: THREE.Scene, env: THREE.Texture | null, towers: { x: number; z: number; r: number }[]): Field {
  // Two grass halves leave a gap for the river; UVs map both onto one texture.
  const groundMat = new THREE.MeshStandardMaterial({ roughness: 1, envMap: env, envMapIntensity: 0.4 })
  splatGround(groundMat, groundMask(towers), pbrSet('grass'), pbrSet('dirt'), [FIELD_W, FIELD_D], 3.2)
  for (const [z0, z1] of [[-FIELD_D / 2, -1.3], [1.3, FIELD_D / 2]]) {
    const geo = new THREE.PlaneGeometry(FIELD_W, z1 - z0)
    geo.rotateX(-Math.PI / 2)
    geo.translate(0, 0, (z0 + z1) / 2)
    const pos = geo.attributes.position, uv = geo.attributes.uv
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + FIELD_W / 2) / FIELD_W, 1 - (pos.getZ(i) + FIELD_D / 2) / FIELD_D)
    const half = new THREE.Mesh(geo, groundMat)
    half.receiveShadow = true
    scene.add(half)
  }

  const stone = new THREE.MeshStandardMaterial({ color: 0xc8c2b8, roughness: 1, envMap: env, envMapIntensity: 0.5 })
  triplanarPBR(stone, pbrSet('rock'), 1.6)
  // River bed + water surface.
  const bed = new THREE.Mesh(new THREE.BoxGeometry(FIELD_W, 0.3, 2.6), new THREE.MeshStandardMaterial({ color: 0x0f2a33, roughness: 1 }))
  bed.position.set(0, -0.32, 0); scene.add(bed)
  const n = waterNormals()
  let water: THREE.Material
  let tickWater: (t: number) => void
  if (LOW_POWER) {
    // Phones: a glossy normal-mapped surface lit by the sky.
    n.repeat.set(10, 1)
    const m = new THREE.MeshStandardMaterial({ color: 0x1e5566, roughness: 0.12, metalness: 0.05, normalMap: n, normalScale: new THREE.Vector2(0.6, 0.6), envMap: env, envMapIntensity: 1.1, transparent: true, opacity: 0.9 })
    const surf = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_W, 2.6), m)
    surf.rotation.x = -Math.PI / 2; surf.position.y = -0.06; surf.receiveShadow = true; scene.add(surf)
    water = m
    tickWater = (t) => n.offset.set(t * 0.035, Math.sin(t * 0.4) * 0.02)
  } else {
    // Desktop: a planar reflection of the live scene (towers, bridges, troops,
    // explosions), rippled by the normal map, with a sun glint.
    const w = new Water(new THREE.PlaneGeometry(FIELD_W, 2.6), {
      textureWidth: 512, textureHeight: 512, waterNormals: n,
      sunDirection: new THREE.Vector3(-20, 18, 8).normalize(), sunColor: 0xffcfa0, waterColor: 0x0d2f38, distortionScale: 0.9, fog: true,
    })
    w.rotation.x = -Math.PI / 2; w.position.y = -0.06
    w.material.uniforms.size.value = 2.2
    // The stock shader mirrors the bright sky almost fully; keep the river dark and moody.
    w.material.fragmentShader = w.material.fragmentShader.replace('reflectionSample * 0.9', 'reflectionSample * 0.5')
    scene.add(w)
    water = w.material
    tickWater = (t) => { w.material.uniforms.time.value = t * 0.45 }
  }
  // Stone banks along both edges of the river.
  for (const s of [-1, 1]) {
    const bank = new THREE.Mesh(new THREE.BoxGeometry(FIELD_W, 0.34, 0.32), stone)
    bank.position.set(0, -0.05, s * 1.36); bank.castShadow = true; bank.receiveShadow = true; scene.add(bank)
  }
  // Packed earth beyond the field, so the arena doesn't float in the sky.
  const dirt = pbrSet('dirt'), outerMap = dirt.color.clone(), outerN = dirt.normal.clone()
  outerMap.repeat.set(40, 40); outerN.repeat.set(40, 40)
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ map: outerMap, normalMap: outerN, color: 0x8a7a68, roughness: 1 }))
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.55; outer.receiveShadow = true; scene.add(outer)
  // Low stone walls along both touchlines, each with a team banner at midfield.
  for (const s of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.3, FIELD_D + 1.2), stone)
    wall.position.set(s * (FIELD_W / 2 + 0.75), 0.65, 0); wall.castShadow = true; wall.receiveShadow = true; scene.add(wall)
    for (const z of [-8, 8]) {
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.7), new THREE.MeshStandardMaterial({ color: z > 0 ? ARENA_TEAM.blue : ARENA_TEAM.red, roughness: 0.9, side: THREE.DoubleSide }))
      banner.position.set(s * (FIELD_W / 2 + 0.38), 1.1, z); banner.rotation.y = -s * Math.PI / 2; scene.add(banner)
    }
  }
  // Stone curb around the field.
  const curbs: [number, number, number, number][] = [[0, -FIELD_D / 2 - 0.2, FIELD_W + 0.8, 0.4], [0, FIELD_D / 2 + 0.2, FIELD_W + 0.8, 0.4], [-FIELD_W / 2 - 0.2, 0, 0.4, FIELD_D], [FIELD_W / 2 + 0.2, 0, 0.4, FIELD_D]]
  for (const [x, z, w, d] of curbs) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(w, 0.45, d), stone)
    c.position.set(x, 0.18, z); c.castShadow = true; c.receiveShadow = true; scene.add(c)
  }
  const wind = scatterClutter(scene, towers, LOW_POWER)
  return {
    water,
    update(t: number) { tickWater(t); wind(t) },
  }
}
