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
// drafts, their organizations' events and profiles) and the staff admin
// (review queue, weekly digest, analytics).
export const MINE_PATH = newsletterPath('/mine')
export const ADMIN_PATH = newsletterPath('/admin')
export const MY_ARTICLES_PATH = newsletterPath('/mine/articles')
export const NEW_ARTICLE_PATH = newsletterPath('/mine/articles/new')
export const REVIEW_PATH = newsletterPath('/admin/review')

// Where an article opens in the editor: from the review queue staff stay in
// the admin (so "Volver" leads back to it); everyone else edits it in Mis
// publicaciones.
export function articleEditPath(id: string, from: 'mine' | 'admin' = 'mine'): string {
  return from === 'admin' ? `${REVIEW_PATH}/${id}` : `${MY_ARTICLES_PATH}/${id}/edit`
}
