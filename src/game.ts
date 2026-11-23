import { CARDS } from './cards'
import type { Threat } from './ai'
import { RivalAI } from './ai'
import { sfx } from './sound'
import type { CardId, MatchRecord, Profile, Side, TowerState, TroopState } from './types'
import { towerPositions, type Shot } from './engine'

export type GamePhase = 'idle' | 'playing' | 'over'
export type GameMode = 'battle' | 'spectate'

export interface GameEvents {
  onUpdate: () => void
  onTowerFall: (t: TowerState) => void
  onTroopAdd: (t: TroopState) => void
  onTroopRemove: (id: number) => void
  onFireball: (x: number, z: number) => void
  /** A ranged attacker fired: the engine flies a visible projectile. Damage is applied instantly by the game; the shot is the visual. */
  onShot: (shot: Shot) => void
  onEnd: (r: MatchRecord) => void
  onBanner: (text: string, sub?: string) => void
}

let nextId = 1

export class Game {
  profile: Profile
  mode: GameMode = 'battle'
  phase: GamePhase = 'idle'
  troops: TroopState[] = []
  towers: TowerState[] = towerPositions()
  elixir = 5
  elixirMax = 10
  timeLeft = 180
  overtime = false
  /** After Overtime expires with no tower down: every tower drains until the lowest-HP one falls. */
  tiebreaker = false
  blueCrowns = 0
  redCrowns = 0
  hand: CardId[] = []
  deckQueue: CardId[] = []
  nextCard: CardId | null = null
  selected: CardId | null = null
  ai: RivalAI
  spectateAI: RivalAI | null = null
  blueElixir = 5
  private aiTimer = 0
  private events: GameEvents

  constructor(profile: Profile, events: GameEvents) {
    this.profile = profile
    this.events = events
    this.ai = new RivalAI(profile)
  }

