import * as THREE from 'three'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { useSyncExternalStore } from 'react'
import { HERO_CARDS, TEAM_COLORS, heroAsset, preloadHero, type HeroCardId } from './hero'
import type { CardId } from './types'

// Card portraits rendered from the real 3D models, so the card art always
// matches the troop on the field. Rendered once at startup on a small
// throwaway WebGL canvas, then kept as images.

const W = 320, H = 400
const store = new Map<CardId, string>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** The portrait image (data URL) for a card, or undefined until it has been rendered. */
export function usePortrait(id: CardId): string | undefined {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb) } }, () => store.get(id))
}

/** Fireball has no model: paint the spell. */
function paintFireball(): string {
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const g = c.getContext('2d')!
  const cx = W * 0.56, cy = H * 0.5
  // smoky tail trailing up to the left
  for (let i = 0; i < 26; i++) {
    const t = i / 26, x = cx - t * 190 + Math.sin(i * 1.7) * 14, y = cy - t * 150 + Math.cos(i * 2.3) * 12, r = 70 - t * 46
    const grad = g.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, `rgba(255,${150 - t * 90},${40 - t * 30},${0.5 - t * 0.38})`); grad.addColorStop(1, 'rgba(60,20,10,0)')
    g.fillStyle = grad; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill()
  }
  // flame tongues
  g.globalCompositeOperation = 'lighter'
  for (let i = 0; i < 9; i++) {
    const a = -2.5 + (i / 8) * 1.3, len = 120 + (i % 3) * 30
    g.fillStyle = `rgba(255,${120 + (i % 3) * 30},20,0.5)`
    g.beginPath(); g.moveTo(cx + Math.cos(a + 1.3) * 52, cy + Math.sin(a + 1.3) * 52)
    g.quadraticCurveTo(cx + Math.cos(a) * len * 0.7, cy + Math.sin(a) * len * 0.7, cx + Math.cos(a) * len, cy + Math.sin(a) * len)
    g.quadraticCurveTo(cx + Math.cos(a) * len * 0.6, cy + Math.sin(a) * len * 0.6, cx + Math.cos(a - 1.3) * 52, cy + Math.sin(a - 1.3) * 52)
    g.fill()
  }
  // glowing core
  for (const [r, col] of [[120, 'rgba(255,90,20,0.55)'], [78, 'rgba(255,170,50,0.9)'], [46, 'rgba(255,240,180,1)']] as [number, string][]) {
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r)
    grad.addColorStop(0, col); grad.addColorStop(1, 'rgba(255,60,0,0)')
    g.fillStyle = grad; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill()
  }
  return c.toDataURL('image/png')
}

let started = false
/** Render every card's portrait. Safe to call more than once. */
export async function buildPortraits(): Promise<void> {
  if (started) return
  started = true
  store.set('fireball', paintFireball()); emit()

  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1); renderer.setSize(W, H)
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.outputColorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.75
  const key = new THREE.DirectionalLight(0xfff0dc, 3.2); key.position.set(2.2, 3, 3.5); scene.add(key)
  const rim = new THREE.DirectionalLight(0x86a8ff, 2.6); rim.position.set(-3, 2.2, -2.5); scene.add(rim)
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.1, 50)

  for (const id of HERO_CARDS) {
    try { await preloadHero(id) } catch { continue }
    const asset = heroAsset(id as HeroCardId)
    if (!asset) continue
    const model = SkeletonUtils.clone(asset.scene)
    model.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      const m = (mesh.material as THREE.MeshStandardMaterial).clone()
      if (m.name === 'Warden_Team') m.color.setHex(TEAM_COLORS.blue)
      mesh.material = m
      mesh.frustumCulled = false
    })
    // Strike a pose from the Idle clip.
    const idle = asset.clips.get('Idle')
    if (idle) { const mixer = new THREE.AnimationMixer(model); mixer.clipAction(idle).play(); mixer.setTime(0.6) }
    model.rotation.y = 0.5
    scene.add(model)
    model.updateMatrixWorld(true)
    // Frame head and shoulders, scaled to the model's height.
    const height = Math.max(1, new THREE.Box3().setFromObject(model).max.y)
    const k = height / 1.75
    const head = model.getObjectByName('head')
    const hp = head ? head.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3(0, height * 0.75, 0)
    const target = new THREE.Vector3(hp.x * 0.6, hp.y + 0.02 * k, hp.z * 0.6)
    camera.position.set(target.x + 0.35 * k, target.y + 0.12 * k, target.z + 2.5 * k)
    camera.lookAt(target)
    renderer.render(scene, camera)
    store.set(id, renderer.domElement.toDataURL('image/png'))
    emit()
    scene.remove(model)
    await new Promise((r) => setTimeout(r, 0)) // don't block the UI between portraits
  }
  pmrem.dispose()
  renderer.dispose()
  renderer.forceContextLoss()
}
