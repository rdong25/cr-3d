import { useCallback, useRef, useState } from 'react'
import Arena, { type ArenaHandle, type Snapshot } from './components/Arena'
import Lobby from './components/Lobby'
import DeckBuilder from './components/DeckBuilder'
import Ladder from './components/Ladder'
import History from './components/History'
import Hud from './components/Hud'
import { loadProfile, saveProfile, resetProfile } from './storage'
import { setSoundEnabled } from './sound'
import type { CameraMode, CardId, MatchRecord, Profile } from './types'

type Screen = 'lobby' | 'deck' | 'ladder' | 'history' | 'battle'
type BattleMode = 'battle' | 'spectate'

const AI_REPLIES = ['😂 Ha!', '👍 Good game!', '😮 Wow!', '👑 For the crown!']

export default function App() {
  const [profile, setProfile] = useState<Profile>(() => loadProfile())
  const [screen, setScreen] = useState<Screen>('lobby')
  const [battleMode, setBattleMode] = useState<BattleMode>('battle')
  const [battleKey, setBattleKey] = useState(0)
  const [camera, setCamera] = useState<CameraMode>('broadcast')
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [banner, setBanner] = useState<{ text: string; sub?: string } | null>(null)
  const [emotes, setEmotes] = useState<string[]>([])
  const [result, setResult] = useState<MatchRecord | null>(null)
  const [sound, setSound] = useState(true)
  const arenaRef = useRef<ArenaHandle>(null)
  const bannerTimer = useRef<number | undefined>(undefined)

  const showBanner = useCallback((text: string, sub?: string) => {
    setBanner({ text, sub })
    window.clearTimeout(bannerTimer.current)
    bannerTimer.current = window.setTimeout(() => setBanner(null), 2200)
  }, [])

  const startBattle = (mode: BattleMode) => {
    setResult(null)
    setBattleMode(mode)
    setCamera('broadcast')
    setBattleKey((k) => k + 1)
    setScreen('battle')
  }

  const handleEnd = useCallback((rec: MatchRecord) => {
    // Game already mutated the profile object (trophies / W-L / rivals).
    setProfile((p) => {
      saveProfile(p)
      return { ...p, matches: [...p.matches], rivals: [...p.rivals] }
    })
    setResult(rec)
  }, [])

  const handleEmote = (e: string) => {
    setEmotes((list) => [...list.slice(-2), `You: ${e}`])
    window.setTimeout(() => {
      const reply = AI_REPLIES[Math.floor(Math.random() * AI_REPLIES.length)]
      setEmotes((list) => [...list.slice(-2), `Rival: ${reply}`])
    }, 1100)
  }

  const saveDeck = (deck: CardId[]) => {
    setProfile((p) => {
      const next = { ...p, deck }
      saveProfile(next)
      return next
    })
    setScreen('lobby')
  }

  const doReset = () => {
    if (!window.confirm('Reset trophies, record and history?')) return
    setProfile(resetProfile())
  }

  const toggleSound = () => {
    setSound((s) => {
      setSoundEnabled(!s)
      return !s
    })
  }

  return (
    <div id="app">
      {/* Arena stays mounted so the stadium is the backdrop for every screen. */}
      <Arena
        key={battleKey}
        ref={arenaRef}
        profile={profile}
        mode={battleMode}
        active={screen === 'battle'}
        camera={camera}
        onSnapshot={setSnap}
        onBanner={showBanner}
        onEnd={handleEnd}
      />
      <div id="vignette" />
      <div id="grain" />
      <div id="ui">
        {screen === 'lobby' && (
          <Lobby
            profile={profile}
            onBattle={() => startBattle('battle')}
            onSpectate={() => startBattle('spectate')}
            onDeck={() => setScreen('deck')}
            onLadder={() => setScreen('ladder')}
            onHistory={() => setScreen('history')}
            onReset={doReset}
          />
        )}
        {screen === 'deck' && <DeckBuilder profile={profile} onSave={saveDeck} onBack={() => setScreen('lobby')} />}
        {screen === 'ladder' && <Ladder profile={profile} onBack={() => setScreen('lobby')} />}
        {screen === 'history' && <History profile={profile} onBack={() => setScreen('lobby')} />}
        {screen === 'battle' && snap && (
          <Hud
            snap={snap}
            camera={camera}
            mode={battleMode}
            banner={banner}
            emotes={emotes}
            onCamera={setCamera}
            onSelect={(id) => arenaRef.current?.selectCard(id)}
            onDeployLane={(lane) => arenaRef.current?.deployLane(lane)}
            onRide={() => arenaRef.current?.rideTroop()}
            onSurrender={() => arenaRef.current?.surrender()}
            onExit={() => { setResult(null); setScreen('lobby') }}
            onEmote={handleEmote}
            onJoystick={(dx, dy) => arenaRef.current?.moveFirst(dx, dy)}
            onZoom={(f) => arenaRef.current?.zoom(f)}
            sound={sound}
            onToggleSound={toggleSound}
          />
        )}
        {screen === 'battle' && result && (
          <div className="screen" style={{ background: 'rgba(6,10,32,.72)', justifyContent: 'center' }}>
            <div className="card" style={{ textAlign: 'center', minWidth: 'min(420px,90vw)' }}>
              <h1 style={{ fontSize: 36 }}>{result.result === 'win' ? '🏆 Victory!' : result.result === 'loss' ? '💔 Defeat' : '🤝 Draw'}</h1>
              <p className="sub" style={{ margin: '10px auto' }}>
                Crowns {result.blueCrowns} – {result.redCrowns} vs {result.opponent}
                {battleMode === 'battle' && <> · Trophies {result.trophiesDelta > 0 ? `+${result.trophiesDelta}` : result.trophiesDelta}</>}
              </p>
              <p style={{ fontWeight: 800 }}>🏆 {profile.trophies} trophies · {profile.wins}W – {profile.losses}L</p>
              <div className="row" style={{ marginTop: 16 }}>
                <button className="btn" onClick={() => startBattle(battleMode)}>Rematch</button>
                <button className="btn ghost" onClick={() => { setResult(null); setScreen('lobby') }}>Lobby</button>
              </div>
            </div>
          </div>
        )}
        {screen !== 'battle' && <button
          className="btn ghost small"
          onClick={toggleSound}
          style={{ position: 'absolute', bottom: 12, right: 12 }}
          aria-label="Toggle sound"
        >
          {sound ? '🔊 Sound on' : '🔇 Muted'}
        </button>}
      </div>
    </div>
  )
}
