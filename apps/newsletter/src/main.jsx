import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { getTheme, setTheme } from './store/prefsStore'
import './i18n'
import App from './App'
import './index.css'

setTheme(getTheme())

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.VITE_BASE_PATH ?? '/'}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
