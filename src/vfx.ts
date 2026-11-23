import * as THREE from 'three'
import type { Side } from './types'

// Visual effects: everything that makes combat read as impact.
//
//  - Particles: one THREE.Points draw call for every spark, flame and smoke
//    puff. Sprites come from a 4x4 atlas (Kenney Particle Pack, CC0). Output is
//    premultiplied, and each particle carries an "additive" factor, so glowing
//    and smoky particles share one buffer. Colors are HDR (> 1), which the
//    bloom pass turns into glow.
//  - Quads: pooled textured planes for slash arcs, rune circles, shock rings,
//    scorch marks and light pillars.
//  - Trails: camera-facing ribbons behind projectiles.
//  - Debris: instanced rock chips with gravity and bounce.
//  - Flash lights: a small pool of point lights for explosions.
//  - Shockwaves: screen-space distortion rings, read by the post pass.
//  - Damage numbers: DOM labels projected from world space.

export const SPRITE = {
  glow: 0, smoke: 1, smokeChunk: 2, fire: 3, flame: 4, muzzle: 5, flare: 6, streak: 7,
  debris: 8, scorch: 9, ring: 10, rune: 11, slash: 12, twirl: 13, star: 14, smokeRing: 15,
} as const
type Sprite = (typeof SPRITE)[keyof typeof SPRITE]
type RGB = [number, number, number]

const TEAM_GLOW: Record<Side, RGB> = { blue: [0.18, 0.5, 2.2], red: [2.3, 0.3, 0.14] }
const FIRE: RGB = [2.2, 0.55, 0.04], EMBER: RGB = [1.7, 0.24, 0.02], HOT: RGB = [2.4, 1.3, 0.35], SMOKE: RGB = [0.16, 0.15, 0.15], DUST: RGB = [0.52, 0.44, 0.34]
const rand = (a = 1, b?: number) => (b === undefined ? Math.random() * a : a + Math.random() * (b - a))
const randSign = () => (Math.random() < 0.5 ? -1 : 1)

// --- particles ------------------------------------------------------------------
interface Spawn {
  x: number; y: number; z: number
  vx?: number; vy?: number; vz?: number
  life: number
  size: [number, number]
  color: RGB; color2?: RGB
  alpha?: [number, number]
  /** 1 = pure glow (adds light), 0 = opaque-ish smoke. */
  add?: number
  rot?: number; spin?: number
  drag?: number; gravity?: number
  sprite: Sprite
  fadeIn?: number
}
const STRIDE = 24 // x y z vx vy vz age life s0 s1 r0 g0 b0 r1 g1 b1 a0 a1 add rot spin drag grav sprite(+fadeIn*16)

class Particles {
  readonly points: THREE.Points
  private data: Float32Array
  private count = 0
  private pos: THREE.BufferAttribute; private col: THREE.BufferAttribute; private misc: THREE.BufferAttribute
  private mat: THREE.ShaderMaterial

  constructor(private capacity: number, atlas: THREE.Texture) {
    this.data = new Float32Array(capacity * STRIDE)
    const g = new THREE.BufferGeometry()
    this.pos = new THREE.BufferAttribute(new Float32Array(capacity * 3), 3)
    this.col = new THREE.BufferAttribute(new Float32Array(capacity * 4), 4)
    this.misc = new THREE.BufferAttribute(new Float32Array(capacity * 4), 4) // size, rot, sprite, additive
    for (const a of [this.pos, this.col, this.misc]) a.setUsage(THREE.DynamicDrawUsage)
    g.setAttribute('position', this.pos); g.setAttribute('aColor', this.col); g.setAttribute('aMisc', this.misc)
    g.setDrawRange(0, 0)
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uAtlas: { value: atlas }, uScale: { value: 600 } },
      vertexShader: `attribute vec4 aColor; attribute vec4 aMisc; uniform float uScale;
        varying vec4 vColor; varying vec3 vMisc;
        void main() {
          vColor = aColor; vMisc = aMisc.yzw;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(aMisc.x * uScale / max(0.1, -mv.z), 1.0, 480.0);
        }`,
      fragmentShader: `uniform sampler2D uAtlas; varying vec4 vColor; varying vec3 vMisc;
        void main() {
          vec2 pc = gl_PointCoord - 0.5;
          float c = cos(vMisc.x), s = sin(vMisc.x);
          pc = vec2(c * pc.x - s * pc.y, s * pc.x + c * pc.y) + 0.5;
          if (pc.x < 0.0 || pc.x > 1.0 || pc.y < 0.0 || pc.y > 1.0) discard;
          float cell = floor(vMisc.y + 0.5);
          vec2 uv = vec2((mod(cell, 4.0) + pc.x) * 0.25, 1.0 - (floor(cell / 4.0) + pc.y) * 0.25);
          float a = texture2D(uAtlas, uv).r * vColor.a;
          // premultiplied: additive particles write no coverage, so they only add light
          gl_FragColor = vec4(vColor.rgb * a, a * (1.0 - vMisc.z));
        }`,
      transparent: true, depthWrite: false, blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
    })
    this.points = new THREE.Points(g, this.mat)
    this.points.frustumCulled = false
    this.points.renderOrder = 20
  }

  spawn(o: Spawn) {
    if (this.count >= this.capacity) return
    const d = this.data, i = this.count++ * STRIDE
    const c2 = o.color2 ?? o.color, a = o.alpha ?? [1, 0]
    d[i] = o.x; d[i + 1] = o.y; d[i + 2] = o.z
    d[i + 3] = o.vx ?? 0; d[i + 4] = o.vy ?? 0; d[i + 5] = o.vz ?? 0
    d[i + 6] = 0; d[i + 7] = o.life
    d[i + 8] = o.size[0]; d[i + 9] = o.size[1]
    d[i + 10] = o.color[0]; d[i + 11] = o.color[1]; d[i + 12] = o.color[2]
    d[i + 13] = c2[0]; d[i + 14] = c2[1]; d[i + 15] = c2[2]
    d[i + 16] = a[0]; d[i + 17] = a[1]
    d[i + 18] = o.add ?? 1
    d[i + 19] = o.rot ?? rand(Math.PI * 2); d[i + 20] = o.spin ?? 0
    d[i + 21] = o.drag ?? 0; d[i + 22] = o.gravity ?? 0
    d[i + 23] = o.sprite + Math.min(0.9, o.fadeIn ?? 0.08) // integer part = sprite, fraction = fade-in share of life
  }

  update(dt: number, pointScale: number) {
    const d = this.data, P = this.pos.array as Float32Array, C = this.col.array as Float32Array, M = this.misc.array as Float32Array
    let n = this.count
    for (let k = 0; k < n; k++) {
      let i = k * STRIDE
      d[i + 6] += dt
      if (d[i + 6] >= d[i + 7]) { // dead: swap the last particle in
        n--
        if (k !== n) d.copyWithin(i, n * STRIDE, n * STRIDE + STRIDE)
        k--
        continue
      }
      const drag = Math.max(0, 1 - d[i + 21] * dt)
      d[i + 3] *= drag; d[i + 4] = d[i + 4] * drag - d[i + 22] * dt; d[i + 5] *= drag
      d[i] += d[i + 3] * dt; d[i + 1] += d[i + 4] * dt; d[i + 2] += d[i + 5] * dt
      d[i + 19] += d[i + 20] * dt
      const t = d[i + 6] / d[i + 7], e = 1 - (1 - t) * (1 - t)
      const sprite = Math.floor(d[i + 23]), fadeIn = d[i + 23] - sprite
      P[k * 3] = d[i]; P[k * 3 + 1] = d[i + 1]; P[k * 3 + 2] = d[i + 2]
      C[k * 4] = d[i + 10] + (d[i + 13] - d[i + 10]) * t
      C[k * 4 + 1] = d[i + 11] + (d[i + 14] - d[i + 11]) * t
      C[k * 4 + 2] = d[i + 12] + (d[i + 15] - d[i + 12]) * t
      C[k * 4 + 3] = (d[i + 16] + (d[i + 17] - d[i + 16]) * t) * Math.min(1, t / Math.max(0.001, fadeIn))
      M[k * 4] = d[i + 8] + (d[i + 9] - d[i + 8]) * e
      M[k * 4 + 1] = d[i + 19]; M[k * 4 + 2] = sprite; M[k * 4 + 3] = d[i + 18]
    }
    this.count = n
    this.points.geometry.setDrawRange(0, n)
    this.pos.needsUpdate = this.col.needsUpdate = this.misc.needsUpdate = true
    this.mat.uniforms.uScale.value = pointScale
  }
}

