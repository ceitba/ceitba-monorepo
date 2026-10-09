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

// The two signed-in areas: "Mis publicaciones" (every writer: articles,
// drafts, their organizations' events and profiles) under /newsletter, and
// the staff side (review queue, weekly digest, analytics), which lives in
// the site's Administración as its Newsletter area (StaffNewsletterApp).
export const MINE_PATH = newsletterPath('/mine')
export const ADMIN_PATH = '/manage/newsletter'
export const MY_ARTICLES_PATH = newsletterPath('/mine/articles')
export const NEW_ARTICLE_PATH = newsletterPath('/mine/articles/new')
export const REVIEW_PATH = `${ADMIN_PATH}/review`
export const DIGESTS_PATH = `${ADMIN_PATH}/digests`
export const ANALYTICS_PATH = `${ADMIN_PATH}/analytics`

export function digestPath(id: string): string {
  return `${DIGESTS_PATH}/${encodeURIComponent(id)}`
}

// Where an article opens in the editor: from the review queue staff stay in
// the admin (so "Volver" leads back to it); everyone else edits it in Mis
// publicaciones.
export function articleEditPath(id: string, from: 'mine' | 'admin' = 'mine'): string {
  return from === 'admin' ? `${REVIEW_PATH}/${id}` : `${MY_ARTICLES_PATH}/${id}/edit`
}

// An organization's pages in Mis publicaciones: profile ('' ), members,
// followers.
export function orgAreaPath(slug: string, page: '' | 'members' | 'followers' = ''): string {
  return newsletterPath(`/mine/org/${encodeURIComponent(slug)}${page ? `/${page}` : ''}`)
}
