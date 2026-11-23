import * as THREE from 'three'
import type { CardId, Side } from './types'

// ---------------------------------------------------------------------------
// Realistic human characters — not toys.
// The previous models were chunky heroic dolls (heads ~1/3 of height,
// flat solid colours, painted-on faces). This rebuild uses:
//  * realistic proportions — ~7.5 heads tall, head ~0.24 units on a
//    ~1.75-unit body, shoulders ~2 head-widths, natural limb ratios,
//    two-bone arms/legs whose elbows and knees bend at real joints;
//  * real facial anatomy — skull + jaw + cheekbones, eye sockets with
//    sclera / iris / pupil / glint and eyelids that blink, brow ridge
//    and curved eyebrows, a nose built from bridge + tip + nostrils,
//    lips (upper / lower / mouth line), ears with inner ear, hair as
//    strands and caps rather than a solid blob, facial hair as strands
//    (Knight's walrus moustache, Giant's stubble) rather than a blob;
//  * real skin — procedural canvas textures (pores, blotches, freckles,
//    stubble, fine lines) on a warm subsurface-style material, never a
//    flat plastic solid colour for a face. Cloth, leather, steel, bone
//    and hair get procedural textures too.
// Human-like faces only where the troop is human. Skeletons / Bomber
// keep realistic bone, Minions stay creatures, Baby Dragon stays a
// realistic scaled creature.
// ---------------------------------------------------------------------------

export interface Rig {
  group: THREE.Group
  head: THREE.Group
  armL: THREE.Group
  armR: THREE.Group
  legL: THREE.Group
  legR: THREE.Group
  weapon?: THREE.Group
  plume?: THREE.Object3D
  cape?: THREE.Object3D
  scale: number
  // Real joints / face parts, wired up by the builders below.
  elbowL?: THREE.Group
  elbowR?: THREE.Group
  kneeL?: THREE.Group
  kneeR?: THREE.Group
  eyelidL?: THREE.Object3D
  eyelidR?: THREE.Object3D
  chest?: THREE.Group
  jaw?: THREE.Object3D
}

// --- deterministic RNG so textures are stable run to run -------------------
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- procedural canvas textures -------------------------------------------
function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, rand: () => number) => void, seed = 7): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')!
  draw(ctx, mulberry32(seed))
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 4
  return tex
}

const texCache = new Map<string, THREE.CanvasTexture>()
function cachedTex(key: string, make: () => THREE.CanvasTexture): THREE.CanvasTexture {
  const hit = texCache.get(key)
  if (hit) return hit
  const t = make()
  texCache.set(key, t)
  return t
}

function skinTexture(base: string, opts: { stubble?: boolean; freckles?: boolean; seed?: number } = {}): THREE.CanvasTexture {
  return cachedTex(`skin:${base}:${opts.stubble ? 1 : 0}:${opts.freckles ? 1 : 0}:${opts.seed ?? 7}`, () =>
    canvasTexture(256, 256, (ctx, rand) => {
      ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 256)
      // Warm / cool blotches — skin is never one flat tone.
      for (let i = 0; i < 46; i++) {
        const x = rand() * 256, y = rand() * 256, r = 14 + rand() * 42
        const g = ctx.createRadialGradient(x, y, 0, x, y, r)
        const warm = rand() > 0.5
        g.addColorStop(0, warm ? 'rgba(190,110,70,0.10)' : 'rgba(220,170,140,0.09)')
        g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
      }
      // Pores — hundreds of tiny darker specks.
      for (let i = 0; i < 2600; i++) {
        ctx.fillStyle = `rgba(120,70,40,${0.05 + rand() * 0.09})`
        ctx.beginPath(); ctx.arc(rand() * 256, rand() * 256, 0.5 + rand() * 0.9, 0, Math.PI * 2); ctx.fill()
      }
      // Fine lines.
      ctx.strokeStyle = 'rgba(120,70,40,0.06)'
      for (let i = 0; i < 26; i++) {
        ctx.beginPath()
        const x = rand() * 256, y = rand() * 256
        ctx.moveTo(x, y); ctx.lineTo(x + (rand() - 0.5) * 36, y + (rand() - 0.5) * 10); ctx.stroke()
      }
      if (opts.freckles) {
        for (let i = 0; i < 160; i++) {
          ctx.fillStyle = `rgba(140,85,45,${0.12 + rand() * 0.2})`
          ctx.beginPath(); ctx.arc(rand() * 256, rand() * 256, 0.7 + rand() * 1.1, 0, Math.PI * 2); ctx.fill()
        }
      }
      if (opts.stubble) {
        for (let i = 0; i < 3200; i++) {
          ctx.fillStyle = `rgba(50,35,20,${0.10 + rand() * 0.22})`
          ctx.fillRect(rand() * 256, 150 + rand() * 106, 1.2, 1.2)
        }
      }
    }, opts.seed ?? 7))
}

function hairTexture(base: string): THREE.CanvasTexture {
  return cachedTex(`hair:${base}`, () =>
    canvasTexture(256, 256, (ctx, rand) => {
      ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 256)
      for (let i = 0; i < 420; i++) {
        const light = rand() > 0.5
        ctx.strokeStyle = light ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.22)'
        ctx.lineWidth = 0.8 + rand() * 1.2
        const x = rand() * 256
        ctx.beginPath(); ctx.moveTo(x, 0)
        ctx.bezierCurveTo(x + (rand() - 0.5) * 22, 85, x + (rand() - 0.5) * 22, 170, x + (rand() - 0.5) * 30, 256)
        ctx.stroke()
      }
    }))
}

function clothTexture(base: string): THREE.CanvasTexture {
  return cachedTex(`cloth:${base}`, () =>
    canvasTexture(256, 256, (ctx, rand) => {
      ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 256)
      for (let y = 0; y < 256; y += 4) {
        ctx.fillStyle = `rgba(0,0,0,${0.04 + (y % 8 === 0 ? 0.05 : 0)})`
        ctx.fillRect(0, y, 256, 2)
      }
      for (let x = 0; x < 256; x += 4) {
        ctx.fillStyle = 'rgba(255,255,255,0.04)'
        ctx.fillRect(x, 0, 2, 256)
      }
      for (let i = 0; i < 500; i++) {
        ctx.fillStyle = `rgba(0,0,0,${0.03 + rand() * 0.06})`
        ctx.fillRect(rand() * 256, rand() * 256, 2, 2)
      }
    }))
}

