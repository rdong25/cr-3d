import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { HeroInstance, makeArenaEnvironment, preloadHero, preloadHeroes, setHeroEnvironment, type HeroCardId } from '../hero'
import { animateRig, buildTroop, type Rig } from '../characters'
import type { CardId, Side } from '../types'

/** Every generated hero, in deploy order. Fireball is a spell — no hero. */
const HEROES: { cardId: HeroCardId; name: string }[] = [
  { cardId: 'knight', name: 'Ember Warden (Knight)' },
  { cardId: 'giant', name: 'Giant' },
  { cardId: 'prince', name: 'Prince' },
  { cardId: 'archers', name: 'Archers' },
  { cardId: 'musketeer', name: 'Musketeer' },
  { cardId: 'bomber', name: 'Bomber' },
  { cardId: 'skeletons', name: 'Skeletons' },
  { cardId: 'minions', name: 'Minions' },
  { cardId: 'dragon', name: 'Baby Dragon' },
]

// Standalone character viewer: same lights and environment as the arena, the
// hero on a turf disc, buttons for each clip, and an old-vs-new comparison.

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.12
renderer.outputColorSpace = THREE.SRGBColorSpace
document.body.prepend(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x1a2240)
scene.fog = new THREE.Fog(0x1a2240, 12, 30)
const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100)
camera.position.set(2.2, 1.6, 3.6)
const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 0.85, 0)
controls.enableDamping = true
controls.minDistance = 1.2
controls.maxDistance = 14

// Arena lighting rig (mirrors engine.ts).
const sunLight = new THREE.DirectionalLight(0xffc27a, 2.4)
sunLight.position.set(-4.5, 5.5, 2.5)
sunLight.castShadow = true
sunLight.shadow.mapSize.set(2048, 2048)
Object.assign(sunLight.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 20 })
sunLight.shadow.bias = -0.0004
sunLight.shadow.normalBias = 0.02
scene.add(sunLight)
const rim = new THREE.DirectionalLight(0x7fb2ff, 0.9); rim.position.set(3.5, 2.5, -4.5); scene.add(rim)
scene.add(new THREE.AmbientLight(0xffe0b8, 0.55))
scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x3d5a2a, 0.5))

const ground = new THREE.Mesh(new THREE.CircleGeometry(4, 64), new THREE.MeshStandardMaterial({ color: 0x4a9e3f, roughness: 0.95 }))
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)

setHeroEnvironment(makeArenaEnvironment(renderer))

const stats = document.getElementById('stats')!
const captions = document.getElementById('captions')!
let team: Side = 'blue'
let heroId: HeroCardId = 'knight'
let hero: HeroInstance | null = null
let oldTroop: Rig | null = null
let compare = false
let turntable = true
let wire = false
let bones: THREE.SkeletonHelper | null = null
let clip = 'Idle'
const pivot = new THREE.Group()
scene.add(pivot)

function spawn() {
  hero?.dispose()
  hero = new HeroInstance(team, heroId)
  hero.group.position.x = compare ? 0.75 : 0
  pivot.add(hero.group)
  applyWire()
  applyBones()
  play(clip === 'Death' ? 'Idle' : clip)
  const name = HEROES.find((h) => h.cardId === heroId)!.name
  document.querySelector('h1')!.textContent = name
  let tris = 0, boneCount = 0
  hero.group.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) tris += (m.geometry.index?.count ?? 0) / 3
    if ((o as THREE.Bone).isBone) boneCount++
  })
  stats.textContent = `${name} · ${tris.toLocaleString()} triangles · ${boneCount} bones · 4 clips`
}

function setCompare(on: boolean) {
  compare = on
  captions.classList.toggle('single', !on)
  if (oldTroop) { pivot.remove(oldTroop.group); oldTroop = null }
  if (on) {
    oldTroop = buildTroop(heroId as CardId, team)
    oldTroop.group.position.x = -0.75
    oldTroop.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true })
    pivot.add(oldTroop.group)
  }
  if (hero) hero.group.position.x = on ? 0.75 : 0
  controls.target.set(0, 0.85, 0)
}

function play(name: string) {
  if (!hero) return
  clip = name
  if (name === 'Walk') hero.setSpeed(1.15)
  else hero.setSpeed(0)
  if (name === 'Attack') hero.attack()
  if (name === 'Death') hero.die()
  document.querySelectorAll<HTMLButtonElement>('#clips button').forEach((b) => b.classList.toggle('on', b.dataset.clip === name))
}

