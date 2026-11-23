import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { Side } from './types'
import { TEAM_COLORS } from './hero'

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

/** Running-bond stone blocks with mortar; 1 tile = 6 courses x 3 blocks. */
const brickTex = () => once('brick', () => canvasTex(512, 512, (g, r) => {
  g.fillStyle = '#6e665c'; g.fillRect(0, 0, 512, 512)
  const rows = 6, cols = 3, bh = 512 / rows, bw = 512 / cols
  for (let y = 0; y < rows; y++) for (let x = -1; x <= cols; x++) {
    const ox = (y % 2) * bw * 0.5 + x * bw + (r() - 0.5) * 6
    const l = 150 + r() * 55, warm = r() * 14
    g.fillStyle = `rgb(${l + warm},${l + warm * 0.6},${l - 4})`
    const px = ox + 4, py = y * bh + 4, pw = bw - 8, ph = bh - 8
    g.beginPath(); g.roundRect(px, py, pw, ph, 10); g.fill()
    // bevel: light top edge, dark bottom edge, speckles
    g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(px + 4, py + 2, pw - 8, 5)
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(px + 4, py + ph - 7, pw - 8, 5)
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.1})`; g.fillRect(px + r() * pw, py + r() * ph, 2 + r() * 3, 2 + r() * 3) }
  }
}, 11))
/** Planks running along X. */
const woodTex = () => once('wood', () => canvasTex(512, 512, (g, r) => {
  g.fillStyle = '#4a2f1a'; g.fillRect(0, 0, 512, 512)
  const n = 6, h = 512 / n
  for (let i = 0; i < n; i++) {
    const l = 120 + r() * 40
    g.fillStyle = `rgb(${l + 40},${l + 6},${l - 34})`; g.fillRect(0, i * h + 3, 512, h - 6)
    for (let k = 0; k < 26; k++) {
      g.strokeStyle = `rgba(60,30,10,${0.12 + r() * 0.2})`; g.lineWidth = 1 + r() * 2
      const y0 = i * h + 6 + r() * (h - 12)
      g.beginPath(); g.moveTo(0, y0); g.bezierCurveTo(170, y0 + (r() - 0.5) * 10, 340, y0 + (r() - 0.5) * 10, 512, y0); g.stroke()
    }
    g.fillStyle = 'rgba(30,15,5,0.6)'; const jx = r() * 512; g.fillRect(jx, i * h + 3, 4, h - 6)
  }
}, 23))
/** Overlapping roof shingles (white-grey; tinted by the team color). */
const shingleTex = () => once('shingle', () => canvasTex(256, 256, (g, r) => {
  g.fillStyle = '#8a8a8a'; g.fillRect(0, 0, 256, 256)
  const rows = 8, cols = 6, h = 256 / rows, w = 256 / cols
  for (let y = 0; y < rows; y++) for (let x = -1; x <= cols; x++) {
    const ox = x * w + (y % 2) * w / 2, l = 200 + r() * 50
    g.fillStyle = `rgb(${l},${l},${l})`
    g.beginPath(); g.roundRect(ox + 2, y * h, w - 4, h + 6, [0, 0, 14, 14]); g.fill()
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(ox + 2, y * h + h - 2, w - 4, 4)
  }
}, 37))

/** Project `tex` from three sides in object space; tile size in meters. */
function triplanar(mat: THREE.MeshStandardMaterial, tex: THREE.Texture, tile: number) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.triMap = { value: tex }
    shader.uniforms.triScale = { value: 1 / tile }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTriPos;\nvarying vec3 vTriN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTriPos = position;\nvTriN = normal;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D triMap;\nuniform float triScale;\nvarying vec3 vTriPos;\nvarying vec3 vTriN;')
      .replace('#include <map_fragment>', `
        vec3 triW = pow(abs(normalize(vTriN)), vec3(4.0));
        triW /= (triW.x + triW.y + triW.z);
        vec3 triP = vTriPos * triScale;
        vec4 triC = texture2D(triMap, triP.zy) * triW.x + texture2D(triMap, triP.xz) * triW.y + texture2D(triMap, triP.xy) * triW.z;
        diffuseColor *= triC * 1.35;`)
  }
  mat.customProgramCacheKey = () => `tri-${tex.uuid}-${tile}`
  mat.needsUpdate = true
}

// --- props ----------------------------------------------------------------------
const matCache = new Map<string, THREE.Material>()
function dressMaterial(m: THREE.MeshStandardMaterial, side: Side | null, env: THREE.Texture | null): THREE.Material {
  const key = `${m.uuid}:${side ?? '-'}`
  const hit = matCache.get(key)
  if (hit) return hit
  const c = m.clone()
  c.envMap = env
  c.envMapIntensity = c.name === 'Arena_Metal' ? 1.2 : 0.5
  if (c.name === 'Arena_Stone') triplanar(c, brickTex(), 1.2)
  if (c.name === 'Arena_Wood') triplanar(c, woodTex(), 0.9)
  if (c.name === 'Arena_Roof') { triplanar(c, shingleTex(), 0.5); c.color.setHex(side ? TEAM_COLORS[side] : 0xffffff) }
  if (c.name === 'Arena_Team' && side) c.color.setHex(TEAM_COLORS[side])
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

/** Mowed grass with stripes, worn dirt lanes and patches around the towers. */
function groundTex(towers: { x: number; z: number; r: number }[]) {
  const W = 1040, H = 1200, sx = W / FIELD_W, sz = H / FIELD_D
  const toPx = (x: number, z: number) => [(x + FIELD_W / 2) * sx, (z + FIELD_D / 2) * sz]
  return canvasTex(W, H, (g, r) => {
    // Mowing stripes across the field.
    const stripe = 1.5 * sz
    for (let y = 0; y < H; y += stripe) {
      const odd = Math.round(y / stripe) % 2
      g.fillStyle = odd ? '#5cab46' : '#54a141'; g.fillRect(0, y, W, stripe + 1)
    }
    // Blade speckle.
    for (let i = 0; i < 26000; i++) {
      const l = r()
      g.fillStyle = l < 0.5 ? `rgba(40,90,30,${0.15 + r() * 0.2})` : `rgba(170,220,120,${0.08 + r() * 0.15})`
      g.fillRect(r() * W, r() * H, 1 + r() * 2, 2 + r() * 4)
    }
    // Worn dirt along both lanes, from tower to bridge.
    const dirt = (x: number, z0: number, z1: number, w: number) => {
      for (let i = 0; i < 900; i++) {
        const z = z0 + (z1 - z0) * r()
        const [px, pz] = toPx(x + (r() - 0.5) * w * (0.6 + r() * 0.6), z)
        const rad = (0.12 + r() * 0.3) * sx
        g.fillStyle = `rgba(${150 + r() * 30},${112 + r() * 20},${70 + r() * 14},${0.1 + r() * 0.16})`
        g.beginPath(); g.arc(px, pz, rad, 0, Math.PI * 2); g.fill()
      }
    }
    for (const x of [-4.2, 4.2]) { dirt(x, -11, -1.5, 1.4); dirt(x, 1.5, 11, 1.4) }
    for (const t of towers) {
      for (let i = 0; i < 260; i++) {
        const a = r() * Math.PI * 2, d = t.r * (0.85 + r() * 0.55)
        const [px, pz] = toPx(t.x + Math.cos(a) * d, t.z + Math.sin(a) * d)
        g.fillStyle = `rgba(${140 + r() * 30},${108 + r() * 20},${70 + r() * 14},${0.12 + r() * 0.18})`
        g.beginPath(); g.arc(px, pz, (0.15 + r() * 0.3) * sx, 0, Math.PI * 2); g.fill()
      }
    }
    // Faint chalk lane guides.
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 0.09 * sx; g.setLineDash([0.6 * sz, 0.5 * sz])
    for (const x of [-4.2, 4.2]) { const [px] = toPx(x, 0); g.beginPath(); g.moveTo(px, toPx(0, -11)[1]); g.lineTo(px, toPx(0, -1.6)[1]); g.moveTo(px, toPx(0, 1.6)[1]); g.lineTo(px, toPx(0, 11)[1]); g.stroke() }
    g.setLineDash([])
    // Soft dark vignette at the edges.
    const grad = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7)
    grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(1, 'rgba(0,20,0,0.28)')
    g.fillStyle = grad; g.fillRect(0, 0, W, H)
  }, 5)
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

export interface Field { water: THREE.MeshStandardMaterial; update(t: number): void }

/** Grass, river with stone banks, a stone curb around the field. */
export function buildField(scene: THREE.Scene, env: THREE.Texture | null, towers: { x: number; z: number; r: number }[]): Field {
  // Two grass halves leave a gap for the river; UVs map both onto one texture.
  const groundMat = new THREE.MeshStandardMaterial({ map: groundTex(towers), roughness: 0.95 })
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

  const stone = new THREE.MeshStandardMaterial({ color: 0xd9d1c4, roughness: 0.9, envMap: env, envMapIntensity: 0.4 })
  triplanar(stone, brickTex(), 1.0)
  // River bed + water surface.
  const bed = new THREE.Mesh(new THREE.BoxGeometry(FIELD_W, 0.3, 2.6), new THREE.MeshStandardMaterial({ color: 0x1d4f6b, roughness: 1 }))
  bed.position.set(0, -0.32, 0); scene.add(bed)
  const n = waterNormals(); n.repeat.set(10, 1)
  const water = new THREE.MeshStandardMaterial({ color: 0x2f8fc4, roughness: 0.12, metalness: 0.05, normalMap: n, normalScale: new THREE.Vector2(0.6, 0.6), envMap: env, envMapIntensity: 1.1, transparent: true, opacity: 0.9 })
  const surf = new THREE.Mesh(new THREE.PlaneGeometry(FIELD_W, 2.6), water)
  surf.rotation.x = -Math.PI / 2; surf.position.y = -0.06; surf.receiveShadow = true; scene.add(surf)
  // Stone banks along both edges of the river.
  for (const s of [-1, 1]) {
    const bank = new THREE.Mesh(new THREE.BoxGeometry(FIELD_W, 0.34, 0.32), stone)
    bank.position.set(0, -0.05, s * 1.36); bank.castShadow = true; bank.receiveShadow = true; scene.add(bank)
  }
  // Packed earth beyond the field, so the arena doesn't float in the sky.
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: 0x6f5a3e, roughness: 1 }))
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.55; outer.receiveShadow = true; scene.add(outer)
  // Low stone walls along both touchlines, each with a team banner at midfield.
  for (const s of [-1, 1]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.3, FIELD_D + 1.2), stone)
    wall.position.set(s * (FIELD_W / 2 + 0.75), 0.65, 0); wall.castShadow = true; wall.receiveShadow = true; scene.add(wall)
    for (const z of [-8, 8]) {
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.7), new THREE.MeshStandardMaterial({ color: z > 0 ? TEAM_COLORS.blue : TEAM_COLORS.red, roughness: 0.8, side: THREE.DoubleSide }))
      banner.position.set(s * (FIELD_W / 2 + 0.38), 1.1, z); banner.rotation.y = -s * Math.PI / 2; scene.add(banner)
    }
  }
  // Stone curb around the field.
  const curbs: [number, number, number, number][] = [[0, -FIELD_D / 2 - 0.2, FIELD_W + 0.8, 0.4], [0, FIELD_D / 2 + 0.2, FIELD_W + 0.8, 0.4], [-FIELD_W / 2 - 0.2, 0, 0.4, FIELD_D], [FIELD_W / 2 + 0.2, 0, 0.4, FIELD_D]]
  for (const [x, z, w, d] of curbs) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(w, 0.45, d), stone)
    c.position.set(x, 0.18, z); c.castShadow = true; c.receiveShadow = true; scene.add(c)
  }
  return {
    water,
    update(t: number) { n.offset.set(t * 0.035, Math.sin(t * 0.4) * 0.02) },
  }
}