function leatherTexture(base = '#6b4a1f'): THREE.CanvasTexture {
  return cachedTex(`leather:${base}`, () =>
    canvasTexture(256, 256, (ctx, rand) => {
      ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 256)
      ctx.strokeStyle = 'rgba(0,0,0,0.20)'; ctx.lineWidth = 0.8
      for (let i = 0; i < 60; i++) {
        ctx.beginPath()
        let x = rand() * 256, y = rand() * 256
        ctx.moveTo(x, y)
        for (let j = 0; j < 4; j++) { x += (rand() - 0.5) * 40; y += (rand() - 0.5) * 40; ctx.lineTo(x, y) }
        ctx.stroke()
      }
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = `rgba(0,0,0,${0.04 + rand() * 0.08})`
        ctx.fillRect(rand() * 256, rand() * 256, 1.5, 1.5)
      }
    }))
}

function steelTexture(): THREE.CanvasTexture {
  return cachedTex('steel', () =>
    canvasTexture(256, 256, (ctx, rand) => {
      ctx.fillStyle = '#b8c0cc'; ctx.fillRect(0, 0, 256, 256)
      for (let i = 0; i < 320; i++) {
        ctx.strokeStyle = `rgba(255,255,255,${0.08 + rand() * 0.16})`
        ctx.lineWidth = 0.6 + rand()
        const y = rand() * 256
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(256, y + (rand() - 0.5) * 8); ctx.stroke()
      }
      for (let i = 0; i < 40; i++) {
        ctx.strokeStyle = 'rgba(60,70,85,0.25)'
        const x = rand() * 256, y = rand() * 256
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rand() - 0.5) * 30, y + (rand() - 0.5) * 6); ctx.stroke()
      }
    }))
}

function boneTexture(): THREE.CanvasTexture {
  return cachedTex('bone', () =>
    canvasTexture(256, 256, (ctx, rand) => {
      ctx.fillStyle = '#e8e2d0'; ctx.fillRect(0, 0, 256, 256)
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = `rgba(150,130,95,${0.05 + rand() * 0.12})`
        ctx.beginPath(); ctx.arc(rand() * 256, rand() * 256, 0.6 + rand() * 1.6, 0, Math.PI * 2); ctx.fill()
      }
      ctx.strokeStyle = 'rgba(120,100,70,0.18)'
      for (let i = 0; i < 24; i++) {
        ctx.beginPath()
        const x = rand() * 256, y = rand() * 256
        ctx.moveTo(x, y); ctx.lineTo(x + (rand() - 0.5) * 44, y + (rand() - 0.5) * 44); ctx.stroke()
      }
    }))
}

function scaleTexture(base = '#ff7a3d'): THREE.CanvasTexture {
  return cachedTex(`scale:${base}`, () =>
    canvasTexture(256, 256, (ctx, rand) => {
      ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 256)
      for (let y = 0; y < 256; y += 18) {
        for (let x = 0; x < 256; x += 18) {
          const off = (y / 18) % 2 === 0 ? 0 : 9
          ctx.fillStyle = `rgba(0,0,0,${0.10 + rand() * 0.14})`
          ctx.beginPath(); ctx.arc(x + off, y, 8, 0, Math.PI * 2); ctx.fill()
          ctx.fillStyle = 'rgba(255,220,160,0.12)'
          ctx.beginPath(); ctx.arc(x + off - 2, y - 2, 5, 0, Math.PI * 2); ctx.fill()
        }
      }
    }))
}

// --- materials ----------------------------------------------------------------
type SkinKey = 'fair' | 'tan' | 'olive' | 'pale' | 'giant'
const SKIN_BASE: Record<SkinKey, string> = {
  fair: '#e8b98d',
  tan: '#c98d5f',
  olive: '#d2a276',
  pale: '#eec39e',
  giant: '#b97f4e',
}
const SKIN_LIP: Record<SkinKey, number> = {
  fair: 0xa85a4a, tan: 0x8f4a3a, olive: 0x9c5544, pale: 0xb06a58, giant: 0x7e4030,
}

/** Warm skin with a subsurface feel: textured map, low clearcoat, warm sheen, faint warm emissive. */
function skinMat(tone: SkinKey = 'fair', opts: { stubble?: boolean; freckles?: boolean } = {}): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    map: skinTexture(SKIN_BASE[tone], { ...opts, seed: tone.length * 13 + 5 }),
    roughness: 0.55,
    metalness: 0,
    clearcoat: 0.18,
    clearcoatRoughness: 0.6,
    sheen: 0.5,
    sheenColor: new THREE.Color(0xffc9a0),
    sheenRoughness: 0.7,
    emissive: 0x2a1208,
    emissiveIntensity: 0.25,
  })
}
function hairMat(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ map: hairTexture(color), roughness: 0.55, metalness: 0 })
}
function clothMat(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ map: clothTexture(color), roughness: 0.85, metalness: 0 })
}
function steelMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ map: steelTexture(), roughness: 0.34, metalness: 0.85 })
}
function goldMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.3, metalness: 0.9 })
}
function leatherMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ map: leatherTexture(), roughness: 0.8, metalness: 0 })
}
function boneMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ map: boneTexture(), roughness: 0.6, metalness: 0 })
}
function mat(color: number, rough = 0.75, metal = 0.05): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal })
}

// --- geometry helpers ---------------------------------------------------------
function mesh(geo: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh {
  const g = new THREE.Mesh(geo, m)
  g.castShadow = true
  return g
}
function box(w: number, h: number, d: number, m: THREE.Material): THREE.Mesh {
  return mesh(new THREE.BoxGeometry(w, h, d), m)
}
function cyl(rt: number, rb: number, h: number, m: THREE.Material, seg = 14): THREE.Mesh {
  return mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m)
}
function sph(r: number, m: THREE.Material, sx = 1, sy = 1, sz = 1): THREE.Mesh {
  const g = mesh(new THREE.SphereGeometry(r, 20, 16), m)
  g.scale.set(sx, sy, sz)
  return g
}
function cone(r: number, h: number, m: THREE.Material): THREE.Mesh {
  return mesh(new THREE.ConeGeometry(r, h, 12), m)
}
function tube(points: [number, number, number][], radius: number, m: THREE.Material): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)))
  return mesh(new THREE.TubeGeometry(curve, 14, radius, 6, false), m)
}

// --- realistic human face -----------------------------------------------------
// Head-group origin is at the base of the neck. Skull centre ~y 0.13,
// head height ~0.24 (1/7.5 of a ~1.75 body), width ~0.19. Forward is +z.
export interface FaceOpts {
  skin?: SkinKey
  eyeColor?: number
  browColor?: string
  hairColor?: string
  hairStyle?: 'short' | 'long' | 'ponytail' | 'bun' | 'bald' | 'receding'
  mustache?: 'walrus' | 'trim' | 'none'
  beard?: 'stubble' | 'short' | 'none'
  freckles?: boolean
  female?: boolean
}

