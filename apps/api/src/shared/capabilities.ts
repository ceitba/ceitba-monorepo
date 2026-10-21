// service/capability/CapabilityService.effective / enabledForAll and the
// Capability registry. Shared because GET /v1/auth/me reports capabilities;
// the capability feature (src/features/capability) builds on these.

import type { Db } from '../db/client';
import { capabilitiesByEmail, capabilitiesByMember, capabilitiesEnabledForAll, isActiveStaff } from '../http/auth/repo';
import type { Micros } from '../lib/time';

export const CAPABILITIES = [
  { key: 'apuntes', label: 'Apuntes', description: 'Compartir carpetas de Drive, ver apuntes y wikis por materia' },
  { key: 'resumen_semanal', label: 'Resumen semanal', description: "Recibir el mail semanal 'La semana en ITBA'" },
  { key: 'asistentes_ia', label: 'Asistentes de IA', description: 'Conectar asistentes de IA (Claude, ChatGPT...) a CEITBA por el servidor MCP' },
] as const;
export type CapabilityKey = (typeof CAPABILITIES)[number]['key'];

const KNOWN = new Set<string>(CAPABILITIES.map((c) => c.key));
/** TreeSet<String> order (UTF-16 code units). */
const sorted = (s: Iterable<string>) => [...new Set(s)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * Effective capability keys, sorted. Staff hold every capability through ANY
 * credential (capabilities are not staff powers, so this asks the staff table
 * directly, not StaffPowers).
 */
export async function effectiveCapabilities(db: Db, user: { id: string; email: string | null } | null, now: Micros): Promise<string[]> {
  if (!user) return [];
  if (await isActiveStaff(db, user.id, now)) return sorted(KNOWN);
  const granted = new Set<string>(await capabilitiesEnabledForAll(db));
  if (user.email != null) for (const c of await capabilitiesByEmail(db, user.email.toLowerCase())) granted.add(c);
  for (const c of await capabilitiesByMember(db, user.id)) granted.add(c);
  return sorted([...granted].filter((c) => KNOWN.has(c)));
}

/** Keys switched on for everyone (GET /v1/capabilities for anonymous visitors). */
export async function capabilitiesForEveryone(db: Db): Promise<string[]> {
  return sorted((await capabilitiesEnabledForAll(db)).filter((c) => KNOWN.has(c)));
}
