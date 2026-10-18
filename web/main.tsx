import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { App } from './App'

const container = document.getElementById('root')
if (!container) throw new Error('页面缺少 #root 节点')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
