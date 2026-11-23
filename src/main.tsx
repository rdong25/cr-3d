import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { preloadHero } from './hero'

// Start fetching the skinned hero model right away; troops fall back to the
// procedural rig until it has loaded.
preloadHero()

createRoot(document.getElementById('root')!).render(<App />)
