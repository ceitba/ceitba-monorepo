// Request binding + validation with Java semantics, built on zod.
//
// A Java request DTO is bound by Jackson, then checked by Bean Validation
// (@Valid). The two fail differently, and so does this helper:
//   - BINDING failures (JSON of the wrong shape: an object where a String
//     goes, "abc" for an Integer, an unknown enum constant, a bad UUID) are
//     HttpMessageNotReadableException -> 400 BadRequest
//     "Malformed or invalid request body" (MalformedBodyError).
//   - CONSTRAINT failures are MethodArgumentNotValidException -> 400
//     ValidationError "field: message; field2: message" with Hibernate
//     Validator's default messages (BeanValidationError).
// Jackson's lenient scalar coercions (Spring Boot defaults) are reproduced:
// numbers/booleans bind to String ("id": 123 -> "123"), numeric strings bind
// to Integer/Long/Double, floats truncate to ints, "" binds to null for boxed
// numbers, unknown properties are ignored, absent = null (primitives: 0/false).
//
// Usage (a Java record `CreateCareerRequest(@NotBlank @Size(max=25) String id, ...)`):
//   export const CreateCareerRequest = jv.object({
//     id: jv.string({ notBlank: true, size: { max: 25 } }),
//     name: jv.string({ notBlank: true, size: { max: 255 } }),
//   });
//   type CreateCareerRequest = z.output<typeof CreateCareerRequest>;  // { id: string | null; name: string | null }
//
// Violation ORDER: Hibernate Validator reports violations from a HashSet, so
// Java's order for several failing fields is not stable; we list them in
// declaration order. Assert single violations or use set equality in tests.

import { z } from 'zod';
import {
  ArgumentTypeMismatchError, BeanValidationError, MalformedBodyError, MissingParameterError,
} from './errors';
import { parseIsoInstant, type Micros } from '../lib/time';
import { isHibernateEmail } from '../lib/beanConstraints';
import { JAVA_NOT_S, JAVA_S, javaTrim } from '../lib/javaCompat';
import { beanMessage, DEFAULT_LOCALE, type JavaLocale } from './locale';

const BIND = 'java_bind';

type Ctx = z.RefinementCtx;
function bindFail(ctx: Ctx, what: string): typeof z.NEVER {
  ctx.addIssue({ code: 'custom', message: `cannot bind ${what}`, params: { [BIND]: true } });
  return z.NEVER;
}
/**
 * A constraint violation: `key` is the Bean Validation constraint (Size, NotBlank...),
 * rendered later in the request locale (Hibernate's bundles, src/http/locale.ts).
 */
function violation(ctx: Ctx, key: string, args: Record<string, string | number | boolean> = {}) {
  ctx.addIssue({ code: 'custom', message: key, params: { bean: { key, args } } });
}
/** A custom validator's literal message (not localized). */
function literal(ctx: Ctx, message: string) {
  ctx.addIssue({ code: 'custom', message, params: { bean: { literal: message } } });
}

const MAX_INT = 2147483647;

export interface SizeOpts { min?: number; max?: number }
function checkSize(ctx: Ctx, len: number, size?: SizeOpts) {
  if (!size) return;
  const min = size.min ?? 0;
  const max = size.max ?? MAX_INT;
  if (len < min || len > max) violation(ctx, 'Size', { min, max });
}

export interface CommonOpts {
  /** @NotNull */
  notNull?: boolean;
  /** Extra check returning a message (custom ConstraintValidator) or null. */
  check?: (v: never) => string | null;
}

export interface StringOpts extends CommonOpts {
  notBlank?: boolean;
  notEmpty?: boolean;
  size?: SizeOpts;
  /**
   * @Pattern(regexp = ...): `regexp` is the Java source (shown in the message, and
   * translated for `(?i)`, `\\s`, `\\S`); pass `js` when it uses other Java-only syntax.
   */
  pattern?: { regexp: string; js?: RegExp };
  /** @Email (Hibernate Validator's regexes, src/lib/beanConstraints.ts). */
  email?: boolean;
}