// --- pooled textured quads ----------------------------------------------------------
interface QuadFx { mesh: THREE.Mesh; t: number; dur: number; s0: number; s1: number; a: number; spin: number; billboard: boolean; color: THREE.Color; fadeIn: number; grow: (t: number) => number }
interface QuadOpts {
  sprite: Sprite; pos: THREE.Vector3; size: [number, number]; dur: number; color: RGB
  alpha?: number; additive?: boolean; spin?: number; rot?: number
  /** 'ground' lies flat; 'billboard' faces the camera; or pass a quaternion. */
  facing?: 'ground' | 'billboard' | THREE.Quaternion
  fadeIn?: number; ease?: 'out' | 'linear'
}

// --- ribbons -----------------------------------------------------------------------
export class Trail {
  readonly mesh: THREE.Mesh
  private pts: THREE.Vector3[] = []
  private posAttr: THREE.BufferAttribute; private colAttr: THREE.BufferAttribute
  dead = false
  private releasing = false
  constructor(private max: number, private width: number, private color: RGB, private minStep = 0.12) {
    const g = new THREE.BufferGeometry()
    this.posAttr = new THREE.BufferAttribute(new Float32Array(max * 2 * 3), 3)
    this.colAttr = new THREE.BufferAttribute(new Float32Array(max * 2 * 3), 3)
    g.setAttribute('position', this.posAttr); g.setAttribute('color', this.colAttr)
    const idx: number[] = []
    for (let i = 0; i < max - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
    g.setIndex(idx); g.setDrawRange(0, 0)
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }))
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 19
  }
  /** Follow `head`; once released the ribbon retracts and removes itself. */
  update(head: THREE.Vector3 | null, cam: THREE.Camera) {
    if (head && !this.releasing) {
      const last = this.pts[0]
      if (!last || last.distanceToSquared(head) > this.minStep * this.minStep) { this.pts.unshift(head.clone()); if (this.pts.length > this.max) this.pts.pop() }
      else last.copy(head)
    } else if (this.pts.length) this.pts.pop()
    const n = this.pts.length
    if (n < 2) { this.mesh.geometry.setDrawRange(0, 0); if (this.releasing) this.dead = true; return }
    const P = this.posAttr.array as Float32Array, C = this.colAttr.array as Float32Array
    const dir = new THREE.Vector3(), side = new THREE.Vector3(), toCam = new THREE.Vector3()
    for (let i = 0; i < n; i++) {
      const p = this.pts[i]
      dir.subVectors(this.pts[Math.max(0, i - 1)], this.pts[Math.min(n - 1, i + 1)])
      toCam.subVectors(cam.position, p)
      side.crossVectors(dir, toCam).normalize()
      const k = 1 - i / (n - 1), w = this.width * (0.25 + 0.75 * k)
      P[i * 6] = p.x + side.x * w; P[i * 6 + 1] = p.y + side.y * w; P[i * 6 + 2] = p.z + side.z * w
      P[i * 6 + 3] = p.x - side.x * w; P[i * 6 + 4] = p.y - side.y * w; P[i * 6 + 5] = p.z - side.z * w
      const b = k * k
      for (const o of [0, 3]) { C[i * 6 + o] = this.color[0] * b; C[i * 6 + o + 1] = this.color[1] * b; C[i * 6 + o + 2] = this.color[2] * b }
    }
    this.posAttr.needsUpdate = this.colAttr.needsUpdate = true
    this.mesh.geometry.setDrawRange(0, (n - 1) * 6)
  }
  release() { this.releasing = true }
  /** Called every frame by Vfx so released ribbons keep retracting. */
  tick(cam: THREE.Camera) { if (this.releasing) this.update(null, cam) }
}

