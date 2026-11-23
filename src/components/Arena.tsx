import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Engine, towerPositions } from '../engine'
import { Game } from '../game'
import type { GameMode, GameEvents } from '../game'
import type { CameraMode, MatchRecord, Profile, TowerState, TroopState } from '../types'
import { sfx } from '../sound'
import { CARDS } from '../cards'

export interface Snapshot {
  timeLeft: number
  elixir: number
  hand: import('../types').CardId[]
  nextCard: import('../types').CardId | null
  selected: import('../types').CardId | null
  blueCrowns: number
  redCrowns: number
  overtime: boolean
  phase: string
  aiElixir: number
  troops: number
}

export interface ArenaHandle {
  deployLane: (lane: -1 | 1) => void
  deployAt: (x: number, z: number) => void
  setCamera: (m: CameraMode) => void
  rideTroop: () => void
  surrender: () => void
  selectCard: (id: import('../types').CardId) => void
  moveFirst: (dx: number, dy: number) => void
  zoom: (factor: number) => void
}

interface Props {
  profile: Profile
  mode: GameMode
  active: boolean
  camera: CameraMode
  onSnapshot: (s: Snapshot) => void
  onBanner: (text: string, sub?: string) => void
  onEnd: (rec: MatchRecord) => void
}

function snapshotOf(g: Game): Snapshot {
  return {
    timeLeft: Math.max(0, Math.ceil(g.timeLeft)),
    elixir: g.elixir,
    hand: [...g.hand],
    nextCard: g.nextCard,
    selected: g.selected,
    blueCrowns: g.blueCrowns,
    redCrowns: g.redCrowns,
    overtime: g.overtime,
    phase: g.phase,
    aiElixir: g.ai.elixir,
    troops: g.troops.length
  }
}

/** Show a frame error on screen (phones have no console) so it can be screenshotted. */
function showFrameError(msg: string) {
  let el = document.getElementById('frameError')
  if (!el) {
    el = document.createElement('div')
    el.id = 'frameError'
    el.style.cssText = 'position:fixed;left:8px;right:8px;bottom:calc(8px + env(safe-area-inset-bottom));z-index:50;background:rgba(150,20,20,.92);color:#fff;font:12px/1.35 ui-monospace,Menlo,monospace;padding:8px 10px;border-radius:10px;pointer-events:none'
    document.body.appendChild(el)
  }
  el.textContent = `Error (please screenshot): ${msg}`
}

const Arena = forwardRef<ArenaHandle, Props>(function Arena({ profile, mode, active, camera, onSnapshot, onBanner, onEnd }, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<Engine | null>(null)
  const gameRef = useRef<Game | null>(null)
  const cbRef = useRef({ onSnapshot, onBanner, onEnd })
  cbRef.current = { onSnapshot, onBanner, onEnd }

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let engine: Engine | null = null
    let game: Game | null = null
    let raf = 0
    let last = performance.now()
    let alive = true

    const events: GameEvents = {
      onUpdate: () => { if (game) cbRef.current.onSnapshot(snapshotOf(game)) },
      onTowerFall: (t: TowerState) => { engine?.setTowerFallen(t.id); engine?.shockwave(t.x, t.z) },
      onTroopAdd: (t: TroopState) => { engine?.addTroop(t) },
      onTroopRemove: (id: number) => { engine?.removeTroop(id) },
      onFireball: (x: number, z: number) => { engine?.shockwave(x, z, 0xff5722); sfx.explosion() },
      onShot: (shot) => { engine?.spawnShot(shot) },
      onEnd: (rec: MatchRecord) => { cbRef.current.onEnd(rec) },
      onBanner: (text: string, sub?: string) => { cbRef.current.onBanner(text, sub) }
    }

    engine = new Engine(container, {
      onDeployAt: (x, z) => { game?.deploySelected(x, z) }
    })
    engine.buildTowers(towerPositions())
    game = new Game(profile, events)
    engineRef.current = engine
    gameRef.current = game
    if (active) {
      game.start(mode)
      cbRef.current.onSnapshot(snapshotOf(game))
    }

    let lastError = ''
    const SIM_STEP = 1 / 60
    let simDebt = 0
    const loop = (now: number) => {
      if (!alive || !engine || !game) return
      // Schedule the next frame first: an exception below must never freeze the
      // match (elixir, timer and troops all stop if the loop dies).
      raf = requestAnimationFrame(loop)
      // Game logic runs on real elapsed time in fixed 1/60 s steps. It used to
      // advance at most 0.05 s per drawn frame, so below 20 fps the whole match
      // (elixir, timer, troops) slowed down. Cap catch-up at 1 s per frame,
      // e.g. after the tab was in the background.
      const dt = Math.max(0, Math.min(1, (now - last) / 1000))
      last = now
      try {
        if (active) {
          simDebt += dt
          while (simDebt >= SIM_STEP) { game.update(SIM_STEP); simDebt -= SIM_STEP }
        }
        const sel = game.selected
        const canPlay = active && game.mode === 'battle' && game.phase === 'playing' && sel != null && game.elixir >= CARDS[sel].cost
        engine.setDeployHint(canPlay ? (sel === 'fireball' ? 'spell' : 'troop') : null)
        engine.render(dt, game.troops, game.towers)
      } catch (err) {
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
        if (msg !== lastError) {
          lastError = msg
          console.error('Frame error', err)
          showFrameError(msg)
        }
      }
    }
    raf = requestAnimationFrame(loop)

    return () => {
      alive = false
      cancelAnimationFrame(raf)
      engine?.dispose()
      engineRef.current = null
      gameRef.current = null
      container.innerHTML = ''
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, active])

  useEffect(() => {
    engineRef.current?.setCameraMode(camera)
  }, [camera])

  useImperativeHandle(ref, () => ({
    deployLane(lane: -1 | 1) {
      const g = gameRef.current
      if (!g || !g.selected) return
      // Spells from the lane buttons hit that lane's enemy princess tower; troops drop at your side of the lane.
      g.deploy(g.selected, 'blue', lane * 4.2, g.selected === 'fireball' ? -8.5 : 6, lane)
    },
    deployAt(x: number, z: number) {
      gameRef.current?.deploySelected(x, z)
    },
    setCamera(m: CameraMode) {
      engineRef.current?.setCameraMode(m)
    },
    rideTroop() {
      const g = gameRef.current
      const e = engineRef.current
      if (!g || !e) return
      const t = [...g.troops].reverse().find((tr) => tr.side === 'blue')
      if (t) e.setRide(t.id)
    },
    surrender() {
      gameRef.current?.surrender()
    },
    selectCard(id) {
      const g = gameRef.current
      if (!g) return
      if (g.hand.includes(id)) { g.selected = id; cbRef.current.onSnapshot(snapshotOf(g)) }
    },
    moveFirst(dx: number, dy: number) {
      engineRef.current?.moveFirst(dx, dy)
    },
    zoom(factor: number) {
      engineRef.current?.zoomBy(factor)
    }
  }), [])

  return <div id="scene" ref={containerRef} />
})

export default Arena
