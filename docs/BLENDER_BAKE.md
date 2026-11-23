# Blender bake: textures for the generated troops

The troops are sculpted in code (`tools/<name>/design.mjs`) and shipped as vertex-painted
meshes. The Blender bake adds the step a game artist would do next: it takes a very dense
version of the same sculpt and bakes its detail into textures for the game mesh. The game mesh,
skeleton and animations do not change; only how the surface is drawn does.

What the bake adds:

- **Normal map**: the shape of the 3.5-million-triangle sculpt, painted onto the 45k-triangle
  game mesh, so rims, grooves, rivets and plate seams look sharp instead of blobby.
- **Base color**: the design's paint, plus procedural "smart material" wear: chipped and bright
  metal edges, grime in the creases, scratches, leather grain, cloth weave, bone growth rings.
- **Occlusion / roughness / metalness** (one packed map): ray-traced contact shadow and
  per-pixel shininess, so worn edges glint and dirty creases stay matte.

`docs/blender-trial-knight.jpg` shows the Knight before and after.

## Running it

Needs Blender 4.2 or newer (tested with 5.3). On a Mac at `/Applications/Blender.app` it is
found automatically; elsewhere set `BLENDER=/path/to/blender`.

```bash
node tools/blender/run.mjs                 # every character in tools/blender/surfaces.mjs
node tools/blender/run.mjs hero dragon     # just these (tools/<name>/ folder names)
```

Run it after `npm run build:hero-<name>`: it reads the freshly built `public/models/<name>.glb`.
A character takes about 30 to 60 seconds on an M3 Max. Output goes to
`public/models/baked/<file>.glb`. Scratch files go to `.cache/bake/` (git-ignored).

To make the game use a baked model, add its card id to `BAKED` in `src/hero.ts`. With `?q=low`
or `?painted=1` in the URL the game uses the painted originals instead.

## The three steps

1. `tools/blender/export.mjs <name>`: re-meshes every piece of the sculpt at 3 mm (about eight
   times the game density) in parallel worker threads, with raw paint colors and two extra
   values per vertex: which smart material it gets, and its curvature (positive on edges,
   negative in creases). Props that move on their own (shield, sword) become separate objects
   so they do not cast baked shadows onto the body. It also extracts the shipped game mesh.
2. `tools/blender/bake.py` (run inside Blender): unwraps the game mesh into one UV atlas,
   builds the smart-material node graph on the dense sculpt, and bakes three maps with Cycles
   on the GPU at twice the shipped size, then saves them as JPEGs at the shipped size.
3. `tools/blender/assemble.mjs <name>`: copies the shipped `.glb`, splits vertices along UV
   seams, adds MikkTSpace tangents (the basis Blender baked the normal map in), attaches the
   textures, drops the vertex colors and quantizes UVs, tangents and weights.

## Choosing materials for a new character

Each piece gets one smart material. The defaults come from the piece's material key:
`metal` becomes steel (gold when its paint is warm), `team` becomes cloth, `soft` becomes
leather. Anything else is listed per character in `tools/blender/surfaces.mjs`, as regular
expressions over piece names:

```js
dragon: {
  'trunk|head|jaw|foreleg_[LR]|wing_membrane_[LR]': 'skin',
  'belly_plates|teeth|horns_[LR]|.*claws.*': 'bone',
},
```

Kinds: `steel`, `gold`, `leather`, `cloth`, `mail`, `bone`, `painted` (chipped paint on wood,
for shield faces), `skin` (hide and creature skin), `wood`.

The look of each kind lives in `bake.py` under "smart materials". Each one is a few lines that
combine the shared masks (`edge`, `grime`, `scratch`, `grunge`) with the piece's own paint, so
a character's colors always come from its design.

## Things to know

- **Glow parts are not baked.** Eyes, gems and runes keep their emissive material. Their halo
  sprites are placed by `findGlowSpots` in `src/hero.ts`, from wherever the glow geometry is.
- **Edits to a design need a rebuild and a re-bake**: `npm run build:hero-<name>`, then
  `node tools/blender/run.mjs <name>`. A baked model left over from an older design will have
  textures that do not match its shape.
- **Download size**: a baked troop is about 2.5 to 4 MB against 1 to 3 MB painted. Set a
  smaller `TEXTURE_SIZE` in `surfaces.mjs` for a troop that is always seen small.
