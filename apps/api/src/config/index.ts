import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { activeProfiles, ConfigError, Env, type RawEnv } from './env';
import type { Config, SectionContext, SectionDefinition } from './registry';

export type { Config } from './registry';
export { ConfigError } from './env';

const SECTIONS_DIR = join(import.meta.dir, 'sections');

let sections: SectionDefinition[] | undefined;

/** Imports every src/config/sections/*.ts once (auto-discovery; no list to edit). */
async function loadSections(): Promise<SectionDefinition[]> {
  if (sections) return sections;
  const files = readdirSync(SECTIONS_DIR).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).sort();
  const loaded: SectionDefinition[] = [];
  for (const f of files) {
    const mod = (await import(join(SECTIONS_DIR, f))) as { default?: SectionDefinition };
    if (!mod.default?.key) throw new ConfigError(`src/config/sections/${f} must default-export defineSection(...)`);
    loaded.push(mod.default);
  }
  sections = loaded;
  return loaded;
}

/**
 * Parses the environment into the typed Config, failing fast (like Spring's
 * binding at boot) with every section's errors.
 */
export async function loadConfig(raw: RawEnv = process.env): Promise<Config> {
  const env = new Env(raw);
  const profiles = activeProfiles(env);
  const ctx: SectionContext = { env, profiles, hasProfile: (p) => profiles.includes(p) };
  const out: Record<string, unknown> = { profiles };
  const errors: string[] = [];
  for (const s of await loadSections()) {
    try {
      const parsed = s.schema.safeParse(s.build(ctx));
      if (!parsed.success) {
        errors.push(`${s.key}: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      } else {
        out[s.key] = parsed.data;
      }
    } catch (e) {
      errors.push(`${s.key}: ${(e as Error).message}`);
    }
  }
  if (errors.length) throw new ConfigError(`Invalid configuration:\n  ${errors.join('\n  ')}`);
  return Object.freeze(out) as unknown as Config;
}
