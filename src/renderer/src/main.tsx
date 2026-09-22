import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { RoiOverlay } from './RoiOverlay'
import './styles.css'

const isOverlay = window.location.hash === '#roi-overlay'
if (isOverlay) document.documentElement.classList.add('roi-overlay-document')

createRoot(document.getElementById('root')!).render(
  <StrictMode>{isOverlay ? <RoiOverlay /> : <App />}</StrictMode>
)