export interface NumberOpts extends CommonOpts {
  min?: number;
  max?: number;
  positive?: boolean;
  positiveOrZero?: boolean;
  negative?: boolean;
  negativeOrZero?: boolean;
  /** Java primitive (int/long/double): absent or null binds to 0. */
  primitive?: boolean;
}

function nullCheck(ctx: Ctx, v: unknown, o: CommonOpts | undefined): boolean {
  if (v === null) {
    if (o?.notNull) violation(ctx, 'NotNull');
    return false;
  }
  return true;
}

function runCustom(ctx: Ctx, v: unknown, o: CommonOpts | undefined) {
  if (o?.check) {
    const m = o.check(v as never);
    if (m) literal(ctx, m);
  }
}

function numberChecks(ctx: Ctx, n: number, o: NumberOpts | undefined) {
  if (!o) return;
  if (o.min !== undefined && n < o.min) violation(ctx, 'Min', { value: o.min });
  if (o.max !== undefined && n > o.max) violation(ctx, 'Max', { value: o.max });
  if (o.positive && !(n > 0)) violation(ctx, 'Positive');
  if (o.positiveOrZero && !(n >= 0)) violation(ctx, 'PositiveOrZero');
  if (o.negative && !(n < 0)) violation(ctx, 'Negative');
  if (o.negativeOrZero && !(n <= 0)) violation(ctx, 'NegativeOrZero');
}

/** Java regex -> anchored JS RegExp (Matcher.matches()): `(?i)` prefix and `\\s`/`\\S` classes. */
export function javaPattern(regexp: string): RegExp {
  let src = regexp;
  let flags = '';
  if (src.startsWith('(?i)')) { flags = 'i'; src = src.slice(4); }
  return new RegExp(`^(?:${translateJavaWhitespace(src)})$`, flags);
}

// Java's \s/\S are ASCII-only, JS's are Unicode. Outside a character class they become whole classes;
// inside one (`[^@\s]`) only the members can be spliced in, since JS has no nested classes without the v flag.
function translateJavaWhitespace(src: string): string {
  const members = JAVA_S.slice(1, -1);
  let out = '';
  let inClass = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (c === '\\' && i + 1 < src.length) {
      const n = src[++i]!;
      if (n === 's') out += inClass ? members : JAVA_S;
      else if (n === 'S') {
        if (inClass) throw new Error(`javaPattern: \\S inside a character class is not supported: ${src}`);
        out += JAVA_NOT_S;
      } else out += c + n;
    } else {
      if (c === '[' && !inClass) inClass = true;
      else if (c === ']' && inClass && !/\[\^?$/.test(out)) inClass = false;
      out += c;
    }
  }
  return out;
}

function toJavaIntegral(v: unknown, ctx: Ctx, bits: 32 | 64): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return bindFail(ctx, 'number');
    const t = Math.trunc(v);
    if (bits === 32 && (t > MAX_INT || t < -MAX_INT - 1)) return bindFail(ctx, 'int out of range');
    return t;
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '') return null;
    if (!/^[+-]?\d+$/.test(s)) return bindFail(ctx, 'integer string');
    const n = Number(s);
    if (bits === 32 && (n > MAX_INT || n < -MAX_INT - 1)) return bindFail(ctx, 'int out of range');
    return n;
  }
  return bindFail(ctx, 'integer');
}

