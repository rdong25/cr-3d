import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { preloadHeroes } from './hero'

// Start fetching all skinned hero models right away; troops fall back to the
// procedural rig until their model has loaded.
preloadHeroes()

createRoot(document.getElementById('root')!).render(<App />)
