import { z } from "zod";
import type { Page, UserMe } from "../api/types";
import { clampLimit, compact, cut, slot } from "../trim";
import { defineTool } from "./define";

export const whoami = defineTool({
  name: "whoami",
  title: "Mi cuenta",
  description:
    "Quién está conectado: nombre, carrera y plan, organizaciones, organizaciones que sigue, funciones habilitadas y " +
    "qué permisos tiene esta conexión. EN: The signed-in user, their plan, organizations, features and this connection's scopes.",
  access: "user",
  input: {},
  async run(_args, ctx) {
    const me = await ctx.api.get<UserMe>("/v1/auth/me");
    return compact({
      name: me.name,
      email: me.email,
      role: me.role,
      moderator: me.moderator || undefined,
      careerId: me.careerId,
      plan: me.plan,
      language: me.language,
      organizations: me.organizations.map(o => `${o.slug} (${o.role})`),
      follows: me.follows,
      capabilities: me.capabilities,
      connectionScopes: [...ctx.scopes]
    });
  }
});

export const listMyFollows = defineTool({
  name: "list_my_follows",
  title: "Organizaciones que sigo",
  description: "Organizaciones que seguís en el newsletter. EN: Organizations you follow.",
  access: "user",
  input: {},
  async run(_args, ctx) {
    const res = await ctx.api.get<{ orgSlug: string; createdAt: string }[]>("/v1/me/follows");
    return res.map(f => f.orgSlug);
  }
});

export const getDigestSubscription = defineTool({
  name: "get_digest_subscription",
  title: "Resumen semanal",
  description: "Si estás suscripto al resumen semanal por email. EN: Whether you get the weekly email digest.",
  access: "user",
  input: {},
  async run(_args, ctx) {
    return ctx.api.get<{ enabled: boolean }>("/v1/digests/subscription");
  }
});

export const listMyScheduleCorrections = defineTool({
  name: "list_my_schedule_corrections",
  title: "Mis correcciones de horario",
  description:
    "Correcciones de horario que sugeriste y su estado (pendiente, aplicada, rechazada) con votos. " +
    "EN: Schedule corrections you suggested, their status and votes.",
  access: "user",
  input: {},
  async run(_args, ctx) {
    const res = await ctx.api.get<{ id: string; status: string; subjectId: string; subjectName: string; commissionName: string;
      schedule: { day: string; timeFrom: string; timeTo: string }[]; confirms: number; rejects: number; createdAt: string; appliedAt: string | null }[]>(
      "/v1/me/schedule-corrections");
    return res.map(c => compact({
      id: c.id, subject: `${c.subjectId} ${c.subjectName}`, commission: c.commissionName, status: c.status,
      slots: c.schedule.map(s => slot({ day: s.day, time_from: s.timeFrom, time_to: s.timeTo })),
      confirms: c.confirms, rejects: c.rejects, createdAt: c.createdAt, appliedAt: c.appliedAt
    }));
  }
});

interface StudyGroup {
  id: string; title: string; subject: { id: string; name: string } | null; type: string; locations: string[];
  dueAt: string | null; description: string | null; contactLink: string | null; maxParticipants: number | null;
  participantCount: number; isFull: boolean; isMember: boolean; isOwner: boolean;
  participants?: { name: string; isOwner: boolean }[];
}

const groupView = (g: StudyGroup, full = false) => compact({
  id: g.id, title: g.title, subject: g.subject ? `${g.subject.id} ${g.subject.name}` : undefined, type: g.type,
  locations: g.locations, dueAt: g.dueAt,
  participants: g.maxParticipants ? `${g.participantCount}/${g.maxParticipants}` : String(g.participantCount),
  full: g.isFull || undefined, member: g.isMember || undefined, owner: g.isOwner || undefined,
  description: g.description ? (full ? g.description : cut(g.description, 300).text) : undefined,
  contact: full ? g.contactLink : undefined,
  people: full ? g.participants?.map(p => p.name + (p.isOwner ? " (organiza)" : "")) : undefined
});

export const listStudyGroups = defineTool({
  name: "list_study_groups",
  title: "Grupos de estudio",
  description:
    "Grupos de estudio abiertos, filtrables por materia y tipo; por defecto solo los próximos. " +
    "EN: Open study groups, filterable by subject and type (upcoming only by default).",
  access: "user",
  input: {
    subject: z.string().optional().describe("Código de materia. / Subject code."),
    type: z.string().optional(),
    upcoming: z.boolean().optional(),
    page: z.number().int().min(1).optional(),
    limit: z.number().int().min(1).max(50).optional()
  },
  async run(args, ctx) {
    const res = await ctx.api.get<Page<StudyGroup>>("/v1/study-groups", {
      subject: args.subject, type: args.type, upcoming: args.upcoming ?? true, page: args.page ?? 1, limit: clampLimit(args.limit, 20, 50)
    });
    return { total: res.meta.total, page: res.meta.page, groups: res.data.map(g => groupView(g)) };
  }
});