function applyWire() {
  hero?.group.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) (m.material as THREE.MeshStandardMaterial).wireframe = wire
  })
}
function applyBones() {
  if (bones) { scene.remove(bones); bones = null }
  if (hero && document.getElementById('bones')!.classList.contains('on')) {
    bones = new THREE.SkeletonHelper(hero.group)
    scene.add(bones)
  }
}

const heroesRow = document.getElementById('heroes')!
for (const h of HEROES) {
  const b = document.createElement('button')
  b.textContent = h.name; b.dataset.hero = h.cardId
  b.classList.toggle('on', h.cardId === heroId)
  b.onclick = () => {
    heroId = h.cardId as HeroCardId
    document.querySelectorAll<HTMLButtonElement>('#heroes button').forEach((x) => x.classList.toggle('on', x === b))
    document.getElementById('compare')!.textContent = `Compare with old ${h.name}`
    spawn(); setCompare(compare)
  }
  heroesRow.append(b)
}
const clipsRow = document.getElementById('clips')!
for (const name of ['Idle', 'Walk', 'Attack', 'Death']) {
  const b = document.createElement('button')
  b.textContent = name; b.dataset.clip = name
  b.onclick = () => { if (name !== 'Death' && hero?.dead) spawn(); play(name) }
  clipsRow.append(b)
}
const respawn = document.createElement('button')
respawn.textContent = 'Respawn'; respawn.onclick = () => { clip = 'Idle'; spawn() }
clipsRow.append(respawn)

document.querySelectorAll<HTMLButtonElement>('[data-team]').forEach((b) => {
  b.onclick = () => {
    team = b.dataset.team as Side
    document.querySelectorAll('[data-team]').forEach((x) => x.classList.toggle('on', x === b))
    spawn(); setCompare(compare)
  }
})
const toggle = (id: string, fn: (on: boolean) => void) => {
  const b = document.getElementById(id)!
  b.addEventListener('click', () => { b.classList.toggle('on'); fn(b.classList.contains('on')) })
}
toggle('compare', setCompare)
toggle('turntable', (on) => { turntable = on; if (!on) pivot.rotation.y = 0 })
toggle('wire', (on) => { wire = on; applyWire() })
toggle('bones', () => applyBones())
document.getElementById('arenaCam')!.onclick = () => {
  // Roughly the in-game broadcast camera distance and angle.
  camera.position.set(0, 9, 8); controls.target.set(0, 0.6, 0)
}

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()

// URL params make screenshots reproducible: ?hero=giant&clip=Walk&t=0.3&team=red&compare=1&yaw=0.6
const params = new URLSearchParams(location.search)
const clock = new THREE.Clock()
let time = 0
// Fetch every hero in the background so switching is instant; wait only for the selected one.
preloadHeroes()
if (params.get('hero') && HEROES.some((h) => h.cardId === params.get('hero'))) heroId = params.get('hero') as HeroCardId
preloadHero(heroId).then(() => {
  if (params.get('team') === 'red') team = 'red'
  document.querySelectorAll('[data-team]').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.team === team))
  if (params.get('clip')) clip = params.get('clip')!
  const requested = clip
  spawn()
  if (requested === 'Death') play('Death')
  if (params.get('compare') === '1') { document.getElementById('compare')!.classList.add('on'); setCompare(true) }
  if (params.has('yaw')) { turntable = false; document.getElementById('turntable')!.classList.remove('on'); pivot.rotation.y = Number(params.get('yaw')) }
  if (params.has('cam')) { const [x, y, z, tx, ty, tz] = params.get('cam')!.split(',').map(Number); camera.position.set(x, y, z); controls.target.set(tx, ty, tz) }
  if (params.has('t')) { const t = Number(params.get('t')); hero!.update(t, t); time = t }
  renderer.setAnimationLoop(() => {
    const dt = params.has('t') ? 0 : Math.min(clock.getDelta(), 0.05)
    time += dt
    if (turntable) pivot.rotation.y += dt * 0.35
    hero?.update(dt, time)
    if (oldTroop) animateRig(oldTroop, time, clip === 'Walk', clip === 'Attack')
    controls.update()
    renderer.render(scene, camera)
  })
  ;(window as unknown as { __ready: boolean }).__ready = true
})
