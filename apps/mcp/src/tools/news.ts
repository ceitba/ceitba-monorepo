import { z } from "zod";
import type { Page } from "../api/types";
import type { Lang } from "../config";
import { t } from "../i18n";
import { clampLimit, compact, cut, hhmm } from "../trim";
import { canActAsStaff, defineTool, ToolError } from "./define";

interface Article {
  id: string; title: string; excerpt: string | null; body: string[] | null; category: string | null;
  organization: string | null; authors: string[] | null; publishedAt: string | null; readingTime: string | null;
  featured: boolean; status: string;
}

interface NewsEvent {
  id: string; title: string; eventDate: string; startTime: string | null; endTime: string | null;
  location: string | null; category: string | null; organization: string | null; description: string | null;
}

interface Organization {
  slug: string; name: string; fullName: string | null; description: string | null; category: string | null;
  followerCount: number;
}

// "Today" for CEITBA is Argentina's calendar day (dates are YYYY-MM-DD with no time zone).
export const todayInArgentina = (now = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(now);

const pick = (lang: Lang, es: string | null | undefined, en: string | null | undefined) =>
  (lang === "en" ? en || es : es || en) ?? undefined;

const page = z.number().int().min(1).optional().describe("Página (desde 1). / Page (1-based).");
const limit = z.number().int().min(1).max(50).optional().describe("Resultados por página (máx. 50). / Page size.");

export const listArticles = defineTool({
  name: "list_articles",
  title: "Noticias del newsletter",
  description:
    "Artículos publicados del newsletter estudiantil (ITBA News), más nuevos primero. Filtrá por categoría u organización (slug). " +
    "EN: Published student newsletter articles, newest first.",
  access: "public",
  input: {
    category: z.string().optional(),
    organization: z.string().optional().describe("Slug de organización (ver list_organizations). / Organization slug."),
    page,
    limit
  },
  async run(args, ctx) {
    const res = await ctx.api.get<Page<Article>>("/v1/articles", {
      category: args.category, organization: args.organization, page: args.page ?? 1, limit: clampLimit(args.limit, 10, 50)
    });
    return {
      total: res.meta.total,
      page: res.meta.page,
      articles: res.data.map(a => compact({
        id: a.id, title: a.title, excerpt: a.excerpt, category: a.category, organization: a.organization,
        publishedAt: a.publishedAt, authors: a.authors, readingTime: a.readingTime, featured: a.featured || undefined
      }))
    };
  }
});

export const getArticle = defineTool({
  name: "get_article",
  title: "Leer artículo",
  description:
    "Texto completo de un artículo del newsletter. Los textos largos se devuelven por partes: usá offset para seguir. " +
    "EN: Full text of a newsletter article, paged by offset when long.",
  access: "public",
  input: {
    id: z.string().min(1),
    offset: z.number().int().min(0).optional(),
    maxChars: z.number().int().min(500).max(20000).optional().describe("Por defecto 8000. / Default 8000.")
  },
  async run(args, ctx) {
    const a = await ctx.api.get<Article>(`/v1/articles/${encodeURIComponent(args.id)}`);
    const body = cut((a.body ?? []).join("\n\n"), args.maxChars ?? 8000, args.offset ?? 0);
    return compact({
      id: a.id, title: a.title, excerpt: a.excerpt, category: a.category, organization: a.organization,
      authors: a.authors, publishedAt: a.publishedAt, status: a.status === "published" ? undefined : a.status,
      body: body.text,
      bodyTotalChars: body.totalChars,
      nextOffset: body.truncated ? body.offset + body.text.length : undefined
    });
  }
});

export const listEvents = defineTool({
  name: "list_events",
  title: "Eventos",
  description:
    "Agenda de eventos estudiantiles (charlas, fiestas, torneos...). Por defecto desde hoy. Fechas YYYY-MM-DD, hora Argentina. " +
    "EN: Student events calendar, from today by default (dates YYYY-MM-DD, Argentina time).",
  access: "public",
  input: {
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    category: z.string().optional(),
    organization: z.string().optional(),
    page,
    limit
  },
  async run(args, ctx) {
    const res = await ctx.api.get<Page<NewsEvent>>("/v1/news/events", {
      from: args.from ?? todayInArgentina(), to: args.to, category: args.category, organization: args.organization,
      page: args.page ?? 1, limit: clampLimit(args.limit, 20, 50)
    });
    return {
      total: res.meta.total,
      page: res.meta.page,
      events: res.data.map(e => compact({
        id: e.id, title: e.title, date: e.eventDate,
        time: e.startTime ? `${hhmm(e.startTime)}${e.endTime ? "-" + hhmm(e.endTime) : ""}` : undefined,
        location: e.location, category: e.category, organization: e.organization,
        description: e.description ? cut(e.description, 400).text : undefined
      }))
    };
  }
});

// The API's news categories (apps/api src/features/news/logic/newsCategories.ts).
export const EVENT_CATEGORIES = ["Académico", "Campus", "Cultura", "Deportes", "Tecnología", "Organizaciones", "General"] as const;

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

// Invites rarely say when an event ends: start + 2 h, capped at 23:59. An event has one date and the
// web form, digest and .ics export all expect end > start, so the end never wraps past midnight.
export const defaultEndTime = (start: string): string => {
  const [h, m] = start.split(":").map(Number);
  const end = Math.min(h! * 60 + m! + 120, 23 * 60 + 59);
  return `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`;
};

export const createEvent = defineTool({
  name: "create_event",
  title: "Crear evento",
  description:
    "Publica un evento en la agenda de CEITBA para una organización de la que sos integrante (el staff puede publicar para " +
    "cualquiera, u omitir la organización). Sirve para pasar una invitación (p. ej. un mensaje de WhatsApp) a la agenda: " +
    "extraé título, fecha, horario, lugar y descripción. Si falta la hora de fin se usa inicio + 2 h (hasta las 23:59); la hora de fin debe ser posterior al inicio, el mismo día. ANTES de llamarla, " +
    "mostrale a la persona el evento tal como se va a publicar y esperá su confirmación: se publica al instante y notifica a " +
    "los seguidores de la organización. No reintentes si falla. " +
    "EN: Publishes an event for an organization you belong to (staff: any, or none). Turn an invite into an event; end " +
    "defaults to start + 2 h (capped at 23:59) and must be after the start, same day. Show the person the parsed event and get confirmation first: it is public at once and notifies " +
    "the organization's followers. Never retry.",
  access: "user",
  events: true,
  annotations: { destructiveHint: false, idempotentHint: false },
  input: {
    organization: z.string().min(1).optional()
      .describe("Slug de la organización (ver whoami / list_organizations). Obligatorio salvo para staff. / Organization slug; required unless staff."),
    title: z.string().trim().min(1).max(200),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD, hora Argentina. / Argentina date."),
    startTime: time.describe("HH:MM (24 h)."),
    endTime: time.optional().describe("HH:MM (24 h). Por defecto inicio + 2 h. / Defaults to start + 2 h."),
    location: z.string().trim().min(1).max(255).describe("Lugar (aula, sede, dirección, \"Online\"). / Place."),
    category: z.enum(EVENT_CATEGORIES).describe("Categoría. Ante la duda, Organizaciones. / Category; if unsure, Organizaciones."),
    description: z.string().trim().max(5000).optional().describe("Detalles del evento, en el texto de la invitación. / Details."),
    onlineUrl: z.string().url().optional().describe("Link de la transmisión o reunión. / Stream or meeting link."),
    signupUrl: z.string().url().optional().describe("Link de inscripción externo (formulario). / External sign-up link.")
  },
  async run(args, ctx) {
    const staff = canActAsStaff(ctx);
    const mine = ctx.identity?.organizations ?? [];
    const orgs = mine.join(", ") || "-";
    if (!args.organization && !staff) throw new ToolError(t(ctx.lang, "eventOrgRequired", { orgs }));
    if (args.organization && !staff && !mine.includes(args.organization)) {
      throw new ToolError(t(ctx.lang, "eventOrgNotMember", { org: args.organization, orgs }));
    }
    const today = todayInArgentina();
    if (args.date < today) throw new ToolError(t(ctx.lang, "eventInPast", { date: args.date, today }));
    if (args.endTime && args.endTime <= args.startTime) {
      throw new ToolError(t(ctx.lang, "eventEndBeforeStart", { start: args.startTime, end: args.endTime }));
    }
    const e = await ctx.api.send<NewsEvent>("POST", "/v1/news/events", {
      title: args.title, eventDate: args.date, startTime: args.startTime, endTime: args.endTime ?? defaultEndTime(args.startTime),
      location: args.location, category: args.category, organization: args.organization ?? null, description: args.description ?? null,
      onlineUrl: args.onlineUrl ?? null, signupMode: args.signupUrl ? "external" : "none", signupUrl: args.signupUrl ?? null
    });
    return {
      event: compact({
        id: e.id, title: e.title, date: e.eventDate, time: `${hhmm(e.startTime)}-${hhmm(e.endTime)}`,
        location: e.location, category: e.category, organization: e.organization
      }),
      note: t(ctx.lang, "eventCreated")
    };
  }
});

export const listOrganizations = defineTool({
  name: "list_organizations",
  title: "Organizaciones estudiantiles",
  description:
    "Centros, agrupaciones y equipos estudiantiles con su slug, categoría y seguidores. " +
    "EN: Student organizations (slug, category, followers).",
  access: "public",
  input: { category: z.string().optional() },
  async run(args, ctx) {
    const res = await ctx.api.get<Record<string, Organization[]>>("/v1/organizations");
    return Object.entries(res)
      .filter(([cat]) => !args.category || cat.toLowerCase() === args.category.toLowerCase())
      .flatMap(([cat, orgs]) => orgs.map(o => compact({
        slug: o.slug, name: o.name, fullName: o.fullName, category: o.category ?? cat, followers: o.followerCount
      })));
  }
});

export const getOrganization = defineTool({
  name: "get_organization",
  title: "Organización",
  description: "Detalle de una organización estudiantil por slug. EN: A student organization by slug.",
  access: "public",
  input: { slug: z.string().min(1) },
  async run(args, ctx) {
    const o = await ctx.api.get<Organization>(`/v1/organizations/${encodeURIComponent(args.slug)}`);
    return compact({ slug: o.slug, name: o.name, fullName: o.fullName, category: o.category, followers: o.followerCount, description: o.description });
  }
});

export const listBenefits = defineTool({
  name: "list_benefits",
  title: "Beneficios CEITBA",
  description:
    "Beneficios para socios del CEITBA (descuentos, convenios) con contacto y enlaces. " +
    "EN: CEITBA member benefits (discounts, partnerships).",
  access: "public",
  input: {},
  async run(_args, ctx) {
    const [benefits, cards] = await Promise.all([
      ctx.api.get<{ slug: string; nameEs: string; nameEn: string; highlightsEs: string[]; highlightsEn: string[]; linkUrl: string | null; contactEmail: string | null }[]>("/v1/benefits"),
      ctx.api.get<{ categorySlug: string; titleEs: string; titleEn: string; summaryEs: string; summaryEn: string; price: string | null;
        location: string | null; website: string | null; ctaUrl: string | null; bulletsEs: string[]; bulletsEn: string[] }[]>("/v1/benefit-cards")
    ]);
    const l = ctx.lang;
    return benefits.map(b => compact({
      category: b.slug,
      name: pick(l, b.nameEs, b.nameEn),
      highlights: l === "en" && b.highlightsEn?.length ? b.highlightsEn : b.highlightsEs,
      link: b.linkUrl,
      contact: b.contactEmail,
      offers: cards.filter(c => c.categorySlug === b.slug).map(c => compact({
        title: pick(l, c.titleEs, c.titleEn),
        summary: pick(l, c.summaryEs, c.summaryEn),
        details: l === "en" && c.bulletsEn?.length ? c.bulletsEn : c.bulletsEs,
        price: c.price, location: c.location, link: c.ctaUrl ?? c.website
      }))
    }));
  }
});

export const listStaffMembers = defineTool({
  name: "list_staff_members",
  title: "Integrantes del CEITBA",
  description:
    "Integrantes de la comisión del CEITBA por año y departamento (por defecto el año más reciente). " +
    "EN: CEITBA team members by year and department (latest year by default).",
  access: "public",
  input: { year: z.number().int().min(2000).max(2100).optional() },
  async run(args, ctx) {
    let year = args.year;
    if (year === undefined) {
      const years = await ctx.api.get<number[]>("/v1/staff-members/years");
      if (years.length === 0) return { year: null, members: [], note: t(ctx.lang, "noStaffMembers") };
      year = Math.max(...years);
    }
    const members = await ctx.api.get<{ name: string; departmentSlug: string; roleEs: string; roleEn: string; email: string | null; linkedinUrl: string | null }[]>(
      "/v1/staff-members", { year });
    return {
      year,
      members: members.map(m => compact({
        name: m.name, department: m.departmentSlug, role: pick(ctx.lang, m.roleEs, m.roleEn), email: m.email, linkedin: m.linkedinUrl
      }))
    };
  }
});

export const listHighlights = defineTool({
  name: "list_highlights",
  title: "Destacados",
  description: "Destacados vigentes de la home de CEITBA (anuncios, campañas). EN: Current CEITBA home highlights.",
  access: "public",
  input: {},
  async run(_args, ctx) {
    const res = await ctx.api.get<{ title: string; description: string | null; linkUrl: string | null; startsAt: string | null; endsAt: string | null }[]>("/v1/highlights");
    return res.map(h => compact({ title: h.title, description: h.description, link: h.linkUrl, until: h.endsAt }));
  }
});

export const newsTools = [listArticles, getArticle, listEvents, createEvent, listOrganizations, getOrganization, listBenefits, listStaffMembers, listHighlights];