export const jv = {
  /** java.lang.String */
  string(o?: StringOpts) {
    return z.any().transform((v: unknown, ctx): string | null => {
      let s: string | null;
      if (v === undefined || v === null) s = null;
      else if (typeof v === 'string') s = v;
      else if (typeof v === 'number' || typeof v === 'boolean') s = String(v);
      else return bindFail(ctx, 'String');
      if (s === null) {
        if (o?.notBlank) violation(ctx, 'NotBlank');
        if (o?.notEmpty) violation(ctx, 'NotEmpty');
        if (o?.notNull) violation(ctx, 'NotNull');
        return null;
      }
      // @NotBlank: Java String.trim() (chars <= U+0020), not JS trim().
      if (o?.notBlank && javaTrim(s).length === 0) violation(ctx, 'NotBlank');
      if (o?.notEmpty && s.length === 0) violation(ctx, 'NotEmpty');
      // Bean Validation @Size counts UTF-16 chars, like JS length.
      checkSize(ctx, s.length, o?.size);
      if (o?.pattern && !(o.pattern.js ?? javaPattern(o.pattern.regexp)).test(s)) {
        violation(ctx, 'Pattern', { regexp: o.pattern.regexp });
      }
      if (o?.email && !isHibernateEmail(s)) violation(ctx, 'Email');
      runCustom(ctx, s, o);
      return s;
    });
  },

  /** java.lang.Integer (or `int` with primitive: true). */
  int(o?: NumberOpts) {
    return z.any().transform((v: unknown, ctx): number | null => {
      const n = toJavaIntegral(v, ctx, 32);
      const val = n === null && o?.primitive ? 0 : n;
      if (!nullCheck(ctx, val, o)) return null;
      numberChecks(ctx, val!, o);
      runCustom(ctx, val, o);
      return val;
    });
  },

  /** java.lang.Long (or `long`). */
  long(o?: NumberOpts) {
    return z.any().transform((v: unknown, ctx): number | null => {
      const n = toJavaIntegral(v, ctx, 64);
      const val = n === null && o?.primitive ? 0 : n;
      if (!nullCheck(ctx, val, o)) return null;
      numberChecks(ctx, val!, o);
      runCustom(ctx, val, o);
      return val;
    });
  },

  /** java.lang.Double / BigDecimal input (as a JS number). */
  double(o?: NumberOpts) {
    return z.any().transform((v: unknown, ctx): number | null => {
      let n: number | null;
      if (v === undefined || v === null) n = null;
      else if (typeof v === 'number') n = v;
      else if (typeof v === 'string') {
        if (v.trim() === '') n = null;
        else if (Number.isNaN(Number(v))) return bindFail(ctx, 'double');
        else n = Number(v);
      } else return bindFail(ctx, 'double');
      const val = n === null && o?.primitive ? 0 : n;
      if (!nullCheck(ctx, val, o)) return null;
      numberChecks(ctx, val!, o);
      runCustom(ctx, val, o);
      return val;
    });
  },

  /** java.lang.Boolean (or `boolean` with primitive: true: absent/null -> false). */
  bool(o?: CommonOpts & { primitive?: boolean; assertTrue?: boolean }) {
    return z.any().transform((v: unknown, ctx): boolean | null => {
      let b: boolean | null;
      if (v === undefined || v === null) b = o?.primitive ? false : null;
      else if (typeof v === 'boolean') b = v;
      else if (typeof v === 'string' && /^(true|false)$/i.test(v.trim())) b = v.trim().toLowerCase() === 'true';
      else if (typeof v === 'string' && v.trim() === '') b = o?.primitive ? false : null;
      else if (typeof v === 'number' && Number.isInteger(v)) b = v !== 0;
      else return bindFail(ctx, 'boolean');
      if (!nullCheck(ctx, b, o)) return null;
      if (o?.assertTrue && b !== true) violation(ctx, 'AssertTrue');
      runCustom(ctx, b, o);
      return b;
    });
  },

  /** java.util.UUID (lower-cased canonical string). */
  uuid(o?: CommonOpts) {
    return z.any().transform((v: unknown, ctx): string | null => {
      if (v === undefined || v === null || v === '') {
        nullCheck(ctx, null, o);
        return null;
      }
      if (typeof v !== 'string') return bindFail(ctx, 'UUID');
      const u = parseJavaUuid(v);
      if (!u) return bindFail(ctx, 'UUID');
      runCustom(ctx, u, o);
      return u;
    });
  },

  /** A Java enum: exact constant name (or its ordinal, Jackson's default). */
  enum<const T extends readonly [string, ...string[]]>(values: T, o?: CommonOpts) {
    return z.any().transform((v: unknown, ctx): T[number] | null => {
      if (v === undefined || v === null) {
        nullCheck(ctx, null, o);
        return null;
      }
      if (typeof v === 'string') {
        if (v === '') return null;
        if ((values as readonly string[]).includes(v)) return v as T[number];
        return bindFail(ctx, 'enum');
      }
      if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < values.length) return values[v] as T[number];
      return bindFail(ctx, 'enum');
    });
  },

  /** OffsetDateTime / Instant: ISO-8601 with offset, or epoch seconds (number). Output: micros. */
  instant(o?: CommonOpts & { future?: boolean; past?: boolean }) {
    return z.any().transform((v: unknown, ctx): Micros | null => {
      if (v === undefined || v === null) {
        nullCheck(ctx, null, o);
        return null;
      }
      let us: Micros | null;
      if (typeof v === 'number') us = Math.round(v * 1_000_000);
      else if (typeof v === 'string') us = v === '' ? null : parseIsoInstant(v);
      else return bindFail(ctx, 'date-time');
      if (us === null) return v === '' ? null : bindFail(ctx, 'date-time');
      runCustom(ctx, us, o);
      return us;
    });
  },

  /** java.time.LocalDate `YYYY-MM-DD` (output: the same string). */
  localDate(o?: CommonOpts) {
    return z.any().transform((v: unknown, ctx): string | null => {
      if (v === undefined || v === null || v === '') {
        nullCheck(ctx, null, o);
        return null;
      }
      if (typeof v !== 'string' || !isValidLocalDate(v)) return bindFail(ctx, 'LocalDate');
      runCustom(ctx, v, o);
      return v;
    });
  },

  /** java.time.LocalTime `HH:mm[:ss[.SSS]]` (output: normalized `HH:mm:ss[.fff]`). */
  localTime(o?: CommonOpts) {
    return z.any().transform((v: unknown, ctx): string | null => {
      if (v === undefined || v === null || v === '') {
        nullCheck(ctx, null, o);
        return null;
      }
      const m = typeof v === 'string' ? /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,9}))?)?$/.exec(v) : null;
      if (!m) return bindFail(ctx, 'LocalTime');
      const out = `${m[1]}:${m[2]}:${m[3] ?? '00'}${m[4] ? `.${m[4]}` : ''}`;
      runCustom(ctx, out, o);
      return out;
    });
  },

  /** java.util.List<T> (a JSON array; a single value is NOT accepted, Jackson's default). */
  list<S extends z.ZodType>(item: S, o?: CommonOpts & { size?: SizeOpts; notEmpty?: boolean }) {
    return z.any().transform((v: unknown, ctx): z.output<S>[] | null => {
      if (v === undefined || v === null) {
        if (o?.notEmpty) violation(ctx, 'NotEmpty');
        else nullCheck(ctx, null, o);
        return null;
      }
      if (!Array.isArray(v)) return bindFail(ctx, 'List');
      const out: z.output<S>[] = [];
      v.forEach((el, i) => {
        const r = item.safeParse(el);
        if (r.success) out.push(r.data as z.output<S>);
        else for (const iss of r.error.issues) ctx.addIssue({ ...(iss as object), path: [i, ...iss.path] } as never);
      });
      if (o?.notEmpty && v.length === 0) violation(ctx, 'NotEmpty');
      checkSize(ctx, v.length, o?.size);
      runCustom(ctx, out, o);
      return out;
    });
  },

  /**
   * A nested record / the request body itself. Unknown properties are ignored.
   * `json`: @JsonProperty / @JsonAlias renames, component -> JSON name(s) (the first is the
   * property, the rest aliases). The component's own name is then an unknown property, and
   * violations are named by the component (`fileNumber: must be greater than 0`), like Java.
   */
  object<Shape extends Record<string, z.ZodType>>(shape: Shape, o?: CommonOpts & { json?: { [K in keyof Shape]?: string | string[] } }) {
    const inner = z.object(shape);
    const names: Record<string, string[]> = {};
    for (const k of Object.keys(shape)) {
      const j = o?.json?.[k];
      names[k] = j === undefined ? [k] : Array.isArray(j) ? j : [j];
    }
    return z.any().transform((v: unknown, ctx): z.output<typeof inner> | null => {
      if (v === undefined || v === null) {
        nullCheck(ctx, null, o);
        return null;
      }
      if (typeof v !== 'object' || Array.isArray(v)) return bindFail(ctx, 'object');
      const full: Record<string, unknown> = {};
      // Jackson reads properties in document order: of several names (property + aliases), the last one present wins.
      const keys = Object.keys(v as Record<string, unknown>);
      for (const k of Object.keys(shape)) {
        const present = keys.filter((x) => names[k]!.includes(x));
        full[k] = present.length ? (v as Record<string, unknown>)[present[present.length - 1]!] : undefined;
      }
      const r = inner.safeParse(full);
      if (!r.success) {
        for (const iss of r.error.issues) ctx.addIssue(iss as never);
        return z.NEVER;
      }
      runCustom(ctx, r.data, o);
      return r.data;
    });
  },

  /** Map<String, V>; `size` = @Size on the map (its entry count). */
  map<S extends z.ZodType>(value: S, o?: CommonOpts & { size?: SizeOpts }) {
    return z.any().transform((v: unknown, ctx): Record<string, z.output<S>> | null => {
      if (v === undefined || v === null) {
        nullCheck(ctx, null, o);
        return null;
      }
      if (typeof v !== 'object' || Array.isArray(v)) return bindFail(ctx, 'Map');
      const out: Record<string, z.output<S>> = {};
      for (const [k, el] of Object.entries(v as Record<string, unknown>)) {
        const r = value.safeParse(el);
        if (r.success) out[k] = r.data as z.output<S>;
        else for (const iss of r.error.issues) ctx.addIssue({ ...(iss as object), path: [k, ...iss.path] } as never);
      }
      checkSize(ctx, Object.keys(out).length, o?.size);
      runCustom(ctx, out, o);
      return out;
    });
  },

  /** JsonNode / Object: anything, as parsed. */
  json() {
    return z.any().transform((v: unknown): unknown => (v === undefined ? null : v));
  },
};