function makeHumanFace(head: THREE.Group, opts: FaceOpts = {}) {
  const skinKey = opts.skin ?? 'fair'
  const skin = skinMat(skinKey, { freckles: opts.freckles })
  const skinStubble = skinMat(skinKey, { stubble: true })
  const hairC = opts.hairColor ?? '#4a2f1d'
  const hair = hairMat(hairC)
  const lipM = mat(SKIN_LIP[skinKey], 0.55)
  const darkM = mat(0x1a1210, 0.6)

  // Cranium — slightly egg-shaped, flattened at the back, not a ball.
  const skull = sph(0.115, skin, 0.92, 1.18, 0.98)
  skull.position.set(0, 0.13, -0.005)
  head.add(skull)
  // Jaw / chin — a separate piece so the mouth can open a fraction.
  const jaw = sph(0.075, opts.beard === 'stubble' ? skinStubble : skin, 1.05, 0.62, 0.9)
  jaw.position.set(0, 0.035, 0.03)
  head.add(jaw)
  head.userData.jaw = jaw
  // Cheekbones.
  for (const s of [-1, 1]) {
    const cheek = sph(0.024, skin, 1.1, 0.8, 0.7)
    cheek.position.set(s * 0.058, 0.105, 0.068)
    head.add(cheek)
    // Ear — flattened, with an inner-ear hollow.
    const ear = sph(0.028, skin, 0.32, 1, 0.62)
    ear.position.set(s * 0.108, 0.12, -0.005)
    head.add(ear)
    const inner = sph(0.012, skinStubble, 0.3, 1, 0.6)
    inner.position.set(s * 0.112, 0.12, 0.002)
    head.add(inner)
  }

  // Eyes — recessed in sockets: sclera, iris, pupil, glint, eyelids, lashes.
  const eyelids: THREE.Object3D[] = []
  const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xf5efe6, roughness: 0.3 })
  const irisM = new THREE.MeshStandardMaterial({ color: opts.eyeColor ?? 0x2b4a7a, roughness: 0.2 })
  const pupilM = new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.2 })
  const glintM = new THREE.MeshBasicMaterial({ color: 0xffffff })
  for (const s of [-1, 1]) {
    const socket = sph(0.032, mat(0x8a5f45, 0.8), 1.05, 1, 0.5)
    socket.position.set(s * 0.042, 0.148, 0.088)
    head.add(socket)
    const eye = sph(0.027, eyeWhite, 1, 1.18, 0.55)
    eye.position.set(s * 0.042, 0.145, 0.098)
    head.add(eye)
    const iris = sph(0.0135, irisM, 1, 1.15, 0.5)
    iris.position.set(s * 0.042, 0.145, 0.12)
    head.add(iris)
    const pupil = sph(0.0065, pupilM, 1, 1.15, 0.5)
    pupil.position.set(s * 0.042, 0.145, 0.128)
    head.add(pupil)
    const glint = sph(0.0038, glintM)
    glint.position.set(s * 0.042 + 0.008, 0.153, 0.132)
    head.add(glint)
    // Upper eyelid — a skin cap that drops when blinking (see animateRig).
    const lid = sph(0.029, skin, 1.05, 0.55, 0.55)
    lid.position.set(s * 0.042, 0.16, 0.1)
    head.add(lid)
    eyelids.push(lid)
    // Lower lid line + lashes.
    const lash = box(0.042, 0.004, 0.006, darkM)
    lash.position.set(s * 0.042, 0.163, 0.112)
    head.add(lash)
    // Eyebrow — a curved tube following the brow ridge, not a flat box.
    // The torus arc (0 to ~171°) is already the top half, so the same
    // orientation caps both eyes; mirroring it would put one brow below.
    const brow = mesh(new THREE.TorusGeometry(0.03, 0.0055, 6, 12, Math.PI * 0.95), hair)
    brow.position.set(s * 0.042, 0.185, 0.1)
    brow.rotation.set(-0.35, 0, 0.15)
    head.add(brow)
  }
  head.userData.eyelidL = eyelids[0]
  head.userData.eyelidR = eyelids[1]

  // Nose — bridge, tip, nostrils and alar wings, not a cone stuck on.
  const bridge = cyl(0.011, 0.017, 0.055, skin, 8)
  bridge.position.set(0, 0.118, 0.105)
  bridge.rotation.x = 0.28
  head.add(bridge)
  const tip = sph(0.016, skin, 1.25, 0.85, 0.95)
  tip.position.set(0, 0.088, 0.118)
  head.add(tip)
  for (const s of [-1, 1]) {
    const ala = sph(0.009, skin, 1, 0.8, 0.9)
    ala.position.set(s * 0.017, 0.082, 0.11)
    head.add(ala)
    const nostril = sph(0.0045, darkM)
    nostril.position.set(s * 0.011, 0.076, 0.118)
    head.add(nostril)
  }

  // Mouth — separate upper / lower lips and a mouth line.
  const upperLip = sph(0.02, lipM, 1.7, 0.38, 0.5)
  upperLip.position.set(0, 0.048, 0.103)
  head.add(upperLip)
  const lowerLip = sph(0.02, lipM, 1.5, 0.45, 0.55)
  lowerLip.position.set(0, 0.032, 0.105)
  head.add(lowerLip)
  const mouthLine = box(0.042, 0.0035, 0.006, darkM)
  mouthLine.position.set(0, 0.04, 0.11)
  head.add(mouthLine)

  // Hair — strands and a cap, never a solid painted blob.
  const style = opts.hairStyle ?? 'short'
  if (style !== 'bald') {
    const cap = mesh(new THREE.SphereGeometry(0.12, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.52), hair)
    cap.position.set(0, 0.155, -0.01)
    cap.scale.set(0.96, 1.05, 1)
    head.add(cap)
    // Front hairline strands framing the face.
    for (const s of [-1, 1]) {
      head.add(tube([[s * 0.09, 0.22, 0.07], [s * 0.105, 0.16, 0.085], [s * 0.1, 0.1, 0.07]], 0.008, hair))
    }
  }
  if (style === 'long' || style === 'ponytail') {
    // Back mass of hair falling past the shoulders.
    const back = sph(0.11, hair, 0.9, 1.35, 0.55)
    back.position.set(0, 0.06, -0.085)
    head.add(back)
    for (const s of [-1, 1]) {
      head.add(tube([[s * 0.08, 0.2, -0.08], [s * 0.1, 0.05, -0.11], [s * 0.09, -0.12, -0.08]], 0.014, hair))
    }
  }
  if (style === 'ponytail') {
    head.add(tube([[0, 0.24, -0.1], [0, 0.12, -0.16], [0.01, -0.05, -0.15]], 0.032, hair))
  }
  if (style === 'bun') {
    const bun = sph(0.05, hair, 1, 1, 1)
    bun.position.set(0, 0.26, -0.09)
    head.add(bun)
  }
  if (style === 'receding') {
    const fringe = mesh(new THREE.SphereGeometry(0.115, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.32), hair)
    fringe.position.set(0, 0.16, -0.02)
    head.add(fringe)
  }

  // Facial hair — strands, not a blob.
  if (opts.mustache === 'walrus') {
    for (const s of [-1, 1]) {
      // Sweeping walrus moustache: a thick curved strand per side + a droop.
      head.add(tube([[0, 0.055, 0.11], [s * 0.045, 0.055, 0.115], [s * 0.075, 0.045, 0.1]], 0.011, hair))
      head.add(tube([[s * 0.03, 0.055, 0.112], [s * 0.06, 0.03, 0.108], [s * 0.062, 0.005, 0.095]], 0.008, hair))
    }
    // Short beard on chin and jaw.
    const beard = sph(0.07, hair, 1.1, 0.55, 0.8)
    beard.position.set(0, 0.005, 0.05)
    head.add(beard)
  } else if (opts.mustache === 'trim') {
    for (const s of [-1, 1]) {
      head.add(tube([[0, 0.055, 0.11], [s * 0.035, 0.053, 0.112]], 0.007, hair))
    }
  }
  if (opts.beard === 'short') {
    const beard = sph(0.078, hair, 1.05, 0.6, 0.85)
    beard.position.set(0, 0.01, 0.045)
    head.add(beard)
  }
  // Stubble lives in the jaw's skin texture (see skinMat stubble) when
  // beard === 'stubble' — the jaw mesh already uses that material.
}

