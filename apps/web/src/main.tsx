import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Each deploy replaces the hashed chunks, so a tab opened before it fails to
// lazy-load a page (the scheduler, the newsletter, Administración...). Reload
// once to pick up the new build. If that reload happened moments ago (or
// sessionStorage is blocked), let the error reach the router's error screen
// instead of looping.
const CHUNK_RELOAD_KEY = 'chunkReloadAt'
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (Date.now() - (Number(sessionStorage.getItem(CHUNK_RELOAD_KEY)) || 0) < 10_000) return
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()))
  } catch {
    return
  }
  event.preventDefault()
  window.location.reload()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