export const getStudyGroup = defineTool({
  name: "get_study_group",
  title: "Grupo de estudio",
  description: "Detalle de un grupo de estudio (descripción, contacto, participantes). EN: A study group's details.",
  access: "user",
  input: { id: z.string().uuid() },
  async run(args, ctx) {
    return groupView(await ctx.api.get<StudyGroup>(`/v1/study-groups/${args.id}`), true);
  }
});

export const listMyStudyGroups = defineTool({
  name: "list_my_study_groups",
  title: "Mis grupos de estudio",
  description: "Grupos de estudio en los que participás u organizás. EN: Study groups you are in or organize.",
  access: "user",
  input: { upcoming: z.boolean().optional() },
  async run(args, ctx) {
    const res = await ctx.api.get<StudyGroup[]>("/v1/me/study-groups", { upcoming: args.upcoming ?? true });
    return res.map(g => groupView(g));
  }
});

interface Proposal {
  id: string; title: string; description: string; topic: string; status: string; lifecycle: string | null;
  rejectionReason: string | null; upCount: number; downCount: number; commentCount: number; myVote: number | null;
  isMine: boolean; authorAlias: string | null; createdAt: string;
}

interface ProposalComment {
  id: string; alias: string; isAuthor: boolean; body: string; deleted: boolean; createdAt: string; replies: ProposalComment[];
}

const proposalView = (p: Proposal, full = false) => compact({
  id: p.id, title: p.title, topic: p.topic, status: p.status, lifecycle: p.lifecycle,
  votes: `+${p.upCount} / -${p.downCount}`, comments: p.commentCount, myVote: p.myVote ?? undefined,
  mine: p.isMine || undefined, author: p.authorAlias, createdAt: p.createdAt,
  rejectionReason: p.rejectionReason,
  description: full ? p.description : cut(p.description, 280).text
});

const commentView = (c: ProposalComment): unknown => compact({
  by: c.alias + (c.isAuthor ? " (autor)" : ""), at: c.createdAt, text: c.deleted ? "[eliminado]" : c.body,
  replies: c.replies?.map(commentView)
});

export const listProposals = defineTool({
  name: "list_proposals",
  title: "Propuestas estudiantiles",
  description:
    "Propuestas de estudiantes al CEITBA (aprobadas para publicación) con votos y comentarios, filtrables por tema. " +
    "EN: Student proposals to CEITBA with votes and comment counts.",
  access: "user",
  input: {
    topic: z.string().optional(),
    mine: z.boolean().optional().describe("Solo mis propuestas (incluye pendientes). / Only mine (incl. pending)."),
    page: z.number().int().min(1).optional(),
    limit: z.number().int().min(1).max(50).optional()
  },
  async run(args, ctx) {
    const path = args.mine ? "/v1/me/proposals" : "/v1/proposals";
    const res = await ctx.api.get<Page<Proposal>>(path, { topic: args.mine ? undefined : args.topic, page: args.page ?? 1, limit: clampLimit(args.limit, 20, 50) });
    return { total: res.meta.total, page: res.meta.page, proposals: res.data.map(p => proposalView(p)) };
  }
});

export const getProposal = defineTool({
  name: "get_proposal",
  title: "Propuesta",
  description: "Una propuesta completa y, opcionalmente, sus comentarios. EN: A proposal and optionally its comments.",
  access: "user",
  input: { id: z.string().uuid(), includeComments: z.boolean().optional() },
  async run(args, ctx) {
    const p = await ctx.api.get<Proposal>(`/v1/proposals/${args.id}`);
    const comments = args.includeComments
      ? (await ctx.api.get<Page<ProposalComment>>(`/v1/proposals/${args.id}/comments`, { page: 1, limit: 50 })).data.map(commentView)
      : undefined;
    return compact({ ...proposalView(p, true), commentThread: comments });
  }
});

export const meTools = [whoami, listMyFollows, getDigestSubscription, listMyScheduleCorrections,
  listStudyGroups, getStudyGroup, listMyStudyGroups, listProposals, getProposal];