// --- bone / creature faces (kept non-human, but anatomically built) --------
function makeBoneFace(head: THREE.Group) {
  const bone = boneMat()
  const skull = sph(0.115, bone, 0.92, 1.12, 0.95)
  skull.position.set(0, 0.13, 0)
  head.add(skull)
  const jawBone = box(0.09, 0.05, 0.08, bone)
  jawBone.position.set(0, 0.03, 0.04)
  head.add(jawBone)
  head.userData.jaw = jawBone
  for (const s of [-1, 1]) {
    const socket = sph(0.032, mat(0x0a0a0a, 0.9), 1, 1.2, 0.5)
    socket.position.set(s * 0.042, 0.145, 0.09)
    head.add(socket)
    const glow = sph(0.011, new THREE.MeshBasicMaterial({ color: 0xffd23d }))
    glow.position.set(s * 0.042, 0.145, 0.115)
    head.add(glow)
    const cheek = sph(0.02, bone, 1, 0.7, 0.7)
    cheek.position.set(s * 0.06, 0.1, 0.07)
    head.add(cheek)
  }
  // Nasal cavity + individual teeth.
  const nasal = cone(0.018, 0.035, mat(0x0a0a0a, 0.9))
  nasal.position.set(0, 0.1, 0.11)
  nasal.rotation.x = Math.PI
  head.add(nasal)
  for (let i = -2; i <= 2; i++) {
    const tooth = box(0.014, 0.018, 0.008, mat(0xf5f2e8, 0.5))
    tooth.position.set(i * 0.016, 0.045, 0.108)
    head.add(tooth)
  }
  const crack = box(0.004, 0.09, 0.004, mat(0x8a7a5a, 0.9))
  crack.position.set(0.03, 0.17, 0.1)
  crack.rotation.z = 0.4
  head.add(crack)
}

// --- rig / body ---------------------------------------------------------------
// Realistic adult: total ~1.75 units. Hip joint 0.84, shoulder 1.28,
// neck 1.32–1.42, head centre 1.55, top of head ~1.68.
function baseRig(scale: number, team: Side): Rig {
  const group = new THREE.Group()
  group.scale.setScalar(scale)
  const accent = team === 'blue' ? 0x2f6df6 : 0xe23b3b
  const head = new THREE.Group(); head.position.y = 1.42
  const armL = new THREE.Group(); armL.position.set(-0.215, 1.28, 0)
  const armR = new THREE.Group(); armR.position.set(0.215, 1.28, 0)
  const legL = new THREE.Group(); legL.position.set(-0.095, 0.84, 0)
  const legR = new THREE.Group(); legR.position.set(0.095, 0.84, 0)
  group.add(head, armL, armR, legL, legR)
  group.userData.accent = accent
  return { group, head, armL, armR, legL, legR, scale }
}

function linkFace(r: Rig) {
  r.eyelidL = r.head.userData.eyelidL as THREE.Object3D | undefined
  r.eyelidR = r.head.userData.eyelidR as THREE.Object3D | undefined
  r.jaw = r.head.userData.jaw as THREE.Object3D | undefined
}

interface BodyOpts {
  skin: SkinKey
  torso: THREE.Material
  arms: THREE.Material
  legs: THREE.Material
  boots?: THREE.Material
  female?: boolean
  bareArms?: boolean
  /** Override for neck / hands / elbows — creatures and skeletons are not human-skinned. */
  skinMaterial?: THREE.Material
}