export interface Shockwave { pos: THREE.Vector3; t: number; dur: number; radius: number; strength: number }
type ProjectileKind = 'arrow' | 'bullet' | 'bomb' | 'fire' | 'cannon'

export class Vfx {
  readonly waves: Shockwave[] = []
  /** Set by effects; the engine adds it to its camera shake. */
  shake = 0
  private particles: Particles
  private quads: QuadFx[] = []
  private quadPool: THREE.Mesh[] = []
  private cells: THREE.Texture[] = []
  private trails: Trail[] = []
  private lights: { light: THREE.PointLight; t: number; dur: number; peak: number }[] = []
  private debris: THREE.InstancedMesh
  private chips: { p: THREE.Vector3; v: THREE.Vector3; r: THREE.Euler; w: THREE.Vector3; life: number; age: number; s: number }[] = []
  private emitters: ((dt: number) => boolean)[] = []
  private labels: { el: HTMLDivElement; pos: THREE.Vector3; t: number; dur: number }[] = []
  private labelLayer: HTMLDivElement
  private planeGeo = new THREE.PlaneGeometry(1, 1)
  private q: number

  constructor(private scene: THREE.Scene, private camera: THREE.Camera, container: HTMLElement, private phone: boolean) {
    this.q = phone ? 0.55 : 1
    // Per-sprite views of the atlas are made once the image has arrived.
    const atlas = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/vfx/atlas.png`, (loaded) => {
      for (let i = 0; i < 16; i++) {
        const c = loaded.clone(); c.repeat.set(0.25, 0.25); c.offset.set((i % 4) * 0.25, 1 - (Math.floor(i / 4) + 1) * 0.25); c.needsUpdate = true
        this.cells.push(c)
      }
    })
    atlas.colorSpace = THREE.NoColorSpace
    this.particles = new Particles(phone ? 2200 : 6000, atlas)
    scene.add(this.particles.points)
    for (let i = 0; i < (phone ? 2 : 4); i++) {
      const light = new THREE.PointLight(0xffffff, 0, 14, 1.8)
      scene.add(light); this.lights.push({ light, t: 1, dur: 1, peak: 0 })
    }
    this.debris = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x6b655d, roughness: 1, flatShading: true }), phone ? 60 : 160)
    this.debris.count = 0; this.debris.castShadow = !phone; this.debris.frustumCulled = false
    scene.add(this.debris)
    this.labelLayer = document.createElement('div')
    this.labelLayer.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:3'
    container.appendChild(this.labelLayer)
  }

  // --- primitives -------------------------------------------------------------
  private p(o: Spawn) { this.particles.spawn(o) }
  private n(count: number) { return Math.max(1, Math.round(count * this.q)) }

  quad(o: QuadOpts) {
    if (this.cells.length < 16) return // atlas still loading
    const mesh = this.quadPool.pop() ?? new THREE.Mesh(this.planeGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }))
    const m = mesh.material as THREE.MeshBasicMaterial
    m.alphaMap = this.cells[o.sprite]
    m.blending = o.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending
    m.color.setRGB(o.color[0], o.color[1], o.color[2])
    m.needsUpdate = true
    mesh.position.copy(o.pos)
    const billboard = o.facing === 'billboard'
    if (o.facing instanceof THREE.Quaternion) mesh.quaternion.copy(o.facing)
    else if (!billboard) mesh.rotation.set(-Math.PI / 2, 0, o.rot ?? rand(Math.PI * 2))
    mesh.renderOrder = o.additive === false ? 2 : 18
    this.scene.add(mesh)
    this.quads.push({ mesh, t: 0, dur: o.dur, s0: o.size[0], s1: o.size[1], a: o.alpha ?? 1, spin: o.spin ?? 0, billboard, color: m.color, fadeIn: o.fadeIn ?? 0.08, grow: o.ease === 'linear' ? (t) => t : (t) => 1 - (1 - t) ** 3 })
  }

  trail(width: number, color: RGB, max = 14, minStep = 0.12): Trail {
    const t = new Trail(max, width, color, minStep)
    this.scene.add(t.mesh); this.trails.push(t)
    return t
  }

  flash(pos: THREE.Vector3, color: number, intensity: number, dur: number) {
    let best = this.lights[0]
    for (const l of this.lights) if (l.t / l.dur > best.t / best.dur) best = l
    best.light.position.copy(pos); best.light.color.setHex(color)
    best.t = 0; best.dur = dur; best.peak = intensity
  }

  wave(pos: THREE.Vector3, radius: number, strength: number, dur = 0.6) {
    if (this.waves.length >= 4) this.waves.shift()
    this.waves.push({ pos: pos.clone(), t: 0, dur, radius, strength })
  }

  private chip(pos: THREE.Vector3, power: number, count: number) {
    for (let i = 0; i < this.n(count); i++) {
      if (this.chips.length >= this.debris.instanceMatrix.count) break
      const a = rand(Math.PI * 2), sp = rand(1.5, 5) * power
      this.chips.push({
        p: pos.clone().add(new THREE.Vector3(rand(-0.3, 0.3), rand(0.1, 0.5), rand(-0.3, 0.3))),
        v: new THREE.Vector3(Math.cos(a) * sp, rand(3, 7.5) * power, Math.sin(a) * sp),
        r: new THREE.Euler(rand(6), rand(6), rand(6)), w: new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)),
        life: rand(1.1, 2.2), age: 0, s: rand(0.05, 0.14) * (0.7 + power * 0.5),
      })
    }
  }

  number(pos: THREE.Vector3, amount: number, color: string, big = false) {
    if (this.labels.length > (this.phone ? 10 : 22)) return
    const el = document.createElement('div')
    el.textContent = String(Math.round(amount))
    const size = Math.round((big ? 22 : 15) + Math.min(14, amount / 60))
    el.style.cssText = `position:absolute;left:0;top:0;font:900 ${size}px system-ui,sans-serif;color:${color};text-shadow:0 2px 0 rgba(0,0,0,.75),0 0 10px rgba(0,0,0,.6);will-change:transform,opacity;white-space:nowrap`
    this.labelLayer.appendChild(el)
    this.labels.push({ el, pos: pos.clone().add(new THREE.Vector3(rand(-0.3, 0.3), 0, rand(-0.2, 0.2))), t: 0, dur: 0.9 })
  }

  // --- composed effects ---------------------------------------------------------
  /** Summoning: rune circle, light pillar, sparks rising, dust ring. */
  deploy(x: number, z: number, side: Side, scale = 1) {
    const c = TEAM_GLOW[side], g = new THREE.Vector3(x, 0.06, z)
    this.quad({ sprite: SPRITE.rune, pos: g, size: [0.6 * scale, 2.6 * scale], dur: 0.9, color: c, spin: 2.2, alpha: 0.9 })
    this.quad({ sprite: SPRITE.ring, pos: g, size: [0.3 * scale, 3.4 * scale], dur: 0.55, color: c })
    for (let i = 0; i < this.n(26); i++) {
      const a = rand(Math.PI * 2), r = rand(0.1, 0.8) * scale
      this.p({ x: x + Math.cos(a) * r, y: 0.1, z: z + Math.sin(a) * r, vy: rand(2.5, 6.5), life: rand(0.35, 0.8), size: [0.5, 0.05], color: c, sprite: SPRITE.streak, rot: 0, alpha: [1, 0] })
    }
    for (let i = 0; i < 3; i++) this.p({ x, y: 0.5 + i * 0.7, z, life: 0.5, size: [2.4 * scale, 0.6], color: c, alpha: [0.3, 0], sprite: SPRITE.glow })
    for (let i = 0; i < this.n(14); i++) {
      const a = rand(Math.PI * 2)
      this.p({ x, y: 0.15, z, vx: Math.cos(a) * rand(2, 4), vy: rand(0.2, 0.9), vz: Math.sin(a) * rand(2, 4), life: rand(0.5, 0.9), size: [0.5, 1.6], color: DUST, alpha: [0.5, 0], add: 0, drag: 2.6, sprite: SPRITE.smoke, spin: rand(-1, 1) })
    }
    this.flash(new THREE.Vector3(x, 1.2, z), side === 'blue' ? 0x4d9bff : 0xff5a3c, 16 * scale, 0.45)
  }

  /** A troop dies: soul wisps rise, embers scatter. */
  death(x: number, y: number, z: number, side: Side) {
    const c = TEAM_GLOW[side]
    this.p({ x, y: y + 0.9, z, life: 0.4, size: [1.8, 3.2], color: c, alpha: [0.8, 0], sprite: SPRITE.glow })
    this.quad({ sprite: SPRITE.ring, pos: new THREE.Vector3(x, 0.07, z), size: [0.4, 2.4], dur: 0.5, color: c })
    for (let i = 0; i < this.n(16); i++) {
      const a = rand(Math.PI * 2)
      this.p({ x: x + Math.cos(a) * rand(0.4), y: y + rand(0.2, 1.4), z: z + Math.sin(a) * rand(0.4), vx: Math.cos(a) * rand(0.6), vy: rand(1.2, 3.2), vz: Math.sin(a) * rand(0.6), life: rand(0.7, 1.5), size: [0.34, 0.04], color: c, sprite: SPRITE.star, drag: 0.6, spin: rand(-3, 3) })
    }
    for (let i = 0; i < this.n(8); i++) this.p({ x: x + rand(-0.3, 0.3), y: y + rand(0.3, 1), z: z + rand(-0.3, 0.3), vy: rand(0.5, 1.2), life: rand(0.8, 1.4), size: [0.7, 1.8], color: SMOKE, alpha: [0.45, 0], add: 0, sprite: SPRITE.smoke, spin: rand(-0.6, 0.6) })
  }

  /** Something took damage: sparks, a flash, and the number. */
  hit(pos: THREE.Vector3, amount: number, opts: { stone?: boolean; side?: Side; label?: boolean } = {}) {
    const heavy = Math.min(1.8, 0.6 + amount / 300)
    this.p({ x: pos.x, y: pos.y, z: pos.z, life: 0.14, size: [0.7 * heavy, 1.5 * heavy], color: HOT, alpha: [0.8, 0], sprite: SPRITE.flare, fadeIn: 0.01 })
    for (let i = 0; i < this.n(6 + heavy * 5); i++) {
      const a = rand(Math.PI * 2), sp = rand(2, 7) * heavy
      this.p({ x: pos.x, y: pos.y, z: pos.z, vx: Math.cos(a) * sp, vy: rand(1, 5), vz: Math.sin(a) * sp, life: rand(0.2, 0.5), size: [0.2, 0.03], color: opts.stone ? [2.4, 2, 1.5] : HOT, color2: EMBER, gravity: 14, drag: 1.5, sprite: SPRITE.streak, rot: a })
    }
    if (opts.stone) {
      for (let i = 0; i < this.n(4); i++) this.p({ x: pos.x + rand(-0.3, 0.3), y: pos.y + rand(-0.2, 0.2), z: pos.z + rand(-0.3, 0.3), vx: rand(-1, 1), vy: rand(0.3, 1.2), vz: rand(-1, 1), life: rand(0.5, 0.9), size: [0.4, 1.3], color: DUST, alpha: [0.5, 0], add: 0, drag: 2, sprite: SPRITE.smoke })
      if (amount > 80) this.chip(pos, 0.5, 3)
    }
    if (opts.label !== false) this.number(pos.clone().setY(pos.y + 0.7), amount, opts.side === 'blue' ? '#ff8f7a' : '#fff3c4', amount >= 250)
  }

  /** Sword / claw swing: a bright crescent in front of the attacker. */
  slash(x: number, z: number, yaw: number, side: Side, scale = 1) {
    const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))
    const pos = new THREE.Vector3(x, 0.95 * scale, z).addScaledVector(f, 0.75 * scale)
    // lie the crescent in a tilted plane, bulging toward the target
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + 0.35 * randSign(), 0, -yaw + Math.PI, 'YXZ'))
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0))
    const c = TEAM_GLOW[side]
    this.quad({ sprite: SPRITE.slash, pos, size: [1.1 * scale, 2.3 * scale], dur: 0.2, color: [2.4, 2.2, 1.8], facing: q, fadeIn: 0.02 })
    this.quad({ sprite: SPRITE.slash, pos: pos.clone().setY(pos.y - 0.05), size: [1.3 * scale, 2.7 * scale], dur: 0.3, color: c, facing: q, alpha: 0.7, fadeIn: 0.02 })
    for (let i = 0; i < this.n(5); i++) {
      const a = yaw + rand(-0.9, 0.9)
      this.p({ x: pos.x, y: pos.y, z: pos.z, vx: Math.sin(a) * rand(3, 6), vy: rand(0.5, 2.5), vz: Math.cos(a) * rand(3, 6), life: rand(0.15, 0.3), size: [0.22, 0.03], color: HOT, sprite: SPRITE.streak, rot: -a, gravity: 6 })
    }
  }

  /** Heavy ground pound (Giant, Prince charge). */
  slam(x: number, z: number, scale = 1) {
    const g = new THREE.Vector3(x, 0.07, z)
    this.quad({ sprite: SPRITE.ring, pos: g, size: [0.5 * scale, 4.2 * scale], dur: 0.45, color: [2.2, 1.9, 1.5], alpha: 0.9 })
    this.quad({ sprite: SPRITE.scorch, pos: g, size: [1.6 * scale, 2.2 * scale], dur: 1.6, color: [0.05, 0.04, 0.03], additive: false, alpha: 0.55, ease: 'linear' })
    for (let i = 0; i < this.n(18); i++) {
      const a = rand(Math.PI * 2)
      this.p({ x: x + Math.cos(a) * 0.4, y: 0.2, z: z + Math.sin(a) * 0.4, vx: Math.cos(a) * rand(3, 6) * scale, vy: rand(0.4, 1.6), vz: Math.sin(a) * rand(3, 6) * scale, life: rand(0.5, 1), size: [0.6, 2.1 * scale], color: DUST, alpha: [0.6, 0], add: 0, drag: 3, sprite: SPRITE.smoke, spin: rand(-1, 1) })
    }
    this.chip(g, 0.7 * scale, 6)
    this.wave(g, 2.2 * scale, 0.012, 0.4)
    this.shake = Math.max(this.shake, 0.22 * scale)
  }

  /** Flash and smoke where a ranged attacker fires. */
  muzzle(from: THREE.Vector3, to: THREE.Vector3, kind: ProjectileKind) {
    const dir = to.clone().sub(from).normalize()
    if (kind === 'bullet' || kind === 'cannon') {
      const big = kind === 'cannon' ? 1.7 : 1
      const p = from.clone().addScaledVector(dir, 0.5 * big)
      this.p({ x: p.x, y: p.y, z: p.z, life: 0.09, size: [1.6 * big, 2.6 * big], color: HOT, sprite: SPRITE.muzzle, rot: Math.atan2(dir.x, -dir.y || 0.001), fadeIn: 0.01 })
      this.p({ x: p.x, y: p.y, z: p.z, life: 0.12, size: [1.2 * big, 2.2 * big], color: FIRE, sprite: SPRITE.flare, fadeIn: 0.01 })
      for (let i = 0; i < this.n(5 * big); i++) this.p({ x: p.x, y: p.y, z: p.z, vx: dir.x * rand(1, 3.5) + rand(-0.6, 0.6), vy: rand(0.2, 1.2), vz: dir.z * rand(1, 3.5) + rand(-0.6, 0.6), life: rand(0.6, 1.2), size: [0.4, 1.7 * big], color: [0.5, 0.48, 0.45], alpha: [0.5, 0], add: 0, drag: 2.4, sprite: SPRITE.smoke, spin: rand(-1, 1) })
      for (let i = 0; i < this.n(6); i++) this.p({ x: p.x, y: p.y, z: p.z, vx: dir.x * rand(5, 11) + rand(-2, 2), vy: dir.y * 6 + rand(-1, 2), vz: dir.z * rand(5, 11) + rand(-2, 2), life: rand(0.12, 0.3), size: [0.2, 0.02], color: HOT, color2: EMBER, sprite: SPRITE.streak, gravity: 8 })
      this.flash(p, 0xffb060, 14 * big, 0.14)
    } else if (kind === 'fire') {
      for (let i = 0; i < this.n(10); i++) this.p({ x: from.x, y: from.y, z: from.z, vx: dir.x * rand(2, 6) + rand(-1, 1), vy: dir.y * 4 + rand(-0.5, 1), vz: dir.z * rand(2, 6) + rand(-1, 1), life: rand(0.2, 0.45), size: [0.5, 1.5], color: FIRE, color2: EMBER, sprite: SPRITE.fire, drag: 2, spin: rand(-3, 3) })
      this.flash(from, 0xff7a2a, 12, 0.2)
    }
  }

  /** Ribbon for a projectile; the engine calls trail.update(head) each frame. */
  projectileTrail(kind: ProjectileKind): Trail {
    if (kind === 'arrow') return this.trail(0.045, [1.6, 1.5, 1.2], 10, 0.2)
    if (kind === 'bullet') return this.trail(0.07, [2.6, 1.9, 0.7], 12, 0.3)
    if (kind === 'bomb') return this.trail(0.09, [1.8, 0.7, 0.15], 12)
    if (kind === 'fire') return this.trail(0.34, [2.2, 0.75, 0.1], 16)
    return this.trail(0.12, [1.1, 1, 0.9], 12, 0.2)
  }
  /** Per-frame particles shed by a flying projectile. */
  projectileTick(kind: ProjectileKind, pos: THREE.Vector3, dt: number) {
    const roll = (rate: number) => Math.random() < rate * dt * this.q
    if (kind === 'fire') {
      if (roll(90)) this.p({ x: pos.x + rand(-0.12, 0.12), y: pos.y + rand(-0.12, 0.12), z: pos.z + rand(-0.12, 0.12), vy: rand(0.3, 1.2), life: rand(0.25, 0.5), size: [0.9, 0.2], color: FIRE, color2: EMBER, sprite: SPRITE.fire, spin: rand(-4, 4) })
      if (roll(30)) this.p({ x: pos.x, y: pos.y, z: pos.z, vy: rand(0.4, 1), life: rand(0.5, 0.9), size: [0.5, 1.4], color: SMOKE, alpha: [0.4, 0], add: 0, sprite: SPRITE.smoke })
    } else if (kind === 'bomb') {
      if (roll(60)) this.p({ x: pos.x, y: pos.y + 0.22, z: pos.z, vx: rand(-1.5, 1.5), vy: rand(0.5, 2.5), vz: rand(-1.5, 1.5), life: rand(0.15, 0.35), size: [0.16, 0.02], color: HOT, color2: EMBER, sprite: SPRITE.star, gravity: 6 })
      if (roll(24)) this.p({ x: pos.x, y: pos.y, z: pos.z, life: rand(0.4, 0.7), size: [0.3, 0.9], color: SMOKE, alpha: [0.35, 0], add: 0, sprite: SPRITE.smoke })
    } else if (kind === 'cannon') {
      if (roll(40)) this.p({ x: pos.x, y: pos.y, z: pos.z, life: rand(0.3, 0.55), size: [0.35, 0.9], color: [0.4, 0.38, 0.36], alpha: [0.35, 0], add: 0, sprite: SPRITE.smoke })
    }
  }

  /** What happens where a projectile lands. */
  impact(kind: ProjectileKind, pos: THREE.Vector3) {
    if (kind === 'bomb') return this.explosion(pos.x, Math.max(0.3, pos.y - 0.6), pos.z, 1)
    if (kind === 'fire') {
      this.p({ x: pos.x, y: pos.y, z: pos.z, life: 0.2, size: [1.4, 3], color: FIRE, alpha: [0.9, 0], sprite: SPRITE.glow })
      for (let i = 0; i < this.n(14); i++) { const a = rand(Math.PI * 2); this.p({ x: pos.x, y: pos.y, z: pos.z, vx: Math.cos(a) * rand(1, 4), vy: rand(0.5, 3.5), vz: Math.sin(a) * rand(1, 4), life: rand(0.3, 0.7), size: [0.9, 0.2], color: FIRE, color2: EMBER, sprite: SPRITE.fire, drag: 2.5, spin: rand(-4, 4) }) }
      this.quad({ sprite: SPRITE.scorch, pos: new THREE.Vector3(pos.x, 0.05, pos.z), size: [1.2, 1.7], dur: 2.5, color: [0.04, 0.03, 0.03], additive: false, alpha: 0.5, ease: 'linear' })
      this.flash(pos, 0xff6a20, 16, 0.3)
      return
    }
    if (kind === 'cannon') {
      for (let i = 0; i < this.n(8); i++) { const a = rand(Math.PI * 2); this.p({ x: pos.x, y: pos.y, z: pos.z, vx: Math.cos(a) * rand(1.5, 4), vy: rand(0.4, 2), vz: Math.sin(a) * rand(1.5, 4), life: rand(0.4, 0.8), size: [0.5, 1.6], color: DUST, alpha: [0.55, 0], add: 0, drag: 3, sprite: SPRITE.smoke }) }
      this.quad({ sprite: SPRITE.ring, pos: new THREE.Vector3(pos.x, 0.06, pos.z), size: [0.3, 2], dur: 0.3, color: [1.6, 1.4, 1.1], alpha: 0.7 })
      this.chip(pos, 0.5, 3)
      this.shake = Math.max(this.shake, 0.06)
    }
  }

  /** Fireball-style blast: flash, fire, smoke column, debris, scorch, shockwave. */
  explosion(x: number, y: number, z: number, scale = 1) {
    const c = new THREE.Vector3(x, y, z), g = new THREE.Vector3(x, 0.06, z)
    this.p({ x, y: y + 0.3, z, life: 0.16, size: [3.2 * scale, 7.5 * scale], color: [2.6, 1.0, 0.18], alpha: [1, 0], sprite: SPRITE.glow, fadeIn: 0.01 })
    this.p({ x, y: y + 0.3, z, life: 0.22, size: [2.5 * scale, 6 * scale], color: HOT, sprite: SPRITE.flare, fadeIn: 0.01 })
    for (let i = 0; i < this.n(26 * scale); i++) {
      const a = rand(Math.PI * 2), up = rand(0.2, 1), sp = rand(1.5, 5.5) * scale
      this.p({ x: x + Math.cos(a) * 0.2, y: y + 0.2, z: z + Math.sin(a) * 0.2, vx: Math.cos(a) * sp, vy: up * 4.5 * scale, vz: Math.sin(a) * sp, life: rand(0.45, 0.95), size: [1.3 * scale, 3.1 * scale], color: [2.8, 0.8, 0.06], color2: [1.1, 0.1, 0.01], alpha: [1, 0], add: 0.6, sprite: Math.random() < 0.5 ? SPRITE.fire : SPRITE.flame, drag: 2.8, spin: rand(-3, 3) })
    }
    for (let i = 0; i < this.n(16 * scale); i++) {
      const a = rand(Math.PI * 2), sp = rand(0.6, 2.6) * scale
      this.p({ x: x + Math.cos(a) * 0.4, y: y + rand(0.2, 0.8), z: z + Math.sin(a) * 0.4, vx: Math.cos(a) * sp, vy: rand(1.2, 3.6) * scale, vz: Math.sin(a) * sp, life: rand(1.1, 2.3), size: [1 * scale, 3.4 * scale], color: [0.22, 0.12, 0.07], color2: SMOKE, alpha: [0.6, 0], add: 0, drag: 1.4, sprite: Math.random() < 0.5 ? SPRITE.smoke : SPRITE.smokeChunk, spin: rand(-0.8, 0.8), fadeIn: 0.35 })
    }
    for (let i = 0; i < this.n(30 * scale); i++) {
      const a = rand(Math.PI * 2), sp = rand(4, 12) * scale
      this.p({ x, y: y + 0.3, z, vx: Math.cos(a) * sp, vy: rand(2, 9) * scale, vz: Math.sin(a) * sp, life: rand(0.4, 1), size: [0.24, 0.02], color: HOT, color2: EMBER, gravity: 13, drag: 0.8, sprite: SPRITE.streak, rot: a })
    }
    this.quad({ sprite: SPRITE.ring, pos: g, size: [0.5 * scale, 6.5 * scale], dur: 0.5, color: [2.4, 0.7, 0.1], alpha: 0.9 })
    this.quad({ sprite: SPRITE.smokeRing, pos: g.clone().setY(0.12), size: [1 * scale, 5.5 * scale], dur: 0.9, color: [0.3, 0.24, 0.2], additive: false, alpha: 0.35 })
    this.quad({ sprite: SPRITE.scorch, pos: g, size: [2.6 * scale, 3.4 * scale], dur: 6, color: [0.03, 0.025, 0.02], additive: false, alpha: 0.7, ease: 'linear', fadeIn: 0.02 })
    this.chip(c, scale, 12 * scale)
    this.flash(c.clone().setY(y + 1.2), 0xff8a3a, 40 * scale, 0.45)
    this.wave(c, 3.6 * scale, 0.03 * scale, 0.55)
    this.shake = Math.max(this.shake, 0.4 * scale)
    // embers that keep drifting up for a moment
    let left = 1.2
    this.emitters.push((dt) => {
      left -= dt
      if (Math.random() < 30 * dt * this.q) this.p({ x: x + rand(-1, 1) * scale, y: 0.2, z: z + rand(-1, 1) * scale, vx: rand(-0.4, 0.4), vy: rand(1, 2.6), vz: rand(-0.4, 0.4), life: rand(0.8, 1.6), size: [0.16, 0.02], color: EMBER, sprite: SPRITE.star, drag: 0.4 })
      return left > 0
    })
  }

  /** Fireball spell: a meteor streaks in, then explodes. */
  meteor(x: number, z: number, onImpact?: () => void) {
    const target = new THREE.Vector3(x, 0.4, z), start = new THREE.Vector3(x + 4, 15, z - 8) // from the far side, never past the camera
    const head = start.clone(), trail = this.trail(0.55, [2.6, 0.9, 0.15], 18, 0.25)
    this.quad({ sprite: SPRITE.rune, pos: new THREE.Vector3(x, 0.06, z), size: [3.4, 2.6], dur: 0.42, color: [2.2, 0.5, 0.1], spin: -3, alpha: 0.8, ease: 'linear' })
    let t = 0
    const dur = 0.42
    this.emitters.push((dt) => {
      t += dt
      const k = Math.min(1, t / dur)
      head.lerpVectors(start, target, k * k)
      trail.update(head, this.camera)
      for (let i = 0; i < this.n(4); i++) this.p({ x: head.x + rand(-0.2, 0.2), y: head.y + rand(-0.2, 0.2), z: head.z + rand(-0.2, 0.2), vx: rand(-1, 1), vy: rand(0, 1.5), vz: rand(-1, 1), life: rand(0.25, 0.6), size: [1.3, 0.3], color: [2.6, 1.0, 0.18], color2: EMBER, add: 0.8, sprite: SPRITE.fire, spin: rand(-4, 4) })
      this.p({ x: head.x, y: head.y, z: head.z, life: 0.08, size: [2.2, 2.2], color: HOT, sprite: SPRITE.glow, fadeIn: 0.01 })
      if (Math.random() < 40 * dt) this.p({ x: head.x, y: head.y, z: head.z, life: rand(0.6, 1.1), size: [0.7, 2], color: SMOKE, alpha: [0.5, 0], add: 0, sprite: SPRITE.smoke })
      if (k < 1) return true
      trail.release()
      this.explosion(x, 0.4, z, 1.7)
      onImpact?.()
      return false
    })
  }

  /** Smoke (and below a quarter health, fire) pouring from a damaged tower. */
  towerDamage(x: number, top: number, z: number, frac: number, dt: number) {
    if (frac <= 0 || frac > 0.6) return
    const heat = 1 - frac / 0.6
    if (Math.random() < (4 + heat * 10) * dt * this.q) this.p({ x: x + rand(-0.6, 0.6), y: top + rand(-0.6, 0.1), z: z + rand(-0.6, 0.6), vx: rand(-0.2, 0.5), vy: rand(1, 2.2), vz: rand(-0.2, 0.2), life: rand(1.4, 2.6), size: [0.7, 2.6 + heat], color: [0.2, 0.17, 0.15], color2: SMOKE, alpha: [0.5 + heat * 0.25, 0], add: 0, sprite: SPRITE.smoke, spin: rand(-0.5, 0.5), fadeIn: 0.2 })
    if (frac < 0.3 && Math.random() < 26 * dt * this.q) this.p({ x: x + rand(-0.7, 0.7), y: top + rand(-0.9, -0.1), z: z + rand(-0.7, 0.7), vy: rand(0.8, 2), life: rand(0.3, 0.6), size: [0.9, 0.2], color: FIRE, color2: EMBER, sprite: Math.random() < 0.5 ? SPRITE.fire : SPRITE.flame, spin: rand(-2, 2) })
  }

  /** A tower comes down: chained blasts, a dust cloud, and a burning ruin. */
  towerDestroyed(x: number, z: number, king: boolean) {
    const s = king ? 1.9 : 1.4
    this.explosion(x, 1.2, z, s)
    let t = 0, fired = 0
    this.emitters.push((dt) => {
      t += dt
      if (fired < 3 && t > 0.14 * (fired + 1)) { fired++; this.explosion(x + rand(-1, 1), rand(0.6, 2.4), z + rand(-1, 1), 0.8) }
      return fired < 3
    })
    for (let i = 0; i < this.n(26); i++) {
      const a = rand(Math.PI * 2)
      this.p({ x: x + Math.cos(a) * 0.8, y: rand(0.2, 1.5), z: z + Math.sin(a) * 0.8, vx: Math.cos(a) * rand(2, 6), vy: rand(0.3, 1.6), vz: Math.sin(a) * rand(2, 6), life: rand(1.4, 2.8), size: [1.4, 4.6], color: DUST, alpha: [0.7, 0], add: 0, drag: 2.2, sprite: SPRITE.smokeChunk, spin: rand(-0.6, 0.6), fadeIn: 0.1 })
    }
    this.chip(new THREE.Vector3(x, 1.5, z), 1.5, 40)
    this.wave(new THREE.Vector3(x, 1, z), 7, 0.05, 0.8)
    this.shake = Math.max(this.shake, 1)
    // the ruin smoulders for the rest of the match
    this.emitters.push((dt) => {
      if (Math.random() < 5 * dt * this.q) this.p({ x: x + rand(-0.8, 0.8), y: rand(0.4, 1.4), z: z + rand(-0.8, 0.8), vx: 0.3, vy: rand(0.8, 1.8), life: rand(2, 3.4), size: [0.9, 3.4], color: [0.18, 0.15, 0.13], color2: SMOKE, alpha: [0.55, 0], add: 0, sprite: SPRITE.smoke, spin: rand(-0.4, 0.4), fadeIn: 0.2 })
      if (Math.random() < 14 * dt * this.q) this.p({ x: x + rand(-0.8, 0.8), y: rand(0.3, 1), z: z + rand(-0.8, 0.8), vy: rand(0.7, 1.6), life: rand(0.35, 0.7), size: [1, 0.2], color: FIRE, color2: EMBER, sprite: SPRITE.flame, spin: rand(-1.5, 1.5) })
      return true
    })
  }

  /** A glowing mote drifting up from a body that is burning away. */
  ember(x: number, y: number, z: number, side: Side) {
    const c = TEAM_GLOW[side]
    this.p({ x: x + rand(-0.5, 0.5), y: y + rand(0.05, 0.6), z: z + rand(-0.7, 0.3), vx: rand(-0.3, 0.3), vy: rand(0.8, 2.4), vz: rand(-0.3, 0.3), life: rand(0.6, 1.3), size: [0.2, 0.02], color: c, sprite: SPRITE.star, drag: 0.5, spin: rand(-3, 3) })
  }

  /** Dust kicked up under a charging troop. */
  footDust(x: number, z: number) {
    this.p({ x: x + rand(-0.2, 0.2), y: 0.12, z: z + rand(-0.2, 0.2), vy: rand(0.2, 0.6), life: rand(0.4, 0.7), size: [0.3, 0.9], color: DUST, alpha: [0.35, 0], add: 0, sprite: SPRITE.smoke })
  }

  // --- per-frame ------------------------------------------------------------------
  update(dt: number, viewportHeightPx: number) {
    this.shake = Math.max(0, this.shake - dt * 2.4)
    for (let i = this.emitters.length - 1; i >= 0; i--) if (!this.emitters[i](dt)) this.emitters.splice(i, 1)
    const proj = (this.camera as THREE.PerspectiveCamera).projectionMatrix.elements[5]
    this.particles.update(dt, proj * viewportHeightPx * 0.5)

    for (let i = this.quads.length - 1; i >= 0; i--) {
      const f = this.quads[i]
      f.t += dt
      const t = f.t / f.dur
      if (t >= 1) { this.scene.remove(f.mesh); this.quadPool.push(f.mesh); this.quads.splice(i, 1); continue }
      const s = f.s0 + (f.s1 - f.s0) * f.grow(t)
      f.mesh.scale.set(s, s, 1)
      ;(f.mesh.material as THREE.MeshBasicMaterial).opacity = f.a * Math.min(1, t / f.fadeIn) * (1 - t) ** 1.5
      if (f.billboard) f.mesh.quaternion.copy(this.camera.quaternion)
      else if (f.spin) f.mesh.rotateZ(f.spin * dt)
    }
    for (let i = this.trails.length - 1; i >= 0; i--) {
      const tr = this.trails[i]
      tr.tick(this.camera)
      if (tr.dead) { this.scene.remove(tr.mesh); tr.mesh.geometry.dispose(); this.trails.splice(i, 1) }
    }
    for (const l of this.lights) {
      if (l.t >= l.dur) { l.light.intensity = 0; continue }
      l.t += dt
      l.light.intensity = l.peak * Math.max(0, 1 - l.t / l.dur) ** 2
    }
    // debris
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3()
    for (let i = this.chips.length - 1; i >= 0; i--) {
      const c = this.chips[i]
      c.age += dt
      if (c.age >= c.life) { this.chips.splice(i, 1); continue }
      c.v.y -= 19 * dt
      c.p.addScaledVector(c.v, dt)
      if (c.p.y < c.s) { c.p.y = c.s; c.v.y *= -0.35; c.v.x *= 0.6; c.v.z *= 0.6; c.w.multiplyScalar(0.5) }
      c.r.x += c.w.x * dt; c.r.y += c.w.y * dt; c.r.z += c.w.z * dt
    }
    this.chips.forEach((c, i) => {
      const k = c.s * Math.min(1, (c.life - c.age) * 3)
      this.debris.setMatrixAt(i, m.compose(c.p, q.setFromEuler(c.r), sc.set(k, k * 0.7, k)))
    })
    this.debris.count = this.chips.length
    this.debris.instanceMatrix.needsUpdate = true
    for (let i = this.waves.length - 1; i >= 0; i--) { this.waves[i].t += dt; if (this.waves[i].t >= this.waves[i].dur) this.waves.splice(i, 1) }
    // damage numbers
    const w = this.labelLayer.clientWidth, h = this.labelLayer.clientHeight, v = new THREE.Vector3()
    for (let i = this.labels.length - 1; i >= 0; i--) {
      const l = this.labels[i]
      l.t += dt
      const t = l.t / l.dur
      if (t >= 1) { l.el.remove(); this.labels.splice(i, 1); continue }
      v.copy(l.pos).setY(l.pos.y + t * 1.1).project(this.camera)
      const pop = t < 0.15 ? 0.6 + (t / 0.15) * 0.7 : 1.3 - Math.min(0.3, (t - 0.15) * 1.2)
      l.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -50%) scale(${pop})`
      l.el.style.opacity = String(v.z > 1 ? 0 : Math.min(1, (1 - t) * 2.2))
    }
  }

  dispose() { this.labelLayer.remove() }
}
