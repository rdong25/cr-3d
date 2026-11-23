// Synthesized sound effects — no audio files needed.
let ctx: AudioContext | null = null
let enabled = true

export function setSoundEnabled(v: boolean) { enabled = v }
export function isSoundEnabled() { return enabled }

function ac(): AudioContext | null {
  if (!enabled) return null
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch { return null }
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0, delay = 0) {
  const c = ac(); if (!c) return
  const t0 = c.currentTime + delay
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = type; o.frequency.setValueAtTime(freq, t0)
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur)
  g.gain.setValueAtTime(vol, t0)
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
  o.connect(g).connect(c.destination)
  o.start(t0); o.stop(t0 + dur + 0.05)
}

function noise(dur: number, vol: number, freq: number, delay = 0) {
  const c = ac(); if (!c) return
  const t0 = c.currentTime + delay
  const len = Math.floor(c.sampleRate * dur)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const src = c.createBufferSource(); src.buffer = buf
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq
  const g = c.createGain(); g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur)
  src.connect(f).connect(g).connect(c.destination); src.start(t0)
}

export const sfx = {
  deploy() { tone(220, 0.12, 'triangle', 0.18, 180); noise(0.08, 0.1, 1200) },
  hit() { noise(0.07, 0.16, 900); tone(140, 0.07, 'square', 0.08, -60) },
  shoot() { tone(880, 0.08, 'sine', 0.1, -400) },
  fireball() { noise(0.5, 0.28, 600); tone(180, 0.5, 'sawtooth', 0.12, -120) },
  explosion() { noise(0.45, 0.35, 400); tone(70, 0.4, 'sine', 0.25, -30) },
  towerFall() { noise(0.9, 0.4, 300); tone(55, 0.8, 'sine', 0.3, -20); tone(440, 0.3, 'triangle', 0.08, 220, 0.1) },
  crown() { tone(523, 0.15, 'triangle', 0.16); tone(659, 0.15, 'triangle', 0.16, 0, 0.12); tone(784, 0.3, 'triangle', 0.18, 0, 0.24) },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.16, 0, i * 0.13)) },
  lose() { [392, 330, 262].forEach((f, i) => tone(f, 0.3, 'triangle', 0.13, 0, i * 0.16)) },
  click() { tone(660, 0.05, 'sine', 0.08) },
  elixir() { tone(980, 0.06, 'sine', 0.06, 200) }
}