function addBody(r: Rig, o: BodyOpts) {
  const skin = o.skinMaterial ?? skinMat(o.skin)
  // Neck — visible, tapered, with a throat shadow.
  const neck = cyl(0.042, 0.052, 0.13, skin, 12)
  neck.position.y = 1.36
  r.group.add(neck)
  // Torso — lathed anatomy: hips / waist / chest / shoulders, not a ball.
  const chest = new THREE.Group()
  chest.position.y = 0.84
  r.group.add(chest)
  r.chest = chest
  const w = o.female ? 0.86 : 1
  const pts = o.female
    ? [new THREE.Vector2(0.02, 0), new THREE.Vector2(0.145, 0.02), new THREE.Vector2(0.125, 0.16), new THREE.Vector2(0.115, 0.28), new THREE.Vector2(0.145, 0.4), new THREE.Vector2(0.165, 0.48)]
    : [new THREE.Vector2(0.02, 0), new THREE.Vector2(0.15, 0.02), new THREE.Vector2(0.135, 0.16), new THREE.Vector2(0.145, 0.28), new THREE.Vector2(0.175, 0.42), new THREE.Vector2(0.185, 0.48)]
  const torso = mesh(new THREE.LatheGeometry(pts, 18), o.torso)
  torso.scale.x = w
  chest.add(torso)
  // Pectoral / abdominal hint: two shallow chest plates (cloth, same tone).
  for (const s of [-1, 1]) {
    const pec = sph(0.07, o.torso, 1.1, 0.75, 0.55)
    pec.position.set(s * 0.07 * w, 0.4, 0.13)
    chest.add(pec)
  }
  // Shoulders.
  for (const s of [-1, 1]) {
    const sh = sph(0.058, o.arms, 1, 0.9, 0.9)
    sh.position.set(s * 0.2, 0.45, 0)
    chest.add(sh)
  }
  // Belt / waistband.
  const belt = cyl(0.15, 0.155, 0.055, leatherMat(), 16)
  belt.position.y = 0.86
  belt.scale.x = w
  r.group.add(belt)
  const buckle = box(0.06, 0.045, 0.02, goldMat())
  buckle.position.set(0, 0.86, 0.15)
  r.group.add(buckle)

  // Arms — two-bone: upper arm, elbow joint, forearm, wrist, real hand.
  for (const arm of [r.armL, r.armR]) {
    const upper = cyl(0.048, 0.04, 0.3, o.bareArms ? skin : o.arms, 12)
    upper.position.y = -0.15
    arm.add(upper)
    const elbow = new THREE.Group()
    elbow.position.y = -0.3
    arm.add(elbow)
    const elbowBall = sph(0.04, skin, 1, 1, 1)
    elbow.add(elbowBall)
    const fore = cyl(0.038, 0.032, 0.28, o.bareArms ? skin : o.arms, 12)
    fore.position.y = -0.14
    elbow.add(fore)
    // Hand — palm, four fingers (two segments each), thumb, nails.
    const hand = new THREE.Group()
    hand.position.y = -0.3
    elbow.add(hand)
    const palm = box(0.07, 0.085, 0.032, skin)
    palm.position.y = -0.04
    hand.add(palm)
    for (let f = 0; f < 4; f++) {
      const fx = -0.024 + f * 0.016
      const finger = cyl(0.0075, 0.0065, 0.055, skin, 6)
      finger.position.set(fx, -0.105, 0.004)
      hand.add(finger)
      const tip = sph(0.007, skin, 1, 1.2, 0.8)
      tip.position.set(fx, -0.135, 0.004)
      hand.add(tip)
    }
    const thumb = cyl(0.008, 0.007, 0.045, skin, 6)
    thumb.position.set(0.045, -0.055, 0.012)
    thumb.rotation.z = -0.6
    hand.add(thumb)
    if (arm === r.armL) r.elbowL = elbow
    else r.elbowR = elbow
  }

  // Legs — two-bone: thigh, knee joint, calf, ankle, real foot.
  const bootM = o.boots ?? leatherMat()
  for (const leg of [r.legL, r.legR]) {
    const thigh = cyl(0.062, 0.052, 0.4, o.legs, 12)
    thigh.position.y = -0.2
    leg.add(thigh)
    const knee = new THREE.Group()
    knee.position.y = -0.4
    leg.add(knee)
    const kneeBall = sph(0.05, o.legs, 1, 1, 1)
    knee.add(kneeBall)
    const calf = cyl(0.05, 0.038, 0.38, o.legs, 12)
    calf.position.y = -0.19
    knee.add(calf)
    const foot = new THREE.Group()
    foot.position.y = -0.4
    knee.add(foot)
    const shoe = box(0.095, 0.055, 0.21, bootM)
    shoe.position.set(0, -0.025, 0.045)
    foot.add(shoe)
    const toe = sph(0.045, bootM, 1, 0.6, 1.1)
    toe.position.set(0, -0.03, 0.14)
    foot.add(toe)
    const sole = box(0.1, 0.018, 0.23, mat(0x1c1a18, 0.9))
    sole.position.set(0, -0.055, 0.045)
    foot.add(sole)
    if (leg === r.legL) r.kneeL = knee
    else r.kneeR = knee
  }
  return r
}

