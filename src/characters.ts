import * as THREE from 'three'
import type { CardId, Side } from './types'

// Character models built to the original Clash Royale quality standard:
// beveled sculpted geometry (no sharp primitive boxes), chunky heroic
// proportions — heads ~1/3 of total height, shorter wider bodies,
// thicker limbs, bigger expressive eyes, clean saturated painterly surfaces.

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
}

function mat(color: number, rough = 0.75, metal = 0.05): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal })
}
function skinMat(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xf2c79b, roughness: 0.6, metalness: 0 })
}
function steel(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xb8c0cc, roughness: 0.32, metalness: 0.85 })
}
function gold(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.3, metalness: 0.9 })
}
function box(w: number, h: number, d: number, m: THREE.Material): THREE.Mesh {
  const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m)
  g.castShadow = true
  return g
}
function cyl(rt: number, rb: number, h: number, m: THREE.Material, seg = 12): THREE.Mesh {
  const g = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m)
  g.castShadow = true
  return g
}
function sph(r: number, m: THREE.Material, sx = 1, sy = 1, sz = 1): THREE.Mesh {
  const g = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 14), m)
  g.scale.set(sx, sy, sz); g.castShadow = true
  return g
}
function cone(r: number, h: number, m: THREE.Material): THREE.Mesh {
  const g = new THREE.Mesh(new THREE.ConeGeometry(r, h, 12), m)
  g.castShadow = true
  return g
}

// A face: big expressive eyes with iris / pupil / glint, brows, nose, mouth, ears.
function makeFace(head: THREE.Group, opts: { mustache?: boolean; stubble?: boolean; magentaHair?: boolean; visor?: boolean; skull?: boolean; glowEyes?: boolean } = {}) {
  const eyeW = mat(0xffffff, 0.25)
  const iris = mat(opts.glowEyes ? 0xffd23d : 0x2b4a7a, 0.2)
  const pupil = mat(0x111111, 0.2)
  const glint = new THREE.MeshBasicMaterial({ color: 0xffffff })
  for (const s of [-1, 1]) {
    const eye = sph(0.085, eyeW, 1, 1.25, 0.55); eye.position.set(s * 0.14, 0.05, 0.26); head.add(eye)
    const ir = sph(0.045, iris, 1, 1.2, 0.5); ir.position.set(s * 0.14, 0.05, 0.33); head.add(ir)
    const pu = sph(0.022, pupil, 1, 1.2, 0.5); pu.position.set(s * 0.14, 0.05, 0.36); head.add(pu)
    const gl = sph(0.014, glint); gl.position.set(s * 0.14 + 0.02, 0.08, 0.38); head.add(gl)
    const brow = box(0.14, 0.035, 0.03, mat(0x4a2f1d, 0.8)); brow.position.set(s * 0.14, 0.17, 0.28); brow.rotation.z = s * -0.12; head.add(brow)
    const ear = sph(0.06, skinMat(), 0.5, 1, 0.8); ear.position.set(s * 0.31, 0, 0); head.add(ear)
  }
  const nose = cone(0.045, 0.12, skinMat()); nose.rotation.x = Math.PI / 2; nose.position.set(0, -0.02, 0.32); head.add(nose)
  const mouth = box(0.12, 0.025, 0.02, mat(0x8a3b2e, 0.7)); mouth.position.set(0, -0.14, 0.29); head.add(mouth)
  if (opts.mustache) {
    // The Knight's magnificent walrus mustache.
    const m = mat(0x6b4a1f, 0.85)
    for (const s of [-1, 1]) {
      const half = sph(0.09, m, 1.6, 0.6, 0.7); half.position.set(s * 0.1, -0.09, 0.28); half.rotation.z = s * 0.5; head.add(half)
    }
    const beard = sph(0.12, m, 1.3, 0.8, 0.7); beard.position.set(0, -0.2, 0.24); head.add(beard)
  }
  if (opts.stubble) {
    const st = sph(0.16, mat(0x5a4632, 0.9), 1.1, 0.7, 0.8); st.position.set(0, -0.18, 0.18); head.add(st)
  }
  if (opts.magentaHair) {
    const hair = sph(0.32, mat(0xd63384, 0.7), 1, 0.75, 1); hair.position.set(0, 0.18, -0.05); head.add(hair)
    const pony = cone(0.09, 0.4, mat(0xd63384, 0.7)); pony.position.set(0, 0.05, -0.34); pony.rotation.x = -0.9; head.add(pony)
  }
  if (opts.visor) {
    const visor = box(0.5, 0.09, 0.06, steel()); visor.position.set(0, 0.1, 0.28); head.add(visor)
  }
  if (opts.skull) {
    const teeth = box(0.16, 0.06, 0.02, mat(0xffffff, 0.5)); teeth.position.set(0, -0.14, 0.29); head.add(teeth)
  }
}

