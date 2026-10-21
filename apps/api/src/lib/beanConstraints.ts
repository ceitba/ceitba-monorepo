// Hibernate Validator 8.0.1 constraint semantics, for DTO schemas that need
// them exactly (src/http/validation.ts's jv.string options use JS trim(), JS
// regex syntax and a simplified @Email). Use with a binding-only jv field:
//
//   token: jv.string().superRefine(constraints(notBlank(), size({ max: 1024 }), pattern(/^...$/, '[A-Za-z0-9_:.\\-]+')))
//
// Each constraint is evaluated independently (null passes all but @NotBlank),
// like Bean Validation. Messages are Hibernate's defaults for the request
// locale: Spring interpolates them with the Accept-Language locale
// (LocaleContextMessageInterpolator), so `es` gives the Spanish bundle.
// The caller passes the locale (request bodies go through src/http/validation.ts, which
// renders messages in the request locale itself, src/http/locale.ts).

import { domainToASCII } from 'node:url';
import { javaTrim } from './javaCompat';

export type BeanLocale = 'en' | 'es';

// ValidationMessages(_es).properties of hibernate-validator 8.0.1 (checked against the JDK run).
export const BEAN_MESSAGES = {
  en: {
    notBlank: 'must not be blank',
    notNull: 'must not be null',
    size: (min: number, max: number) => `size must be between ${min} and ${max}`,
    pattern: (re: string) => `must match "${re}"`,
    email: 'must be a well-formed email address',
    min: (v: number) => `must be greater than or equal to ${v}`,
  },
  es: {
    notBlank: 'no debe estar vacío',
    notNull: 'no debe ser nulo',
    size: (min: number, max: number) => `el tamaño debe estar entre ${min} y ${max}`,
    pattern: (re: string) => `debe coincidir con "${re}"`,
    email: 'debe ser una dirección de correo electrónico con formato correcto',
    min: (v: number) => `debe ser mayor que o igual a ${v}`,
  },
} as const;

/** A constraint: the violation message for `v`, or null when it holds. */
export type Constraint<T> = (v: T | null, locale: BeanLocale) => string | null;

/** @NotBlank: not null and Java trim() not empty. */
export const notBlank = (): Constraint<string> => (v, l) => (v == null || javaTrim(v).length === 0 ? BEAN_MESSAGES[l].notBlank : null);

/** @Size on a String: UTF-16 length. */
export const size = (o: { min?: number; max?: number }): Constraint<string> => (v, l) => {
  if (v == null) return null;
  const min = o.min ?? 0;
  const max = o.max ?? 2147483647;
  return v.length < min || v.length > max ? BEAN_MESSAGES[l].size(min, max) : null;
};

/**
 * @Pattern: `js` is the Java regexp translated to JS and anchored (Java uses
 * Matcher.matches()); `javaRegexp` is the Java source text for the message.
 */
export const pattern = (js: RegExp, javaRegexp: string, message?: string): Constraint<string> => (v, l) =>
  (v == null || js.test(v) ? null : message ?? BEAN_MESSAGES[l].pattern(javaRegexp));

/** @Min on an int/long. */
export const min = (value: number): Constraint<number> => (v, l) => (v == null || v >= value ? null : BEAN_MESSAGES[l].min(value));

// AbstractEmailValidator / DomainNameUtil (CASE_INSENSITIVE). [\u0080-￿]
// is a BMP range in Java (by code point), hence the `u` flag. Possessive `++`
// is emulated with a lookahead + backreference.
const LOCAL_ATOM = "[a-z0-9!#$%&'*+/=?^_`{|}~\\u0080-\\uffff-]";
const LOCAL_QUOTED = "(?:[a-z0-9!#$%&'*.(),<>\\[\\]:;  @+/=?^_`{|}~\\u0080-\\uffff-]|\\\\\\\\|\\\\\")";
const LOCAL_PART = new RegExp(`^(?:${LOCAL_ATOM}+|"${LOCAL_QUOTED}+")(?:\\.(?:${LOCAL_ATOM}+|"${LOCAL_QUOTED}+"))*$`, 'iu');
const DCH = "[a-z\\u0080-\\uffff0-9!#$%&'*+/=?^_`{|}~]";
const label = (g: number) => `(?:${DCH}-*)*(?=(${DCH}+))\\${g}`;
const IPV4 = '[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}';
const B = '(?:25[0-5]|(?:2[0-4]|1{0,1}[0-9]){0,1}[0-9])';
const H = '[0-9a-fA-F]{1,4}';
const IPV6 = `(?:(?:${H}:){7,7}${H}|(?:${H}:){1,7}:|(?:${H}:){1,6}:${H}|(?:${H}:){1,5}(?::${H}){1,2}|(?:${H}:){1,4}(?::${H}){1,3}`
  + `|(?:${H}:){1,3}(?::${H}){1,4}|(?:${H}:){1,2}(?::${H}){1,5}|${H}:(?:(?::${H}){1,6})|:(?:(?::${H}){1,7}|:)`
  + `|fe80:(?::[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(?:ffff(:0{1,4}){0,1}:){0,1}(?:${B}\\.){3,3}${B}`
  + `|(?:${H}:){1,4}:(?:${B}\\.){3,3}${B})`;
const EMAIL_DOMAIN = new RegExp(`^(?:${label(1)}(?:\\.${label(2)})*|\\[${IPV4}\\]|\\[IPv6:${IPV6}\\])$`, 'iu');

/**
 * java.net.IDN.toASCII (IDNA2003, no flags), approximated: labels split on the
 * IDNA dots, ASCII labels kept, others punycoded by node's domainToASCII
 * (UTS 46); a label over 63 chars throws. Only its length is used here.
 */
function idnToAsciiLength(domain: string): number | null {
  let total = 0;
  const labels = domain.split(/[.。．｡]/);
  for (const [i, l] of labels.entries()) {
    let a = l;
    if (/[^\x00-\x7F]/.test(l)) {
      a = domainToASCII(l);
      if (a === '') return null;
    }
    if (a.length > 63) return null;
    total += a.length + (i > 0 ? 1 : 0);
  }
  return total;
}

/** @Email (null and "" are valid). */
export function isHibernateEmail(value: string): boolean {
  if (value.length === 0) return true;
  const at = value.lastIndexOf('@');
  if (at < 0) return false;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length > 64 || !LOCAL_PART.test(local)) return false;
  if (domain.endsWith('.')) return false;
  const len = idnToAsciiLength(domain);
  if (len == null || len > 255) return false;
  return EMAIL_DOMAIN.test(domain);
}

export const email = (): Constraint<string> => (v, l) => (v == null || isHibernateEmail(v) ? null : BEAN_MESSAGES[l].email);

/** zod superRefine adapter: one issue per failing constraint, in declaration order. */
export function constraints<T>(...cs: Constraint<T>[]) {
  return (v: T | null, ctx: { addIssue(issue: { code: 'custom'; message: string }): void }, locale: BeanLocale = 'en') => {
    for (const c of cs) {
      const m = c(v, locale);
      if (m != null) ctx.addIssue({ code: 'custom', message: m });
    }
  };
}