// --- troops -------------------------------------------------------------------
export function buildTroop(cardId: CardId, side: Side): Rig {
  const teamColor = side === 'blue' ? '#2f6df6' : '#e23b3b'
  switch (cardId) {
    case 'knight': {
      const r = baseRig(1, side)
      makeHumanFace(r.head, { skin: 'fair', eyeColor: 0x3a5a8a, hairColor: '#6b4a1f', hairStyle: 'short', mustache: 'walrus', beard: 'short' })
      linkFace(r)
      addBody(r, { skin: 'fair', torso: clothMat(teamColor), arms: steelMat(), legs: steelMat(), boots: steelMat() })
      // Open-face bascinet: steel cap + cheek plates + nose guard — face stays visible.
      const helm = mesh(new THREE.SphereGeometry(0.125, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55), steelMat())
      helm.position.set(0, 0.155, -0.01)
      helm.scale.set(0.98, 1, 1)
      r.head.add(helm)
      const guard = box(0.016, 0.09, 0.012, steelMat())
      guard.position.set(0, 0.1, 0.118)
      r.head.add(guard)
      for (const s of [-1, 1]) {
        const cheek = box(0.012, 0.07, 0.05, steelMat())
        cheek.position.set(s * 0.108, 0.09, 0.04)
        r.head.add(cheek)
      }
      const crest = box(0.03, 0.12, 0.16, clothMat('#e23b3b'))
      crest.position.set(0, 0.27, -0.02)
      r.head.add(crest)
      r.plume = crest
      // Tabard over the cuirass.
      const tabard = box(0.22, 0.34, 0.02, clothMat(teamColor))
      tabard.position.set(0, 1.08, 0.16)
      r.group.add(tabard)
      const shield = cyl(0.26, 0.26, 0.04, clothMat(teamColor), 20)
      shield.rotation.z = Math.PI / 2; shield.rotation.y = 0.4
      shield.position.set(-0.28, 0.95, 0.1)
      r.group.add(shield)
      const boss = sph(0.06, goldMat())
      boss.position.set(-0.31, 0.95, 0.13)
      r.group.add(boss)
      const sword = new THREE.Group()
      const blade = box(0.055, 0.72, 0.018, steelMat()); blade.position.y = 0.48; sword.add(blade)
      const guardS = box(0.2, 0.04, 0.04, goldMat()); guardS.position.y = 0.12; sword.add(guardS)
      const grip = cyl(0.024, 0.024, 0.13, leatherMat()); grip.position.y = 0.02; sword.add(grip)
      sword.position.set(0, -0.58, 0.04); r.armR.add(sword); r.weapon = sword
      return r
    }
    case 'archers': {
      const r = baseRig(0.94, side)
      makeHumanFace(r.head, { skin: 'fair', eyeColor: 0x2e7d5a, hairColor: '#d63384', hairStyle: 'ponytail', freckles: true, female: true })
      linkFace(r)
      addBody(r, { skin: 'fair', torso: clothMat('#2e7d32'), arms: clothMat('#2e7d32'), legs: clothMat('#3d2b1f'), female: true, bareArms: true })
      // Hood pushed back so the face and magenta hair stay visible.
      const hood = cone(0.13, 0.2, clothMat('#2e7d32'))
      hood.position.set(0, 0.24, -0.08)
      hood.rotation.x = -0.5
      r.head.add(hood)
      const quiver = cyl(0.055, 0.055, 0.3, leatherMat())
      quiver.position.set(0.14, 0.95, -0.2)
      quiver.rotation.z = 0.25
      r.group.add(quiver)
      for (let i = 0; i < 3; i++) {
        const shaft = cyl(0.008, 0.008, 0.2, mat(0xd8c49a, 0.6))
        shaft.position.set(0.14 + (i - 1) * 0.025, 1.12, -0.2)
        shaft.rotation.z = 0.25
        r.group.add(shaft)
      }
      const bow = new THREE.Group()
      const arc = mesh(new THREE.TorusGeometry(0.36, 0.022, 8, 20, Math.PI * 1.2), leatherMat())
      arc.rotation.z = Math.PI / 2 - 0.3
      bow.add(arc)
      const string = cyl(0.003, 0.003, 0.62, mat(0xe8e8e8, 0.6), 4)
      string.rotation.z = Math.PI / 2
      string.position.set(0.12, 0, 0)
      bow.add(string)
      const arrow = cyl(0.01, 0.01, 0.55, mat(0xd8c49a, 0.6))
      arrow.rotation.z = Math.PI / 2
      arrow.position.set(0.08, 0, 0)
      bow.add(arrow)
      bow.position.set(0, -0.58, 0.08); r.armL.add(bow); r.weapon = bow
      return r
    }
    case 'giant': {
      const r = baseRig(1.35, side)
      makeHumanFace(r.head, { skin: 'giant', eyeColor: 0x4a2f1d, hairColor: '#3a2a1a', hairStyle: 'short', beard: 'stubble' })
      linkFace(r)
      // Bare chest: skin torso with a cloth sash and belt — no shirt.
      addBody(r, { skin: 'giant', torso: skinMat('giant'), arms: skinMat('giant'), legs: clothMat('#5a4632'), bareArms: true })
      const sash = box(0.62, 0.1, 0.42, clothMat('#e23b3b'))
      sash.position.set(0, 1.1, 0)
      sash.rotation.z = 0.5
      r.group.add(sash)
      // Big fists — real hands, closed.
      for (const arm of [r.armL, r.armR]) {
        const fist = sph(0.075, skinMat('giant'), 1, 0.9, 1)
        fist.position.set(0, -0.62, 0)
        arm.add(fist)
      }
      return r
    }
    case 'musketeer': {
      const r = baseRig(1, side)
      makeHumanFace(r.head, { skin: 'olive', eyeColor: 0x1e4a3a, hairColor: '#8a5a2b', hairStyle: 'long', female: true })
      linkFace(r)
      addBody(r, { skin: 'olive', torso: clothMat('#5b3a8a'), arms: clothMat('#5b3a8a'), legs: clothMat('#2b2b3d'), female: true })
      const hat = cyl(0.2, 0.22, 0.05, clothMat('#5b3a8a'), 16)
      hat.position.set(0, 0.26, 0)
      hat.rotation.z = 0.08
      r.head.add(hat)
      const feather = tube([[0.16, 0.28, 0], [0.24, 0.36, -0.02], [0.3, 0.34, -0.04]], 0.012, mat(0xffffff, 0.7))
      r.head.add(feather)
      const musket = new THREE.Group()
      const barrel = cyl(0.028, 0.028, 0.95, steelMat())
      barrel.rotation.x = Math.PI / 2
      musket.add(barrel)
      const stock = box(0.06, 0.09, 0.42, leatherMat())
      stock.position.set(0, -0.04, 0.26)
      musket.add(stock)
      const lock = box(0.03, 0.06, 0.08, goldMat())
      lock.position.set(0.04, 0.02, 0.1)
      musket.add(lock)
      musket.position.set(0, -0.58, 0.28); r.armR.add(musket); r.weapon = musket
      return r
    }
    case 'minions': {
      const r = baseRig(0.62, side)
      // Creature, not human: blue-grey skin, horns, fangs, wings — but
      // built with the same eye / eyelid anatomy, not a painted face.
      const skin = new THREE.MeshStandardMaterial({ color: 0x6a7cff, roughness: 0.6 })
      const headSkin = sph(0.115, skin, 0.92, 1.1, 0.95)
      headSkin.position.set(0, 0.13, 0)
      r.head.add(headSkin)
      for (const s of [-1, 1]) {
        const eye = sph(0.03, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 }), 1, 1.2, 0.55)
        eye.position.set(s * 0.042, 0.15, 0.095)
        r.head.add(eye)
        const iris = sph(0.014, new THREE.MeshStandardMaterial({ color: 0xffd23d, roughness: 0.2 }), 1, 1.2, 0.5)
        iris.position.set(s * 0.042, 0.15, 0.12)
        r.head.add(iris)
        const pupil = sph(0.007, mat(0x111111, 0.2), 1, 1.2, 0.5)
        pupil.position.set(s * 0.042, 0.15, 0.128)
        r.head.add(pupil)
        const ear = cone(0.025, 0.07, skin)
        ear.position.set(s * 0.1, 0.2, 0)
        ear.rotation.z = s * -0.5
        r.head.add(ear)
        const horn = cone(0.03, 0.14, mat(0xf2e6c9, 0.6))
        horn.position.set(s * 0.07, 0.26, 0)
        horn.rotation.z = s * -0.35
        r.head.add(horn)
      }
      const snout = sph(0.04, skin, 1.3, 0.7, 0.8)
      snout.position.set(0, 0.08, 0.1)
      r.head.add(snout)
      for (const s of [-1, 1]) {
        const fang = cone(0.009, 0.035, mat(0xffffff, 0.5))
        fang.position.set(s * 0.02, 0.045, 0.11)
        fang.rotation.x = Math.PI
        r.head.add(fang)
      }
      addBody(r, { skin: 'fair', torso: skin, arms: skin, legs: skin, bareArms: true, skinMaterial: skin })
      const wingM = new THREE.MeshStandardMaterial({ color: 0x7a4a9a, roughness: 0.55, side: THREE.DoubleSide, transparent: true, opacity: 0.92 })
      for (const s of [-1, 1]) {
        const wing = mesh(new THREE.PlaneGeometry(0.42, 0.26), wingM)
        wing.position.set(s * 0.32, 1.15, -0.18)
        wing.rotation.y = s * 0.7
        r.group.add(wing)
        // Wing membrane veins.
        const vein = cyl(0.004, 0.004, 0.36, mat(0x4a2a6a, 0.7), 4)
        vein.position.set(s * 0.32, 1.15, -0.16)
        vein.rotation.z = Math.PI / 2
        r.group.add(vein)
      }
      const tail = tube([[0, 0.85, -0.16], [0, 0.7, -0.3], [0.02, 0.55, -0.38]], 0.022, skin)
      r.group.add(tail)
      return r
    }
    case 'bomber': {
      const r = baseRig(0.96, side)
      makeBoneFace(r.head)
      linkFace(r)
      // Bone body: ribcage over a dark tunic, bone arms.
      addBody(r, { skin: 'pale', torso: clothMat('#23262e'), arms: boneMat(), legs: clothMat('#23262e'), skinMaterial: boneMat() })
      for (let i = 0; i < 3; i++) {
        const rib = mesh(new THREE.TorusGeometry(0.14 - i * 0.008, 0.012, 6, 16, Math.PI), boneMat())
        rib.position.set(0, 1.18 - i * 0.09, 0.02)
        rib.rotation.x = 0.15
        r.group.add(rib)
      }
      const spine = cyl(0.02, 0.02, 0.4, boneMat(), 8)
      spine.position.set(0, 1.05, -0.12)
      r.group.add(spine)
      const bomb = sph(0.16, mat(0x1c1e24, 0.4, 0.6))
      bomb.position.set(0, -0.58, 0.12)
      r.armR.add(bomb)
      const fuse = tube([[0, -0.44, 0.12], [0.02, -0.36, 0.14], [0.05, -0.3, 0.12]], 0.01, mat(0xd8c49a, 0.8))
      r.armR.add(fuse)
      const spark = sph(0.035, new THREE.MeshBasicMaterial({ color: 0xffc93d }))
      spark.position.set(0.05, -0.28, 0.12)
      r.armR.add(spark)
      return r
    }
    case 'prince': {
      const r = baseRig(1.02, side)
      makeHumanFace(r.head, { skin: 'fair', eyeColor: 0x2b4a7a, hairColor: '#c9a227', hairStyle: 'short', mustache: 'trim' })
      linkFace(r)
      addBody(r, { skin: 'fair', torso: steelMat(), arms: steelMat(), legs: steelMat(), boots: steelMat() })
      // Open helm with a raised visor — eyes and mouth stay visible.
      const helm = mesh(new THREE.SphereGeometry(0.125, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), steelMat())
      helm.position.set(0, 0.16, -0.01)
      r.head.add(helm)
      const visor = box(0.16, 0.05, 0.02, steelMat())
      visor.position.set(0, 0.2, 0.1)
      visor.rotation.x = -0.9
      r.head.add(visor)
      const plume = cone(0.045, 0.22, mat(0xffffff, 0.7))
      plume.position.set(0, 0.3, -0.02)
      r.head.add(plume)
      r.plume = plume
      const cape = mesh(new THREE.PlaneGeometry(0.5, 0.72), new THREE.MeshStandardMaterial({ color: 0xe23b3b, roughness: 0.85, side: THREE.DoubleSide }))
      cape.position.set(0, 0.95, -0.2)
      r.group.add(cape)
      r.cape = cape
      const lance = new THREE.Group()
      const shaft = cyl(0.03, 0.03, 1.25, leatherMat())
      shaft.rotation.x = Math.PI / 2
      lance.add(shaft)
      const tip = cone(0.05, 0.24, steelMat())
      tip.rotation.x = Math.PI / 2
      tip.position.z = 0.72
      lance.add(tip)
      const pennon = mesh(new THREE.PlaneGeometry(0.16, 0.1), clothMat('#e23b3b'))
      pennon.position.set(0, 0.05, 0.5)
      lance.add(pennon)
      lance.position.set(0, -0.58, 0.32); r.armR.add(lance); r.weapon = lance
      return r
    }
    case 'skeletons': {
      const r = baseRig(0.92, side)
      makeBoneFace(r.head)
      linkFace(r)
      addBody(r, { skin: 'pale', torso: boneMat(), arms: boneMat(), legs: boneMat(), skinMaterial: boneMat() })
      for (let i = 0; i < 3; i++) {
        const rib = mesh(new THREE.TorusGeometry(0.13 - i * 0.008, 0.011, 6, 16, Math.PI), boneMat())
        rib.position.set(0, 1.18 - i * 0.09, 0.02)
        rib.rotation.x = 0.15
        r.group.add(rib)
      }
      const spine = cyl(0.018, 0.018, 0.4, boneMat(), 8)
      spine.position.set(0, 1.05, -0.11)
      r.group.add(spine)
      // Bone fingers: thin phalanges instead of a flesh hand.
      for (const arm of [r.armL, r.armR]) {
        for (let f = 0; f < 3; f++) {
          const ph = cyl(0.006, 0.005, 0.05, boneMat(), 5)
          ph.position.set(-0.02 + f * 0.02, -0.62, 0.01)
          arm.add(ph)
        }
      }
      return r
    }
    case 'dragon': {
      const r = baseRig(1.05, side)
      // Realistic creature: scaled hide, horned head, jaw with teeth.
      const hide = new THREE.MeshStandardMaterial({ map: scaleTexture('#ff7a3d'), roughness: 0.65 })
      const bellyM = new THREE.MeshStandardMaterial({ map: scaleTexture('#ffe8b3'), roughness: 0.7 })
      const skull = sph(0.115, hide, 1, 1.05, 1.15)
      skull.position.set(0, 0.13, 0)
      r.head.add(skull)
      const snout = box(0.14, 0.08, 0.14, hide)
      snout.position.set(0, 0.08, 0.13)
      r.head.add(snout)
      for (const s of [-1, 1]) {
        const nostril = sph(0.007, mat(0x1a0d08, 0.8))
        nostril.position.set(s * 0.035, 0.1, 0.2)
        r.head.add(nostril)
        const eye = sph(0.028, new THREE.MeshStandardMaterial({ color: 0xffd23d, roughness: 0.2 }), 1, 1.2, 0.55)
        eye.position.set(s * 0.055, 0.17, 0.09)
        r.head.add(eye)
        const pupil = sph(0.008, mat(0x111111, 0.2), 0.5, 1.4, 0.5)
        pupil.position.set(s * 0.055, 0.17, 0.115)
        r.head.add(pupil)
        const horn = cone(0.025, 0.13, bellyM)
        horn.position.set(s * 0.07, 0.25, -0.03)
        horn.rotation.z = s * -0.4
        r.head.add(horn)
        const ear = cone(0.03, 0.09, hide)
        ear.position.set(s * 0.1, 0.18, -0.02)
        ear.rotation.z = s * -0.6
        r.head.add(ear)
      }
      const jawD = box(0.12, 0.04, 0.14, hide)
      jawD.position.set(0, 0.04, 0.12)
      r.head.add(jawD)
      r.head.userData.jaw = jawD
      linkFace(r)
      for (let i = -1; i <= 1; i++) {
        const tooth = cone(0.008, 0.025, mat(0xffffff, 0.5))
        tooth.position.set(i * 0.035, 0.06, 0.19)
        tooth.rotation.x = Math.PI
        r.head.add(tooth)
      }
      const glow = sph(0.035, new THREE.MeshBasicMaterial({ color: 0xff7a1a }))
      glow.position.set(0, 0.05, 0.2)
      r.head.add(glow)
      addBody(r, { skin: 'fair', torso: hide, arms: hide, legs: hide, bareArms: true, skinMaterial: hide })
      const belly = sph(0.14, bellyM, 1, 1.15, 0.55)
      belly.position.set(0, 1.05, 0.1)
      r.group.add(belly)
      for (let i = 0; i < 4; i++) {
        const spike = cone(0.035, 0.14, bellyM)
        spike.position.set(0, 1.28 - i * 0.02, -0.16 - i * 0.03)
        spike.rotation.x = -0.5
        r.group.add(spike)
      }
      const wingM = new THREE.MeshStandardMaterial({ color: 0xff8a3d, roughness: 0.6, side: THREE.DoubleSide, transparent: true, opacity: 0.92 })
      for (const s of [-1, 1]) {
        const wing = mesh(new THREE.PlaneGeometry(0.55, 0.36), wingM)
        wing.position.set(s * 0.36, 1.2, -0.16)
        wing.rotation.y = s * 0.6
        r.group.add(wing)
      }
      return r
    }
    default: {
      const r = baseRig(1, side)
      makeHumanFace(r.head, { skin: 'fair' })
      linkFace(r)
      addBody(r, { skin: 'fair', torso: clothMat(teamColor), arms: clothMat(teamColor), legs: clothMat('#3d2b1f') })
      return r
    }
  }
}

