# Clash Royale 3D — `cr-3d`

A real-time 3D lane battler built with **React + Vite + TypeScript + Three.js**.
A golden-hour stadium arena, 8-card decks, elixir, a rival AI, first-person
spectating, and a competitive ladder — with **no backend**. Progress saves in
the browser (`localStorage`).

> This is a fan-made, original-code tribute inspired by Clash Royale. All
> character models, names in the code, and art are original creations built
> from Three.js geometry — no game assets were copied.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build into dist/
npm run preview  # serve the production build
```

Requires Node 18+.

## What it includes

- **3D stadium arena** (Three.js, plain Three.js inside a React component):
  river + bridges, six towers (King + 2 Princess per side), animated crowd,
  gradient sky dome, warm golden-hour key light with soft shadows, cool rim
  light, horizon haze, floodlit stands, torch lights, dust motes, flowing
  river, turf with worn-earth patches, shockwave rings and camera shake on
  tower falls.
- **10 original cards, 8-card deck builder**: Knight, Archers, Giant,
  Musketeer, Minions, Bomber, Prince, Skeletons, Baby Dragon, Fireball
  (spell). Elixir-based deployment, ×2 elixir in the last minute / overtime.
- **Rival AI** that defends when threatened, pushes when elixir is high, and
  levels up as your trophies grow.
- **3-minute matches + overtime sudden death** — most crowns wins; tied at
  full time, next tower wins. King tower falling ends the match.
- **Three cameras**: Broadcast (drag to angle), Orbit cinematic, and
  **first-person** — walk with WASD / arrow keys or the on-screen joystick,
  drag to look, click the arena to deploy at the reticle — plus a
  **Ride-troop** view.
- **AI-vs-AI Spectate mode**: both sides are AI, sit back and watch.
- **Emotes** with AI replies.
- **Competitive layer**: trophies (win +30 / lose −20), win/loss record,
  crowns, streaks, match history, and a ladder ranking you against nine
  arena rivals.
- **Characters** built to the original game's quality standard: beveled
  sculpted geometry, chunky heroic proportions (heads ~1/3 height, shorter
  wider bodies, thicker limbs, bigger expressive eyes), clean saturated
  painterly surfaces. Knight's walrus mustache and long hero sword, Archers'
  magenta hair, Prince's visor glints. Troops walk, swing, breathe and blink.
- **Synthesized sound** (WebAudio, no audio files): deploy, hits, fireball,
  explosions, tower falls, win/lose jingles. Toggle in the corner.

## Controls

| Action | Control |
| --- | --- |
| Select a card | Click / tap a hand card |
| Deploy | Deploy Left / Deploy Right buttons, or click the arena in 1st Person |
| Camera | Broadcast / Orbit / 1st Person buttons, Ride troop |
| Move (1st Person) | WASD or arrow keys, or the on-screen joystick |
| Look (1st Person / Broadcast) | Drag |
| Emote | Emote buttons (left side in battle) |
| Surrender / Lobby | Buttons in the top bar |

## Project layout

```
index.html                  Vite entry
vite.config.ts              Vite + @vitejs/plugin-react, base './'
tsconfig.json               TypeScript (react-jsx, bundler resolution)
src/
  main.tsx                  React entry (createRoot, no StrictMode double-mount)
  App.tsx                   Screen state: lobby / deck / ladder / history / battle
  styles.css                All UI styling, vignette + film grain
  types.ts                  Shared types (cards, troops, towers, profile)
  cards.ts                  10 card definitions + default deck
  storage.ts                localStorage profile (trophies, deck, history, ladder)
  sound.ts                  Synthesized WebAudio SFX
  characters.ts             Troop / King / Princess model builders + walk animation
  engine.ts                 Three.js arena, lighting, crowd, river, cameras, rigs
  ai.ts                     Rival AI (defend / push / elixir management)
  game.ts                   Match logic: elixir, timer, combat, crowns, overtime
  components/
    Arena.tsx               React wrapper: owns Engine + Game, rAF loop, imperative handle
    Lobby.tsx               Home screen + stats
    DeckBuilder.tsx         8-card deck picker
    Ladder.tsx              Standings vs nine rivals
    History.tsx             Match history table
    Hud.tsx                 Timer, crowns, elixir bar, hand, cameras, emotes, joystick
```

React owns **all UI** (lobby, deck builder, HUD, standings, history, menus,
emotes). Three.js lives inside `Arena.tsx` — plain Three.js in a
`useEffect`/`useRef`, which is the simpler reliable route (no
`@react-three/fiber` dependency). The game simulation (`game.ts`, `ai.ts`)
is framework-free TypeScript and talks to React only through snapshots and
callbacks.

## Persistence

Profile, deck, trophies, match history and ladder live in
`localStorage` under `cr3d-profile-v1`. Reset from the Lobby.

## Deploy

`npm run build` produces a static `dist/` folder — host it anywhere static
( GitHub Pages, Netlify, Vercel, …). No server or database is needed.
