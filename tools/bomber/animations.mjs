// Animation clips for the Bomber — same structure as the Ember Warden
// (tools/hero/animations.mjs): pose functions of time, baked at 30 fps.
// A pose is { boneName: [rx, ry, rz] } in radians (XYZ Euler, offsets from
// the rest pose), plus optional { pos: { boneName: [dx, dy, dz] } }.
// Sign cheat-sheet (faces +Z, left = +X):
//   limb swings FORWARD  = negative X      knee / shin bends back = positive X
//   lean / nod forward   = positive X      turn toward its left   = positive Y
//   left arm out to side = positive Z      right arm out          = negative Z

const TAU = Math.PI * 2
const sstep = (t) => t * t * (3 - 2 * t)
const clamp01 = (t) => Math.max(0, Math.min(1, t))

/** Base stance: hunched under the hood, bomb held low in the right hand. */
function stance(breath = 0) {
  return {
    hips: [0, 0, 0],
    spine: [0.16 + breath * 0.012, 0, 0],
    chest: [0.06 - breath * 0.015, 0, 0],
    neck: [-0.08, 0, 0],
    head: [-0.06, 0, 0],
    thigh_L: [-0.22, 0, 0.06], shin_L: [0.35, 0, 0], foot_L: [-0.13, 0, -0.06],
    thigh_R: [-0.18, 0, -0.06], shin_R: [0.32, 0, 0], foot_R: [-0.14, 0, 0.06],
    upperarm_R: [0.25, 0, -0.15 - breath * 0.02], forearm_R: [-0.35, 0, 0], hand_R: [0.15, 0, 0],
    upperarm_L: [0.15, 0, 0.18 + breath * 0.02], forearm_L: [-0.55, -0.2, 0], hand_L: [0.1, 0, 0],
    tabard_F: [0, 0, 0],
    cape_1: [0.04, 0, 0], cape_2: [0.03, 0, 0], cape_3: [0.03, 0, 0],
    pos: { hips: [0, -0.06 + breath * 0.004, 0] },
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
        head: [Math.sin(ph * 2) * 0.02, Math.sin(ph) * 0.1, 0],
        chest: [0, Math.sin(ph) * 0.03, 0],
        upperarm_R: [Math.sin(ph + 1) * 0.04, 0, 0], // bomb hand sways
        upperarm_L: [Math.sin(ph + 0.5) * 0.03, 0, 0],
        tabard_F: [Math.sin(ph + 0.6) * 0.03, 0, 0],
        cape_1: [Math.sin(ph - 0.5) * 0.02, 0, 0], cape_2: [Math.sin(ph - 1.2) * 0.035, 0, 0], cape_3: [Math.sin(ph - 2) * 0.05, 0, 0],
      })
    },
  },
  {
    // Shuffling scurry: short quick steps, low crouch, robe swaying.
    name: 'Walk', duration: 0.9, loop: true,
    pose: (t) => {
      const ph = (t / 0.9) * TAU
      const s = Math.sin(ph), c = Math.cos(ph)
      const thighL = -0.42 * s, thighR = 0.42 * s
      const kneeL = 0.25 + 0.55 * Math.pow(Math.max(0, c), 1.4)
      const kneeR = 0.25 + 0.55 * Math.pow(Math.max(0, -c), 1.4)
      const base = stance(0)
      return {
        ...base,
        hips: [0, 0.1 * s, 0.05 * s],
        spine: [0.2, -0.05 * s, -0.03 * s],
        chest: [0.06, -0.1 * s, 0],
        neck: [0, 0.04 * s, 0],
        head: [-0.06 + 0.03 * Math.cos(ph * 2), 0.05 * s, 0],
        thigh_L: [thighL - 0.2, 0, 0.03], shin_L: [kneeL, 0, 0], foot_L: [-(thighL + kneeL) * 0.7, 0, -0.03],
        thigh_R: [thighR - 0.18, 0, -0.03], shin_R: [kneeR, 0, 0], foot_R: [-(thighR + kneeR) * 0.7, 0, 0.03],
        upperarm_L: [0.15 + 0.18 * s, 0, 0.2], forearm_L: [-0.55, -0.2, 0],
        upperarm_R: [0.25 - 0.15 * s, 0, -0.18], forearm_R: [-0.35 - 0.1 * Math.max(0, -s), 0, 0], hand_R: [0.15, 0, 0],
        tabard_F: [Math.min(thighL, thighR) * 0.8 - 0.04, 0, 0],
        cape_1: [0.15 + 0.03 * Math.cos(ph * 2), 0, -0.04 * s], cape_2: [0.08 + 0.05 * Math.sin(ph * 2 - 1), 0, -0.05 * Math.sin(ph - 0.6)],
        cape_3: [0.08 + 0.06 * Math.sin(ph * 2 - 2), 0, -0.06 * Math.sin(ph - 1.2)],
        pos: { hips: [0, -0.07 + 0.02 * Math.cos(ph * 2), 0] },
      }
    },
  },
  {
    // Underhand lob: wind the bomb arm back low, swing forward and up, release.
    name: 'Attack', duration: 0.9, loop: false,
    pose: (() => {
      const ready = stance(0)
      const windup = layer(ready, {
        hips: [0, -0.15, 0], spine: [-0.1, -0.18, 0], chest: [-0.08, -0.22, 0.04], head: [0.06, 0.3, 0],
        upperarm_R: [0.85, 0, -0.3], forearm_R: [-0.15, 0.3, 0], hand_R: [0.3, 0, 0],
        upperarm_L: [-0.2, 0, 0.25], forearm_L: [0.15, 0, 0],
        thigh_L: [-0.3, 0, 0], shin_L: [0.4, 0, 0], thigh_R: [-0.05, 0, 0], shin_R: [0.3, 0, 0],
        pos: { hips: [0, -0.01, -0.04] },
      })
      const lob = layer(ready, {
        hips: [0, 0.2, 0], spine: [0.28, 0.15, 0], chest: [0.1, 0.25, -0.05], head: [-0.18, -0.25, 0],
        upperarm_R: [-1.15, 0, 0.25], forearm_R: [-0.15, -0.15, 0], hand_R: [-0.4, 0, 0],
        upperarm_L: [0.3, 0, 0.1], forearm_L: [0.25, 0, 0],
        thigh_L: [-0.5, 0, 0], shin_L: [0.5, 0, 0], foot_L: [0.1, 0, 0],
        thigh_R: [0.3, 0, 0], shin_R: [0.3, 0, 0], foot_R: [-0.15, 0, 0],
        tabard_F: [-0.3, 0, 0], cape_1: [0.3, 0, 0], cape_2: [0.18, 0, 0], cape_3: [0.12, 0, 0],
        pos: { hips: [0, -0.05, 0.06] },
      })
      const follow = layer(lob, { upperarm_R: [-0.35, 0, 0.1], forearm_R: [-0.4, 0, 0], spine: [0.05, 0, 0], tabard_F: [0.15, 0, 0] })
      const fast = (t) => 1 - Math.pow(1 - t, 3)
      return keyed([
        { t: 0, pose: ready },
        { t: 0.3, pose: windup },
        { t: 0.38, pose: lob, ease: fast },
        { t: 0.52, pose: follow },
        { t: 0.9, pose: ready },
      ])
    })(),
  },
  {
    // Staggers back, crumples to its knees, then topples onto its back.
    name: 'Death', duration: 1.4, loop: false,
    pose: (() => {
      const ready = stance(0)
      const hit = layer(ready, {
        spine: [-0.3, 0.15, 0], chest: [-0.12, 0, 0], head: [-0.3, 0.2, 0],
        upperarm_R: [0.7, 0, -0.5], forearm_R: [0.4, 0, 0], upperarm_L: [0.5, 0, 0.5], forearm_L: [0.6, 0, 0],
        pos: { hips: [0, 0, -0.06] },
      })
      const buckle = layer(ready, {
        spine: [0.3, 0, 0], head: [0.35, 0, 0],
        thigh_L: [-1.1, 0, 0.1], shin_L: [1.7, 0, 0], foot_L: [-0.5, 0, 0],
        thigh_R: [-0.8, 0, -0.1], shin_R: [1.9, 0, 0], foot_R: [-0.9, 0, 0],
        upperarm_R: [0.4, 0, -0.4], forearm_R: [0.5, 0, 0], upperarm_L: [0.3, 0, 0.4], forearm_L: [0.8, 0, 0],
        tabard_F: [-0.3, 0, 0],
        pos: { hips: [0, -0.3, 0.02] },
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
