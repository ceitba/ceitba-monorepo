import { useEffect } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { buttonClass } from '../components/ui'

// https://ceitba.org.ar/app/<screen> opens CEITBApp, e.g. the weekly digest's
// "Armá tu horario en la app" (/app/horario). With the app installed, the
// link is a Universal Link (iOS) / App Link (Android) and never reaches this
// page: the OS opens the app (public/.well-known/: apple-app-site-association
// declares the paths, assetlinks.json the Play App Signing key). Here
// we only see visitors without the app, on a desktop, or whose mail client
// opened the link in its own browser.
//   desktop → the same screen on the website
//   Android → an intent:// URL: opens the app if installed, otherwise the
//             Play Store (browser_fallback_url)
//   iOS     → the App Store (it shows "Abrir" when the app is installed)

const APP_STORE_URL = 'https://apps.apple.com/app/ceitbapp/id6503629920'
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.ceitba.app'
const ANDROID_PACKAGE = 'com.ceitba.app'

// App screen (the path segment after /app) → the website page with the same
// content. Screens not listed open the website's home.
const WEB_FALLBACK: Record<string, string> = {
  horario: '/scheduler',
}

type Platform = 'ios' | 'android' | 'desktop'

function detectPlatform(): Platform {
  const ua = navigator.userAgent
  if (/android/i.test(ua)) return 'android'
  // iPadOS reports itself as a Mac; touch support gives it away.
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ios'
  return 'desktop'
}

function androidIntentUrl(pathname: string): string {
  return `intent://${window.location.host}${pathname}#Intent;scheme=https;package=${ANDROID_PACKAGE};`
    + `S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};end`
}

export default function OpenInAppPage() {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const platform = detectPlatform()
  const screen = pathname.replace(/^\/app\/?/, '').split('/')[0]
  const webPath = WEB_FALLBACK[screen] ?? '/'
  const storeUrl = platform === 'ios' ? APP_STORE_URL : PLAY_STORE_URL
  const openUrl = platform === 'android' ? androidIntentUrl(window.location.pathname) : storeUrl

  // Try once on arrival; the buttons below cover browsers that block a
  // redirect to another app without a tap.
  useEffect(() => {
    if (platform !== 'desktop') window.location.replace(openUrl)
  }, [platform, openUrl])

  if (platform === 'desktop') return <Navigate to={webPath} replace />

  return (
    <main id="main-content" tabIndex={-1} className="outline-none container-content py-section-mobile lg:py-section">
      <div className="max-w-md mx-auto text-center">
        <h1 className="font-display font-bold text-h2 text-ink-primary dark:text-night-text">
          {t('openInApp.title')}
        </h1>
        <p className="font-body text-body text-ink-secondary dark:text-night-muted mt-2">
          {t('openInApp.body')}
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <a href={openUrl} className={buttonClass({ variant: 'primary', block: true })}>
            {platform === 'android' ? t('openInApp.open') : t('openInApp.appStore')}
          </a>
          {platform === 'android' && (
            <a href={PLAY_STORE_URL} className={buttonClass({ variant: 'outline', block: true })}>
              {t('openInApp.playStore')}
            </a>
          )}
          <Link to={webPath} className={buttonClass({ variant: 'ghost', block: true })}>
            {t('openInApp.web')}
          </Link>
        </div>
      </div>
    </main>
  )
}
