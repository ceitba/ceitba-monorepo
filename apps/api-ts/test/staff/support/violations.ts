// Validator.validate(dto) for zod DTO schemas: the violations as
// {path, message}, sorted by path (Java's order is a HashSet's). jv
// constraint issues carry a bean key rendered in the given locale (default
// en_US, the JVM default), like validateBody does for a request.
import type { z } from 'zod';
import { beanMessage, DEFAULT_LOCALE, type JavaLocale } from '../../../src/http/locale';

type BeanParams = { key?: string; args?: Record<string, string | number | boolean>; literal?: string };

export function violations(schema: z.ZodType, value: unknown, locale: JavaLocale = DEFAULT_LOCALE): { path: string; message: string }[] {
  const r = schema.safeParse(value);
  if (r.success) return [];
  return r.error.issues.map((i) => {
    const b = (i as { params?: { bean?: BeanParams } }).params?.bean;
    const message = !b ? i.message : b.literal !== undefined ? b.literal : beanMessage(b.key!, b.args ?? {}, locale);
    return { path: i.path.map(String).join('.'), message };
  }).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.message < b.message ? -1 : a.message > b.message ? 1 : 0));
}

export const paths = (schema: z.ZodType, value: unknown): string[] => violations(schema, value).map((v) => v.path);
