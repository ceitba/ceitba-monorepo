// Spring's @RequestParam on a POST also reads an x-www-form-urlencoded body.
import type { AppContext } from '../../http/context';

/** @RequestParam(required = false): the query string first, then an x-www-form-urlencoded body (getParameter). */
export async function requestParam(c: AppContext, name: string): Promise<string | null> {
  const q = c.req.query(name);
  if (q !== undefined) return q;
  const type = c.req.header('content-type') ?? '';
  if (!/^application\/x-www-form-urlencoded/i.test(type)) return null;
  try {
    return new URLSearchParams(await c.req.text()).get(name);
  } catch {
    return null;
  }
}
