// SavedScheduleService.payloadChanged (apps/api/.../service/user/SavedScheduleService.java):
// payload_updated_at (digest staleness) moves only on a real change. Compared
// as canonical JSON (map keys sorted, recursively, by UTF-16 order like
// Jackson's ORDER_MAP_ENTRIES_BY_KEYS), so key order and Integer/Long are not changes.
// Difference: Java distinguishes 1 from 1.0 (Integer vs Double); JS numbers do not.
//
// TODO(user-service): the rest of SavedScheduleService (CRUD, MAX_PER_USER = 5, primary) is repository code.

function canonical(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

export function payloadChanged(stored: Record<string, unknown> | null | undefined,
                               incoming: Record<string, unknown> | null | undefined): boolean {
  return canonical(stored ?? {}) !== canonical(incoming ?? {});
}
