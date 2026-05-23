import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { HubProvider } from './services/merlin-hub-sdk/react'
import { configureMerlinHub } from './services/merlin-hub-sdk'
import './index.css'

configureMerlinHub({
  hubUrl: '', // CORS 방지를 위해 상대 경로를 사용하고, dev proxy / Netlify redirects로 중계
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <HubProvider appId="Vaulter">
        <App />
      </HubProvider>
    </BrowserRouter>
  </StrictMode>
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('/sw.js')
    } catch (error) {
      console.warn('[GmailSync] service worker registration failed:', error)
    }
  })
}
