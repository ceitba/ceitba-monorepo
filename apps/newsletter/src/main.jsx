import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { getTheme, setTheme } from './store/prefsStore'
import './i18n'
import App from './App'
import './index.css'

setTheme(getTheme())

// BASE_URL ends in "/" (e.g. "/newsletter/"), and React Router treats that
// basename as not matching "/newsletter" itself, which is the URL the CEITBA
// site links to: the router would render nothing.
const ROUTER_BASENAME = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename={ROUTER_BASENAME}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
)