export function parseJavaUuid(s: string): string | null {
  // UUID.fromString accepts 1-8/1-4/1-4/1-4/1-12 hex groups; canonical output is lower-case padded.
  const m = /^([0-9a-fA-F]{1,8})-([0-9a-fA-F]{1,4})-([0-9a-fA-F]{1,4})-([0-9a-fA-F]{1,4})-([0-9a-fA-F]{1,12})$/.exec(s);
  if (!m || s.length > 36) return null;
  return [m[1]!.padStart(8, '0'), m[2]!.padStart(4, '0'), m[3]!.padStart(4, '0'), m[4]!.padStart(4, '0'), m[5]!.padStart(12, '0')]
    .join('-').toLowerCase();
}

function isValidLocalDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

function fieldPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const p of path) {
    if (typeof p === 'number') out += `[${p}]`;
    else out += out === '' ? String(p) : `.${String(p)}`;
  }
  return out;
}

type BeanParams = { key?: string; args?: Record<string, string | number | boolean>; literal?: string };

function render(issue: z.core.$ZodIssue, locale: JavaLocale): string {
  const b = (issue as { params?: { bean?: BeanParams } }).params?.bean;
  if (!b) return issue.message;
  if (b.literal !== undefined) return b.literal;
  return beanMessage(b.key!, b.args ?? {}, locale);
}

