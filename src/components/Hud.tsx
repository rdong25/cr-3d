import { useRef, useState } from 'react'
import { CARDS } from '../cards'
import CardFace from './CardFace'
import type { CameraMode, CardId } from '../types'
import type { Snapshot } from './Arena'

interface Props {
  snap: Snapshot
  camera: CameraMode
  mode: 'battle' | 'spectate'
  banner: { text: string; sub?: string } | null
  emotes: string[]
  onCamera: (m: CameraMode) => void
  onSelect: (id: CardId) => void
  onDeployLane: (lane: -1 | 1) => void
  onRide: () => void
  onSurrender: () => void
  onExit: () => void
  onEmote: (e: string) => void
  onJoystick: (dx: number, dy: number) => void
  onZoom: (factor: number) => void
  sound: boolean
  onToggleSound: () => void
}

const EMOTES = ['👋 Hi!', '😂 Ha!', '😮 Wow!', '👍 Good game!', '😡 Argh!', '👑 For the crown!']
const CAM_LABEL: Record<CameraMode, string> = { broadcast: '📺 Broadcast', orbit: '🎥 Orbit', first: '🧍 1st Person', ride: '🏇 Ride troop' }

export default function Hud({ snap, camera, mode, banner, emotes, onCamera, onSelect, onDeployLane, onRide, onSurrender, onExit, onEmote, onJoystick, onZoom, sound, onToggleSound }: Props) {
  const joyRef = useRef<HTMLDivElement>(null)
  // On phones the camera and emote columns collapse behind one button each (see styles.css).
  const [camsOpen, setCamsOpen] = useState(false)
  const [emotesOpen, setEmotesOpen] = useState(false)
  const mm = Math.floor(snap.timeLeft / 60)
  const ss = String(snap.timeLeft % 60).padStart(2, '0')
  const elixirPct = Math.min(100, (snap.elixir / 10) * 100)

  const joyMove = (e: React.PointerEvent) => {
    const el = joyRef.current
    if (!el || e.buttons === 0) return
    const r = el.getBoundingClientRect()
    const dx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1))
    const dy = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1))
    onJoystick(dx, dy)
    const knob = el.querySelector<HTMLElement>('#joyKnob')
    if (knob) knob.style.transform = `translate(${dx * 28}px, ${dy * 28}px)`
  }

  return (
    <div id="hud">
      <div className="top">
        <div className="row">
          <span className="pill">👑 You {snap.blueCrowns} – {snap.redCrowns} Rival</span>
          <span className="pill" id="timer">{snap.overtime ? 'OT ' : ''}{mm}:{ss}{snap.timeLeft < 60 && !snap.overtime ? ' ×2' : ''}</span>
          <span className="pill">👥 {snap.troops} troops</span>
        </div>
        <div className="row">
          <button className="btn ghost small" onClick={onExit}>Lobby</button>
          {mode === 'battle' && <button className="btn ghost small" onClick={onSurrender}>Surrender</button>}
          <button className="btn ghost small" onClick={onToggleSound} aria-label="Toggle sound">{sound ? '🔊' : '🔇'}</button>
        </div>
      </div>

      <div className="mid">
        {banner && <div><div id="banner">{banner.text}</div><div id="bannerSub">{banner.sub ?? ''}</div></div>}
        {emotes.length > 0 && <div id="toast">{emotes[emotes.length - 1]}</div>}
        {camera === 'first' && <div id="reticle">◎</div>}
      </div>

      <div>
        <div id="camBar" className={camsOpen ? 'open' : ''}>
          <button className="btn small panelToggle" aria-label="Camera" onClick={() => setCamsOpen((o) => !o)}>{CAM_LABEL[camera].split(' ')[0]} ▾</button>
          <div className="panelList">
            {(['broadcast', 'orbit', 'first'] as CameraMode[]).map((m) => (
              <button key={m} className={`btn small ${camera === m ? '' : 'ghost'}`} onClick={() => { onCamera(m); setCamsOpen(false) }}>
                {CAM_LABEL[m]}
              </button>
            ))}
            <button className="btn small ghost" onClick={() => { onRide(); setCamsOpen(false) }}>🏇 Ride troop</button>
          </div>
          {(camera === 'broadcast' || camera === 'orbit') && (
            <div className="zoomRow">
              <button className="btn small ghost" aria-label="Zoom out" onClick={() => onZoom(1.2)}>➖</button>
              <button className="btn small ghost" aria-label="Zoom in" onClick={() => onZoom(1 / 1.2)}>➕</button>
            </div>
          )}
        </div>
        <div id="emoteBar" className={emotesOpen ? 'open' : ''}>
          <button className="btn ghost small panelToggle" aria-label="Emotes" onClick={() => setEmotesOpen((o) => !o)}>😀</button>
          <div className="panelList">
            {EMOTES.map((e) => <button key={e} className="btn ghost small" onClick={() => { onEmote(e); setEmotesOpen(false) }}>{e.split(' ')[0]}</button>)}
          </div>
        </div>
        {camera === 'first' && (
          <div id="joy" ref={joyRef} onPointerMove={joyMove} onPointerDown={joyMove}>
            <div id="joyKnob" />
          </div>
        )}
        {mode === 'battle' ? (
          <div id="handDock">
            <div id="elixirWrap">
              <span id="elixirCount" className={snap.elixir >= 10 ? 'full' : ''}>{Math.floor(snap.elixir)}</span>
              <div id="elixirBar"><div id="elixirFill" className={snap.elixir >= 10 ? 'full' : ''} style={{ width: `${elixirPct}%` }} /></div>
              {snap.nextCard && (
                <div id="nextCard">
                  <small>Next</small>
                  <CardFace id={snap.nextCard} size="mini" />
                </div>
              )}
            </div>
            <div id="hand">
              {snap.hand.map((id) => (
                <CardFace key={id} id={id} selected={snap.selected === id} disabled={snap.elixir < CARDS[id].cost} onClick={() => onSelect(id)} />
              ))}
            </div>
            <div id="deployHint">Tap a card, then tap your side of the arena · pinch to zoom</div>
          </div>
        ) : (
          <div className="row" style={{ padding: 12 }}><span className="pill">👁️ Spectating — both sides are AI. Switch cameras to watch up close.</span></div>
        )}
      </div>
    </div>
  )
}
