// Animation clips for the Baby Dragon: Idle / Walk (flying hover) / Attack
// (fire breath) / Death. Pose functions of time, baked to keyframes at 30 fps.
//
// A pose is { boneName: [rx, ry, rz] } in radians (XYZ Euler, offsets from the
// rest pose), plus optional { pos: { boneName: [dx, dy, dz] } } translations.
// The game holds flying troops at y ≈ 1.1; clips bob around feet-at-y=0.
// cape_1/2/3 are the TAIL chain (pointing back, -Z).
//
// Sign cheat-sheet (character faces +Z, left = +X):
//   limb swings FORWARD  = negative X      knee / shin bends back = positive X
//   lean / nod forward   = positive X      turn toward its left   = positive Y
//   left wing tip up     = positive Z (wing_L)   right wing tip up = negative Z (wing_R)
//   tail tip down        = negative X on the cape chain (tail points -Z)

const TAU = Math.PI * 2
const sstep = (t) => t * t * (3 - 2 * t)
const clamp01 = (t) => Math.max(0, Math.min(1, t))

/** Base stance: hovering, wings half-raised, tail drooping slightly, legs tucked. */
function stance(breath = 0) {
  return {
    hips: [0, 0, 0],
    spine: [0.03 + breath * 0.01, 0, 0],
    chest: [-0.02 - breath * 0.015, 0, 0],
    neck: [0.05, 0, 0],
    head: [-0.05, 0, 0],
    wing_L: [0, 0, 0.3 + breath * 0.05],
    wing_R: [0, 0, -0.3 - breath * 0.05],
    cape_1: [-0.05, 0, 0], cape_2: [-0.08, 0, 0], cape_3: [-0.05, 0, 0],
    thigh_L: [-0.35, 0, 0.06], shin_L: [0.7, 0, 0], foot_L: [-0.3, 0, 0],
    thigh_R: [-0.3, 0, -0.06], shin_R: [0.65, 0, 0], foot_R: [-0.3, 0, 0],
    upperarm_R: [-0.6, 0, -0.3], forearm_R: [-0.7, 0, 0], hand_R: [0, 0, 0],
    upperarm_L: [-0.6, 0, 0.3], forearm_L: [-0.7, 0, 0], hand_L: [0, 0, 0],
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
    // Gentle hover: slow wing beats, bobbing, tail swaying, head looking around.
    name: 'Idle', duration: 2.4, loop: true,
    pose: (t) => {
      const ph = (t / 2.4) * TAU
      const b = Math.sin(ph)
      const flap = Math.sin(ph * 2) * 0.16
      const sway = Math.sin(ph) * 0.12
      return layer(stance(b), {
        head: [Math.sin(ph * 2) * 0.02, Math.sin(ph) * 0.22, 0],
        chest: [0, Math.sin(ph) * 0.03, 0],
        wing_L: [Math.sin(ph) * 0.06, 0, flap],
        wing_R: [Math.sin(ph) * 0.06, 0, -flap],
        cape_1: [0, sway, 0], cape_2: [0, sway * 1.4, Math.sin(ph - 0.6) * 0.04], cape_3: [0, sway * 1.8, Math.sin(ph - 1.2) * 0.05],
        pos: { hips: [0, 0.025 * b, 0] },
      })
    },
  },
  {
    // Flying hover: fast wing beats, bob up/down, tail swaying, legs trailing.
    name: 'Walk', duration: 0.9, loop: true,
    pose: (t) => {
      const ph = (t / 0.9) * TAU
      const s = Math.sin(ph), c = Math.cos(ph)
      const flap = 0.5 * s
      const sway = 0.14 * Math.sin(ph - 0.8)
      const base = stance(0)
      return {
        ...base,
        hips: [0.04 * s, 0, 0.03 * s],
        spine: [0.1, -0.05 * s, 0],
        chest: [0.04, 0, 0],
        neck: [0.08, 0, 0],
        head: [-0.1 + 0.03 * c, 0, 0],
        wing_L: [0.08 * c, 0, 0.3 + flap],
        wing_R: [0.08 * c, 0, -0.3 - flap],
        cape_1: [-0.02, sway, 0], cape_2: [-0.04, sway * 1.4, 0], cape_3: [-0.02, sway * 1.8, 0],
        thigh_L: [-0.45 + 0.1 * s, 0, 0.06], shin_L: [0.8, 0, 0], foot_L: [-0.3, 0, 0],
        thigh_R: [-0.45 - 0.1 * s, 0, -0.06], shin_R: [0.8, 0, 0], foot_R: [-0.3, 0, 0],
        upperarm_L: [-0.75 + 0.1 * s, 0, 0.35], forearm_L: [-0.6, 0, 0],
        upperarm_R: [-0.75 - 0.1 * s, 0, -0.35], forearm_R: [-0.6, 0, 0],
        pos: { hips: [0, 0.06 + 0.05 * c, 0.02 * s] },
      }
    },
  },
  {
    // Fire breath: rear back, then head lunges forward/down, wings spread wide.
    name: 'Attack', duration: 0.9, loop: false,
    pose: (() => {
      const ready = stance(0)
      const windup = layer(ready, {
        hips: [0, -0.15, 0], spine: [-0.12, -0.15, 0], chest: [-0.1, -0.2, 0], neck: [-0.15, 0, 0], head: [-0.25, 0.25, 0],
        wing_L: [0, 0, -0.1], wing_R: [0, 0, 0.1],
        cape_1: [0.1, 0, 0], cape_2: [0.08, 0, 0],
        upperarm_R: [-0.3, 0, -0.5], forearm_R: [-0.9, 0, 0],
        upperarm_L: [-0.3, 0, 0.5], forearm_L: [-0.9, 0, 0],
        pos: { hips: [0, 0.03, -0.05] },
      })
      const breath = layer(ready, {
        hips: [0, 0.2, 0], spine: [0.22, 0.12, 0], chest: [0.18, 0.15, 0], neck: [0.3, 0, 0], head: [0.45, -0.15, 0],
        wing_L: [0, 0, 0.75], wing_R: [0, 0, -0.75],
        cape_1: [-0.15, 0, 0], cape_2: [-0.1, 0, 0], cape_3: [-0.08, 0, 0],
        upperarm_R: [-1.0, 0, -0.4], forearm_R: [-0.3, 0, 0],
        upperarm_L: [-1.0, 0, 0.4], forearm_L: [-0.3, 0, 0],
        thigh_L: [-0.6, 0, 0], shin_L: [0.9, 0, 0],
        thigh_R: [-0.2, 0, 0], shin_R: [0.7, 0, 0],
        pos: { hips: [0, 0.0, 0.1] },
      })
      const follow = layer(breath, { head: [0.1, 0, 0], neck: [0.05, 0, 0], spine: [0.04, 0, 0] })
      const fast = (t) => 1 - Math.pow(1 - t, 3)
      return keyed([
        { t: 0, pose: ready },
        { t: 0.3, pose: windup },
        { t: 0.38, pose: breath, ease: fast },
        { t: 0.55, pose: follow },
        { t: 0.9, pose: ready },
      ])
    })(),
  },
  {
    // Hit, wings fold, crashes down nose-first, ends sprawled on the ground.
    name: 'Death', duration: 1.4, loop: false,
    pose: (() => {
      const ready = stance(0)
      const hit = layer(ready, {
        spine: [-0.3, 0.15, 0], chest: [-0.15, 0, 0], neck: [-0.2, 0, 0], head: [-0.35, 0.2, 0],
        wing_L: [0, 0, -0.45], wing_R: [0, 0, 0.45],
        cape_1: [0.15, 0, 0], cape_2: [0.1, 0, 0],
        upperarm_R: [0.5, 0, -0.6], forearm_R: [0.5, 0, 0], upperarm_L: [0.4, 0, 0.6], forearm_L: [0.6, 0, 0],
        pos: { hips: [0, 0.04, -0.05] },
      })
      const crash = layer(ready, {
        spine: [0.35, 0, 0], chest: [0.2, 0, 0], neck: [0.35, 0, 0], head: [0.4, 0, 0],
        wing_L: [0, 0, -0.55], wing_R: [0, 0, 0.55],
        cape_1: [0.2, 0, 0], cape_2: [0.15, 0, 0], cape_3: [0.1, 0, 0],
        thigh_L: [-0.7, 0, 0.1], shin_L: [1.0, 0, 0],
        thigh_R: [-0.5, 0, -0.1], shin_R: [1.2, 0, 0],
        upperarm_R: [0.3, 0, -0.5], forearm_R: [0.6, 0, 0], upperarm_L: [0.2, 0, 0.5], forearm_L: [0.8, 0, 0],
        pos: { hips: [0, -0.28, 0.03] },
      })
      const down = {
        ...stance(0),
        root: [-1.35, 0, 0.2],
        hips: [0, 0, 0.1], spine: [-0.08, 0, 0], chest: [0, 0, 0], neck: [0.1, 0, 0], head: [0.2, 0.4, 0],
        wing_L: [0, 0, -0.1], wing_R: [0, 0, 0.1],
        cape_1: [0.1, 0, 0], cape_2: [0.05, 0, 0], cape_3: [0, 0, 0],
        thigh_L: [-0.2, 0, 0.12], shin_L: [0.3, 0, 0], foot_L: [0.25, 0, 0],
        thigh_R: [-0.1, 0, -0.1], shin_R: [0.15, 0, 0], foot_R: [0.3, 0, 0],
        upperarm_R: [-0.3, 0, -1.0], forearm_R: [-0.3, 0, 0],
        upperarm_L: [-0.2, 0, 1.0], forearm_L: [-0.5, 0, 0],
        pos: { root: [0, 0.18, 0], hips: [0, -0.3, 0] },
      }
      const bounce = layer(down, { root: [0.06, 0, 0], head: [0.1, 0, 0], pos: { root: [0, 0.03, 0] } })
      const drop = (t) => t * t
      return keyed([
        { t: 0, pose: ready },
        { t: 0.14, pose: hit },
        { t: 0.5, pose: crash },
        { t: 0.95, pose: down, ease: drop },
        { t: 1.08, pose: bounce },
        { t: 1.4, pose: down },
      ])
    })(),
  },
]
