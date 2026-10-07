import React from 'react'
import ReactDOM from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { getTheme, setTheme } from './store/prefsStore'
import './i18n'
import App from './App'
import './index.css'

setTheme(getTheme())

// BASE_URL ends in "/" (e.g. "/newsletter/"), and React Router treats that
// basename as not matching "/newsletter" itself, which is the URL the CEITBA
// site links to: the router would render nothing.
const ROUTER_BASENAME = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/'

// A data router (rather than BrowserRouter) so pages can use useBlocker:
// the article editor asks before any in-app navigation, back/forward
// included, drops unsaved changes. App keeps declaring its routes with
// <Routes>, rendered under one catch-all route.
const router = createBrowserRouter([{ path: '*', element: <App /> }], { basename: ROUTER_BASENAME })

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
)