/**
 * Binds + validates a parsed JSON body like Spring's `@Valid @RequestBody`.
 * `locale`: the request locale (resolveRequestLocale(Accept-Language)), which
 * picks Hibernate's message bundle like Spring does.
 */
export function validateBody<S extends z.ZodType>(schema: S, json: unknown, locale: JavaLocale = DEFAULT_LOCALE): z.output<S> {
  if (json === null || json === undefined) throw new MalformedBodyError();
  const r = schema.safeParse(json);
  if (r.success) {
    if (r.data === null) throw new MalformedBodyError();
    return r.data as z.output<S>;
  }
  if (r.error.issues.some((i) => (i as { params?: Record<string, unknown> }).params?.[BIND] || i.code !== 'custom')) {
    throw new MalformedBodyError();
  }
  throw new BeanValidationError(r.error.issues.map((i) => ({ field: fieldPath(i.path), message: render(i, locale) })));
}

/** Binds a body WITHOUT Bean Validation (a `@RequestBody` with no `@Valid`): only binding errors fail. */
export function bindBody<S extends z.ZodType>(schema: S, json: unknown): z.output<S> {
  if (json === null || json === undefined) throw new MalformedBodyError();
  const r = schema.safeParse(json);
  if (r.success) return r.data as z.output<S>;
  if (r.error.issues.some((i) => (i as { params?: Record<string, unknown> }).params?.[BIND] || i.code !== 'custom')) {
    throw new MalformedBodyError();
  }
  // Constraint failures are ignored without @Valid: re-parse leniently is not
  // possible with zod transforms, so DTOs used without @Valid must not declare constraints.
  throw new MalformedBodyError();
}

