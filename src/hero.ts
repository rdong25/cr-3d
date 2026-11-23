import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { Side } from './types'

// Runtime for skinned, animated .glb characters — the part of the pipeline
// that stays the same whether the model came from tools/hero (generated) or
// from an artist's Blender/Maya export.
//
// Asset contract (what an artist's file must provide):
//   - Y up, facing +Z, feet at y = 0, ~1.6–1.8 units tall
//   - one skeleton; clips named Idle, Walk, Attack, Death
//   - a material named "Warden_Team" for team-colored parts (white-ish base)
//   - optional emissive "Warden_Glow" material

const MODEL_URL = `${import.meta.env.BASE_URL}models/ember-warden.glb`
export const TEAM_COLORS: Record<Side, number> = { blue: 0x2f6df6, red: 0xe23b3b }
/** Ground distance covered by one Walk cycle at timeScale 1 (keeps feet from sliding). */
const WALK_SPEED_AT_1X = 1.15

interface Asset { scene: THREE.Group; clips: Map<string, THREE.AnimationClip> }
let asset: Asset | null = null
let loading: Promise<Asset> | null = null

export function preloadHero(): Promise<Asset> {
  if (!loading) {
    loading = new GLTFLoader().loadAsync(MODEL_URL).then((gltf) => {
      asset = { scene: gltf.scene, clips: new Map(gltf.animations.map((c) => [c.name, c])) }
      return asset
    })
    loading.catch((err) => { console.warn('Hero model failed to load; using procedural troops.', err); loading = null })
  }
  return loading
}
export const heroReady = () => asset !== null

// --- materials: one set per team, shared by every instance --------------------------
const materialSets = new Map<Side, Map<string, THREE.MeshStandardMaterial>>()
let envMap: THREE.Texture | null = null

function materialsFor(side: Side): Map<string, THREE.MeshStandardMaterial> {
  let set = materialSets.get(side)
  if (set) return set
  set = new Map()
  asset!.scene.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
    if (!m || set!.has(m.name)) return
    const c = m.clone()
    if (c.name === 'Warden_Team') c.color.setHex(TEAM_COLORS[side])
    c.envMap = envMap
    c.envMapIntensity = c.name === 'Warden_Metal' ? 1.1 : 0.6
    set!.set(c.name, c)
  })
  materialSets.set(side, set)
  return set
}

/** Image-based lighting for the metal. Call once per renderer, before spawning heroes. */
export function setHeroEnvironment(tex: THREE.Texture) {
  if (envMap && envMap !== tex) envMap.dispose() // previous match's renderer
  envMap = tex
  for (const set of materialSets.values()) for (const m of set.values()) { m.envMap = tex; m.needsUpdate = true }
}

/**
 * A small sky/sun/ground scene matching the arena's golden-hour palette,
 * prefiltered into an environment map so metal reflects the stadium's light.
 */
