import { CARDS } from './cards'
import type { CardId, Profile } from './types'

export interface AIDecision {
  cardId: CardId
  lane: -1 | 1
  x: number
  z: number
}

// Rival AI: defends when threatened, attacks in pushes, saves elixir for
// big cards, and levels up as the player's trophies grow.
export class RivalAI {
  name: string
  level: number
  elixir = 5
  private timer = 0
  private deck: CardId[]

  constructor(profile: Profile) {
    const rival = profile.rivals[Math.floor(Math.random() * profile.rivals.length)]
    this.name = rival?.name ?? 'Vex'
    this.level = Math.max(1, Math.min(13, 5 + Math.floor((profile.trophies - 1000) / 220)))
    this.deck = ['knight', 'archers', 'giant', 'musketeer', 'minions', 'bomber', 'prince', 'dragon']
  }

  update(dt: number, threat: number, myTroops: number, elixirCap = 10): AIDecision | null {
    this.elixir = Math.min(elixirCap, this.elixir + dt * (1 / 2.8))
    this.timer += dt
    if (this.timer < 1.2) return null
    this.timer = 0
    // Defend hard when blue troops are close to red towers.
    if (threat > 0.45 && this.elixir >= 3) {
      const cheap = this.deck.filter((c) => CARDS[c].cost <= this.elixir && CARDS[c].cost <= 4)
      if (cheap.length) {
        const cardId = cheap[Math.floor(Math.random() * cheap.length)]
        this.elixir -= CARDS[cardId].cost
        const lane = Math.random() < 0.5 ? -1 : 1
        return { cardId, lane, x: lane * 4.2, z: -6 }
      }
    }
    // Attack in a push when elixir is high and we are not outnumbered.
    if (this.elixir >= 7 && myTroops <= 3) {
      const big = this.deck.filter((c) => CARDS[c].cost >= 4 && CARDS[c].cost <= this.elixir)
      if (big.length) {
        const cardId = big[Math.floor(Math.random() * big.length)]
        this.elixir -= CARDS[cardId].cost
        const lane = Math.random() < 0.5 ? -1 : 1
        return { cardId, lane, x: lane * 4.2, z: -10 }
      }
    }
    if (this.elixir >= 9) {
      const affordable = this.deck.filter((c) => CARDS[c].cost <= this.elixir)
      const cardId = affordable[Math.floor(Math.random() * affordable.length)]
      this.elixir -= CARDS[cardId].cost
      const lane = Math.random() < 0.5 ? -1 : 1
      return { cardId, lane, x: lane * 4.2, z: -9 }
    }
    return null
  }

  hpMultiplier(): number { return 1 + (this.level - 5) * 0.06 }
  damageMultiplier(): number { return 1 + (this.level - 5) * 0.05 }
}
