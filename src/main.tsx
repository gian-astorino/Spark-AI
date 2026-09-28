import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@skyground-media/pipelean-design-system/styles.css'
import { ThemeProvider } from '@skyground-media/pipelean-design-system'
import './app.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
