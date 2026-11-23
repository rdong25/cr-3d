// Keeps the installed copy (browser tab or iPhone Home Screen app) on the latest
// deployed version.
//
// The deploy workflow bakes the commit SHA into the bundle (VITE_BUILD_ID) and
// publishes the same SHA at version.json. We poll version.json, bypassing every
// cache, and when it differs we load the page under a new URL (?v=<sha>). A new
// URL can't be served from Safari's or GitHub Pages' cached index.html, and the
// JS/CSS files are content-hashed, so that reload always gets the new build.

export const BUILD_ID: string = import.meta.env.VITE_BUILD_ID || 'dev'
export const shortId = (id: string) => (id === 'dev' ? 'dev' : id.slice(0, 7))

const VERSION_URL = `${import.meta.env.BASE_URL}version.json`
const RELOAD_KEY = 'cr3d-reloaded-for'

/** Fetch the latest deployed build id, or null if offline / not deployed. */
export async function fetchLatestId(): Promise<string | null> {
  try {
    const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return null
    const { id } = (await res.json()) as { id?: string }
    return typeof id === 'string' && id ? id : null
  } catch {
    return null
  }
}

/** Load the given version, bypassing cached HTML. */
export function reloadTo(id: string) {
  try { sessionStorage.setItem(RELOAD_KEY, id) } catch { /* private mode */ }
  const url = new URL(location.href)
  url.searchParams.set('v', id.slice(0, 12))
  location.replace(url.toString())
}

/**
 * Calls onNewVersion(latestId) whenever a newer deploy than this bundle exists.
 * Checks now, every `everyMs`, and whenever the app comes back to the foreground.
 * Returns a stop function. Does nothing in local dev builds.
 */
export function watchForUpdates(onNewVersion: (latestId: string) => void, everyMs = 60_000): () => void {
  if (BUILD_ID === 'dev') return () => {}
  const check = async () => {
    const latest = await fetchLatestId()
    if (!latest || latest === BUILD_ID) return
    // If we already reloaded for this id and still got the old bundle, a cache
    // somewhere is stale; don't loop. The manual Update button can still retry.
    let already: string | null = null
    try { already = sessionStorage.getItem(RELOAD_KEY) } catch { /* ignore */ }
    if (already === latest) return
    onNewVersion(latest)
  }
  check()
  const timer = setInterval(check, everyMs)
  const onVisible = () => { if (document.visibilityState === 'visible') check() }
  document.addEventListener('visibilitychange', onVisible)
  return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible) }
}
