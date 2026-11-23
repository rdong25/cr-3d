import type { Profile } from '../types'

interface Props {
  profile: Profile
  onBattle: () => void
  onSpectate: () => void
  onDeck: () => void
  onLadder: () => void
  onHistory: () => void
  onReset: () => void
}

export default function Lobby({ profile, onBattle, onSpectate, onDeck, onLadder, onHistory, onReset }: Props) {
  const total = profile.wins + profile.losses + profile.draws
  const winRate = total ? Math.round((profile.wins / total) * 100) : 0
  const rank = [...profile.rivals, { name: 'You', trophies: profile.trophies, wins: profile.wins, level: 0 }]
    .sort((a, b) => b.trophies - a.trophies)
    .findIndex((r) => r.name === 'You') + 1
  return (
    <div className="screen">
      <h1>CLASH ROYALE <span>3D</span></h1>
      <p className="sub">Real-time 3D lane battles in a golden-hour stadium. Build your deck, manage elixir, take the towers — and climb the ladder.</p>
      <div className="row">
        <span className="pill">🏆 {profile.trophies} trophies</span>
        <span className="pill">👑 {profile.crowns} crowns</span>
        <span className="pill">🔥 {profile.streak} streak (best {profile.bestStreak})</span>
        <span className="pill">#{rank} on ladder</span>
        <span className="pill">{profile.wins}W – {profile.losses}L – {profile.draws}D · {winRate}%</span>
      </div>
      <div className="row" style={{ marginTop: 18 }}>
        <button className="btn" onClick={onBattle}>⚔️ Battle</button>
        <button className="btn blue" onClick={onSpectate}>👁️ Spectate AI vs AI</button>
        <button className="btn ghost" onClick={onDeck}>🃏 Deck Builder</button>
        <button className="btn ghost" onClick={onLadder}>🏆 Ladder</button>
        <button className="btn ghost" onClick={onHistory}>📜 History</button>
      </div>
      <div className="grid">
        <div className="card"><b>🎥 First-person spectate</b><p style={{ opacity: 0.85, marginTop: 6, lineHeight: 1.5 }}>In battle, switch to 1st Person: walk with WASD or the joystick, drag to look, click the arena to deploy at the reticle — or Ride a troop.</p></div>
        <div className="card"><b>🃏 Deck &amp; elixir</b><p style={{ opacity: 0.85, marginTop: 6, lineHeight: 1.5 }}>8 cards, 4 in hand. Elixir refills over time — ×2 in the last minute and overtime. Fireball is a spell: it hits anywhere.</p></div>
        <div className="card"><b>🏆 Competitive ladder</b><p style={{ opacity: 0.85, marginTop: 6, lineHeight: 1.5 }}>Win +30, lose −20. Rivals level up as your trophies grow, so the AI gets tougher the higher you climb.</p></div>
        <div className="card"><b>⏱️ 3 minutes + overtime</b><p style={{ opacity: 0.85, marginTop: 6, lineHeight: 1.5 }}>Most crowns wins. Tied at full time? Sudden death — next tower takes the match.</p></div>
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn ghost small" onClick={onReset}>Reset profile</button>
      </div>
      <p style={{ opacity: 0.6, marginTop: 14, fontSize: 13, textAlign: 'center' }}>Progress saves in your browser (localStorage). No account, no backend. Runs on desktop &amp; phone.</p>
    </div>
  )
}
