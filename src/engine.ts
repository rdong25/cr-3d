import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { buildKing, buildPrincess, buildTroop, animateRig, type Rig } from './characters'
import type { CameraMode, CardId, Side, TowerState, TroopState } from './types'
import { HeroInstance, heroReady, isHeroCard, makeArenaEnvironment, setHeroEnvironment } from './hero'
import { TOWER_FLOOR, arenaReady, buildField, makeBridge, makeTower, preloadArena, type Field } from './arena'

// Golden-hour stadium: gradient sky dome, warm key light + soft shadows,
// cool rim fill, horizon haze, floodlit stands, torch lights, dust motes,
// animated flowing river, turf with worn-earth patches.

export interface EngineCallbacks {
  onDeployAt?: (x: number, z: number) => void
}

export type ProjectileKind = 'arrow' | 'bullet' | 'bomb' | 'fire' | 'cannon'
/** A visible shot: game logic applies damage instantly; this is the ammo the player sees fly. */
export interface Shot {
  kind: ProjectileKind
  from: { x: number; y: number; z: number }
  to: { x: number; y: number; z: number }
}

interface Projectile {
  group: THREE.Group
  from: THREE.Vector3
  to: THREE.Vector3
  kind: ProjectileKind
  t: number
  dur: number
  arc: number
}

interface HpBar {
  group: THREE.Group
  fill: THREE.Mesh
  width: number
}

export class Engine {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera: THREE.PerspectiveCamera
  rigs = new Map<number, Rig>()
  /** Troops rendered with a skinned .glb character instead of a procedural rig. */
  heroes = new Map<number, { hero: HeroInstance; side: Side; x: number; z: number; cd: number; yaw: number; flying: boolean }>()
  private dying: { hero: HeroInstance; t: number; dur: number }[] = []
  private deployHint = {
    troop: new THREE.Mesh(new THREE.PlaneGeometry(22, 13), new THREE.MeshBasicMaterial({ color: 0x4a90ff, transparent: true, opacity: 0.12, depthWrite: false })),
    spell: new THREE.Mesh(new THREE.PlaneGeometry(24, 28), new THREE.MeshBasicMaterial({ color: 0xff7a2a, transparent: true, opacity: 0.08, depthWrite: false })),
  }
  towerMeshes = new Map<string, THREE.Group>()
  /** Billboard HP bars, one per troop (keyed by troop id) and per tower (keyed by tower id). */
  private hpBars = new Map<number | string, HpBar>()
  private projectiles: Projectile[] = []
  mode: CameraMode = 'broadcast'
  orbitAngle = 0.6
  fpPos = new THREE.Vector3(0, 1.7, 11)
  fpYaw = 0
  fpPitch = 0
  keys = new Set<string>()
  shake = 0
  riverMat: THREE.MeshStandardMaterial
  private env: THREE.Texture
  private field: Field | null = null
  crowd: THREE.InstancedMesh
  crowdData: { x: number; z: number; y: number; phase: number; c: THREE.Color }[] = []
  flash = 0
  time = 0
  private container: HTMLElement
  private cb: EngineCallbacks
  private dragging = false
  private lastX = 0
  private lastY = 0
  private rideId: number | null = null

  constructor(container: HTMLElement, cb: EngineCallbacks = {}) {
    this.container = container
    this.cb = cb
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.12
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    container.appendChild(this.renderer.domElement)
    this.env = makeArenaEnvironment(this.renderer)
    setHeroEnvironment(this.env)
    // Soft image-based fill for every PBR material in the arena.
    this.scene.environment = this.env
    this.scene.environmentIntensity = 0.35
    for (const [k, m] of Object.entries(this.deployHint)) {
      m.rotation.x = -Math.PI / 2
      m.position.set(0, 0.04, k === 'troop' ? 7.5 : 0)
      m.visible = false
      m.renderOrder = 1
      this.scene.add(m)
    }
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200)
    this.camera.position.set(0, 14, 16)

