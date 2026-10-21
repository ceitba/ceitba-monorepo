import { z } from 'zod';
import { defineSection } from '../registry';

// logging.level.* (application.yml: root INFO, org.ceitba.api DEBUG; prod INFO).
const schema = z.object({
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']),
  /** Pretty-print instead of JSON lines (local dev). */
  pretty: z.boolean(),
});

declare module '../registry' {
  interface ConfigSections { logging: z.infer<typeof schema> }
}

export default defineSection('logging', schema, ({ env, hasProfile }) => ({
  level: (env.opt('LOG_LEVEL') ?? (hasProfile('prod') ? 'info' : 'debug')).toLowerCase(),
  pretty: env.bool('LOG_PRETTY', false),
}));
