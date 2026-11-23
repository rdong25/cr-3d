import type { CardDef, CardId } from './types'

export const CARDS: Record<CardId, CardDef> = {
  knight: { id: 'knight', name: 'Knight', cost: 3, rarity: 'Common', hp: 1450, damage: 167, range: 1.1, speed: 1.6, count: 1, desc: 'A tough melee fighter with a big sword and an even bigger mustache.', emoji: '⚔️', color: '#8a94a6' },
  archers: { id: 'archers', name: 'Archers', cost: 3, rarity: 'Common', hp: 252, damage: 86, range: 5.5, speed: 1.6, count: 2, desc: 'A pair of sharpshooters with magenta hair. They attack from range.', emoji: '🏹', color: '#e75480' },
  giant: { id: 'giant', name: 'Giant', cost: 5, rarity: 'Rare', hp: 3344, damage: 211, range: 1.2, speed: 1.2, count: 1, desc: 'Slow but durable. Targets buildings only — a walking siege tower.', emoji: '🛡️', color: '#c98a3d' },
  musketeer: { id: 'musketeer', name: 'Musketeer', cost: 4, rarity: 'Rare', hp: 598, damage: 181, range: 6, speed: 1.6, count: 1, desc: 'A crack shot with a long musket. High single-target damage.', emoji: '🔫', color: '#7b5cff' },
  minions: { id: 'minions', name: 'Minions', cost: 3, rarity: 'Common', hp: 190, damage: 84, range: 1.4, speed: 2.6, count: 3, flying: true, desc: 'Fast, flying, and fragile. Three of them swarm the enemy.', emoji: '🦇', color: '#5a6cff' },
  bomber: { id: 'bomber', name: 'Bomber', cost: 3, rarity: 'Common', hp: 320, damage: 271, range: 4.5, speed: 1.6, count: 1, splash: true, desc: 'Lobs bombs that splash a whole group. Skull-faced and cheerful.', emoji: '💣', color: '#3a3f4a' },
  prince: { id: 'prince', name: 'Prince', cost: 5, rarity: 'Epic', hp: 1620, damage: 325, range: 1.3, speed: 1.8, count: 1, desc: 'Charges with a couched lance — double damage on the charge.', emoji: '🐎', color: '#d4af37' },
  skeletons: { id: 'skeletons', name: 'Skeletons', cost: 1, rarity: 'Common', hp: 67, damage: 67, range: 0.9, speed: 2.4, count: 3, desc: 'Three brittle bone buddies. Cheap, fast, and surprisingly annoying.', emoji: '💀', color: '#e8e8e8' },
  dragon: { id: 'dragon', name: 'Baby Dragon', cost: 4, rarity: 'Epic', hp: 1064, damage: 133, range: 3.5, speed: 1.8, count: 1, flying: true, splash: true, desc: 'Burps fire in a splash. Nobody knows what the baby eats to make that.', emoji: '🐉', color: '#ff7a3d' },
  fireball: { id: 'fireball', name: 'Fireball', cost: 4, rarity: 'Rare', hp: 0, damage: 572, range: 0, speed: 0, count: 0, splash: true, desc: 'A spell. Hurl a blazing fireball anywhere — big splash damage.', emoji: '🔥', color: '#ff5722' }
}

export const ALL_CARDS = Object.values(CARDS)
export const DEFAULT_DECK: CardId[] = ['knight', 'archers', 'giant', 'musketeer', 'minions', 'bomber', 'prince', 'dragon']

export const RIVAL_NAMES = ['Vex', 'Mira', 'Korg', 'Luna', 'Ash', 'Zara', 'Finn', 'Nia', 'Rook']
