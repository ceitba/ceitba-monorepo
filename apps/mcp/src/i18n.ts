import type { Lang } from "./config";

// Messages this server writes itself (errors, notes). CEITBA content comes
// from the API as stored, mostly in Spanish. Spanish is the default; a
// signed-in user's profile language (UserMe.language) switches to English.

const messages = {
  es: {
    signInRequired: "Esta herramienta necesita una sesión de CEITBA. Conectate con OAuth o configurá CEITBA_API_KEY.",
    capabilityRequired: "Tu cuenta no tiene habilitada la función \"{capability}\" (Apuntes / wiki). Pedila a CEITBA.",
    forbidden: "No tenés permiso para esta acción.",
    insufficientScope: "La credencial que usa este servidor no tiene el permiso necesario ({detail}).",
    notFound: "No se encontró: {detail}.",
    rateLimited: "Demasiadas solicitudes. Probá de nuevo en un rato.",
    validation: "Datos inválidos: {detail}",
    upstream: "La API de CEITBA respondió con un error ({detail}).",
    unreachable: "No se pudo contactar a la API de CEITBA.",
    truncated: "Resultado recortado. Pedí la siguiente página u otro offset para ver más.",
    noSchedules: "No hay combinaciones posibles con esas restricciones. Probá permitir superposición, quitar bloqueos o elegir otras comisiones.",
    unknownSubjects: "Estas materias no están en el plan {plan}: {ids}",
    noCommissions: "Estas materias no tienen comisiones cargadas este cuatrimestre: {ids}"
  },
  en: {
    signInRequired: "This tool needs a CEITBA session. Connect with OAuth or set CEITBA_API_KEY.",
    capabilityRequired: "Your account doesn't have the \"{capability}\" feature (Apuntes / wiki) enabled. Ask CEITBA for access.",
    forbidden: "You are not allowed to do this.",
    insufficientScope: "The credential this server uses lacks the required permission ({detail}).",
    notFound: "Not found: {detail}.",
    rateLimited: "Too many requests. Try again in a moment.",
    validation: "Invalid input: {detail}",
    upstream: "The CEITBA API returned an error ({detail}).",
    unreachable: "Could not reach the CEITBA API.",
    truncated: "Result truncated. Ask for the next page or another offset to see more.",
    noSchedules: "No possible combinations with those constraints. Try allowing overlap, removing blocked times or picking other commissions.",
    unknownSubjects: "These subjects are not in plan {plan}: {ids}",
    noCommissions: "These subjects have no commissions loaded this term: {ids}"
  }
} as const;

export type MessageKey = keyof typeof messages.es;

export function t(lang: Lang, key: MessageKey, vars: Record<string, string> = {}): string {
  let s: string = messages[lang][key] ?? messages.es[key];
  for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

export function langFrom(pref: string | null | undefined, fallback: Lang): Lang {
  if (!pref) return fallback;
  return pref.toLowerCase().startsWith("en") ? "en" : "es";
}
