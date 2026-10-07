import { z } from "zod";
import type { Page } from "../api/types";
import { clampLimit, compact, cut, slot } from "../trim";
import { defineTool, ToolError } from "./define";

// Staff and moderator tools. They are only listed for sessions whose user
// holds the role AND whose credential carries the "staff" scope; the write
// ones additionally need the "write" scope (see define.ts isVisible).

interface StaffCorrection {
  id: string; commissionId: string; status: string; subjectId: string; subjectName: string; commissionName: string;
  schedule: { day: string; timeFrom: string; timeTo: string }[]; sgaSchedule: { day: string; time_from?: string; timeFrom?: string; time_to?: string; timeTo?: string }[] | null;
  confirms: number; rejects: number; createdAt: string; appliedAt: string | null; reviewedAt: string | null; reviewedByStaff: boolean;
}

const correctionView = (c: StaffCorrection) => compact({
  id: c.id, subject: `${c.subjectId} ${c.subjectName}`, commission: c.commissionName, status: c.status,
  proposed: c.schedule.map(s => slot({ day: s.day, time_from: s.timeFrom, time_to: s.timeTo })),
  sga: c.sgaSchedule?.map(s => slot({ day: s.day, time_from: s.time_from ?? s.timeFrom ?? "", time_to: s.time_to ?? s.timeTo ?? "" })),
  votes: `+${c.confirms} / -${c.rejects}`, createdAt: c.createdAt, appliedAt: c.appliedAt, reviewedAt: c.reviewedAt
});

export const staffListScheduleCorrections = defineTool({
  name: "staff_list_schedule_corrections",
  title: "[Staff] Correcciones de horario",
  description:
    "STAFF. Correcciones de horario sugeridas por estudiantes, con horario propuesto vs. SGA y votos. Filtrá por estado. " +
    "EN: STAFF. Student schedule corrections (proposed vs SGA, votes), by status.",
  access: "staff",
  input: {
    status: z.enum(["PENDING", "APPLIED", "REJECTED", "RESOLVED", "SUPERSEDED"]).optional(),
    page: z.number().int().min(1).optional(),
    limit: z.number().int().min(1).max(50).optional()
  },
  async run(args, ctx) {
    const res = await ctx.api.get<Page<StaffCorrection>>("/v1/staff/schedule-corrections", {
      status: args.status ?? "PENDING", page: args.page ?? 1, limit: clampLimit(args.limit, 20, 50)
    });
    return { total: res.meta.total, page: res.meta.page, corrections: res.data.map(correctionView) };
  }
});

export const staffReviewScheduleCorrection = defineTool({
  name: "staff_review_schedule_correction",
  title: "[Staff] Aplicar o rechazar corrección",
  description:
    "STAFF, ESCRITURA. Aplica (reemplaza el horario de la comisión para todos) o rechaza una corrección de horario. " +
    "Confirmá con la persona antes de usarla. EN: STAFF, WRITE. Apply or reject a schedule correction; confirm with the user first.",
  access: "staff",
  write: true,
  annotations: { destructiveHint: true, idempotentHint: true },
  input: { id: z.string().uuid(), action: z.enum(["apply", "reject"]) },
  async run(args, ctx) {
    const res = await ctx.api.send<StaffCorrection>("POST", `/v1/staff/schedule-corrections/${args.id}/${args.action}`);
    return correctionView(res);
  }
});

interface Proposal {
  id: string; title: string; description: string; topic: string; status: string; lifecycle: string | null;
  authorAlias: string | null; createdAt: string; attachments: { url: string; contentType: string }[];
}

export const moderationListProposals = defineTool({
  name: "moderation_list_proposals",
  title: "[Moderación] Propuestas",
  description:
    "MODERACIÓN. Cola de propuestas estudiantiles por estado (por defecto PENDING). " +
    "EN: MODERATION. Student proposals queue by status (default PENDING).",
  access: "moderator",
  input: {
    status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
    page: z.number().int().min(1).optional(),
    limit: z.number().int().min(1).max(50).optional()
  },
  async run(args, ctx) {
    const res = await ctx.api.get<Page<Proposal>>("/v1/staff/proposals", {
      status: args.status ?? "PENDING", page: args.page ?? 1, limit: clampLimit(args.limit, 20, 50)
    });
    return {
      total: res.meta.total,
      page: res.meta.page,
      proposals: res.data.map(p => compact({
        id: p.id, title: p.title, topic: p.topic, status: p.status, author: p.authorAlias, createdAt: p.createdAt,
        attachments: p.attachments?.length, description: cut(p.description, 1500).text
      }))
    };
  }
});

export const moderationReviewProposal = defineTool({
  name: "moderation_review_proposal",
  title: "[Moderación] Aprobar o rechazar propuesta",
  description:
    "MODERACIÓN, ESCRITURA. Aprueba (publica) o rechaza una propuesta; rechazar requiere motivo, que ve el autor. " +
    "Confirmá con la persona antes de usarla. EN: MODERATION, WRITE. Approve or reject (with a reason) a proposal.",
  access: "moderator",
  write: true,
  annotations: { destructiveHint: true },
  input: {
    id: z.string().uuid(),
    action: z.enum(["approve", "reject"]),
    reason: z.string().min(3).max(1024).optional().describe("Obligatorio al rechazar. / Required to reject.")
  },
  async run(args, ctx) {
    if (args.action === "reject" && !args.reason) {
      throw new ToolError(ctx.lang === "en" ? "reason is required to reject" : "Para rechazar hace falta un motivo (reason).");
    }
    const res = await ctx.api.send<Proposal>("POST", `/v1/staff/proposals/${args.id}/${args.action}`,
      args.action === "reject" ? { reason: args.reason } : undefined);
    return compact({ id: res.id, title: res.title, status: res.status });
  }
});

