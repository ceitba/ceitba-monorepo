// Validator.validate(dto) for zod DTO schemas: the violations as
// {path, message}, sorted by path (Java's order is a HashSet's).
import type { z } from 'zod';

export function violations(schema: z.ZodType, value: unknown): { path: string; message: string }[] {
  const r = schema.safeParse(value);
  if (r.success) return [];
  return r.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.message < b.message ? -1 : a.message > b.message ? 1 : 0));
}

export const paths = (schema: z.ZodType, value: unknown): string[] => violations(schema, value).map((v) => v.path);