  start(mode: GameMode = 'battle') {
    this.mode = mode
    this.phase = 'playing'
    this.troops = []
    this.towers = towerPositions()
    this.elixir = 5; this.blueElixir = 5
    this.timeLeft = 180; this.overtime = false; this.tiebreaker = false
    this.blueCrowns = 0; this.redCrowns = 0
    this.ai = new RivalAI(this.profile)
    this.spectateAI = mode === 'spectate' ? new RivalAI(this.profile) : null
    // Shuffle deck into hand of 4 + queue.
    const deck = [...this.profile.deck]
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]] }
    this.hand = deck.slice(0, 4)
    this.deckQueue = deck.slice(4)
    this.nextCard = this.deckQueue[0] ?? null
    this.selected = this.hand[0] ?? null
    this.events.onBanner(mode === 'spectate' ? 'AI vs AI — Spectate' : 'Battle start!', mode === 'spectate' ? 'Two rivals fight. Sit back and watch.' : 'Destroy more towers than your rival.')
    sfx.crown()
    this.events.onUpdate()
  }

  deploy(cardId: CardId, side: Side, x: number, z: number, lane: -1 | 1): boolean {
    if (this.phase !== 'playing') return false
    const def = CARDS[cardId]
    if (side === 'blue' && this.mode === 'battle') {
      if (this.elixir < def.cost) return false
      // Troops deploy on your own half — unless you took the enemy Princess
      // Tower in this lane, which annexes the ground past the bridge there.
      if (cardId !== 'fireball' && z < this.blueDeployMinZ(lane)) return false
      this.elixir -= def.cost
    }
    if (side === 'red') {
      if (this.ai.elixir < def.cost) return false
      if (cardId !== 'fireball' && z > this.redDeployMaxZ(lane)) return false
      this.ai.elixir -= def.cost
    }
    if (cardId === 'fireball') {
      this.events.onFireball(x, z)
      sfx.fireball()
      this.damageArea(x, z, def.damage, side)
      this.afterDeploy(side, cardId)
      return true
    }
    const mult = side === 'red' ? this.ai.hpMultiplier() : 1
    const dmgMult = side === 'red' ? this.ai.damageMultiplier() : 1
    for (let i = 0; i < def.count; i++) {
      const t: TroopState = {
        id: nextId++, cardId, side,
        x: x + (i - (def.count - 1) / 2) * 0.9,
        z: z + (i % 2) * 0.7,
        lane, hp: def.hp * mult, maxHp: def.hp * mult,
        targetId: null, attackCd: 0, walkPhase: Math.random() * 6,
        flying: !!def.flying, dead: false
      }
      void dmgMult
      this.troops.push(t)
      this.events.onTroopAdd(t)
    }
    sfx.deploy()
    this.afterDeploy(side, cardId)
    return true
  }

  private afterDeploy(side: Side, cardId: CardId) {
    if (side !== 'blue' || this.mode !== 'battle') return
    const idx = this.hand.indexOf(cardId)
    if (idx >= 0) {
      this.hand[idx] = this.deckQueue.shift() ?? cardId
      this.deckQueue.push(cardId)
      this.nextCard = this.deckQueue[0] ?? null
      this.selected = this.hand[0] ?? null
    }
    this.events.onUpdate()
  }

  /** Lowest z blue may deploy troops in a lane: its own half (0.5), or past the bridge (-7) once it has taken that lane's red Princess Tower (the annexed ground). */
  private blueDeployMinZ(lane: -1 | 1): number {
    const guard = this.towers.find((t) => t.side === 'red' && t.kind === 'princess' && t.lane === lane)
    return guard && !guard.alive ? -7 : 0.5
  }
  /** Highest z red may deploy troops in a lane: its own half (-0.5), or past the bridge (7) once it has taken that lane's blue Princess Tower. */
  private redDeployMaxZ(lane: -1 | 1): number {
    const guard = this.towers.find((t) => t.side === 'blue' && t.kind === 'princess' && t.lane === lane)
    return guard && !guard.alive ? 7 : -0.5
  }

  /** Deploy the selected card at a tapped arena point. Troops snap onto your half (or the annexed ground past the bridge); spells land where tapped. */
  deploySelected(x: number, z: number): boolean {
    if (!this.selected) return false
    const lane: -1 | 1 = x < 0 ? -1 : 1
    const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
    if (this.selected === 'fireball') return this.deploy('fireball', 'blue', clamp(x, -11, 11), clamp(z, -14, 14), lane)
    return this.deploy(this.selected, 'blue', clamp(x, -10, 10), clamp(z, this.blueDeployMinZ(lane), 13), lane)
  }

  private damageArea(x: number, z: number, dmg: number, side: Side) {
    for (const t of this.troops) {
      if (t.side === side) continue
      const d = Math.hypot(t.x - x, t.z - z)
      if (d < 2.5) { t.hp -= dmg; if (t.hp <= 0) this.kill(t) }
    }
    for (const tw of this.towers) {
      if (tw.side === side || !tw.alive) continue
      const d = Math.hypot(tw.x - x, tw.z - z)
      // Towers take 65% reduced damage from spells (Fireball hits a tower for 35% of 572 = 200).
      if (d < 2.5) this.damageTower(tw, dmg * 0.35)
    }
    setTimeout(() => sfx.explosion(), 350)
  }

  /** Fire a visible projectile for a ranged attack (range > 1.5). Melee troops have no ammo. */
  private emitShot(t: TroopState, target: TroopState | TowerState) {
    const def = CARDS[t.cardId]
    if (def.range <= 1.5) return
    const kind = t.cardId === 'archers' ? 'arrow' : t.cardId === 'musketeer' ? 'bullet' : t.cardId === 'bomber' ? 'bomb' : 'fire'
    const isTower = 'kind' in target
    this.events.onShot({
      kind,
      from: { x: t.x, y: t.flying ? 1.7 : 1.4, z: t.z },
      to: { x: target.x, y: isTower ? 2.2 : target.flying ? 1.7 : 1.1, z: target.z },
    })
  }

  private kill(t: TroopState) {
    if (t.dead) return
    t.dead = true
    this.events.onTroopRemove(t.id)
  }

  private damageTower(tw: TowerState, dmg: number) {
    if (!tw.alive) return
    // A King Tower activates the moment it takes damage.
    if (tw.kind === 'king') tw.active = true
    tw.hp -= dmg
    if (tw.hp <= 0 && tw.alive) {
      tw.alive = false; tw.hp = 0
      if (tw.side === 'red') this.blueCrowns++
      else this.redCrowns++
      this.events.onTowerFall(tw)
      sfx.towerFall()
      if (tw.kind === 'king') { this.end(); return }
      // Losing a Princess Tower activates that side's King Tower.
      const king = this.towers.find((t) => t.side === tw.side && t.kind === 'king')
      if (king) king.active = true
      this.events.onBanner(tw.side === 'red' ? 'Tower destroyed!' : 'Your tower fell!', tw.side === 'red' ? '+1 crown' : 'Defend the King!')
      // In the tiebreaker the first tower to fall decides the match.
      if (this.tiebreaker) { this.end(); return }
    }
    this.events.onUpdate()
  }

  /**
   * Enemy troops near or past the river heading for `side`'s towers, as an AI
   * threat in that side's own frame (its towers at negative z; blue is mirrored).
   */
  private threatTo(side: Side): Threat | null {
    const flip = side === 'red' ? 1 : -1
    let level = 0, lead: TroopState | null = null
    for (const t of this.troops) {
      if (t.side === side || t.dead) continue
      const z = t.z * flip
      if (z > 3) continue // still well inside their own half
      const def = CARDS[t.cardId]
      level += def.cost / Math.max(1, def.count) / 4
      if (!lead || z < lead.z * flip) lead = t
    }
    return lead ? { level, x: lead.x * flip, z: lead.z * flip } : null
  }

  /** Elixir generation multiplier: 1x normally, 2x in the last minute of regular time and the first minute of Overtime, 3x in the final minute of Overtime. */
  private elixirRate(): number {
    if (!this.overtime) return this.timeLeft <= 60 ? 2 : 1
    return this.timeLeft > 60 ? 2 : 3
  }

  update(dt: number) {
    if (this.phase !== 'playing') return
    // Timer — 3:00 regular time, then 2:00 Overtime if tied on crowns, then a tiebreaker.
    this.timeLeft -= dt
    if (this.timeLeft <= 0) {
      if (!this.overtime) {
        if (this.blueCrowns !== this.redCrowns) { this.end(); return }
        this.overtime = true; this.timeLeft = 120
        this.events.onBanner('Overtime — Sudden Death', 'Next tower wins!')
        sfx.crown()
      } else if (!this.tiebreaker) {
        this.tiebreaker = true
        this.events.onBanner('Tiebreaker!', 'Lowest tower falls!')
        sfx.crown()
      }
    }
    if (this.tiebreaker) {
      // Every tower drains 10% of its max HP per second; the lowest-HP% tower falls first.
      // Identical HP% means they fall on the same tick and the match is a draw.
      for (const tw of this.towers) {
        if (tw.alive) this.damageTower(tw, tw.maxHp * 0.1 * dt)
        if (this.phase !== 'playing') return
      }
    }
    // Elixir: 1 per 2.8s; double in the last minute of regular time and the
    // first minute of Overtime; triple in the final minute of Overtime.
    const rate = this.elixirRate()
    this.elixir = Math.min(this.elixirMax, this.elixir + dt * rate * (1 / 2.8))
    if (this.mode === 'spectate' && this.spectateAI) this.blueElixir = Math.min(10, this.blueElixir + dt * rate * (1 / 2.8))

    // Rival AI
    this.aiTimer += dt
    if (this.aiTimer > 0.5) {
      this.aiTimer = 0
      const dec = this.ai.update(0.5, this.threatTo('red'), this.troops.filter((t) => t.side === 'red').length, 10, rate)
      if (dec) this.deploy(dec.cardId, 'red', dec.x, dec.z, dec.lane)
      if (this.mode === 'spectate' && this.spectateAI) {
        const decB = this.spectateAI.update(0.5, this.threatTo('blue'), this.troops.filter((t) => t.side === 'blue').length, 10, rate)
        if (decB && this.spectateAI.elixir >= CARDS[decB.cardId].cost) {
          // Spectate blue AI deploys on blue side, bypassing player elixir.
          const def = CARDS[decB.cardId]
          this.spectateAI.elixir -= def.cost
          for (let i = 0; i < def.count; i++) {
            const t: TroopState = { id: nextId++, cardId: decB.cardId, side: 'blue', x: -decB.x + (i - (def.count - 1) / 2) * 0.9, z: -decB.z, lane: decB.lane, hp: def.hp, maxHp: def.hp, targetId: null, attackCd: 0, walkPhase: Math.random() * 6, flying: !!def.flying, dead: false }
            this.troops.push(t); this.events.onTroopAdd(t)
          }
        }
      }
    }

    // Troop movement + combat
    for (const t of [...this.troops]) {
      if (t.dead) continue
      t.attackCd -= dt
      const def = CARDS[t.cardId]
      // Find target: nearest enemy troop in range, else nearest alive enemy tower.
      let target: TroopState | null = null
      let best = Infinity
      for (const e of this.troops) {
        if (e.side === t.side || e.dead) continue
        // Giants only target buildings.
        if (t.cardId === 'giant') continue
        const d = Math.hypot(e.x - t.x, e.z - t.z)
        if (d < best) { best = d; target = e }
      }
      let towerTarget: TowerState | null = null
      let bestT = Infinity
      for (const tw of this.towers) {
        if (tw.side === t.side || !tw.alive) continue
        // Princess towers first; king only if its princess towers are down or troop is past river.
        if (tw.kind === 'king') {
          const guards = this.towers.filter((g) => g.side === tw.side && g.kind === 'princess' && g.alive)
          if (guards.length && Math.abs(t.z) < 8) continue
        }
        const d = Math.hypot(tw.x - t.x, tw.z - t.z)
        if (d < bestT) { bestT = d; towerTarget = tw }
      }
      const inRangeTroop = target && best <= def.range
      const inRangeTower = towerTarget && bestT <= def.range + 0.8
      if (inRangeTroop && target) {
        if (t.attackCd <= 0) {
          t.attackCd = def.hitSpeed
          const dmg = def.damage * (t.side === 'red' ? this.ai.damageMultiplier() : 1)
          // Prince charge: double damage on the first hit after a run-up.
          target.hp -= t.cardId === 'prince' && Math.abs(t.z) > 4 ? dmg * 2 : dmg
          sfx.hit()
          this.emitShot(t, target)
          if (def.splash) {
            // Splash hits every other enemy in the blast radius for full damage (the primary target was already hit above).
            for (const e of this.troops) if (e !== target && e.side !== t.side && !e.dead && Math.hypot(e.x - target.x, e.z - target.z) < 1.6) e.hp -= dmg
          }
          if (target.hp <= 0) this.kill(target)
        }
      } else if (inRangeTower && towerTarget) {
        if (t.attackCd <= 0) {
          t.attackCd = def.hitSpeed
          this.damageTower(towerTarget, def.damage * (t.side === 'red' ? this.ai.damageMultiplier() : 1))
          sfx.hit()
          this.emitShot(t, towerTarget)
        }
      } else {
        // Move toward the nearest enemy troop within sight range (5.5), else toward the tower.
        const dest = target && best <= 5.5 ? target : towerTarget
        if (dest) {
          const dx = dest.x - t.x; const dz = dest.z - t.z
          const d = Math.hypot(dx, dz) || 1
          const step = def.speed * dt
          t.x += (dx / d) * step; t.z += (dz / d) * step
          t.walkPhase += dt * 9
        }
      }
      // Tower counter-attack (princess towers shoot).
      // Handled below per-tower.
    }
    // Tower shots — discrete cannon shots, not continuous damage.
    // Princess: 109 damage every 0.8s, range 7.5. King: 109 every 1.0s, range 7,
    // but only once activated (damaged, or a friendly Princess Tower falls).
    for (const tw of this.towers) {
      if (!tw.alive || !tw.active) continue
      const range = tw.kind === 'princess' ? 7.5 : 7
      const hitSpeed = tw.kind === 'princess' ? 0.8 : 1.0
      let nearest: TroopState | null = null; let bd = range
      for (const t of this.troops) {
        if (t.side === tw.side || t.dead) continue
        const d = Math.hypot(t.x - tw.x, t.z - tw.z)
        if (d < bd) { bd = d; nearest = t }
      }
      if (nearest) {
        tw.shotCd = (tw.shotCd ?? 0) - dt
        if (tw.shotCd <= 0) {
          tw.shotCd = hitSpeed
          nearest.hp -= 109
          if (nearest.hp <= 0) this.kill(nearest)
          this.events.onShot({
            kind: 'cannon',
            from: { x: tw.x, y: tw.kind === 'princess' ? 3.0 : 3.6, z: tw.z },
            to: { x: nearest.x, y: nearest.flying ? 1.7 : 1.0, z: nearest.z },
          })
        }
      }
    }
    this.troops = this.troops.filter((t) => !t.dead)
    this.events.onUpdate()
  }

  private end() {
    if (this.phase === 'over') return
    this.phase = 'over'
    const result: MatchRecord['result'] = this.blueCrowns > this.redCrowns ? 'win' : this.blueCrowns < this.redCrowns ? 'loss' : 'draw'
    let delta = 0
    if (this.mode === 'battle') {
      delta = result === 'win' ? 30 : result === 'loss' ? -20 : 0
      const p = this.profile
      p.trophies = Math.max(0, p.trophies + delta)
      if (result === 'win') { p.wins++; p.streak++; p.bestStreak = Math.max(p.bestStreak, p.streak) }
      else if (result === 'loss') { p.losses++; p.streak = 0 }
      else p.draws++
      p.crowns += this.blueCrowns
      // Rivals drift with you.
      for (const r of p.rivals) r.trophies = Math.max(200, r.trophies + Math.floor((Math.random() - 0.45) * 30))
      p.rivals.sort((a, b) => b.trophies - a.trophies)
    }
    const rec: MatchRecord = {
      id: `${Date.now()}`,
      date: new Date().toISOString(),
      result,
      blueCrowns: this.blueCrowns,
      redCrowns: this.redCrowns,
      trophiesDelta: delta,
      opponent: this.ai.name
    }
    if (this.mode === 'battle') this.profile.matches.unshift(rec)
    if (result === 'win') sfx.win(); else if (result === 'loss') sfx.lose(); else sfx.crown()
    this.events.onEnd(rec)
    this.events.onUpdate()
  }

  surrender() { if (this.phase === 'playing') { this.blueCrowns = 0; this.redCrowns = 1; this.end() } }
}
