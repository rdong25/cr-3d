// Animation clips for the Minions: Idle / Walk (flying hover) / Attack / Death.
// Pose functions of time, baked to keyframes at 30 fps by build.mjs.
//
// A pose is { boneName: [rx, ry, rz] } in radians (XYZ Euler, offsets from the
// rest pose), plus optional { pos: { boneName: [dx, dy, dz] } } translations.
// The game holds flying troops at y ≈ 1.1; clips bob around feet-at-y=0.
//
// Sign cheat-sheet (character faces +Z, left = +X):
//   limb swings FORWARD  = negative X      knee / shin bends back = positive X
//   lean / nod forward   = positive X      turn toward its left   = positive Y
//   left wing tip up     = positive Z (wing_L)   right wing tip up = negative Z (wing_R)

const TAU = Math.PI * 2
const sstep = (t) => t * t * (3 - 2 * t)
const clamp01 = (t) => Math.max(0, Math.min(1, t))

/** Base stance: hovering, wings half-raised, arms tucked, legs dangling. */
function stance(breath = 0) {
  return {
    hips: [0, 0, 0],
    spine: [0.06 + breath * 0.015, 0, 0],
    chest: [0.04 - breath * 0.02, 0, 0],
    neck: [0, 0, 0],
    head: [-0.06, 0, 0],
    wing_L: [0, 0, 0.35 + breath * 0.05],
    wing_R: [0, 0, -0.35 - breath * 0.05],
    thigh_L: [-0.15, 0, 0.05], shin_L: [0.35, 0, 0], foot_L: [-0.15, 0, 0],
    thigh_R: [-0.05, 0, -0.05], shin_R: [0.3, 0, 0], foot_R: [-0.2, 0, 0],
    upperarm_R: [-0.5, 0, -0.35], forearm_R: [-0.9, 0, 0], hand_R: [0, 0, 0],
    upperarm_L: [-0.5, 0, 0.35], forearm_L: [-0.9, 0, 0], hand_L: [0, 0, 0],
    pos: { hips: [0, 0.06, 0] },
  }
}

function blend(a, b, t) {
  const out = { pos: {} }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k === 'pos') continue
    const x = a[k] || [0, 0, 0], y = b[k] || [0, 0, 0]
    out[k] = [0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t)
  }
  const pa = a.pos || {}, pb = b.pos || {}
  for (const k of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
    const x = pa[k] || [0, 0, 0], y = pb[k] || [0, 0, 0]
    out.pos[k] = [0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t)
  }
  return out
}
/** Merge partial overrides on top of a base pose (adds angles). */
function layer(base, over) {
  const out = JSON.parse(JSON.stringify(base))
  for (const [k, v] of Object.entries(over)) {
    if (k === 'pos') { for (const [b, p] of Object.entries(v)) out.pos[b] = (out.pos[b] || [0, 0, 0]).map((x, i) => x + p[i]); continue }
    out[k] = (out[k] || [0, 0, 0]).map((x, i) => x + v[i])
  }
  return out
}
/** Piecewise key poses [{t, pose}] with smoothstep easing between keys. */
function keyed(keys) {
  return (t) => {
    if (t <= keys[0].t) return keys[0].pose
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1]
      if (t <= b.t) return blend(a.pose, b.pose, (b.ease || sstep)(clamp01((t - a.t) / (b.t - a.t))))
    }
    return keys[keys.length - 1].pose
  }
}