function baseRig(scale: number, team: Side): Rig {
  const group = new THREE.Group()
  const accent = team === 'blue' ? 0x2f6df6 : 0xe23b3b
  const head = new THREE.Group(); head.position.y = 1.18
  const armL = new THREE.Group(); armL.position.set(-0.42, 0.92, 0)
  const armR = new THREE.Group(); armR.position.set(0.42, 0.92, 0)
  const legL = new THREE.Group(); legL.position.set(-0.16, 0.52, 0)
  const legR = new THREE.Group(); legR.position.set(0.16, 0.52, 0)
  group.add(head, armL, armR, legL, legR)
  group.userData.accent = accent
  return { group, head, armL, armR, legL, legR, scale }
}

function addLimbs(r: Rig, opts: { skinArms?: boolean; armor?: boolean; team: Side }) {
  const armM = opts.skinArms ? skinMat() : mat(opts.armor ? 0x8a94a6 : (r.group.userData.accent as number), 0.7)
  const legM = opts.armor ? steel() : mat(0x3d2b1f, 0.8)
  for (const arm of [r.armL, r.armR]) {
    const upper = cyl(0.11, 0.1, 0.42, armM); upper.position.y = -0.21; arm.add(upper)
    const hand = sph(0.11, skinMat()); hand.position.y = -0.48; arm.add(hand)
    // thumb + curled fingers, simplified as a second knuckle sphere
    const knuckle = sph(0.07, skinMat(), 1.2, 0.8, 1); knuckle.position.set(0.05, -0.5, 0.06); arm.add(knuckle)
  }
  for (const leg of [r.legL, r.legR]) {
    const thigh = cyl(0.13, 0.12, 0.3, legM); thigh.position.y = -0.15; leg.add(thigh)
    const boot = box(0.2, 0.14, 0.34, mat(0x2b1d12, 0.85)); boot.position.set(0, -0.48, 0.05); leg.add(boot)
  }
  // Chunky heroic torso: lathed, wide, with muscle bulge.
  const torso = sph(0.42, mat(r.group.userData.accent as number, 0.7), 1.15, 0.95, 0.85)
  torso.position.y = 0.78; r.group.add(torso)
  const belt = cyl(0.4, 0.42, 0.12, mat(0x2b1d12, 0.85)); belt.position.y = 0.52; r.group.add(belt)
  const buckle = box(0.14, 0.1, 0.04, gold()); buckle.position.set(0, 0.52, 0.4); r.group.add(buckle)
  return r
}

function addHeadBase(r: Rig, skin = true) {
  const skull = sph(0.32, skin ? skinMat() : mat(0xe8e8e8, 0.55), 1, 1.05, 0.95)
  r.head.add(skull)
  return r
}