export function makeArenaEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const scene = new THREE.Scene()
  const sky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { top: { value: new THREE.Color(0x3a64b0) }, mid: { value: new THREE.Color(0xffb27a) }, low: { value: new THREE.Color(0x56733a) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 low;
      void main(){ float h = normalize(vP).y;
        vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.0, 0.6, h)) : mix(mid, low, smoothstep(0.0, 0.25, -h));
        gl_FragColor = vec4(c, 1.0); }`,
  }))
  scene.add(sky)
  const sun = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff0c8).multiplyScalar(6) }))
  sun.position.set(-5.5, 6.5, 3); scene.add(sun)
  const rimPanel = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x9cc4ff).multiplyScalar(2.2), side: THREE.DoubleSide }))
  rimPanel.position.set(5, 4, -6); rimPanel.lookAt(0, 0, 0); scene.add(rimPanel)
  const pmrem = new THREE.PMREMGenerator(renderer)
  const tex = pmrem.fromScene(scene, 0.02).texture
  pmrem.dispose()
  return tex
}

// --- soft glow halos (sprites) for the eyes and chest gem --------------------
let glowTex: THREE.Texture | null = null
function glowSprite(w: number, h: number): THREE.Sprite {
  if (!glowTex) {
    const c = document.createElement('canvas'); c.width = c.height = 64
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, 'rgba(255,200,120,1)'); grad.addColorStop(0.35, 'rgba(255,120,40,0.45)'); grad.addColorStop(1, 'rgba(255,80,20,0)')
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64)
    glowTex = new THREE.CanvasTexture(c); glowTex.colorSpace = THREE.SRGBColorSpace
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }))
  s.scale.set(w, h, 1)
  return s
}

type ClipName = 'Idle' | 'Walk' | 'Attack' | 'Death'

/** One troop's worth of model + animation state. */
export class HeroInstance {
  /** Position/rotate this in the world. */
  readonly group = new THREE.Group()
  readonly mixer: THREE.AnimationMixer
  readonly head: THREE.Object3D
  private actions = new Map<ClipName, THREE.AnimationAction>()
  private current: THREE.AnimationAction
  private moving = false
  private attacking = false
  private glowMat: THREE.MeshStandardMaterial | undefined
  dead = false

  constructor(side: Side) {
    if (!asset) throw new Error('preloadHero() must resolve before creating heroes')
    // SkeletonUtils.clone re-binds the cloned meshes to the cloned bones —
    // a plain .clone() would leave every copy driven by the original skeleton.
    const model = SkeletonUtils.clone(asset.scene)
    const mats = materialsFor(side)
    model.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh
      if (!mesh.isMesh) return
      mesh.material = mats.get((mesh.material as THREE.Material).name)!
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.frustumCulled = false // bounds are bind-pose only; animations move outside them
    })
    this.glowMat = mats.get('Warden_Glow')
    this.group.add(model)
    this.head = model.getObjectByName('head')!
    const visor = glowSprite(0.34, 0.13); visor.position.set(0, 0.19, 0.27); this.head.add(visor)
    const gem = glowSprite(0.2, 0.2); gem.position.set(0, 0.05, 0.25); model.getObjectByName('chest')!.add(gem)

    this.mixer = new THREE.AnimationMixer(model)
    for (const name of ['Idle', 'Walk', 'Attack', 'Death'] as ClipName[]) {
      const clip = asset.clips.get(name)
      if (!clip) continue
      const a = this.mixer.clipAction(clip)
      if (name === 'Attack' || name === 'Death') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true }
      this.actions.set(name, a)
    }
    this.current = this.actions.get('Idle')!
    this.current.time = Math.random() * 2 // desync crowds of the same troop
    this.current.play()
    this.mixer.addEventListener('finished', (e) => {
      if (e.action === this.actions.get('Attack')) { this.attacking = false; this.fadeTo(this.moving ? 'Walk' : 'Idle', 0.18) }
    })
  }

  private fadeTo(name: ClipName, duration: number) {
    const next = this.actions.get(name)
    if (!next || next === this.current) return
    next.reset().setEffectiveWeight(1).play()
    this.current.crossFadeTo(next, duration, false)
    this.current = next
  }

  /** Ground speed in units/second; switches Idle <-> Walk and syncs stride. */
  setSpeed(speed: number) {
    if (this.dead) return
    const walk = this.actions.get('Walk')!
    walk.timeScale = THREE.MathUtils.clamp(speed / WALK_SPEED_AT_1X, 0.7, 1.8)
    const moving = speed > 0.15
    if (moving !== this.moving) {
      this.moving = moving
      if (!this.attacking) this.fadeTo(moving ? 'Walk' : 'Idle', 0.2)
    }
  }

  /** Swing once. Skipping into the clip puts the hit frame right after the game applies damage. */
  attack() {
    if (this.dead) return
    this.attacking = true
    const a = this.actions.get('Attack')!
    if (this.current === a) a.reset().play()
    else this.fadeTo('Attack', 0.06)
    a.time = 0.12
  }

  /** Play the death clip; returns its length in seconds. */
  die(): number {
    if (this.dead) return 0
    this.dead = true
    this.fadeTo('Death', 0.1)
    return this.actions.get('Death')?.getClip().duration ?? 0
  }

  update(dt: number, time: number) {
    this.mixer.update(dt)
    if (this.glowMat) this.glowMat.emissiveIntensity = 2.8 + Math.sin(time * 3.1) * 0.5 + Math.sin(time * 7.3) * 0.25
  }

  dispose() {
    this.mixer.stopAllAction()
    this.group.removeFromParent()
  }
}