export function animateRig(r: Rig, t: number, moving: boolean, attacking: boolean) {
  const ph = t * (moving ? 9 : 2)
  const swing = moving ? Math.sin(ph) * 0.5 : Math.sin(ph) * 0.05
  // Hips swing, knees bend as the leg swings forward, ankles stay planted.
  r.legL.rotation.x = swing
  r.legR.rotation.x = -swing
  if (r.kneeL) r.kneeL.rotation.x = moving ? Math.max(0, Math.sin(ph + 0.7)) * 0.85 : 0.06
  if (r.kneeR) r.kneeR.rotation.x = moving ? Math.max(0, Math.sin(ph + Math.PI + 0.7)) * 0.85 : 0.06
  // Shoulders swing opposite the legs; elbows bend naturally, more on attack.
  r.armL.rotation.x = -swing * 0.75
  r.armR.rotation.x = attacking ? -1.15 + Math.sin(t * 14) * 0.3 : swing * 0.75
  if (r.elbowL) r.elbowL.rotation.x = moving ? -0.45 - Math.max(0, Math.sin(ph)) * 0.25 : -0.25
  if (r.elbowR) r.elbowR.rotation.x = attacking ? -0.9 : moving ? -0.45 - Math.max(0, -Math.sin(ph)) * 0.25 : -0.25
  // Breathing — chest rises, whole body bobs a touch, head looks around.
  if (r.chest) {
    const b = 1 + Math.sin(t * 2.2) * 0.018
    r.chest.scale.set(b, 1, b)
  }
  r.group.position.y = Math.sin(t * 2.2) * 0.015
  r.head.rotation.y = Math.sin(t * 0.7) * 0.12
  r.head.rotation.x = attacking ? 0.1 : Math.sin(t * 1.1) * 0.03
  // Blink — eyelids drop for ~0.12s every ~3.2s. Jaw drops a fraction on attack.
  const blinkPhase = t % 3.2
  const blink = blinkPhase < 0.12 ? Math.sin((blinkPhase / 0.12) * Math.PI) : 0
  for (const lid of [r.eyelidL, r.eyelidR]) {
    if (lid) lid.scale.y = 0.55 + blink * 0.85
  }
  if (r.jaw) {
    if (r.jaw.userData.baseY === undefined) r.jaw.userData.baseY = r.jaw.position.y
    r.jaw.position.y = (r.jaw.userData.baseY as number) - (attacking ? 0.012 : 0)
  }
  if (r.plume) r.plume.rotation.z = Math.sin(t * 3) * 0.1
  if (r.cape) (r.cape as THREE.Mesh).rotation.x = moving ? 0.22 + Math.sin(ph) * 0.07 : 0.06
}

