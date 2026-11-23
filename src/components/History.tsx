import type { Profile } from '../types'

export default function History({ profile, onBack }: { profile: Profile; onBack: () => void }) {
  return (
    <div className="screen">
      <h1>📜 Match History</h1>
      <p className="sub">{profile.matches.length === 0 ? 'No battles yet — go win your first one.' : `${profile.matches.length} recent battle${profile.matches.length === 1 ? '' : 's'}.`}</p>
      <div className="row"><button className="btn ghost" onClick={onBack}>Back</button></div>
      <div className="card" style={{ width: 'min(640px,100%)', marginTop: 12 }}>
        {profile.matches.length === 0 ? <p style={{ opacity: 0.8 }}>Your results will show up here with crowns, opponent and trophy change.</p> : (
          <table><thead><tr><th>Date</th><th>Result</th><th>Crowns</th><th>Opponent</th><th>Trophies</th></tr></thead>
            <tbody>{profile.matches.slice(0, 20).map((m) => (
              <tr key={m.id}>
                <td>{new Date(m.date).toLocaleString()}</td>
                <td>{m.result === 'win' ? '✅ Win' : m.result === 'loss' ? '❌ Loss' : '🤝 Draw'}</td>
                <td>{m.blueCrowns} – {m.redCrowns}</td>
                <td>{m.opponent}</td>
                <td>{m.trophiesDelta > 0 ? `+${m.trophiesDelta}` : m.trophiesDelta}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  )
}