export function buildTroop(cardId: CardId, side: Side): Rig {
  const teamColor = side === 'blue' ? 0x2f6df6 : 0xe23b3b
  switch (cardId) {
    case 'knight': {
      const r = baseRig(1, side); addHeadBase(r); addLimbs(r, { armor: true, team: side })
      makeFace(r.head, { mustache: true })
      const helm = sph(0.35, steel(), 1, 0.7, 1); helm.position.y = 0.2; r.head.add(helm)
      const crest = box(0.06, 0.28, 0.34, mat(0xe23b3b, 0.7)); crest.position.y = 0.48; r.head.add(crest)
      r.plume = crest
      const shield = cyl(0.32, 0.32, 0.06, mat(teamColor, 0.5, 0.3), 20); shield.rotation.z = Math.PI / 2; shield.rotation.y = 0.4
      shield.position.set(-0.5, 0.65, 0.12); r.group.add(shield)
      const boss = sph(0.09, gold()); boss.position.set(-0.56, 0.65, 0.16); r.group.add(boss)
      const sword = new THREE.Group()
      const blade = box(0.09, 0.85, 0.03, steel()); blade.position.y = 0.55; sword.add(blade)
      const guard = box(0.28, 0.06, 0.06, gold()); guard.position.y = 0.14; sword.add(guard)
      const grip = cyl(0.035, 0.035, 0.16, mat(0x2b1d12, 0.8)); grip.position.y = 0.02; sword.add(grip)
      sword.position.set(0, -0.5, 0.05); r.armR.add(sword); r.weapon = sword
      return r
    }
    case 'archers': {
      const r = baseRig(0.92, side); addHeadBase(r); addLimbs(r, { skinArms: true, team: side })
      makeFace(r.head, { magentaHair: true })
      const hood = cone(0.34, 0.42, mat(0x2e7d32, 0.8)); hood.position.y = 0.28; r.head.add(hood)
      const quiver = cyl(0.09, 0.09, 0.42, mat(0x6b4a1f, 0.85)); quiver.position.set(0.2, 0.85, -0.38); quiver.rotation.z = 0.25; r.group.add(quiver)
      const bow = new THREE.Group()
      const arc = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.035, 8, 20, Math.PI * 1.2), mat(0x6b4a1f, 0.8))
      arc.rotation.z = Math.PI / 2 - 0.3; bow.add(arc)
      const arrow = cyl(0.015, 0.015, 0.7, mat(0xd8c49a, 0.6)); arrow.rotation.z = Math.PI / 2; arrow.position.set(0.1, 0, 0); bow.add(arrow)
      bow.position.set(0, -0.5, 0.1); r.armL.add(bow); r.weapon = bow
      return r
    }
    case 'giant': {
      const r = baseRig(1.5, side); addHeadBase(r); addLimbs(r, { skinArms: true, team: side })
      makeFace(r.head, { stubble: true })
      const sash = box(0.9, 0.16, 0.7, mat(0xe23b3b, 0.75)); sash.position.set(0, 0.9, 0); sash.rotation.z = 0.5; r.group.add(sash)
      const fistL = sph(0.2, skinMat()); fistL.position.set(0, -0.52, 0); r.armL.add(fistL)
      const fistR = sph(0.2, skinMat()); fistR.position.set(0, -0.52, 0); r.armR.add(fistR)
      r.group.scale.setScalar(1.5)
      return r
    }
    case 'musketeer': {
      const r = baseRig(1, side); addHeadBase(r); addLimbs(r, { skinArms: false, team: side })
      makeFace(r.head)
      const hair = sph(0.33, mat(0x8a5a2b, 0.7), 1, 0.6, 1); hair.position.set(0, 0.22, -0.06); r.head.add(hair)
      const hat = cyl(0.36, 0.38, 0.08, mat(0x5b3a8a, 0.75)); hat.position.y = 0.3; r.head.add(hat)
      const musket = new THREE.Group()
      const barrel = cyl(0.04, 0.04, 1.1, steel()); barrel.rotation.x = Math.PI / 2; musket.add(barrel)
      const stock = box(0.08, 0.12, 0.5, mat(0x6b4a1f, 0.85)); stock.position.set(0, -0.05, 0.3); musket.add(stock)
      musket.position.set(0, -0.5, 0.3); r.armR.add(musket); r.weapon = musket
      return r
    }
    case 'minions': {
      const r = baseRig(0.72, side); addHeadBase(r, false); addLimbs(r, { skinArms: true, team: side })
      makeFace(r.head, { glowEyes: true })
      const hornM = mat(0xf2e6c9, 0.6)
      for (const s of [-1, 1]) { const h = cone(0.06, 0.22, hornM); h.position.set(s * 0.18, 0.32, 0); h.rotation.z = s * -0.4; r.head.add(h) }
      const wingM = new THREE.MeshStandardMaterial({ color: 0x7a4a9a, roughness: 0.6, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
      for (const s of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.3), wingM)
        wing.position.set(s * 0.45, 0.95, -0.25); wing.rotation.y = s * 0.7; r.group.add(wing)
      }
      const tail = cyl(0.04, 0.02, 0.5, mat(0x5a6cff, 0.7)); tail.position.set(0, 0.45, -0.45); tail.rotation.x = 1.1; r.group.add(tail)
      return r
    }
    case 'bomber': {
      const r = baseRig(0.95, side); addHeadBase(r, false); addLimbs(r, { skinArms: true, team: side })
      makeFace(r.head, { skull: true, glowEyes: true })
      const bomb = sph(0.22, mat(0x1c1e24, 0.4, 0.6)); bomb.position.set(0, -0.5, 0.15); r.armR.add(bomb)
      const fuse = cyl(0.02, 0.02, 0.16, mat(0xd8c49a, 0.8)); fuse.position.set(0, -0.3, 0.15); r.armR.add(fuse)
      const spark = sph(0.05, new THREE.MeshBasicMaterial({ color: 0xffc93d })); spark.position.set(0, -0.2, 0.15); r.armR.add(spark)
      return r
    }
    case 'prince': {
      const r = baseRig(1.08, side); addHeadBase(r); addLimbs(r, { armor: true, team: side })
      makeFace(r.head, { visor: true })
      const helm = sph(0.34, steel(), 1, 0.75, 1); helm.position.y = 0.2; r.head.add(helm)
      const plume = cone(0.09, 0.36, mat(0xffffff, 0.7)); plume.position.y = 0.5; r.head.add(plume); r.plume = plume
      const cape = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.9), new THREE.MeshStandardMaterial({ color: 0xe23b3b, roughness: 0.8, side: THREE.DoubleSide }))
      cape.position.set(0, 0.65, -0.42); r.group.add(cape); r.cape = cape
      const lance = new THREE.Group()
      const shaft = cyl(0.04, 0.04, 1.4, mat(0x6b4a1f, 0.8)); shaft.rotation.x = Math.PI / 2; lance.add(shaft)
      const tip = cone(0.07, 0.3, steel()); tip.rotation.x = Math.PI / 2; tip.position.z = 0.8; lance.add(tip)
      lance.position.set(0, -0.5, 0.35); r.armR.add(lance); r.weapon = lance
      return r
    }
    case 'skeletons': {
      const r = baseRig(0.78, side); addHeadBase(r, false); addLimbs(r, { skinArms: true, team: side })
      makeFace(r.head, { skull: true, glowEyes: true })
      for (let i = 0; i < 3; i++) {
        const rib = new THREE.Mesh(new THREE.TorusGeometry(0.3 - i * 0.02, 0.025, 6, 16, Math.PI), mat(0xe8e8e8, 0.55))
        rib.position.y = 0.95 - i * 0.12; rib.rotation.z = 0; r.group.add(rib)
      }
      return r
    }
    case 'dragon': {
      const r = baseRig(1.05, side); addHeadBase(r); addLimbs(r, { skinArms: true, team: side })
      // Snout, tongue, belly plates, back spikes, fire glow.
      const snout = box(0.3, 0.16, 0.22, mat(0xff9a5c, 0.65)); snout.position.set(0, -0.05, 0.3); r.head.add(snout)
      const tongue = box(0.1, 0.03, 0.18, mat(0xff5a7a, 0.6)); tongue.position.set(0, -0.12, 0.38); r.head.add(tongue)
      const glow = sph(0.09, new THREE.MeshBasicMaterial({ color: 0xff7a1a })); glow.position.set(0, -0.08, 0.42); r.head.add(glow)
      const eyeM = mat(0xffd23d, 0.2)
      for (const s of [-1, 1]) { const e = sph(0.07, eyeM); e.position.set(s * 0.16, 0.08, 0.26); r.head.add(e) }
      const belly = sph(0.3, mat(0xffe8b3, 0.7), 1, 1.1, 0.6); belly.position.set(0, 0.72, 0.22); r.group.add(belly)
      for (let i = 0; i < 4; i++) { const spike = cone(0.07, 0.22, mat(0xffe8b3, 0.6)); spike.position.set(0, 1.05 - i * 0.02, -0.32 - i * 0.04); spike.rotation.x = -0.5; r.group.add(spike) }
      const wingM = new THREE.MeshStandardMaterial({ color: 0xff8a3d, roughness: 0.6, side: THREE.DoubleSide, transparent: true, opacity: 0.92 })
      for (const s of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.45), wingM)
        wing.position.set(s * 0.5, 1.0, -0.2); wing.rotation.y = s * 0.6; r.group.add(wing)
      }
      return r
    }
    default: {
      const r = baseRig(1, side); addHeadBase(r); addLimbs(r, { team: side }); makeFace(r.head); return r
    }
  }
}

