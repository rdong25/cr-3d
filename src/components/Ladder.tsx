import type { Profile } from '../types'

export default function Ladder({ profile, onBack }: { profile: Profile; onBack: () => void }) {
  const rows = [...profile.rivals.map((r) => ({ name: r.name, trophies: r.trophies, wins: r.wins })), { name: 'You', trophies: profile.trophies, wins: profile.wins }]
    .sort((a, b) => b.trophies - a.trophies)
  return (
    <div className="screen">
      <h1>🏆 Ladder</h1>
      <p className="sub">You against nine arena rivals. Win +30 trophies, lose −20. Rivals drift and level up as you climb.</p>
      <div className="row"><button className="btn ghost" onClick={onBack}>Back</button></div>
      <div className="card" style={{ width: 'min(640px,100%)', marginTop: 12 }}>
        <table><thead><tr><th>#</th><th>Player</th><th>Trophies</th><th>Wins</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={r.name} style={r.name === 'You' ? { background: 'rgba(255,210,61,.14)', fontWeight: 800 } : undefined}>
              <td>{i + 1}</td><td>{r.name}{r.name === 'You' ? ' ⭐' : ''}</td><td>{r.trophies}</td><td>{r.wins}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}
