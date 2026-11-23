import * as THREE from 'three'

// Photoscanned PBR materials (Poly Haven, CC0; see public/textures/pbr/CREDITS.md)
// applied to sculpted meshes that have no UVs.
//
// Triplanar mapping: each texture is projected along the object's X, Y and Z
// axes and blended by the surface normal. Normal maps use the "whiteout" blend
// in object space, then go to view space through per-vertex object axes (so
// it works for any rotation / uniform scale without needing tangents).

const DIR = `${import.meta.env.BASE_URL}textures/pbr/`
export type PBRName = 'stone' | 'grass' | 'dirt' | 'wood' | 'roof' | 'rock'
export interface PBRSet { color: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture }

const loader = new THREE.TextureLoader()
const sets = new Map<PBRName, PBRSet>()
export function pbrSet(name: PBRName): PBRSet {
  let s = sets.get(name)
  if (s) return s
  const tex = (file: string, srgb: boolean) => {
    const t = loader.load(DIR + file)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    t.anisotropy = 8
    return t
  }
  s = { color: tex(`${name}_color.jpg`, true), normal: tex(`${name}_normal.jpg`, false), rough: tex(`${name}_rough.jpg`, false) }
  sets.set(name, s)
  return s
}

const VERT_DECL = 'varying vec3 vTriPos;\nvarying vec3 vTriN;\nvarying vec3 vAxX;\nvarying vec3 vAxY;\nvarying vec3 vAxZ;'
const VERT_BODY = 'vTriPos = position;\nvTriN = normal;\nvAxX = normalize(normalMatrix * vec3(1.0, 0.0, 0.0));\nvAxY = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));\nvAxZ = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));'
const FRAG_DECL = `${VERT_DECL}
uniform sampler2D tpColor; uniform sampler2D tpNormal; uniform sampler2D tpRough;
uniform float tpScale; uniform float tpNormalStrength; uniform vec3 tpTint;
vec3 tpWeights(vec3 n) { vec3 w = pow(abs(n), vec3(6.0)); return w / (w.x + w.y + w.z); }
vec4 tpSample(sampler2D t, vec3 p, vec3 w) {
  return texture2D(t, p.zy) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z;
}
// Whiteout-blended triplanar normal, returned in object space.
vec3 tpNormalObj(vec3 p, vec3 n, vec3 w) {
  vec3 tx = texture2D(tpNormal, p.zy).xyz * 2.0 - 1.0;
  vec3 ty = texture2D(tpNormal, p.xz).xyz * 2.0 - 1.0;
  vec3 tz = texture2D(tpNormal, p.xy).xyz * 2.0 - 1.0;
  tx.xy *= tpNormalStrength; ty.xy *= tpNormalStrength; tz.xy *= tpNormalStrength;
  tx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
  ty = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
  tz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
  return normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
}`

/**
 * Make `mat` sample a photoscanned set by triplanar projection.
 * `tile` = meters per texture repeat. Vertex colors (baked AO) still multiply in.
 */
export function triplanarPBR(mat: THREE.MeshStandardMaterial, set: PBRSet, tile: number, opts: { normalStrength?: number; tint?: THREE.ColorRepresentation } = {}) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tpColor = { value: set.color }
    shader.uniforms.tpNormal = { value: set.normal }
    shader.uniforms.tpRough = { value: set.rough }
    shader.uniforms.tpScale = { value: 1 / tile }
    shader.uniforms.tpNormalStrength = { value: opts.normalStrength ?? 1 }
    shader.uniforms.tpTint = { value: new THREE.Color(opts.tint ?? 0xffffff) }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_DECL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${VERT_BODY}`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_DECL}`)
      .replace('#include <map_fragment>', `
        vec3 tpN = normalize(vTriN);
        vec3 tpW = tpWeights(tpN);
        vec3 tpP = vTriPos * tpScale;
        diffuseColor.rgb *= tpSample(tpColor, tpP, tpW).rgb * tpTint;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * tpSample(tpRough, tpP, tpW).g;')
      .replace('#include <normal_fragment_maps>', `
        vec3 tpNo = tpNormalObj(tpP, tpN, tpW);
        normal = normalize(tpNo.x * vAxX + tpNo.y * vAxY + tpNo.z * vAxZ);`)
  }
  mat.customProgramCacheKey = () => `tp-${set.color.uuid}-${tile}-${opts.normalStrength ?? 1}`
  mat.needsUpdate = true
}

/**
 * Ground: two photoscanned sets (grass, dirt) blended by `mask` (red channel =
 * dirt), on a flat field whose UVs span the whole arena. `tile` in meters.
 */
export function splatGround(mat: THREE.MeshStandardMaterial, mask: THREE.Texture, a: PBRSet, b: PBRSet, fieldSize: [number, number], tile: number) {
  mat.map = mask // gives us vMapUv
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      gA: { value: a.color }, gAN: { value: a.normal }, gAR: { value: a.rough },
      gB: { value: b.color }, gBN: { value: b.normal }, gBR: { value: b.rough },
      gRepeat: { value: new THREE.Vector2(fieldSize[0] / tile, fieldSize[1] / tile) },
    })
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vAxX;\nvarying vec3 vAxY;\nvarying vec3 vAxZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAxX = normalize(normalMatrix * vec3(1.0, 0.0, 0.0));\nvAxY = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));\nvAxZ = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vAxX; varying vec3 vAxY; varying vec3 vAxZ;
        uniform sampler2D gA; uniform sampler2D gAN; uniform sampler2D gAR;
        uniform sampler2D gB; uniform sampler2D gBN; uniform sampler2D gBR;
        uniform vec2 gRepeat;`)
      .replace('#include <map_fragment>', `
        vec4 gMask = texture2D(map, vMapUv);
        vec2 gUv = vMapUv * gRepeat;
        // Break up visible tiling with a second, rotated, larger-scale sample.
        vec2 gUv2 = mat2(0.8, -0.6, 0.6, 0.8) * gUv * 0.37 + 0.31;
        float gH = gMask.r;
        float gM = smoothstep(0.35, 0.65, gH + (texture2D(gB, gUv2).r - 0.5) * 0.5);
        // Grass pushed toward a deeper, richer green; dirt slightly darker.
        vec3 gGrass = mix(texture2D(gA, gUv).rgb, texture2D(gA, gUv2).rgb, 0.35) * vec3(0.6, 0.84, 0.46);
        vec3 gCol = mix(gGrass, texture2D(gB, gUv).rgb * 0.85, gM);
        diffuseColor.rgb *= gCol * (0.85 + 0.3 * gMask.g);`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = roughness * mix(texture2D(gAR, gUv).g, texture2D(gBR, gUv).g, gM);')
      .replace('#include <normal_fragment_maps>', `
        vec3 gT = mix(texture2D(gAN, gUv).xyz, texture2D(gBN, gUv).xyz, gM) * 2.0 - 1.0;
        // uv.x runs along +X, uv.y along -Z; the field faces +Y.
        vec3 gNo = normalize(vec3(gT.x, gT.z, -gT.y));
        normal = normalize(gNo.x * vAxX + gNo.y * vAxY + gNo.z * vAxZ);`)
  }
  mat.customProgramCacheKey = () => 'splat-ground'
  mat.needsUpdate = true
}
