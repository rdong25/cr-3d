// Minimal binary glTF (.glb) reader/writer: just enough to read mesh data out of a model the
// game already ships and to write it back with UVs, tangents and textures added.

const COMPONENTS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }

export function readGlb(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a .glb file')
  const jsonLen = dv.getUint32(12, true)
  const json = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jsonLen)))
  const binStart = 20 + jsonLen + 8
  const binLen = dv.getUint32(20 + jsonLen, true)
  // Copy so typed-array views over it are aligned whatever the file offsets were.
  const bin = new Uint8Array(binLen)
  bin.set(buf.subarray(binStart, binStart + binLen))
  return { json, bin }
}

/** A typed array holding one accessor's values (copied, tightly packed). */
export function accessorData(glb, index) {
  const a = glb.json.accessors[index], view = glb.json.bufferViews[a.bufferView]
  const T = COMPONENTS[a.componentType], w = WIDTH[a.type]
  const start = (view.byteOffset || 0) + (a.byteOffset || 0)
  const stride = view.byteStride || T.BYTES_PER_ELEMENT * w
  const out = new T(a.count * w)
  const dv = new DataView(glb.bin.buffer, glb.bin.byteOffset)
  const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType]
  for (let i = 0; i < a.count; i++) for (let k = 0; k < w; k++) out[i * w + k] = dv[get](start + i * stride + k * T.BYTES_PER_ELEMENT, true)
  return out
}

/**
 * Rebuilds a .glb from its JSON plus a list of byte chunks. Every bufferView in `json` must
 * carry a private `_data` Uint8Array; offsets are assigned here.
 */
export function writeGlb(json) {
  let size = 0
  for (const v of json.bufferViews) { size = (size + 3) & ~3; v.byteOffset = size; v.byteLength = v._data.byteLength; size += v.byteLength }
  size = (size + 3) & ~3
  const bin = new Uint8Array(size)
  for (const v of json.bufferViews) { bin.set(v._data, v.byteOffset); delete v._data }
  json.buffers = [{ byteLength: size }]
  let text = new TextEncoder().encode(JSON.stringify(json))
  const pad = (4 - (text.length % 4)) % 4
  if (pad) { const t = new Uint8Array(text.length + pad).fill(0x20); t.set(text); text = t }
  const out = new Uint8Array(12 + 8 + text.length + 8 + bin.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true)
  dv.setUint32(12, text.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(text, 20)
  dv.setUint32(20 + text.length, bin.length, true); dv.setUint32(24 + text.length, 0x004e4942, true); out.set(bin, 28 + text.length)
  return out
}

/** Give every bufferView its own copy of its bytes (`_data`), ready for editing and writeGlb. */
export function detachViews(glb) {
  for (const v of glb.json.bufferViews) v._data = glb.bin.slice(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength)
}

/** Append a typed array as a new accessor; returns its index. */
export function addAccessor(json, array, type, { target, minMax = false, normalized = false } = {}) {
  const componentType = Number(Object.entries(COMPONENTS).find(([, T]) => array instanceof T)[0])
  const w = WIDTH[type]
  const view = { buffer: 0, _data: new Uint8Array(array.buffer, array.byteOffset, array.byteLength) }
  if (target) view.target = target
  json.bufferViews.push(view)
  const acc = { bufferView: json.bufferViews.length - 1, componentType, count: array.length / w, type }
  if (normalized) acc.normalized = true
  if (minMax) {
    acc.min = new Array(w).fill(Infinity); acc.max = new Array(w).fill(-Infinity)
    for (let i = 0; i < array.length; i++) { const k = i % w; if (array[i] < acc.min[k]) acc.min[k] = array[i]; if (array[i] > acc.max[k]) acc.max[k] = array[i] }
  }
  json.accessors.push(acc)
  return json.accessors.length - 1
}