export function buildKing(side: Side): THREE.Group {
  const g = new THREE.Group()
  const robe = mesh(new THREE.LatheGeometry([
    new THREE.Vector2(0.02, 0), new THREE.Vector2(0.5, 0.02), new THREE.Vector2(0.42, 0.4),
    new THREE.Vector2(0.38, 0.8), new THREE.Vector2(0.42, 1.05),
  ], 16), clothMat(side === 'blue' ? '#2f6df6' : '#e23b3b'))
  robe.position.y = 0.05
  g.add(robe)
  const head = new THREE.Group()
  head.position.y = 1.42
  g.add(head)
  makeHumanFace(head, { skin: 'fair', eyeColor: 0x3a5a8a, hairColor: '#8a8a8a', hairStyle: 'receding', mustache: 'walrus', beard: 'short' })
  const crown = cyl(0.13, 0.145, 0.09, goldMat(), 10)
  crown.position.y = 0.27
  head.add(crown)
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    const spike = cone(0.025, 0.08, goldMat())
    spike.position.set(Math.cos(a) * 0.125, 0.35, Math.sin(a) * 0.125)
    head.add(spike)
  }
  const jewel = sph(0.02, new THREE.MeshStandardMaterial({ color: 0xe23b3b, roughness: 0.2, metalness: 0.4 }))
  jewel.position.set(0, 0.27, 0.14)
  head.add(jewel)
  const scepter = cyl(0.02, 0.02, 0.9, goldMat())
  scepter.position.set(0.32, 0.65, 0.12)
  scepter.rotation.z = -0.12
  g.add(scepter)
  const orb = sph(0.06, goldMat())
  orb.position.set(0.37, 1.12, 0.12)
  g.add(orb)
  return g
}

export function buildPrincess(side: Side): THREE.Group {
  const g = new THREE.Group()
  const dress = mesh(new THREE.LatheGeometry([
    new THREE.Vector2(0.02, 0), new THREE.Vector2(0.34, 0.02), new THREE.Vector2(0.24, 0.4),
    new THREE.Vector2(0.16, 0.75), new THREE.Vector2(0.17, 0.95),
  ], 16), clothMat(side === 'blue' ? '#7fb2ff' : '#ff9ab0'))
  dress.position.y = 0.05
  g.add(dress)
  const head = new THREE.Group()
  head.position.y = 1.32
  g.add(head)
  makeHumanFace(head, { skin: 'fair', eyeColor: 0x2e7d5a, hairColor: '#d63384', hairStyle: 'long', female: true, freckles: true })
  const circlet = mesh(new THREE.TorusGeometry(0.115, 0.01, 6, 20), goldMat())
  circlet.position.y = 0.22
  circlet.rotation.x = Math.PI / 2 - 0.15
  head.add(circlet)
  const bow = new THREE.Group()
  const arc = mesh(new THREE.TorusGeometry(0.28, 0.022, 8, 18, Math.PI * 1.1), leatherMat())
  arc.rotation.z = Math.PI / 2
  bow.add(arc)
  bow.position.set(0.28, 0.75, 0.12)
  g.add(bow)
  return g
}