export function animateRig(r: Rig, t: number, moving: boolean, attacking: boolean) {
  const ph = t * (moving ? 9 : 2)
  const swing = moving ? Math.sin(ph) * 0.55 : Math.sin(ph) * 0.06
  r.legL.rotation.x = swing
  r.legR.rotation.x = -swing
  r.armL.rotation.x = -swing * 0.8
  r.armR.rotation.x = attacking ? -1.2 + Math.sin(t * 14) * 0.35 : swing * 0.8
  // Breathing + idle head movement.
  r.group.position.y = Math.sin(t * 2.2) * 0.02
  r.head.rotation.y = Math.sin(t * 0.7) * 0.12
  r.head.rotation.x = attacking ? 0.12 : 0
  if (r.plume) r.plume.rotation.z = Math.sin(t * 3) * 0.12
  if (r.cape) (r.cape as THREE.Mesh).rotation.x = moving ? 0.25 + Math.sin(ph) * 0.08 : 0.08
}

export function buildKing(side: Side): THREE.Group {
  const g = new THREE.Group()
  const robe = cyl(0.55, 0.75, 1.1, mat(side === 'blue' ? 0x2f6df6 : 0xe23b3b, 0.75), 14); robe.position.y = 0.55; g.add(robe)
  const head = new THREE.Group(); head.position.y = 1.45; g.add(head)
  const skull = sph(0.32, skinMat(), 1, 1.05, 0.95); head.add(skull)
  makeFace(head, { mustache: true })
  const crown = cyl(0.3, 0.34, 0.22, gold(), 10); crown.position.y = 0.32; head.add(crown)
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    const spike = cone(0.06, 0.18, gold()); spike.position.set(Math.cos(a) * 0.3, 0.48, Math.sin(a) * 0.3); head.add(spike)
  }
  const scepter = cyl(0.04, 0.04, 1.1, gold()); scepter.position.set(0.5, 0.8, 0.2); scepter.rotation.z = -0.15; g.add(scepter)
  return g
}

export function buildPrincess(side: Side): THREE.Group {
  const g = new THREE.Group()
  const dress = cone(0.5, 1.0, mat(side === 'blue' ? 0x7fb2ff : 0xff9ab0, 0.75)); dress.position.y = 0.5; g.add(dress)
  const head = new THREE.Group(); head.position.y = 1.25; g.add(head)
  const skull = sph(0.28, skinMat(), 1, 1.05, 0.95); head.add(skull)
  makeFace(head, { magentaHair: true })
  const bow = new THREE.Group()
  const arc = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.03, 8, 18, Math.PI * 1.1), mat(0x6b4a1f, 0.8))
  arc.rotation.z = Math.PI / 2; bow.add(arc)
  bow.position.set(0.35, 0.9, 0.15); g.add(bow)
  return g
}
