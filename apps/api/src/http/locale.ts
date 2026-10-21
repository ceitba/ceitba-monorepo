// The locale Bean Validation messages are interpolated in. Spring puts the
// request locale (AcceptHeaderLocaleResolver: Tomcat's request.getLocale(),
// the highest-q Accept-Language entry, else the JVM default) in
// LocaleContextHolder; LocaleContextMessageInterpolator hands it to Hibernate,
// whose ResourceBundle lookup tries lang_COUNTRY, lang, then (only if neither
// exists) the JVM default locale's bundles, then the base bundle.

import { VALIDATION_BUNDLES } from '../lib/validationMessages';

export interface JavaLocale { language: string; country: string }

/** The JVM default locale of the Java image (eclipse-temurin: LANG=en_US.UTF-8). */
export const DEFAULT_LOCALE: JavaLocale = { language: 'en', country: 'US' };

export function parseLocaleTag(tag: string): JavaLocale | null {
  const m = /^([A-Za-z]{1,8})(?:[-_]([A-Za-z0-9]{1,8}))?/.exec(tag.trim());
  if (!m || m[1] === '*') return null;
  const country = m[2] && /^([A-Za-z]{2}|\d{3})$/.test(m[2]) ? m[2].toUpperCase() : '';
  return { language: m[1]!.toLowerCase(), country };
}

/** Tomcat Request.parseLocales + getLocale: highest quality first (stable), q=0 dropped. */
export function resolveRequestLocale(acceptLanguage: string | null | undefined, fallback: JavaLocale = DEFAULT_LOCALE): JavaLocale {
  if (!acceptLanguage || acceptLanguage.trim() === '') return fallback;
  const entries: { loc: JavaLocale; q: number; i: number }[] = [];
  acceptLanguage.split(',').forEach((part, i) => {
    const [tag, ...params] = part.split(';');
    let q = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/.exec(p);
      if (m) q = Number(m[1]);
    }
    if (!tag || tag.trim() === '*' || !(q > 0)) return;
    const loc = parseLocaleTag(tag);
    if (loc) entries.push({ loc, q, i });
  });
  entries.sort((a, b) => b.q - a.q || a.i - b.i);
  return entries[0]?.loc ?? fallback;
}

function candidates(l: JavaLocale): string[] {
  return [l.country ? `${l.language}_${l.country}` : '', l.language].filter((c) => c && c in VALIDATION_BUNDLES);
}

/** The bundle chain Hibernate reads for `locale` (most specific first, base last). */
export function bundleChain(locale: JavaLocale, fallback: JavaLocale = DEFAULT_LOCALE): string[] {
  const own = candidates(locale);
  return [...(own.length ? own : candidates(fallback)), ''];
}

/** A Hibernate default message for constraint `key` (e.g. 'Size'), interpolated. */
export function beanMessage(key: string, args: Record<string, string | number | boolean>, locale: JavaLocale, fallback = DEFAULT_LOCALE): string {
  let template = key;
  for (const b of bundleChain(locale, fallback)) {
    const t = VALIDATION_BUNDLES[b]?.[key];
    if (t !== undefined) { template = t; break; }
  }
  return template
    .replace(/\$\{inclusive == true \? '([^']*)' : '([^']*)'\}/g, (_m, yes: string, no: string) => (args.inclusive === false ? no : yes))
    .replace(/\{(\w+)\}/g, (m, name: string) => (name in args ? String(args[name]) : m));
}