interface UserRow {
  id: string; email: string; name: string; fileNumber: string | null; careerId: string | null; plan: string | null;
  isStaff: boolean; organizations: { slug: string; role: string }[];
}

const userView = (u: UserRow) => compact({
  id: u.id, name: u.name, email: u.email, fileNumber: u.fileNumber, careerId: u.careerId, plan: u.plan,
  staff: u.isStaff || undefined, organizations: u.organizations?.map(o => `${o.slug} (${o.role})`)
});

export const staffSearchUsers = defineTool({
  name: "staff_search_users",
  title: "[Staff] Buscar usuarios",
  description:
    "STAFF. Busca usuarios por nombre, email o legajo, o por organización. Datos personales: usalos solo para gestión. " +
    "EN: STAFF. Search users by name, email, file number or organization (personal data; admin use only).",
  access: "staff",
  input: {
    q: z.string().optional(),
    organization: z.string().optional(),
    page: z.number().int().min(1).optional(),
    limit: z.number().int().min(1).max(50).optional()
  },
  async run(args, ctx) {
    const res = await ctx.api.get<Page<UserRow>>("/v1/users", {
      q: args.q, organization: args.organization, page: args.page ?? 1, limit: clampLimit(args.limit, 20, 50)
    });
    return { total: res.meta.total, page: res.meta.page, users: res.data.map(userView) };
  }
});

export const staffListDigests = defineTool({
  name: "staff_list_digests",
  title: "[Staff] Resúmenes semanales",
  description:
    "STAFF. Resúmenes semanales por email: estado, envíos y tasas de apertura y clics. Con id muestra el detalle y estadísticas. " +
    "EN: STAFF. Weekly email digests (status, sends, open/click rates); pass id for details and stats.",
  access: "staff",
  input: { id: z.string().uuid().optional() },
  async run(args, ctx) {
    if (args.id === undefined) {
      const list = await ctx.api.get<{ id: string; weekStart: string; subject: string | null; status: string; sentAt: string | null;
        counts: { pending: number; sent: number; failed: number }; openRate: number | null; clickRate: number | null }[]>("/v1/digests");
      return list.map(d => compact({
        id: d.id, week: d.weekStart, subject: d.subject, status: d.status, sentAt: d.sentAt,
        sent: d.counts?.sent, failed: d.counts?.failed || undefined, pending: d.counts?.pending || undefined,
        openRate: d.openRate, clickRate: d.clickRate
      }));
    }
    const [detail, stats] = await Promise.all([
      ctx.api.get<{ id: string; weekStart: string; weekEnd: string; subject: string | null; status: string; recipientEstimate: number | null;
        articles: { title: string; excluded: boolean }[]; events: { title: string; excluded: boolean }[] }>(`/v1/digests/${args.id}`),
      ctx.api.get<{ delivered: number; uniqueOpens: number; openRate: number; uniqueClicks: number; clickRate: number;
        clicksByLink: { label: string; uniqueClicks: number }[] }>(`/v1/digests/${args.id}/stats`).catch(() => null)
    ]);
    return compact({
      id: detail.id, week: `${detail.weekStart}..${detail.weekEnd}`, subject: detail.subject, status: detail.status,
      recipients: detail.recipientEstimate,
      articles: detail.articles.filter(a => !a.excluded).map(a => a.title),
      events: detail.events.filter(e => !e.excluded).map(e => e.title),
      stats: stats ? compact({
        delivered: stats.delivered, uniqueOpens: stats.uniqueOpens, openRate: stats.openRate,
        uniqueClicks: stats.uniqueClicks, clickRate: stats.clickRate,
        topLinks: stats.clicksByLink.slice(0, 10).map(l => `${l.label}: ${l.uniqueClicks}`)
      }) : undefined
    });
  }
});

export const staffAnalyticsSummary = defineTool({
  name: "staff_analytics_summary",
  title: "[Staff] Analíticas del newsletter",
  description:
    "STAFF. Resumen de lecturas del newsletter: artículos y categorías más vistos, vistas por día y votos. " +
    "EN: STAFF. Newsletter analytics: top articles and categories, daily views, votes.",
  access: "staff",
  input: { days: z.number().int().min(1).max(365).optional().describe("Ventana en días (por defecto 30). / Window in days.") },
  async run(args, ctx) {
    return ctx.api.get<unknown>("/v1/analytics/summary", { days: args.days ?? 30 });
  }
});

export const staffTools = [staffListScheduleCorrections, staffReviewScheduleCorrection, moderationListProposals,
  moderationReviewProposal, staffSearchUsers, staffListDigests, staffAnalyticsSummary];
