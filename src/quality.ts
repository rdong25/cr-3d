// One place decides how heavy the rendering is.
//   low  = phones and anything touch-first: no ambient-occlusion pass, no MSAA,
//          fewer particles, grass tufts and flash lights, no water reflections.
//   high = everything on.
// Override with ?q=low or ?q=high in the URL (e.g. a phone that runs hot, or a
// tablet with power to spare).
const forced = new URLSearchParams(location.search).get('q')
export const LOW_POWER: boolean = forced === 'low' || (forced !== 'high' && (window.matchMedia?.('(pointer: coarse)').matches ?? false))
