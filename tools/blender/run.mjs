// The whole Blender bake for one or more characters:
//
//   node tools/blender/run.mjs hero giant ...     (no names = every character in surfaces.mjs)
//
//   export.mjs   sculpt at high density + the game mesh        -> .cache/bake/<name>/
//   bake.py      Blender: unwrap, smart materials, Cycles bake  -> uv + textures
//   assemble.mjs game model + UVs + tangents + textures         -> public/models/baked/<file>.glb
//
// Needs Blender 4.2 or newer. Set BLENDER to its executable if it is not in the default place.

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { GLB_NAME, TEXTURE_SIZE, CHARACTERS } from './surfaces.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const BLENDER = process.env.BLENDER || ['/Applications/Blender.app/Contents/MacOS/Blender', '/usr/bin/blender', '/usr/local/bin/blender'].find(existsSync)
if (!BLENDER) { console.error('Blender not found. Install it or set BLENDER=/path/to/blender'); process.exit(1) }

const names = process.argv.slice(2).length ? process.argv.slice(2) : CHARACTERS
for (const name of names) {
  const size = TEXTURE_SIZE[name] || 1024
  const t0 = Date.now()
  console.log(`\n== ${name} ==`)
  execFileSync('node', [`${here}/export.mjs`, name], { cwd: root, stdio: 'inherit' })
  // Bake at twice the shipped size and scale down: free anti-aliasing.
  const log = execFileSync(BLENDER, ['-b', '-P', `${here}/bake.py`, '--', `${root}/.cache/bake/${name}`, String(size * 2)], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 26 })
  for (const line of log.split('\n')) if (/^\[bake|Error|Traceback/.test(line)) console.log(line)
  if (!/\] done/.test(log)) { console.error(log.slice(-3000)); throw new Error(`Blender bake failed for ${name}`) }
  execFileSync('node', [`${here}/assemble.mjs`, name, `baked/${GLB_NAME[name] || name}`, String(size)], { cwd: root, stdio: 'inherit' })
  console.log(`${name}: ${((Date.now() - t0) / 1000).toFixed(0)}s`)
}
