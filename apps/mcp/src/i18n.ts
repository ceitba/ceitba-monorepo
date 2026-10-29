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
    noCommissions: "Estas materias no tienen comisiones cargadas este cuatrimestre: {ids}",
    unknownCommissions: "Ninguna de las comisiones indicadas existe. Comisiones disponibles: {list}",
    unknownPlan: "No existe el plan {plan}. Usá list_careers para ver los planes de cada carrera.",
    noStaffMembers: "Todavía no hay integrantes cargados.",
    noWikiResults: "No hay fragmentos de las wikis que coincidan. Probá con otras palabras o sin limitar la materia.",
    reported: "Reporte enviado. Gracias: CEITBA lo revisa, y con 3 reportes el contenido se oculta.",
    wikiSearchUnavailable: "La búsqueda en las wikis no está disponible en este momento.",
    eventOrgRequired: "Indicá la organización del evento. Podés crear eventos para: {orgs}.",
    eventOrgNotMember: "No sos integrante de \"{org}\". Podés crear eventos para: {orgs}.",
    eventInPast: "La fecha {date} ya pasó (hoy es {today}). Revisá la fecha del evento.",
    eventEndBeforeStart: "La hora de fin ({end}) tiene que ser posterior a la de inicio ({start}), el mismo día.",
    eventCreated: "Evento creado. Los seguidores de la organización reciben una notificación; se edita o borra desde el newsletter en la web."
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
    noCommissions: "These subjects have no commissions loaded this term: {ids}",
    unknownCommissions: "None of the given commissions exist. Available commissions: {list}",
    unknownPlan: "There is no plan {plan}. Use list_careers to see each degree's plans.",
    noStaffMembers: "No team members have been loaded yet.",
    noWikiResults: "No wiki passages match. Try other words or drop the subject filter.",
    reported: "Report sent. Thanks: CEITBA reviews it, and 3 reports hide the content.",
    wikiSearchUnavailable: "Wiki search is not available right now.",
    eventOrgRequired: "Say which organization the event is for. You can create events for: {orgs}.",
    eventOrgNotMember: "You are not a member of \"{org}\". You can create events for: {orgs}.",
    eventInPast: "{date} is in the past (today is {today}). Check the event date.",
    eventEndBeforeStart: "The end time ({end}) must be after the start time ({start}), on the same day.",
    eventCreated: "Event created. The organization's followers get a notification; edit or delete it from the newsletter on the website."
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
