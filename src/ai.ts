import { CARDS } from './cards'
import type { CardId, Profile } from './types'

/** The most advanced enemy push: how dangerous (sum of card cost / 4) and where its lead troop is, in this AI's own coordinates (its towers at negative z). */
export interface Threat {
  level: number
  x: number
  z: number
}

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
    // Same rules as the player: shuffle, hold four, the rest wait in order.
    const shuffled = [...this.deck].sort(() => Math.random() - 0.5)
    this.hand = shuffled.slice(0, 4)
    this.queue = shuffled.slice(4)
  }

  /** The four cards the AI may play right now. */
  hand: CardId[] = []
  /** Cards waiting to be drawn, next first. */
  private queue: CardId[] = []

  /** Called once a card has actually been deployed: it goes to the back of the queue and the next card is drawn. */
  played(cardId: CardId) {
    const i = this.hand.indexOf(cardId)
    if (i < 0) return
    this.hand[i] = this.queue.shift() ?? cardId
    this.queue.push(cardId)
  }

  /**
   * Pick a card to play, or null. The AI only *chooses*: Game.deploy() checks
   * and spends the elixir, so a play that can't happen costs nothing. (It used
   * to subtract here as well, so every play was paid twice and nearly always
   * rejected; the AI almost never got a troop onto the field.)
   */
  update(dt: number, threat: Threat | null, myTroops: number, elixirCap = 10, elixirRate = 1): AIDecision | null {
    // The AI's elixir follows the same clock as the player's: double in the
    // last minute, triple in the final minute of Overtime.
    this.elixir = Math.min(elixirCap, this.elixir + dt * elixirRate * (1 / 2.8))
    this.timer += dt
    if (this.timer < 0.8) return null
    this.timer = 0
    // Only cards in hand can be played, so no card repeats until four others have gone.
    const pick = (ok: (c: CardId) => boolean): CardId | null => {
      const options = this.hand.filter((c) => ok(c) && CARDS[c].cost <= this.elixir)
      return options.length ? options[Math.floor(Math.random() * options.length)] : null
    }
    // Defend: answer troops heading for our towers, in their lane and path.
    if (threat && threat.level >= 0.6) {
      // Prefer a cheap answer; if the hand has none, defend with whatever it can afford.
      const cardId = pick((c) => CARDS[c].cost <= 4) ?? pick(() => true)
      if (cardId) {
        const lane: -1 | 1 = threat.x < 0 ? -1 : 1
        const x = Math.max(-9, Math.min(9, threat.x))
        const z = Math.max(-11, Math.min(-2, threat.z - 3))
        return { cardId, lane, x, z }
      }
      return null // save up rather than starting a push while under attack
    }
    // Attack in a push when elixir is high and we are not outnumbered.
    if (this.elixir >= 7 && myTroops <= 3) {
      const cardId = pick((c) => CARDS[c].cost >= 4)
      if (cardId) {
        const lane: -1 | 1 = Math.random() < 0.5 ? -1 : 1
        return { cardId, lane, x: lane * 4.2, z: -10 }
      }
    }
    if (this.elixir >= 9) {
      const cardId = pick(() => true)
      if (cardId) {
        const lane: -1 | 1 = Math.random() < 0.5 ? -1 : 1
        return { cardId, lane, x: lane * 4.2, z: -9 }
      }
    }
    return null
  }

  hpMultiplier(): number { return 1 + (this.level - 5) * 0.06 }
  damageMultiplier(): number { return 1 + (this.level - 5) * 0.05 }
}
