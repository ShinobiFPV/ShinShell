import { render } from 'preact'
import App from './app'

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // offline-first app shell just won't be available yet — the page
    // itself already loaded fine, so this isn't fatal.
  })
}

const root = document.getElementById('app')
if (root) render(<App />, root)
