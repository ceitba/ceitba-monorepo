import type { z } from 'zod';
import type { Env } from './env';

/**
 * Typed config sections. Each file in src/config/sections/ augments this
 * interface with its own key (declaration merging), so adding an area never
 * edits a shared file:
 *
 *   declare module '../registry' { interface ConfigSections { myArea: z.infer<typeof schema> } }
 *   export default defineSection('myArea', schema, ({ env }) => ({ ... }));
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ConfigSections {}

export type Config = ConfigSections & {
  /** Active Spring profiles (SPRING_PROFILES_ACTIVE, default `dev` like application.yml). */
  readonly profiles: readonly string[];
};

export interface SectionContext {
  env: Env;
  profiles: readonly string[];
  hasProfile(name: string): boolean;
}

export interface SectionDefinition<K extends keyof ConfigSections = keyof ConfigSections> {
  key: K;
  schema: z.ZodType<ConfigSections[K]>;
  build: (ctx: SectionContext) => unknown;
}

export function defineSection<K extends keyof ConfigSections>(
  key: K,
  schema: z.ZodType<ConfigSections[K]>,
  build: (ctx: SectionContext) => unknown,
): SectionDefinition<K> {
  return { key, schema, build };
}