    // Sky dome — gradient via vertex colours on a big sphere.
    const skyGeo = new THREE.SphereGeometry(90, 24, 16)
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { top: { value: new THREE.Color(0x2a4a8a) }, mid: { value: new THREE.Color(0xff9a5c) }, bot: { value: new THREE.Color(0xffd9a0) } },
      vertexShader: `varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 bot;
        void main(){ float h=normalize(vP).y; vec3 c = h>0.15 ? mix(mid,top,smoothstep(0.15,0.7,h)) : mix(bot,mid,smoothstep(-0.1,0.15,h)); gl_FragColor=vec4(c,1.0); }`
    })
    this.scene.add(new THREE.Mesh(skyGeo, skyMat))
    // Sun glow sprite
    const sun = new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffe9a8 }))
    sun.position.set(-28, 22, -40); this.scene.add(sun)
    const halo = new THREE.Mesh(new THREE.SphereGeometry(4.2, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffc46a, transparent: true, opacity: 0.28 }))
    halo.position.copy(sun.position); this.scene.add(halo)

    this.scene.fog = new THREE.Fog(0xf2b98a, 35, 95)

    // Lighting: warm low key + cool rim + ambient.
    const sunLight = new THREE.DirectionalLight(0xffc27a, 2.4)
    sunLight.position.set(-18, 22, 10)
    sunLight.castShadow = true
    sunLight.shadow.mapSize.set(2048, 2048)
    sunLight.shadow.bias = -0.0005
    sunLight.shadow.normalBias = 0.03
    sunLight.shadow.camera.left = -22; sunLight.shadow.camera.right = 22
    sunLight.shadow.camera.top = 22; sunLight.shadow.camera.bottom = -22
    this.scene.add(sunLight)
    const rim = new THREE.DirectionalLight(0x7fb2ff, 0.9); rim.position.set(14, 10, -18); this.scene.add(rim)
    this.scene.add(new THREE.AmbientLight(0xffe0b8, 0.55))
    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x3d5a2a, 0.5))

    this.buildArena()
    this.field = buildField(this.scene, this.env, [
      { x: 0, z: 12.5, r: 2.3 }, { x: 0, z: -12.5, r: 2.3 },
      { x: -4.2, z: 8.5, r: 1.8 }, { x: 4.2, z: 8.5, r: 1.8 }, { x: -4.2, z: -8.5, r: 1.8 }, { x: 4.2, z: -8.5, r: 1.8 },
    ])
    this.riverMat = this.field.water

    // Crowd — instanced, animated.
    // Each spectator: a rounded body with a head on top.
    const bodyGeo = new THREE.CapsuleGeometry(0.16, 0.24, 3, 8)
    const headGeo = new THREE.SphereGeometry(0.12, 10, 8); headGeo.translate(0, 0.33, 0)
    const crowdGeo = mergeGeometries([bodyGeo, headGeo])!
    const crowdMat = new THREE.MeshStandardMaterial({ roughness: 0.9 })
    this.crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, 420)
    const dummy = new THREE.Object3D()
    const palette = [0xff5a5a, 0x5a8aff, 0xffd23d, 0x7dff8a, 0xff9ad5, 0xffffff, 0x9a7bff]
    for (let i = 0; i < 420; i++) {
      const side = i % 2 === 0 ? -1 : 1
      const x = -13 + Math.random() * 26
      const row = Math.floor(Math.random() * 3)
      const z = side * (16.1 + row * 1.3)
      const c = new THREE.Color(palette[i % palette.length])
      this.crowdData.push({ x, z, y: 1.05 + row * 0.85, phase: Math.random() * Math.PI * 2, c })
      dummy.position.set(x, 1.05 + row * 0.85, z); dummy.updateMatrix(); this.crowd.setMatrixAt(i, dummy.matrix)
      this.crowd.setColorAt(i, c)
    }
    this.crowd.instanceMatrix.needsUpdate = true
    this.scene.add(this.crowd)

    // Dust motes
    const dustGeo = new THREE.BufferGeometry()
    const N = 160
    const pos = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) { pos[i * 3] = (Math.random() - 0.5) * 36; pos[i * 3 + 1] = 0.5 + Math.random() * 8; pos[i * 3 + 2] = (Math.random() - 0.5) * 30 }
    dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xffe9b0, size: 0.09, transparent: true, opacity: 0.7 }))
    dust.userData.dust = true; this.scene.add(dust)

    this.bindInput()
    this.resize()
    // Phones in portrait start a little zoomed out so both kings' towers fit.
    if (this.camera.aspect < 1) { this.zoom = 1.15; this.orbitAngle = 0.15 }
    window.addEventListener('resize', () => this.resize())
    window.addEventListener('keydown', (e) => this.keys.add(e.key.toLowerCase()))
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()))
  }

  private bridges: THREE.Group[] = []

  private buildArena() {
    // Ground, river and curbs come from buildField() (src/arena.ts).
    // Bridges: sculpted model once loaded, simple planks until then.
    for (const x of [-4.2, 4.2]) {
      const g = new THREE.Group()
      g.position.set(x, 0, 0)
      const deck = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.28, 3.4), new THREE.MeshStandardMaterial({ color: 0x9a7b4f, roughness: 0.85 }))
      deck.position.y = 0.14; deck.castShadow = true; deck.receiveShadow = true; g.add(deck)
      this.scene.add(g)
      this.bridges.push(g)
    }
    // Stands behind each end line, three tiers, team-colored seat rows.
    const standM = new THREE.MeshStandardMaterial({ color: 0x313a55, roughness: 0.9 })
    for (const s of [-1, 1]) {
      const seatM = new THREE.MeshStandardMaterial({ color: s > 0 ? 0x2f5fd0 : 0xc83a3a, roughness: 0.8 })
      for (let row = 0; row < 3; row++) {
        const z = s * (16.1 + row * 1.3), h = 0.8 + row * 0.85
        const stand = new THREE.Mesh(new THREE.BoxGeometry(30, h, 1.3), standM)
        stand.position.set(0, h / 2, z); stand.receiveShadow = true; this.scene.add(stand)
        const seats = new THREE.Mesh(new THREE.BoxGeometry(30, 0.12, 0.5), seatM)
        seats.position.set(0, h + 0.06, z - s * 0.3); this.scene.add(seats)
      }
      // Floodlight poles + lamps
      for (const x of [-12, 0, 12]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 7, 8), new THREE.MeshStandardMaterial({ color: 0x333a44, roughness: 0.6, metalness: 0.6 }))
        pole.position.set(x, 3.5, s * 19.4); this.scene.add(pole)
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshBasicMaterial({ color: 0xfff2c0 }))
        lamp.position.set(x, 7.1, s * 19.4); this.scene.add(lamp)
        const light = new THREE.PointLight(0xffe9a0, 18, 24); light.position.set(x, 6.8, s * 17); this.scene.add(light)
      }
    }
    preloadArena().then(() => this.upgradeProps()).catch(() => {})
  }

  private towerStates: TowerState[] = []

  buildTowers(towers: TowerState[]) {
    this.towerStates = towers
    for (const t of towers) {
      const g = new THREE.Group()
      g.position.set(t.x, 0, t.z)
      this.scene.add(g)
      this.towerMeshes.set(t.id, g)
      this.populateTower(g, t)
      this.makeHpBar(t.id, t.side, 1.6, 0.16)
    }
  }

  /** Fill a tower's group: the sculpted model when loaded, else the simple fallback. */
  private populateTower(g: THREE.Group, t: TowerState) {
    for (const c of [...g.children]) g.remove(c)
    const isKing = t.kind === 'king'
    if (arenaReady()) {
      const model = makeTower(t.kind, t.side, this.env)
      model.rotation.y = t.side === 'blue' ? Math.PI : 0 // gate and banners face the river
      g.add(model)
      const fig = isKing ? buildKing(t.side) : buildPrincess(t.side)
      fig.position.y = isKing ? TOWER_FLOOR.king : TOWER_FLOOR.princess
      fig.scale.setScalar(isKing ? 0.85 : 0.8)
      fig.rotation.y = t.side === 'blue' ? Math.PI : 0
      g.add(fig)
      return
    }
    const h = isKing ? 3.4 : 2.6
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.45, h, 16), new THREE.MeshStandardMaterial({ color: 0xb8b0a2, roughness: 0.9 }))
    body.position.y = h / 2; body.castShadow = true; body.receiveShadow = true; g.add(body)
    const fig = isKing ? buildKing(t.side) : buildPrincess(t.side)
    fig.position.y = h; fig.scale.setScalar(isKing ? 0.85 : 0.8); g.add(fig)
  }

  /** Swap in the sculpted towers and bridges once their models have loaded. */
  private upgradeProps() {
    for (const t of this.towerStates) {
      const g = this.towerMeshes.get(t.id)
      if (g) this.populateTower(g, t)
    }
    for (const b of this.bridges) {
      for (const c of [...b.children]) b.remove(c)
      b.add(makeBridge(this.env))
    }
  }

  // --- HP bars ---------------------------------------------------------------
  private makeHpBar(key: number | string, side: Side, width: number, height: number) {
    const group = new THREE.Group()
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.75, depthTest: false })
    )
    bg.renderOrder = 998
    const fill = new THREE.Mesh(
      new THREE.PlaneGeometry(width - 0.04, height - 0.04),
      // transparent like the background, so renderOrder (999 > 998) puts the fill on top;
      // an opaque fill is drawn before all transparent objects and gets covered.
      new THREE.MeshBasicMaterial({ color: side === 'blue' ? 0x3d8bff : 0xff4a4a, depthTest: false, transparent: true, opacity: 1 })
    )
    fill.renderOrder = 999
    group.add(bg, fill)
    this.scene.add(group)
    this.hpBars.set(key, { group, fill, width: width - 0.04 })
  }

  private updateHpBar(key: number | string, frac: number, x: number, y: number, z: number) {
    const b = this.hpBars.get(key)
    if (!b) return
    const f = THREE.MathUtils.clamp(frac, 0, 1)
    b.group.visible = f > 0
    if (!b.group.visible) return
    b.group.position.set(x, y, z)
    b.group.quaternion.copy(this.camera.quaternion) // billboard: always faces the camera
    b.fill.scale.x = Math.max(f, 0.001)
    b.fill.position.x = -(1 - f) * b.width / 2 // fill drains from the right
  }

  private removeHpBar(key: number | string) {
    const b = this.hpBars.get(key)
    if (!b) return
    this.scene.remove(b.group)
    this.hpBars.delete(key)
  }

  /** Height of the HP bar above the ground for a troop. */
  private troopBarHeight(t: TroopState): number {
    const base = t.flying ? 1.1 : 0
    return base + (t.cardId === 'giant' ? 2.5 : t.cardId === 'dragon' ? 2.4 : t.cardId === 'minions' ? 2.0 : 2.0)
  }

  // --- Projectiles -----------------------------------------------------------
  /** Fly a visible shot from `from` to `to`. Damage was already applied by the game; this is the ammo. */
  spawnShot(shot: Shot) {
    const from = new THREE.Vector3(shot.from.x, shot.from.y, shot.from.z)
    const to = new THREE.Vector3(shot.to.x, shot.to.y, shot.to.z)
    const dist = from.distanceTo(to)
    if (dist < 0.3) return
    const group = new THREE.Group()
    const speed = shot.kind === 'arrow' ? 20 : shot.kind === 'bullet' ? 30 : shot.kind === 'bomb' ? 9 : shot.kind === 'fire' ? 12 : 14
    const arc = shot.kind === 'bomb' ? 2.2 : shot.kind === 'fire' ? 1.2 : 0
    if (shot.kind === 'arrow') {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6), new THREE.MeshStandardMaterial({ color: 0xd8c49a, roughness: 0.7 }))
      shaft.rotation.x = Math.PI / 2
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 6), new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.3, metalness: 0.8 }))
      tip.rotation.x = Math.PI / 2; tip.position.z = 0.42
      group.add(shaft, tip)
    } else if (shot.kind === 'bullet') {
      const tracer = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe066 }))
      tracer.scale.set(0.6, 0.6, 3.2)
      group.add(tracer)
    } else if (shot.kind === 'bomb') {
      const bomb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 }))
      const fuse = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffa53d }))
      fuse.position.set(0, 0.22, 0)
      group.add(bomb, fuse)
    } else if (shot.kind === 'fire') {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.26, 12, 10), new THREE.MeshBasicMaterial({ color: 0xff7a2a }))
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 10), new THREE.MeshBasicMaterial({ color: 0xffb03d, transparent: true, opacity: 0.35 }))
      group.add(ball, halo)
    } else {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 8), new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.4, metalness: 0.6 }))
      group.add(ball)
    }
    group.position.copy(from)
    group.lookAt(to)
    this.scene.add(group)
    this.projectiles.push({ group, from, to, kind: shot.kind, t: 0, dur: Math.max(0.15, dist / speed), arc })
  }

  private updateProjectiles(dt: number) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]
      p.t += dt / p.dur
      if (p.t >= 1) {
        if (p.kind === 'bomb' || p.kind === 'fire') this.shockwave(p.to.x, p.to.z, p.kind === 'fire' ? 0xff5722 : 0xffa53d)
        this.scene.remove(p.group)
        this.projectiles.splice(i, 1)
        continue
      }
      const pos = new THREE.Vector3().lerpVectors(p.from, p.to, p.t)
      if (p.arc > 0) pos.y += Math.sin(p.t * Math.PI) * p.arc
      p.group.position.copy(pos)
      if (p.kind === 'arrow' || p.kind === 'bullet' || p.kind === 'cannon') p.group.lookAt(p.to)
    }
  }

  addTroop(t: TroopState) {
    this.makeHpBar(t.id, t.side, 0.9, 0.12)
    if (isHeroCard(t.cardId) && heroReady(t.cardId)) {
      const hero = new HeroInstance(t.side, t.cardId)
      const yaw = t.side === 'blue' ? Math.PI : 0
      hero.group.position.set(t.x, t.flying ? 1.1 : 0, t.z)
      hero.group.rotation.y = yaw
      this.scene.add(hero.group)
      this.heroes.set(t.id, { hero, side: t.side, x: t.x, z: t.z, cd: t.attackCd, yaw, flying: t.flying })
      return
    }
    const rig = buildTroop(t.cardId, t.side)
    rig.group.position.set(t.x, t.flying ? 1.1 : 0, t.z)
    rig.group.rotation.y = t.side === 'blue' ? Math.PI : 0
    this.scene.add(rig.group)
    this.rigs.set(t.id, rig)
  }

  removeTroop(id: number) {
    this.removeHpBar(id)
    const h = this.heroes.get(id)
    if (h) {
      // Keep the body around for the death clip, then sink it into the turf.
      this.dying.push({ hero: h.hero, t: 0, dur: h.hero.die() })
      this.heroes.delete(id)
    }
    const r = this.rigs.get(id)
    if (r) { this.scene.remove(r.group); this.rigs.delete(id) }
    if (this.rideId === id) this.rideId = null
  }

  setTowerFallen(id: string) {
    const g = this.towerMeshes.get(id)
    if (!g) return
    g.rotation.z = 0.5; g.position.y = -0.7; g.scale.y = 0.55
    this.shake = 1; this.flash = 1
  }

  shockwave(x: number, z: number, color = 0xffa53d) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.09, 8, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }))
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.15, z); ring.userData.shock = 0
    this.scene.add(ring)
  }

  setCameraMode(m: CameraMode) { this.mode = m; if (m === 'first') { this.fpPos.set(0, 1.7, 11); this.fpYaw = 0; this.fpPitch = 0 } }
  setRide(id: number | null) { this.rideId = id; if (id != null) this.mode = 'ride' }

  /** Broadcast / orbit camera distance multiplier: < 1 zooms in, > 1 shows more of the map. */
  zoom = 1
  zoomBy(factor: number) { this.zoom = THREE.MathUtils.clamp(this.zoom * factor, 0.5, 1.7) }

  private pointers = new Map<number, { x: number; y: number }>()
  private pinchDist = 0
  private tap: { id: number; x: number; y: number; t: number; moved: boolean } | null = null

  private pointerSpread(): number {
    const [a, b] = [...this.pointers.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  private bindInput() {
    // One finger: drag to turn the camera, quick tap to deploy at that spot.
    // Two fingers: pinch to zoom. Mouse wheel also zooms.
    const el = this.renderer.domElement
    el.style.touchAction = 'none'
    el.addEventListener('pointerdown', (e) => {
      try { el.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (this.pointers.size === 1) {
        this.dragging = true; this.lastX = e.clientX; this.lastY = e.clientY
        this.tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), moved: false }
      } else {
        this.dragging = false; this.tap = null
        this.pinchDist = this.pointerSpread()
      }
    })
    const end = (e: PointerEvent) => {
      const tap = this.tap
      this.pointers.delete(e.pointerId)
      if (e.type === 'pointerup' && tap && tap.id === e.pointerId && !tap.moved && performance.now() - tap.t < 500) this.tapAt(e.clientX, e.clientY)
      this.tap = null
      if (this.pointers.size === 1) {
        const [p] = [...this.pointers.values()]
        this.dragging = true; this.lastX = p.x; this.lastY = p.y
      } else this.dragging = false
    }
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
    el.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId)
      if (!p) return
      p.x = e.clientX; p.y = e.clientY
      if (this.pointers.size >= 2) {
        const d = this.pointerSpread()
        if (this.pinchDist > 0 && d > 0) this.zoomBy(this.pinchDist / d)
        this.pinchDist = d
        return
      }
      if (!this.dragging) return
      if (this.tap && Math.hypot(e.clientX - this.tap.x, e.clientY - this.tap.y) > 10) this.tap.moved = true
      const dx = e.clientX - this.lastX; const dy = e.clientY - this.lastY
      this.lastX = e.clientX; this.lastY = e.clientY
      if (this.mode === 'broadcast') this.orbitAngle += dx * 0.005
      else if (this.mode === 'first') { this.fpYaw -= dx * 0.004; this.fpPitch = Math.max(-0.6, Math.min(0.6, this.fpPitch - dy * 0.003)) }
    })
    el.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomBy(Math.exp(e.deltaY * 0.0015)) }, { passive: false })
  }

  /** Raycast a screen tap onto the ground and ask the game to deploy there. */
  private tapAt(clientX: number, clientY: number) {
    if (this.mode === 'ride') return
    const rect = this.renderer.domElement.getBoundingClientRect()
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(nx, ny), this.camera)
    const t = -this.camera.position.y / ray.ray.direction.y
    if (!(t > 0)) return
    const p = this.camera.position.clone().addScaledVector(ray.ray.direction, t)
    this.cb.onDeployAt?.(p.x, p.z)
  }

  /** Highlight where the selected card can go: your half for troops, everywhere for spells. */
  setDeployHint(kind: 'troop' | 'spell' | null) {
    this.deployHint.troop.visible = kind === 'troop'
    this.deployHint.spell.visible = kind === 'spell'
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth
    const h = this.container.clientHeight || window.innerHeight
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    // Portrait phones: widen the vertical FOV so the arena's width (both lanes)
    // still fits, instead of cropping to the middle.
    const aspect = w / h
    this.camera.fov = aspect >= 1 ? 55 : Math.min(80, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(22)) / aspect)))
    // Portrait: the hand, elixir bar and deploy buttons cover the bottom of the
    // screen, so shift the rendered view up to keep your side of the arena visible.
    if (aspect < 1) this.camera.setViewOffset(w, h, 0, Math.round(h * 0.1), w, h)
    else this.camera.clearViewOffset()
    this.camera.updateProjectionMatrix()
  }

  render(dt: number, troops: TroopState[], towers: TowerState[]) {
    this.time += dt
    const t = this.time
    // River flow
    this.field?.update(t)
    for (const child of this.scene.children) {
      if (child.userData.shock !== undefined) {
        child.userData.shock += dt * 2.4
        const s = 1 + child.userData.shock * 3.2
        child.scale.setScalar(s)
        ;((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.95 - child.userData.shock)
        if (child.userData.shock > 1) this.scene.remove(child)
      }
      if (child.userData.dust) { child.rotation.y += dt * 0.02 }
    }
    // Crowd bounce
    const dummy = new THREE.Object3D()
    for (let i = 0; i < this.crowdData.length; i++) {
      const c = this.crowdData[i]
      dummy.position.set(c.x, c.y + Math.abs(Math.sin(t * 3 + c.phase)) * 0.22, c.z)
      dummy.updateMatrix(); this.crowd.setMatrixAt(i, dummy.matrix)
    }
    this.crowd.instanceMatrix.needsUpdate = true

    // Deploy hint pulses gently.
    ;(this.deployHint.troop.material as THREE.MeshBasicMaterial).opacity = 0.2 + Math.sin(t * 4) * 0.06
    ;(this.deployHint.spell.material as THREE.MeshBasicMaterial).opacity = 0.12 + Math.sin(t * 4) * 0.04

    // Troop meshes
    for (const tr of troops) {
      const rig = this.rigs.get(tr.id)
      if (!rig) continue
      rig.group.position.set(tr.x, tr.flying ? 1.1 + Math.sin(t * 3 + tr.id) * 0.12 : 0, tr.z)
      const moving = Math.abs(tr.x) > 0.01 || true
      // animateRig already advances the stride from time; adding walkPhase (which the
      // game also advances ~9/s) made legs cycle ~14x a second. Use a fixed per-troop offset.
      animateRig(rig, t + (tr.id % 7) * 0.45, moving, tr.attackCd > 0.4)
      // Face movement direction
      rig.group.rotation.y = tr.side === 'blue' ? Math.PI : 0
      this.updateHpBar(tr.id, tr.hp / tr.maxHp, tr.x, this.troopBarHeight(tr), tr.z)
    }
    for (const tr of troops) {
      const h = this.heroes.get(tr.id)
      if (!h) continue
      const dx = tr.x - h.x, dz = tr.z - h.z
      const speed = dt > 0 ? Math.hypot(dx, dz) / dt : 0
      h.x = tr.x; h.z = tr.z
      // Turn smoothly toward the direction of travel.
      if (speed > 0.15) {
        const want = Math.atan2(dx, dz)
        const diff = Math.atan2(Math.sin(want - h.yaw), Math.cos(want - h.yaw))
        h.yaw += diff * Math.min(1, dt * 8)
      }
      h.hero.group.position.set(tr.x, h.flying ? 1.1 + Math.sin(t * 3 + tr.id) * 0.12 : 0, tr.z)
      h.hero.group.rotation.y = h.yaw
      h.hero.setSpeed(speed)
      // game.ts resets attackCd to 1 on the frame a hit lands.
      if (tr.attackCd > h.cd + 0.5) h.hero.attack()
      h.cd = tr.attackCd
      h.hero.update(dt, t)
      this.updateHpBar(tr.id, tr.hp / tr.maxHp, tr.x, this.troopBarHeight(tr), tr.z)
    }
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const d = this.dying[i]
      d.t += dt
      d.hero.update(dt, t)
      const sinkStart = d.dur + 1.2
      if (d.t > sinkStart) d.hero.group.position.y = -(d.t - sinkStart) * 0.6
      if (d.t > sinkStart + 1.5) { d.hero.dispose(); this.dying.splice(i, 1) }
    }
    // Tower HP bars (above the tower top; hidden once the tower falls).
    for (const tw of towers) {
      this.updateHpBar(tw.id, tw.hp / tw.maxHp, tw.x, tw.kind === 'king' ? 4.3 : 3.5, tw.z)
    }
    // Projectiles in flight.
    this.updateProjectiles(dt)

    // Camera
    if (this.mode === 'broadcast') {
      const r = 19 * this.zoom
      this.camera.position.set(Math.sin(this.orbitAngle) * r * 0.55, 13.5 * this.zoom, Math.cos(this.orbitAngle) * r * 0.55 + 2)
      this.camera.lookAt(0, 0, 0)
    } else if (this.mode === 'orbit') {
      const a = t * 0.12
      this.camera.position.set(Math.sin(a) * 15 * this.zoom, 6.5 * this.zoom, Math.cos(a) * 15 * this.zoom)
      this.camera.lookAt(0, 0.5, 0)
    } else if (this.mode === 'first') {
      const speed = 5.2 * dt
      const fwd = new THREE.Vector3(-Math.sin(this.fpYaw), 0, -Math.cos(this.fpYaw))
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x)
      if (this.keys.has('w') || this.keys.has('arrowup')) this.fpPos.addScaledVector(fwd, speed)
      if (this.keys.has('s') || this.keys.has('arrowdown')) this.fpPos.addScaledVector(fwd, -speed)
      if (this.keys.has('a') || this.keys.has('arrowleft')) this.fpPos.addScaledVector(right, -speed)
      if (this.keys.has('d') || this.keys.has('arrowright')) this.fpPos.addScaledVector(right, speed)
      this.fpPos.x = THREE.MathUtils.clamp(this.fpPos.x, -11, 11)
      this.fpPos.z = THREE.MathUtils.clamp(this.fpPos.z, -13, 13)
      this.camera.position.copy(this.fpPos)
      this.camera.rotation.set(this.fpPitch, this.fpYaw, 0, 'YXZ')
    } else if (this.mode === 'ride') {
      const rig = this.rideId != null ? this.rigs.get(this.rideId) : undefined
      const hero = this.rideId != null ? this.heroes.get(this.rideId) : undefined
      const obj = rig?.group ?? hero?.hero.group
      if (obj) {
        // Same framing as before; heroes turn while walking, so use their spawn facing.
        const red = rig ? rig.group.rotation.y === 0 : hero!.side === 'red'
        const p = obj.position
        this.camera.position.set(p.x, p.y + 2.1, p.z + (red ? 2.2 : -2.2))
        this.camera.lookAt(p.x, p.y + 1, p.z + (red ? -6 : 6))
      } else {
        this.camera.position.set(0, 10, 14); this.camera.lookAt(0, 0, 0)
      }
    }
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 1.6)
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.5
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.4
    }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 1.2)
    this.renderer.render(this.scene, this.camera)
  }

  moveFirst(dx: number, dy: number) {
    // Virtual joystick: dx/dy in [-1,1]
    const fwd = new THREE.Vector3(-Math.sin(this.fpYaw), 0, -Math.cos(this.fpYaw))
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x)
    this.fpPos.addScaledVector(fwd, -dy * 0.16)
    this.fpPos.addScaledVector(right, dx * 0.16)
    this.fpPos.x = THREE.MathUtils.clamp(this.fpPos.x, -11, 11)
    this.fpPos.z = THREE.MathUtils.clamp(this.fpPos.z, -13, 13)
  }

  dispose() { this.renderer.dispose() }
}

export function towerPositions(): TowerState[] {
  const mk = (id: string, side: Side, kind: 'king' | 'princess', lane: -1 | 0 | 1, x: number, z: number, hp: number): TowerState =>
    ({ id, side, kind, lane, x, z, hp, maxHp: hp, alive: true })
  return [
    mk('blue-king', 'blue', 'king', 0, 0, 12.5, 2400),
    mk('blue-p-left', 'blue', 'princess', -1, -4.2, 8.5, 1400),
    mk('blue-p-right', 'blue', 'princess', 1, 4.2, 8.5, 1400),
    mk('red-king', 'red', 'king', 0, 0, -12.5, 2400),
    mk('red-p-left', 'red', 'princess', -1, -4.2, -8.5, 1400),
    mk('red-p-right', 'red', 'princess', 1, 4.2, -8.5, 1400)
  ]
}
