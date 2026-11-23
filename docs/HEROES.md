# Heroes — all nine troops as skinned .glb characters

Every troop except Fireball (a spell) is now a skinned, animated `.glb`
built with the pipeline in [CHARACTER_PIPELINE.md](CHARACTER_PIPELINE.md):
SDF sculpting → Surface Nets → meshoptimizer decimation → baked AO/edge-wear
in vertex colors → skin weights → Idle/Walk/Attack/Death clips → glTF export.
Each hero lives in its own `tools/<slug>/` directory (a copy of `tools/hero/`
with its own `design.mjs` / `animations.mjs` / `build.mjs`), and its asset in
`public/models/<slug>.glb`.

Regenerate one hero with `npm run build:hero-<slug>`, or all nine with
`npm run build:heroes`. The Ember Warden build is byte-identical on
regeneration (57,886 tris, 2,856 KB), which is how the pipeline was verified.

| Hero | Card | File | Triangles | Size | Pieces | Bones | Height | Design notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ember Warden | Knight | `ember-warden.glb` | 57,886 | 2,856 KB | 64 | 22 | ~1.8 | Bucket helm, T visor, ember eyes, horns, cape, shield + sword. The original; see [EMBER_WARDEN_WALKTHROUGH.md](EMBER_WARDEN_WALKTHROUGH.md). |
| Giant | Giant | `giant.glb` | 44,362 | 2,311 KB | 44 | 22 | 2.21 | Knight skeleton ×1.35. Bare-chested, team sash + belt, big fists, no weapon. Two-handed overhead smash. |
| Prince | Prince | `prince.glb` | 53,774 | 2,670 KB | 64 | 22 | 1.73 | Visored helm, gold trim, team plume, cape + tabard, couched lance with team pennon. Lance-charge attack. |
| Archers | Archers | `archers.glb` | 21,223 | 1,162 KB | 43 | 22 | 1.62 | Slim build, magenta hair + ponytail, quiver, recurve bow with nocked arrow. Bow-draw attack. One .glb reused for both archers. |
| Musketeer | Musketeer | `musketeer.glb` | 22,864 | 1,255 KB | 36 | 22 | 1.72 | Wide-brimmed hat, long hair, long team coat, long musket. Aim-and-fire attack with recoil. |
| Bomber | Bomber | `bomber.glb` | 23,727 | 1,230 KB | 21 | 22 | 1.63 | Skull face (carved sockets, teeth, glow eyes), dark hooded robe, bomb with sparking fuse. Underhand lob attack. |
| Skeletons | Skeletons | `skeletons.glb` | 22,716 | 1,119 KB | 26 | 22 | 1.53 | Full bone body — skull, spine, 5-band ribcage, dual forearm/shin bones — plus a team sash. Death collapses into a bone pile. One .glb reused for all three. |
| Minions | Minions | `minions.glb` | 10,232 | 599 KB | 34 | 20 | ~1.0 | Small blue-grey imp, horns, fangs, glow eyes, webbed wings on added `wing_L`/`wing_R` bones. Walk clip is a flying hover. One .glb reused for all three. |
| Baby Dragon | Baby Dragon | `dragon.glb` | 21,055 | 1,133 KB | 34 | 23 | ~1.4 | Horizontal body, long snout with glow mouth + teeth, horns, belly plates, back spikes, wings, tail on the reused `cape_1/2/3` chain. Fire-breath attack. |

Totals: **277,839 triangles, ~14.0 MB** across the nine models.

## Runtime

`src/hero.ts` keeps a `CardId → url` map (`HERO_URLS`) and loads every hero
up front (`preloadHeroes()` in `src/main.tsx`). `Engine.addTroop` spawns a
`HeroInstance` for any hero card whose model has loaded, and falls back to
the procedural rig in `src/characters.ts` until it has. Flying heroes
(Minions, Baby Dragon) hover at y ≈ 1.1 with a bob, matching the old rigs.
Heroes without a `Warden_Glow` material (Archers, Musketeer) get no eye/chest
halo sprites; heroes with one do. Team parts use the `Warden_Team` material,
tinted blue/red per side.

## Viewer

`viewer.html` lists all nine heroes with clip, team, wireframe, skeleton,
and old-vs-new comparison controls, plus a `?hero=<cardId>` URL param
(e.g. `viewer.html?hero=giant&clip=Walk`).

## Not yet verified visually

Triangle counts, file sizes, clip/bone/material names, and heights were
verified from the build output and by parsing each `.glb`'s JSON chunk.
No hero was eyeballed in the viewer or in a live battle — proportions, paint,
and animation quality (especially the bow/musket aim poses and the flying
heroes' wing orientation) still need a human look in the viewer before
trusting them on screen.
