import { useState } from 'react'
import { ALL_CARDS } from '../cards'
import CardFace from './CardFace'
import type { CardId, Profile } from '../types'

interface Props {
  profile: Profile
  onSave: (deck: CardId[]) => void
  onBack: () => void
}

export default function DeckBuilder({ profile, onSave, onBack }: Props) {
  const [deck, setDeck] = useState<CardId[]>([...profile.deck])
  const toggle = (id: CardId) => {
    setDeck((d) => {
      if (d.includes(id)) {
        if (d.length <= 1) return d
        return d.filter((c) => c !== id)
      }
      if (d.length >= 8) return d
      return [...d, id]
    })
  }
  const avg = deck.length ? (deck.reduce((s, id) => s + ALL_CARDS.find((c) => c.id === id)!.cost, 0) / deck.length).toFixed(1) : '—'
  return (
    <div className="screen">
      <h1>Deck Builder</h1>
      <p className="sub">Pick exactly 8 cards. Tap a card to add or remove it. Average elixir: <b>{avg}</b></p>
      <div className="row">
        <span className="pill">{deck.length} / 8 cards</span>
        <button className="btn" disabled={deck.length !== 8} onClick={() => onSave(deck)}>Save deck</button>
        <button className="btn ghost" onClick={onBack}>Back</button>
      </div>
      {deck.length !== 8 && <p style={{ color: '#ffd23d', marginTop: 10 }}>Your deck needs exactly 8 cards to battle.</p>}
      <div className="grid">
        {ALL_CARDS.map((c) => {
          const sel = deck.includes(c.id)
          return (
            <button key={c.id} className={`deckcard ${sel ? 'sel' : ''}`} onClick={() => toggle(c.id)}>
              <CardFace id={c.id} size="deck" />
              <b>{c.name}</b>
              <span className={`rar ${c.rarity}`}>{c.rarity}</span>
              <small>{c.desc}</small>
              <small style={{ opacity: 0.65 }}>HP {c.hp || '—'} · DMG {c.damage} · {c.count ? `×${c.count}` : 'Spell'}</small>
            </button>
          )
        })}
      </div>
    </div>
  )
}
