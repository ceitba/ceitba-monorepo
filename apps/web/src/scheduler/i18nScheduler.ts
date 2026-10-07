import i18n from '@/i18n'
import es from './locales/es.json'
import en from './locales/en.json'

// Scheduler strings ship with the lazily loaded scheduler chunk, in their
// own namespace so their keys can't collide with the rest of the app.
// SchedulerApp makes "scheduler" the default namespace for its subtree.
i18n.addResourceBundle('es', 'scheduler', es, true, true)
i18n.addResourceBundle('en', 'scheduler', en, true, true)

export default i18n
