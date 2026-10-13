import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import '@/shared/styles/globals.css'
import { setupServiceWorker } from '@/app/pwa'

setupServiceWorker()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