export const CLIPS = [
  {
    // Gentle hover: slow wing beats, bobbing, head looking around.
    name: 'Idle', duration: 2.4, loop: true,
    pose: (t) => {
      const ph = (t / 2.4) * TAU
      const b = Math.sin(ph)
      const flap = Math.sin(ph * 2) * 0.18
      return layer(stance(b), {
        head: [Math.sin(ph * 2) * 0.02, Math.sin(ph) * 0.25, 0],
        chest: [0, Math.sin(ph) * 0.04, 0],
        wing_L: [Math.sin(ph) * 0.08, 0, flap],
        wing_R: [Math.sin(ph) * 0.08, 0, -flap],
        thigh_L: [Math.sin(ph + 0.5) * 0.06, 0, 0], thigh_R: [Math.sin(ph + 2) * 0.06, 0, 0],
        pos: { hips: [0, 0.025 * b, 0] },
      })
    },
  },
  {
    // Flying hover: fast wing beats, bob up/down, legs dangle and trail.
    name: 'Walk', duration: 0.9, loop: true,
    pose: (t) => {
      const ph = (t / 0.9) * TAU
      const s = Math.sin(ph), c = Math.cos(ph)
      const flap = 0.55 * s
      const base = stance(0)
      return {
        ...base,
        hips: [0.05 * s, 0, 0.04 * s],
        spine: [0.12, 0, 0],
        chest: [0.06, 0, 0],
        head: [-0.12 + 0.03 * c, 0, 0],
        wing_L: [0.1 * c, 0, 0.35 + flap],
        wing_R: [0.1 * c, 0, -0.35 - flap],
        thigh_L: [-0.3 + 0.12 * s, 0, 0.05], shin_L: [0.45 + 0.1 * c, 0, 0], foot_L: [-0.15, 0, 0],
        thigh_R: [-0.3 - 0.12 * s, 0, -0.05], shin_R: [0.45 - 0.1 * c, 0, 0], foot_R: [-0.15, 0, 0],
        upperarm_L: [-0.7 + 0.1 * s, 0, 0.4], forearm_L: [-0.7, 0, 0],
        upperarm_R: [-0.7 - 0.1 * s, 0, -0.4], forearm_R: [-0.7, 0, 0],
        pos: { hips: [0, 0.06 + 0.05 * c, 0.02 * s] },
      }
    },
  },
  {
    // Claw swipe: wings spread wide, body lunges, right claw rakes across.
    name: 'Attack', duration: 0.9, loop: false,
    pose: (() => {
      const ready = stance(0)
      const windup = layer(ready, {
        hips: [0, -0.2, 0], spine: [-0.1, -0.2, 0], chest: [-0.08, -0.25, 0], head: [0.05, 0.3, 0],
        wing_L: [0, 0, -0.25], wing_R: [0, 0, 0.25],
        upperarm_R: [-0.2, 0, -0.9], forearm_R: [-1.4, 0, 0],
        upperarm_L: [-0.3, 0, 0.5], forearm_L: [-1.0, 0, 0],
        pos: { hips: [0, 0.02, -0.04] },
      })
      const strike = layer(ready, {
        hips: [0, 0.25, 0], spine: [0.25, 0.15, 0], chest: [0.15, 0.25, 0], head: [-0.25, -0.25, 0],
        wing_L: [0, 0, 0.55], wing_R: [0, 0, -0.55],
        upperarm_R: [-1.3, -0.6, -0.2], forearm_R: [-0.2, 0, 0], hand_R: [-0.3, 0, 0],
        upperarm_L: [0.3, 0, 0.3], forearm_L: [0.4, 0, 0],
        thigh_L: [-0.5, 0, 0], shin_L: [0.6, 0, 0],
        thigh_R: [0.1, 0, 0], shin_R: [0.4, 0, 0],
        pos: { hips: [0, 0.02, 0.08] },
      })
      const follow = layer(strike, { upperarm_R: [0.2, 0.3, 0], forearm_R: [0.15, 0, 0], spine: [0.05, 0, 0] })
      const fast = (t) => 1 - Math.pow(1 - t, 3)
      return keyed([
        { t: 0, pose: ready },
        { t: 0.3, pose: windup },
        { t: 0.38, pose: strike, ease: fast },
        { t: 0.5, pose: follow },
        { t: 0.9, pose: ready },
      ])
    })(),
  },
  {
    // Wings fold, tumbles down out of the sky, lands on its back.
    name: 'Death', duration: 1.4, loop: false,
    pose: (() => {
      const ready = stance(0)
      const hit = layer(ready, {
        spine: [-0.3, 0.15, 0], chest: [-0.15, 0, 0], head: [-0.3, 0.2, 0],
        wing_L: [0, 0, -0.5], wing_R: [0, 0, 0.5],
        upperarm_R: [0.5, 0, -0.6], forearm_R: [0.5, 0, 0], upperarm_L: [0.4, 0, 0.6], forearm_L: [0.6, 0, 0],
        pos: { hips: [0, 0.04, -0.05] },
      })
      const fall = layer(ready, {
        spine: [0.2, 0, 0], head: [0.25, 0, 0],
        wing_L: [0, 0, -0.55], wing_R: [0, 0, 0.55],
        thigh_L: [-0.6, 0, 0.1], shin_L: [0.9, 0, 0],
        thigh_R: [-0.4, 0, -0.1], shin_R: [1.1, 0, 0],
        upperarm_R: [0.3, 0, -0.5], forearm_R: [0.6, 0, 0], upperarm_L: [0.2, 0, 0.5], forearm_L: [0.8, 0, 0],
        pos: { hips: [0, -0.3, 0] },
      })
      const down = {
        ...stance(0),
        root: [-1.42, 0, 0.25],
        hips: [0, 0, 0.1], spine: [-0.1, 0, 0], chest: [0, 0, 0], head: [0.2, 0.4, 0],
        wing_L: [0, 0, -0.15], wing_R: [0, 0, 0.15],
        thigh_L: [-0.2, 0, 0.12], shin_L: [0.3, 0, 0], foot_L: [0.25, 0, 0],
        thigh_R: [-0.1, 0, -0.1], shin_R: [0.15, 0, 0], foot_R: [0.3, 0, 0],
        upperarm_R: [-0.3, 0, -1.1], forearm_R: [-0.3, 0, 0],
        upperarm_L: [-0.2, 0, 1.0], forearm_L: [-0.5, 0, 0],
        pos: { root: [0, 0.12, 0], hips: [0, -0.32, 0] },
      }
      const bounce = layer(down, { root: [0.06, 0, 0], head: [0.1, 0, 0], pos: { root: [0, 0.03, 0] } })
      const drop = (t) => t * t
      return keyed([
        { t: 0, pose: ready },
        { t: 0.14, pose: hit },
        { t: 0.5, pose: fall },
        { t: 0.95, pose: down, ease: drop },
        { t: 1.08, pose: bounce },
        { t: 1.4, pose: down },
      ])
    })(),
  },
]
