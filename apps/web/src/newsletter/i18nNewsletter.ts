import i18n from '@/i18n'
import es from './locales/es.json'
import en from './locales/en.json'

// Newsletter strings ship with the lazily loaded newsletter chunk, in their
// own namespace so their keys can't collide with the rest of the app.
// NewsletterApp makes "newsletter" the default namespace for its subtree.
i18n.addResourceBundle('es', 'newsletter', es, true, true)
i18n.addResourceBundle('en', 'newsletter', en, true, true)

export default i18n
