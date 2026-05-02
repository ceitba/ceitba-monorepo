import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export default function Footer() {
  const { t } = useTranslation()
  const year = new Date().getFullYear()

  const FOOTER_LINKS = [
    { to: '/',       label: t('nav.articles') },
    { to: '/events', label: t('nav.events')   },
    { to: 'mailto:newsletter@ceitba.org.ar', label: t('footer.contact'), external: true },
  ]

  return (
    <footer className="border-t border-border bg-primary-900 text-surface mt-auto">
      <div className="container-content py-12 sm:py-16">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-10">
          <div className="sm:col-span-1">
            <p className="font-display text-h4 font-bold text-surface leading-tight">
              ITBA News
            </p>
            <p className="font-body text-body-sm text-primary-200 mt-1 leading-relaxed">
              {t('footer.tagline')}
            </p>
          </div>

          <nav aria-label={t('footer.navigate')} className="sm:col-span-1">
            <p className="font-mono text-label uppercase tracking-widest text-primary-300 mb-3">
              {t('footer.navigate')}
            </p>
            <ul className="flex flex-col gap-2 list-none m-0 p-0">
              {FOOTER_LINKS.map(({ to, label, external }) => (
                <li key={to}>
                  {external ? (
                    <a
                      href={to}
                      className="font-body text-body-sm text-primary-100 hover:text-accent transition-colors duration-150"
                    >
                      {label}
                    </a>
                  ) : (
                    <Link
                      to={to}
                      className="font-body text-body-sm text-primary-100 hover:text-accent transition-colors duration-150"
                    >
                      {label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>

          <div className="sm:col-span-1">
            <p className="font-mono text-label uppercase tracking-widest text-primary-300 mb-3">
              {t('footer.follow')}
            </p>
            <div className="flex gap-4">
              <SocialLink href="https://instagram.com/ceitba" label="Instagram">
                <IconInstagram />
              </SocialLink>
              <SocialLink href="https://twitter.com/ceitba" label="Twitter / X">
                <IconX />
              </SocialLink>
              <SocialLink href="https://linkedin.com/company/ceitba" label="LinkedIn">
                <IconLinkedIn />
              </SocialLink>
            </div>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-primary-700 flex flex-col sm:flex-row justify-between gap-2">
          <p className="font-mono text-label text-primary-400">
            &copy; {year} {t('footer.copyright')}
          </p>
          <p className="font-mono text-label text-primary-500">
            {t('footer.institution')}
          </p>
        </div>
      </div>
    </footer>
  )
}

function SocialLink({ href, label, children }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="w-11 h-11 flex items-center justify-center rounded text-primary-200 hover:text-accent hover:bg-primary-700 transition-colors duration-150 focus-visible:rounded"
    >
      {children}
    </a>
  )
}

function IconInstagram() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

function IconX() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.253 5.622L18.244 2.25zM17.083 19.77h1.833L7.084 4.126H5.117L17.083 19.77z" />
    </svg>
  )
}

function IconLinkedIn() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect x="2" y="9" width="4" height="12" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  )
}
