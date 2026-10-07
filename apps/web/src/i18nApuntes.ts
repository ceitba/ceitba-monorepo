import i18n from './i18n'
import es from './locales/apuntes.es.json'
import en from './locales/apuntes.en.json'

// Strings for the Apuntes pages, the subject wikis and their /manage tab
// (keys apuntes.*, wiki.*, manage.drive.*, and the dev-only devLogin.*). They live outside the main
// locale files so they ship with the lazily loaded Apuntes chunks instead
// of the home page bundle: every module that renders them imports this
// file, which merges them into the default namespace on first load.
i18n.addResourceBundle('es', 'translation', es, true, true)
i18n.addResourceBundle('en', 'translation', en, true, true)
