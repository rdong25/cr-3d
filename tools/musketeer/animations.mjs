// Animation clips for the Musketeer, authored as pose functions of time and
// baked to keyframes at 30 fps.
//
// A pose is { boneName: [rx, ry, rz] } in radians (XYZ Euler, offsets from the
// rest pose), plus optional { pos: { boneName: [dx, dy, dz] } } translations.
//
// Sign cheat-sheet (character faces +Z, left = +X):
//   limb swings FORWARD  = negative X      knee / shin bends back = positive X
//   lean / nod forward   = positive X      turn toward its left   = positive Y
//   left arm out to side = positive Z      right arm out          = negative Z
//
// The musket is rigid to hand_R, its barrel running down-forward across the
// body in the bind pose. Raising the right arm swings the barrel up to level;
// the aim pose counter-rotates the hand so the barrel points straight ahead.

const TAU = Math.PI * 2
const sstep = (t) => t * t * (3 - 2 * t)
const clamp01 = (t) => Math.max(0, Math.min(1, t))

/** Base stance: musket held across the body in both hands, at the ready. */
function stance(breath = 0) {
  return {
    hips: [0, 0, 0],
    spine: [0.04 + breath * 0.012, 0, 0],
    chest: [-0.02 - breath * 0.02, 0, 0],
    neck: [0, 0, 0],
    head: [-0.03, 0, 0],
    thigh_L: [-0.08, 0, 0.06], shin_L: [0.16, 0, 0], foot_L: [-0.08, 0, -0.06],
    thigh_R: [0.05, 0, -0.06], shin_R: [0.12, 0, 0], foot_R: [-0.17, 0, 0.06],
    // Right hand grips the musket at the chest; left hand reaches across to
    // support the barrel.
    upperarm_R: [-0.55, 0, -0.15 - breath * 0.02], forearm_R: [-0.55, 0, 0], hand_R: [0.3, 0, 0],
    upperarm_L: [-0.85, 0, 0.25 + breath * 0.02], forearm_L: [-0.75, 0.3, 0], hand_L: [0.2, 0, 0],
    tabard_F: [0, 0, 0],
    cape_1: [0.04, 0, 0], cape_2: [0.03, 0, 0], cape_3: [0.03, 0, 0],
    pos: { hips: [0, -0.018 + breath * 0.004, 0] },
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
    name: 'Idle', duration: 2.4, loop: true,
    pose: (t) => {
      const ph = (t / 2.4) * TAU
      const b = Math.sin(ph)
      return layer(stance(b), {
        head: [Math.sin(ph * 2) * 0.015, Math.sin(ph) * 0.12, 0],
        chest: [0, Math.sin(ph) * 0.03, 0],
        upperarm_R: [Math.sin(ph + 1) * 0.025, 0, 0],
        upperarm_L: [Math.sin(ph + 1.2) * 0.025, 0, 0],
        tabard_F: [Math.sin(ph + 0.6) * 0.03, 0, 0],
        cape_1: [Math.sin(ph - 0.5) * 0.02, 0, 0], cape_2: [Math.sin(ph - 1.2) * 0.035, 0, Math.sin(ph) * 0.02], cape_3: [Math.sin(ph - 2) * 0.05, 0, Math.sin(ph - 0.8) * 0.03],
      })
    },
  },
  {
    // Steady march, musket held across the body. One cycle = two steps.
    name: 'Walk', duration: 0.9, loop: true,
    pose: (t) => {
      const ph = (t / 0.9) * TAU
      const s = Math.sin(ph), c = Math.cos(ph)
      const thighL = -0.5 * s, thighR = 0.5 * s
      const kneeL = 0.1 + 0.8 * Math.pow(Math.max(0, c), 1.4)
      const kneeR = 0.1 + 0.8 * Math.pow(Math.max(0, -c), 1.4)
      const base = stance(0)
      return {
        ...base,
        hips: [0, 0.12 * s, 0.05 * s],
        spine: [0.1, -0.05 * s, -0.03 * s],
        chest: [-0.02, -0.1 * s, 0],
        neck: [0, 0.04 * s, 0],
        head: [-0.05 + 0.02 * Math.cos(ph * 2), 0.04 * s, 0],
        thigh_L: [thighL, 0, 0.03], shin_L: [kneeL, 0, 0], foot_L: [-(thighL + kneeL) * 0.75, 0, -0.03],
        thigh_R: [thighR, 0, -0.03], shin_R: [kneeR, 0, 0], foot_R: [-(thighR + kneeR) * 0.75, 0, 0.03],
        // Hands stay on the musket; only a small march bob.
        upperarm_L: [-0.85 + 0.06 * s, 0, 0.25], forearm_L: [-0.75, 0.3, 0],
        upperarm_R: [-0.55 - 0.06 * s, 0, -0.15], forearm_R: [-0.55, 0, 0], hand_R: [0.3, 0, 0],
        tabard_F: [Math.min(thighL, thighR) * 0.85 - 0.04, 0, 0],
        cape_1: [0.2 + 0.03 * Math.cos(ph * 2), 0, -0.04 * s], cape_2: [0.1 + 0.06 * Math.sin(ph * 2 - 1), 0, -0.05 * Math.sin(ph - 0.6)],
        cape_3: [0.1 + 0.08 * Math.sin(ph * 2 - 2), 0, -0.07 * Math.sin(ph - 1.2)],
        pos: { hips: [0, -0.028 + 0.022 * Math.cos(ph * 2), 0] },
      }
    },
  },
  {
    // Raise the musket, aim down the barrel, fire (shot lands ~0.5s) with a
    // recoil kick through head and shoulders, then lower.
    name: 'Attack', duration: 0.9, loop: false,
    pose: (() => {
      const ready = stance(0)
      const raise = layer(ready, {
        hips: [0, 0.05, 0], spine: [0.08, 0.06, 0], chest: [0.04, 0.08, 0], head: [-0.06, -0.05, 0],
        upperarm_R: [-1.05, 0, -0.1], forearm_R: [-0.35, 0, 0], hand_R: [0.75, 0, 0],
        upperarm_L: [-1.2, 0, 0.2], forearm_L: [-0.5, 0.2, 0], hand_L: [0.3, 0, 0],
        thigh_L: [-0.16, 0, 0], shin_L: [0.12, 0, 0], thigh_R: [0.12, 0, 0], shin_R: [0.14, 0, 0],
        pos: { hips: [0, -0.01, 0.03] },
      })
      const fire = layer(raise, {
        // Recoil: head and shoulders kick back, musket jumps.
        spine: [-0.22, 0, 0], chest: [-0.14, 0, 0], head: [-0.28, 0, 0],
        upperarm_R: [-0.2, 0, 0], forearm_R: [0.1, 0, 0], hand_R: [0.15, 0, 0],
        upperarm_L: [0.12, 0, 0], forearm_L: [0.1, 0, 0],
        thigh_L: [-0.1, 0, 0], thigh_R: [0.2, 0, 0],
        pos: { hips: [0, -0.02, -0.05] },
      })
      const lower = layer(ready, {
        upperarm_R: [-0.75, 0, -0.12], forearm_R: [-0.45, 0, 0], hand_R: [0.5, 0, 0],
        upperarm_L: [-1.0, 0, 0.22], forearm_L: [-0.6, 0.25, 0],
        head: [-0.1, 0, 0],
      })
      const fast = (t) => 1 - Math.pow(1 - t, 3)
      return keyed([
        { t: 0, pose: ready },
        { t: 0.32, pose: raise },
        { t: 0.5, pose: fire, ease: fast },
        { t: 0.62, pose: lower },
        { t: 0.9, pose: ready },
      ])
    })(),
  },
  {
    // Knocked back, buckles, topples onto its back. Holds the last frame.
    name: 'Death', duration: 1.4, loop: false,
    pose: (() => {
      const ready = stance(0)
      const hit = layer(ready, {
        spine: [-0.35, 0.15, 0], chest: [-0.15, 0, 0], head: [-0.35, 0.2, 0],
        upperarm_R: [0.6, 0, -0.5], forearm_R: [0.5, 0, 0], upperarm_L: [0.5, 0, 0.5], forearm_L: [0.7, 0, 0],
        pos: { hips: [0, 0, -0.06] },
      })
      const buckle = layer(ready, {
        spine: [0.25, 0, 0], head: [0.3, 0, 0],
        thigh_L: [-1.0, 0, 0.1], shin_L: [1.6, 0, 0], foot_L: [-0.5, 0, 0],
        thigh_R: [-0.7, 0, -0.1], shin_R: [1.9, 0, 0], foot_R: [-0.9, 0, 0],
        upperarm_R: [0.3, 0, -0.4], forearm_R: [0.6, 0, 0], upperarm_L: [0.2, 0, 0.4], forearm_L: [0.9, 0, 0],
        tabard_F: [-0.3, 0, 0],
        pos: { hips: [0, -0.26, 0.02] },
      })
      const down = {
        ...stance(0),
        root: [-1.42, 0, 0],
        hips: [0, 0, 0.1], spine: [-0.1, 0, 0], chest: [0, 0, 0], head: [0.25, 0.5, 0],
        thigh_L: [-0.25, 0, 0.12], shin_L: [0.35, 0, 0], foot_L: [0.3, 0, 0],
        thigh_R: [-0.1, 0, -0.1], shin_R: [0.15, 0, 0], foot_R: [0.4, 0, 0],
        upperarm_R: [-0.3, 0, -1.25], forearm_R: [-0.3, 0, 0], hand_R: [0.3, 0, 0],
        upperarm_L: [-0.2, 0, 1.15], forearm_L: [-0.6, 0, 0],
        tabard_F: [0.4, 0, 0], cape_1: [-0.15, 0, 0], cape_2: [-0.1, 0, 0], cape_3: [0, 0, 0],
        pos: { root: [0, 0.22, 0], hips: [0, -0.02, 0] },
      }
      const bounce = layer(down, { root: [0.06, 0, 0], head: [0.12, 0, 0], pos: { root: [0, 0.03, 0] } })
      const fall = (t) => t * t
      return keyed([
        { t: 0, pose: ready },
        { t: 0.14, pose: hit },
        { t: 0.5, pose: buckle },
        { t: 0.95, pose: down, ease: fall },
        { t: 1.08, pose: bounce },
        { t: 1.4, pose: down },
      ])
    })(),
  },
]
