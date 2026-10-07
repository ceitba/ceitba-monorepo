import {
  DEFAULT_SCHEDULER_OPTIONS,
  generateSchedules,
  type PossibleSchedule,
  type SchedulerOptions,
  type SubjectInput,
  type TimeBlock
} from "@ceitba/scheduler-core";
import { z } from "zod";
import { sharedCatalog } from "../catalog";
import type { SessionContext } from "../context";
import { t } from "../i18n";
import { compact, dayShort, hhmm } from "../trim";
import { defineTool, ToolError } from "./define";

const weekday = z.enum(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY"]);
const time = z.string().regex(/^\d{2}:\d{2}$/, "HH:mm");

interface SavedSchedule {
  id: string;
  name: string;
  careerId: string | null;
  plan: string | null;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
  payload: {
    version?: number;
    selectedCourses?: { subject_id: string; selectedCommissions: string[] }[];
    options?: Partial<SchedulerOptions>;
    blockedTimes?: TimeBlock[];
  } | null;
}

const ORDER = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

// A generated schedule as a compact week view the model can read and explain.
export function scheduleView(s: PossibleSchedule, rank: number) {
  const commissions: Record<string, string> = {};
  const week: Record<string, string[]> = {};
  const slots = [...s.slots].sort((a, b) =>
    ORDER.indexOf(a.day) - ORDER.indexOf(b.day) || a.timeFrom.localeCompare(b.timeFrom));
  for (const x of slots) {
    commissions[x.subject_id] = x.commission;
    const place = [x.building, x.classroom].filter(Boolean).join(" ");
    (week[dayShort(x.day)] ??= []).push(
      `${hhmm(x.timeFrom)}-${hhmm(x.timeTo)} ${x.subject_id} ${x.subject} (${x.commission})${place ? " " + place : ""}`);
  }
  return compact({
    rank,
    commissions,
    freeWeekdays: s.freeDays,
    gapMinutes: s.gapMinutes,
    maxOverlapMinutes: s.maxOverlap,
    buildingChangeUnder1h: s.hasBuildingConflict || undefined,
    week
  });
}

async function loadSaved(ctx: SessionContext, id: string): Promise<SavedSchedule> {
  if (!ctx.identity) throw new ToolError(t(ctx.lang, "signInRequired"));
  return ctx.api.get<SavedSchedule>(`/v1/me/schedules/${encodeURIComponent(id)}`);
}

export const generateSchedulesTool = defineTool({
  name: "generate_schedules",
  title: "Combinador de horarios",
  description:
    "Genera combinaciones de comisiones sin superposición (el mismo algoritmo que el Combinador de Horarios de CEITBA). " +
    "Indicá plan y materias (opcionalmente las comisiones aceptables) o un horario guardado (savedScheduleId). " +
    "Podés bloquear franjas, permitir superposición limitada (≤30 min) o ilimitada, y exigir un día libre. " +
    "Devuelve las mejores primero: menos superposición, más días libres, menos horas muertas. " +
    "EN: Builds clash-free commission combinations (same algorithm as the CEITBA scheduler), best first.",
  access: "public",
  input: {
    plan: z.string().optional().describe("Plan, p. ej. \"S10-Rev23\". Requerido salvo con savedScheduleId. / Study plan."),
    subjects: z.array(z.object({
      subjectId: z.string().min(1),
      commissions: z.array(z.string()).optional().describe("Comisiones aceptables (vacío = todas). / Acceptable commissions.")
    })).max(15).optional().describe("Materias a cursar. / Subjects to take."),
    savedScheduleId: z.string().uuid().optional()
      .describe("Usar materias, bloqueos y opciones de un horario guardado (requiere sesión). / Use a saved schedule."),
    blocked: z.array(z.object({ day: weekday, from: time, to: time })).max(40).optional()
      .describe("Franjas sin clases, p. ej. trabajo. / Blocked time ranges."),
    allowOverlap: z.boolean().optional().describe("Permitir hasta 30 min de superposición. / Allow up to 30 min overlap."),
    allowUnlimitedOverlap: z.boolean().optional().describe("Permitir cualquier superposición. / Allow any overlap."),
    allowFreeDay: z.boolean().optional().describe("Exigir al menos un día libre (lun-vie). / Require a free weekday."),
    limit: z.number().int().min(1).max(20).optional().describe("Cuántas combinaciones devolver (por defecto 5). / How many to return.")
  },
  async run(args, ctx) {
    let planId = args.plan;
    let wanted = (args.subjects ?? []).map(s => ({ id: s.subjectId, commissions: s.commissions ?? [] }));
    let blocked: TimeBlock[] = (args.blocked ?? []).map(b => ({ day: b.day, from: b.from, to: b.to }));
    let options: SchedulerOptions = { ...DEFAULT_SCHEDULER_OPTIONS };

    if (args.savedScheduleId) {
      const saved = await loadSaved(ctx, args.savedScheduleId);
      planId ??= saved.plan ?? undefined;
      if (wanted.length === 0) {
        wanted = (saved.payload?.selectedCourses ?? []).map(c => ({ id: c.subject_id, commissions: c.selectedCommissions }));
      }
      if (!args.blocked) blocked = saved.payload?.blockedTimes ?? [];
      options = {
        allowOverlap: Boolean(saved.payload?.options?.allowOverlap),
        allowUnlimitedOverlap: Boolean(saved.payload?.options?.allowUnlimitedOverlap),
        allowFreeDay: Boolean(saved.payload?.options?.allowFreeDay)
      };
    }
    if (args.allowOverlap !== undefined) options.allowOverlap = args.allowOverlap;
    if (args.allowUnlimitedOverlap !== undefined) options.allowUnlimitedOverlap = args.allowUnlimitedOverlap;
    if (args.allowFreeDay !== undefined) options.allowFreeDay = args.allowFreeDay;

    if (!planId) throw new ToolError(ctx.lang === "en" ? "plan is required" : "Falta el plan (plan).");
    if (wanted.length === 0) throw new ToolError(ctx.lang === "en" ? "subjects is required" : "Indicá al menos una materia (subjects).");

    const catalog = await sharedCatalog.planSubjects(ctx.api, planId);
    const byId = new Map(catalog.map(s => [s.subject_id, s]));
    const unknown = wanted.filter(w => !byId.has(w.id)).map(w => w.id);
    if (unknown.length) throw new ToolError(t(ctx.lang, "unknownSubjects", { plan: planId, ids: unknown.join(", ") }));
    const empty = wanted.filter(w => byId.get(w.id)!.commissions.length === 0).map(w => w.id);
    if (empty.length) throw new ToolError(t(ctx.lang, "noCommissions", { ids: empty.join(", ") }));

    const input: SubjectInput[] = wanted.map(w => {
      const s = byId.get(w.id)!;
      return {
        subject_id: s.subject_id,
        name: s.name,
        course_start: s.course_start,
        course_end: s.course_end,
        commissions: s.commissions.map(c => ({
          name: c.name,
          schedule: c.schedule.map(e => ({ ...e, building: e.building ?? "", classroom: e.classroom ?? "" }))
        })),
        selectedCommissions: w.commissions
      };
    });

    const result = generateSchedules(input, options, blocked);
    const limit = args.limit ?? 5;
    return compact({
      plan: planId,
      options,
      blocked: blocked.map(b => `${dayShort(b.day)} ${b.from}-${b.to}`),
      totalFound: result.schedules.length,
      // The search stops at 500 results or 1M steps, like the web scheduler.
      searchTruncated: result.truncated || undefined,
      note: result.schedules.length === 0 ? t(ctx.lang, "noSchedules") : undefined,
      schedules: result.schedules.slice(0, limit).map((s, i) => scheduleView(s, i + 1))
    });
  }
});

export const listMySchedules = defineTool({
  name: "list_my_schedules",
  title: "Mis horarios guardados",
  description:
    "Horarios guardados en el Combinador (materias y comisiones elegidas, bloqueos). Usá el id con generate_schedules. " +
    "EN: Your saved scheduler workspaces; pass the id to generate_schedules.",
  access: "user",
  input: {},
  async run(_args, ctx) {
    const list = await ctx.api.get<SavedSchedule[]>("/v1/me/schedules");
    return list.map(s => compact({
      id: s.id,
      name: s.name,
      plan: s.plan,
      primary: s.isPrimary || undefined,
      updatedAt: s.updatedAt,
      subjects: (s.payload?.selectedCourses ?? []).map(c =>
        c.selectedCommissions?.length && !c.selectedCommissions.includes("any")
          ? `${c.subject_id} [${c.selectedCommissions.join(", ")}]` : c.subject_id),
      blocked: (s.payload?.blockedTimes ?? []).map(b => `${dayShort(b.day)} ${b.from}-${b.to}`)
    }));
  }
});

export const getShareSession = defineTool({
  name: "get_share_session",
  title: "Sesión compartida de horarios",
  description:
    "Muestra una sesión compartida del Combinador (link /scheduler/share/<token>): participantes y sus materias. " +
    "EN: Shows a shared scheduler session (participants and their subjects) by token.",
  access: "public",
  input: { token: z.string().min(8).max(128) },
  async run(args, ctx) {
    const s = await ctx.api.get<{
      name: string; creatorDisplayName: string; expiresAt: string;
      participants: { displayName: string; isCreator: boolean; plan: string | null; payload: SavedSchedule["payload"] }[];
    }>(`/v1/share/sessions/${encodeURIComponent(args.token)}`);
    return compact({
      name: s.name,
      creator: s.creatorDisplayName,
      expiresAt: s.expiresAt,
      participants: s.participants.map(p => compact({
        name: p.displayName,
        creator: p.isCreator || undefined,
        plan: p.plan,
        subjects: (p.payload?.selectedCourses ?? []).map(c => c.subject_id)
      }))
    });
  }
});

export const scheduleTools = [generateSchedulesTool, listMySchedules, getShareSession];
