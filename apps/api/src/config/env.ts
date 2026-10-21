// Spring-compatible environment readers used by the config sections.
//
// Every value in apps/api/src/main/resources/application.yml is written as a
// placeholder `${ENV_VAR:default}`. Spring resolves it as: the env var when it
// is SET (even to an empty string), otherwise the default. `Env.str` does the
// same. Conversions follow Spring's: lists are comma-separated and trimmed,
// booleans accept true/false/yes/no/on/off/1/0, durations accept Spring's
// simple (`10m`, `60s`, `60d`, `500ms`, plain number = millis) and ISO-8601
// (`PT5M`, `P30D`) styles.

export type RawEnv = Record<string, string | undefined>;

export class ConfigError extends Error {}

export class Env {
  constructor(readonly raw: RawEnv) {}

  /** `${name:def}`: the env var when set (even empty), else the default. */
  str(name: string, def: string): string {
    const v = this.raw[name];
    return v === undefined ? def : v;
  }

  /** `${a:${b:def}}`: the first env var that is set, else the default. */
  strChain(names: string[], def: string): string {
    for (const n of names) {
      const v = this.raw[n];
      if (v !== undefined) return v;
    }
    return def;
  }

  /** Optional value: undefined when unset or blank. */
  opt(name: string): string | undefined {
    const v = this.raw[name];
    return v === undefined || v.trim() === '' ? undefined : v;
  }

  bool(name: string, def: boolean): boolean {
    return parseBool(this.str(name, String(def)), name);
  }

  int(name: string, def: number): number {
    return parseIntStrict(this.str(name, String(def)), name);
  }

  num(name: string, def: number): number {
    const s = this.str(name, String(def)).trim();
    const n = Number(s);
    if (s === '' || !Number.isFinite(n)) throw new ConfigError(`${name}: '${s}' is not a number`);
    return n;
  }

  /** Duration in milliseconds (Spring DurationStyle; plain numbers are millis). */
  duration(name: string, def: string): number {
    return parseDuration(this.str(name, def), name);
  }

  list(name: string, def: string): string[] {
    return parseList(this.str(name, def));
  }
}

export function parseBool(value: string, name = 'value'): boolean {
  const v = value.trim().toLowerCase();
  if (['true', 'yes', 'on', '1'].includes(v)) return true;
  if (['false', 'no', 'off', '0'].includes(v)) return false;
  throw new ConfigError(`${name}: '${value}' is not a boolean`);
}

export function parseIntStrict(value: string, name = 'value'): number {
  const v = value.trim();
  if (!/^[+-]?\d+$/.test(v)) throw new ConfigError(`${name}: '${value}' is not an integer`);
  return Number.parseInt(v, 10);
}

// Spring's StringToCollectionConverter: comma-delimited, each element trimmed.
// An empty (or blank) string is an empty list.
export function parseList(value: string): string[] {
  if (value.trim() === '') return [];
  return value.split(',').map((s) => s.trim());
}

const SIMPLE_UNITS: Record<string, number> = {
  ns: 1e-6, us: 1e-3, ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000,
};

/**
 * Spring Boot DurationStyle.detectAndParse, in milliseconds. SIMPLE:
 * `^([+-]?\d+)([a-zA-Z]{0,2})$` (no unit = ms). ISO-8601: `PnDTnHnMn.nS`
 * (java.time.Duration.parse: days, hours, minutes, seconds; no years/months).
 */
export function parseDuration(value: string, name = 'duration'): number {
  const v = value.trim();
  const simple = /^([+-]?\d+)([a-zA-Z]{0,2})$/.exec(v);
  if (simple) {
    const unit = (simple[2] || 'ms').toLowerCase();
    const mult = SIMPLE_UNITS[unit];
    if (mult === undefined) throw new ConfigError(`${name}: unknown duration unit '${simple[2]}' in '${value}'`);
    return Number(simple[1]) * mult;
  }
  const iso = /^([+-]?)P(?:([+-]?\d+)D)?(?:T(?:([+-]?\d+)H)?(?:([+-]?\d+)M)?(?:([+-]?\d+)(?:[.,](\d{0,9}))?S)?)?$/i.exec(v);
  if (iso && /\d/.test(v) && !/T$/i.test(v)) {
    const sign = iso[1] === '-' ? -1 : 1;
    const days = Number(iso[2] ?? 0);
    const hours = Number(iso[3] ?? 0);
    const minutes = Number(iso[4] ?? 0);
    const secs = Number(iso[5] ?? 0);
    const frac = iso[6] ? Number(`0.${iso[6]}`) * (secs < 0 || iso[5]?.startsWith('-') ? -1 : 1) : 0;
    return sign * (days * 86_400_000 + hours * 3_600_000 + minutes * 60_000 + (secs + frac) * 1000);
  }
  throw new ConfigError(`${name}: '${value}' is not a valid duration`);
}

/** Spring profiles: SPRING_PROFILES_ACTIVE, else application.yml's `spring.profiles.active: dev`. */
export function activeProfiles(env: Env): string[] {
  return parseList(env.str('SPRING_PROFILES_ACTIVE', 'dev')).filter((p) => p !== '');
}