// ----------------------------------------------------------- path / query params

export type ParamSpec<T> = {
  /** Java type shown in conversion errors: 'java.util.UUID', 'int', 'java.lang.Integer'... */
  javaType: string;
  parse(raw: string | undefined, name: string): T;
};

const PRIMITIVES = new Set(['int', 'long', 'boolean', 'double']);

function conv<T>(javaType: string, required: boolean, fn: (s: string) => T | { error: string }, def?: T): ParamSpec<T | null> {
  return {
    javaType,
    parse(raw, name) {
      if (raw === undefined || (raw === '' && def !== undefined)) {
        if (def !== undefined) return def;
        if (required) throw new MissingParameterError(name, javaType.replace(/^java\.lang\./, '').replace(/^java\.util\./, ''));
        return null;
      }
      // Spring's converters turn "" into null for object types (Integer, UUID, enums, dates; not
      // String), so an optional `?limit=` is absent. A primitive still fails to convert "".
      if (raw === '' && !required && javaType !== 'java.lang.String' && !PRIMITIVES.has(javaType)) return null;
      const r = fn(raw);
      if (r && typeof r === 'object' && 'error' in (r as object)) {
        throw new ArgumentTypeMismatchError(name, raw, javaType, (r as { error: string }).error);
      }
      return r as T;
    },
  };
}

const intParse = (javaType: string) => (s: string) => {
  const t = s.trim();
  if (!/^[+-]?\d+$/.test(t) || (javaType.toLowerCase().includes('int') && Math.abs(Number(t)) > MAX_INT + 1)) {
    return { error: `For input string: "${s}"` };
  }
  return Number(t);
};

/**
 * Path variables (@PathVariable, always required) and query parameters
 * (@RequestParam; `required` defaults to true like Spring, `def` makes it optional).
 */
export const param = {
  string: (o: { required?: boolean; def?: string } = {}) => conv<string>('java.lang.String', o.required ?? true, (s) => s, o.def),
  uuid: (o: { required?: boolean } = {}) => conv<string>('java.util.UUID', o.required ?? true, (s) => parseJavaUuid(s) ?? { error: `Invalid UUID string: ${s}` }),
  int: (o: { required?: boolean; def?: number; primitive?: boolean } = {}) => conv<number>(o.primitive ? 'int' : 'java.lang.Integer', o.required ?? true, intParse('int'), o.def),
  long: (o: { required?: boolean; def?: number; primitive?: boolean } = {}) => conv<number>(o.primitive ? 'long' : 'java.lang.Long', o.required ?? true, intParse('long'), o.def),
  bool: (o: { required?: boolean; def?: boolean } = {}) => conv<boolean>('boolean', o.required ?? true, (s) => {
    const v = s.trim().toLowerCase();
    if (['true', 'on', 'yes', '1'].includes(v)) return true;
    if (['false', 'off', 'no', '0', ''].includes(v)) return false;
    return { error: `Invalid boolean value [${s}]` };
  }, o.def),
  localDate: (o: { required?: boolean } = {}) => conv<string>('java.time.LocalDate', o.required ?? true, (s) => (isValidLocalDate(s) ? s : { error: `Failed to convert from type [java.lang.String] to type [@org.springframework.web.bind.annotation.RequestParam java.time.LocalDate] for value [${s}]` })),
  enum: <const T extends readonly string[]>(values: T, javaType: string, o: { required?: boolean } = {}) =>
    conv<T[number]>(javaType, o.required ?? true, (s) => ((values as readonly string[]).includes(s) ? (s as T[number]) : { error: `Failed to convert from type [java.lang.String] to type [@org.springframework.web.bind.annotation.RequestParam ${javaType}] for value [${s}]` })),
};
