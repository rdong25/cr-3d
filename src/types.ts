export type Side = 'blue' | 'red'
export type CardId = 'knight' | 'archers' | 'giant' | 'musketeer' | 'minions' | 'bomber' | 'prince' | 'skeletons' | 'dragon' | 'fireball'
export type Rarity = 'Common' | 'Rare' | 'Epic'
export type CameraMode = 'broadcast' | 'orbit' | 'first' | 'ride'

export interface CardDef {
  id: CardId
  name: string
  cost: number
  rarity: Rarity
  hp: number
  damage: number
  range: number
  speed: number
  count: number
  flying?: boolean
  splash?: boolean
  desc: string
  emoji: string
  color: string
}

export interface MatchRecord {
  id: string
  date: string
  result: 'win' | 'loss' | 'draw'
  blueCrowns: number
  redCrowns: number
  trophiesDelta: number
  opponent: string
}

export interface Rival {
  name: string
  trophies: number
  wins: number
  level: number
}

export interface Profile {
  name: string
  trophies: number
  wins: number
  losses: number
  draws: number
  crowns: number
  streak: number
  bestStreak: number
  deck: CardId[]
  matches: MatchRecord[]
  rivals: Rival[]
  createdAt: string
}

export interface TroopState {
  id: number
  cardId: CardId
  side: Side
  x: number
  z: number
  lane: -1 | 1
  hp: number
  maxHp: number
  targetId: number | null
  attackCd: number
  walkPhase: number
  flying: boolean
  dead: boolean
}

export interface TowerState {
  id: string
  side: Side
  kind: 'king' | 'princess'
  lane: -1 | 0 | 1
  x: number
  z: number
  hp: number
  maxHp: number
  alive: boolean
  /** Seconds until the princess tower's next (visual) cannon shot. */
  shotCd?: number
}
