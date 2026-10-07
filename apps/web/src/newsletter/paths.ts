// The newsletter is mounted at /newsletter inside the CEITBA app. Its routes
// are declared relative to that (NewsletterApp), but links and navigate()
// calls take absolute paths, so build them with newsletterPath('/events') etc.
export const NEWSLETTER_BASE = '/newsletter'

export function newsletterPath(path: string): string {
  return path === '/' ? NEWSLETTER_BASE : NEWSLETTER_BASE + path
}

// The inverse, for code that inspects location.pathname: "/newsletter/admin"
// -> "/admin".
export function stripNewsletterBase(pathname: string): string {
  if (pathname === NEWSLETTER_BASE) return '/'
  return pathname.startsWith(NEWSLETTER_BASE + '/') ? pathname.slice(NEWSLETTER_BASE.length) : pathname
}
