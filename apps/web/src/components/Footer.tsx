import { useTranslation } from 'react-i18next'

const SOCIALS = [
  {
    id: 'instagram',
    href: 'https://instagram.com/ceitba',
    label: 'Instagram',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
        <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" strokeWidth="2.5" />
      </svg>
    ),
  },
  {
    id: 'linkedin',
    href: 'https://linkedin.com/company/ceitba',
    label: 'LinkedIn',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
        <rect x="2" y="9" width="4" height="12" />
        <circle cx="4" cy="4" r="2" />
      </svg>
    ),
  },
  {
    id: 'x',
    href: 'https://x.com/ceitba',
    label: 'X',
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.744l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    ),
  },
]

export default function Footer() {
  const { t } = useTranslation()
  const year = new Date().getFullYear()

  return (
    <footer className="border-t border-border dark:border-[#3f3f46] bg-surface dark:bg-[#18181b] py-8 mt-auto">
      <div className="container-content flex flex-col sm:flex-row items-center justify-between gap-6">
        <div className="flex flex-col items-center sm:items-start gap-1">
          <span className="font-display font-bold text-primary text-h5 tracking-tight">CEITBA</span>
          <span className="font-mono text-label text-ink-secondary dark:text-[#a1a1aa] uppercase tracking-widest">
            © {year} {t('footer.itTeam')}. {t('footer.rights')}
          </span>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-6">
          {/* Social icons */}
          <div className="flex items-center gap-4">
            {SOCIALS.map(({ id, href, label, icon }) => (
              <a
                key={id}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={label}
                className="text-ink-secondary dark:text-[#a1a1aa] hover:text-primary transition-colors duration-150"
              >
                {icon}
              </a>
            ))}
          </div>

          {/* Text links */}
          <nav className="flex items-center gap-6" aria-label="Footer">
            <a
              href="https://github.com/ceitba"
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-[#a1a1aa] hover:text-primary transition-colors duration-150"
            >
              {t('footer.github')}
            </a>
            <a
              href="mailto:ceitba@itba.edu.ar"
              className="font-mono text-label uppercase tracking-widest text-ink-secondary dark:text-[#a1a1aa] hover:text-primary transition-colors duration-150"
            >
              {t('footer.contact')}
            </a>
          </nav>
        </div>
      </div>
    </footer>
  )
}
