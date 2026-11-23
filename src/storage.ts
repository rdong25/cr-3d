import { DEFAULT_DECK, RIVAL_NAMES } from './cards'
import type { Profile, Rival } from './types'

const KEY = 'cr3d-profile-v1'

function defaultRivals(): Rival[] {
  return RIVAL_NAMES.map((name, i) => ({
    name,
    trophies: 1180 - i * 85 + Math.floor(Math.random() * 40),
    wins: 18 + i * 2,
    level: 6 + (i % 4)
  }))
}

export function defaultProfile(): Profile {
  return {
    name: 'You',
    trophies: 1000,
    wins: 0,
    losses: 0,
    draws: 0,
    crowns: 0,
    streak: 0,
    bestStreak: 0,
    deck: [...DEFAULT_DECK],
    matches: [],
    rivals: defaultRivals(),
    createdAt: new Date().toISOString()
  }
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultProfile()
    const p = JSON.parse(raw) as Profile
    if (!p.deck || p.deck.length !== 8) p.deck = [...DEFAULT_DECK]
    if (!p.rivals || p.rivals.length === 0) p.rivals = defaultRivals()
    if (!Array.isArray(p.matches)) p.matches = []
    return p
  } catch {
    return defaultProfile()
  }
}

export function saveProfile(p: Profile): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)) } catch { /* storage full / private mode */ }
}

export function resetProfile(): Profile {
  const p = defaultProfile()
  saveProfile(p)
  return p
}
