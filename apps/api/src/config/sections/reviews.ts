import { z } from 'zod';
import { defineSection } from '../registry';

// Subject reviews (docs/SUBJECT-REVIEWS.md).
const schema = z.object({
  /** REVIEWS_DIRECTORY_USE_FAKE: name professors from a fixed list instead of the Google directory. */
  directoryUseFake: z.boolean(),
});

declare module '../registry' {
  interface ConfigSections { reviews: z.infer<typeof schema> }
}

export default defineSection('reviews', schema, ({ env }) => ({
  directoryUseFake: env.bool('REVIEWS_DIRECTORY_USE_FAKE', false),
}));
