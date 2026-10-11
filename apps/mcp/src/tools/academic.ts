import { z } from "zod";
import type { Career } from "../api/types";
import { sharedCatalog, type PlanSubject } from "../catalog";
import { clampLimit, compact, normalize, slot } from "../trim";
import { defineTool, ToolError } from "./define";

const plan = z.string().min(1).describe("Plan de estudios, p. ej. \"S10-Rev23\" (ver list_careers). / Study plan id.");
const subjectId = z.string().min(1).describe("Código de materia, p. ej. \"93.41\". / Subject code.");
const day = z.enum(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]);
const hhmm = z.string().regex(/^\d{2}:\d{2}$/, "HH:mm");

const commissionView = (c: PlanSubject["commissions"][number]) => compact({
  name: c.name,
  commissionId: c.commission_id,
  slots: c.schedule.map(slot),
  // Present only while a student correction is applied: the original SGA times.
  sgaSlots: c.sga_schedule?.map(slot)
});

export const listCareers = defineTool({
  name: "list_careers",
  title: "Carreras y planes",
  description:
    "Lista las carreras del ITBA con sus planes de estudio (ids de plan para las demás herramientas). " +
    "EN: Lists ITBA degrees and their study plan ids.",
  access: "public",
  input: {},
  async run(_args, ctx) {
    // GET /v1/careers leaves plans empty; /v1/careers/plans fills them.
    const careers = await ctx.api.get<Record<string, Career>>("/v1/careers/plans");
    return Object.values(careers).map(c => ({ id: c.id, name: c.name, plans: c.plans }));
  }
});

export const getPlanSubjects = defineTool({
  name: "get_plan_subjects",
  title: "Materias de un plan",
  description:
    "Materias de un plan de estudios, con año, cuatrimestre, créditos y correlativas. Filtrá por año, cuatrimestre, " +
    "sección o texto. Con includeCommissions=true agrega comisiones y horarios del cuatrimestre actual. " +
    "EN: Subjects of a study plan (year, term, credits, prerequisites), optionally with this term's commissions and times.",
  access: "public",
  input: {
    plan,
    year: z.number().int().min(1).max(7).optional().describe("Año de la carrera. / Year of the degree."),
    semester: z.number().int().min(1).max(2).optional().describe("Cuatrimestre (1 o 2). / Term."),
    section: z.string().optional().describe("Sección, p. ej. \"Obligatorias\" o \"Electivas\". / Section."),
    query: z.string().optional().describe("Texto a buscar en código o nombre. / Text to match in code or name."),
    includeCommissions: z.boolean().optional().describe("Incluir comisiones y horarios. / Include commissions and times."),
    limit: z.number().int().min(1).max(200).optional().describe("Máximo de materias (por defecto 80). / Max subjects.")
  },
  async run(args, ctx) {
    const all = await sharedCatalog.planSubjects(ctx.api, args.plan);
    const q = args.query ? normalize(args.query) : null;
    const filtered = all.filter(s =>
      (args.year === undefined || s.year === args.year) &&
      (args.semester === undefined || s.semester === args.semester) &&
      (!args.section || normalize(s.section).includes(normalize(args.section))) &&
      (!q || normalize(s.subject_id).includes(q) || normalize(s.name).includes(q)));
    const limit = clampLimit(args.limit, 80, 200);
    return compact({
      plan: args.plan,
      total: filtered.length,
      truncated: filtered.length > limit || undefined,
      subjects: filtered.slice(0, limit).map(s => compact({
        id: s.subject_id,
        name: s.name,
        credits: s.credits,
        year: s.year,
        semester: s.semester,
        section: s.section,
        prerequisites: s.dependencies,
        creditsRequired: s.credits_required,
        commissions: args.includeCommissions ? s.commissions.map(commissionView) : s.commissions.length
      }))
    });
  }
});

export const getSubject = defineTool({
  name: "get_subject",
  title: "Detalle de materia",
  description:
    "Datos de una materia (nombre, créditos) y en qué planes está, con año, cuatrimestre y correlativas en cada uno. " +
    "EN: Subject details and the plans it belongs to (year, term, prerequisites per plan).",
  access: "public",
  input: { subjectId },
  async run(args, ctx) {
    const [subject, plans] = await Promise.all([
      ctx.api.get<{ id: string; name: string; credits: number }>(`/v1/subjects/${encodeURIComponent(args.subjectId)}`),
      ctx.api.get<{ planId: string; section: string; year: number; semester: number; dependencies: string[]; creditsRequired: number | null }[]>(
        `/v1/plans/subjects/${encodeURIComponent(args.subjectId)}/plans`)
    ]);
    return compact({
      id: subject.id,
      name: subject.name,
      credits: subject.credits,
      plans: plans.map(p => compact({
        plan: p.planId, section: p.section, year: p.year, semester: p.semester,
        prerequisites: p.dependencies, creditsRequired: p.creditsRequired
      }))
    });
  }
});

export const getSubjectCommissions = defineTool({
  name: "get_subject_commissions",
  title: "Comisiones y horarios de una materia",
  description:
    "Comisiones del cuatrimestre actual de una materia en un plan: horarios (día, hora, edificio, aula), cupo, " +
    "inscriptos y correcciones de horario sugeridas por estudiantes. " +
    "EN: This term's commissions of a subject: times, rooms, quota, enrolment and student-suggested schedule corrections.",
  access: "public",
  input: { plan, subjectId },
  async run(args, ctx) {
    const [subjects, commissions] = await Promise.all([
      sharedCatalog.planSubjects(ctx.api, args.plan),
      sharedCatalog.planCommissions(ctx.api, args.plan).catch(() => [])
    ]);
    const s = subjects.find(x => x.subject_id === args.subjectId);
    if (!s) throw new ToolError(`${args.subjectId} ∉ ${args.plan}`);
    const quota = new Map(commissions.filter(c => c.subjectCode === s.subject_id).map(c => [c.commissionName, c]));
    return compact({
      id: s.subject_id,
      name: s.name,
      courseStart: s.course_start,
      courseEnd: s.course_end,
      commissions: s.commissions.map(c => compact({
        ...commissionView(c),
        quota: quota.get(c.name)?.quota,
        enrolled: quota.get(c.name)?.enrolledStudents,
        corrections: c.corrections?.map(k => compact({
          id: k.id, status: k.status, slots: k.schedule.map(slot), confirms: k.confirms, rejects: k.rejects
        }))
      }))
    });
  }
});

export const findFreeClassrooms = defineTool({
  name: "find_free_classrooms",
  title: "Aulas libres",
  description:
    "Aulas libres por edificio (ventanas de al menos minMinutes, 08:00-23:00 hora Argentina). Por defecto hoy y ahora. " +
    "EN: Free classrooms per building for a day and time (defaults: today, now; windows of at least minMinutes).",
  access: "public",
  input: {
    day: day.optional().describe("Día (por defecto hoy). / Day (default today)."),
    at: hhmm.optional().describe("Hora HH:mm (por defecto ahora). / Time HH:mm (default now)."),
    building: z.string().optional().describe("Edificio, p. ej. \"SDF\" o \"R\". / Building."),
    minMinutes: z.number().int().min(30).max(900).optional().describe("Duración mínima libre (por defecto 60). / Minimum free minutes."),
    freeNowOnly: z.boolean().optional().describe("Solo aulas libres en este momento. / Only rooms free right now.")
  },
  async run(args, ctx) {
    const res = await ctx.api.get<{
      day: string; at: string; minMinutes: number;
      buildings: { building: string; totalClassrooms: number; freeNowCount: number;
        classrooms: { classroom: string; freeFrom: string; freeUntil: string; freeNow: boolean }[] }[];
    }>("/v1/classrooms/availability", { day: args.day, at: args.at, building: args.building, minMinutes: args.minMinutes });
    return {
      day: res.day,
      at: res.at,
      minMinutes: res.minMinutes,
      buildings: res.buildings
        .filter(b => !args.building || normalize(b.building) === normalize(args.building))
        .map(b => ({
          building: b.building,
          freeNow: b.freeNowCount,
          total: b.totalClassrooms,
          windows: b.classrooms
            .filter(c => !args.freeNowOnly || c.freeNow)
            .map(c => `${c.classroom} ${c.freeFrom}-${c.freeUntil}${c.freeNow ? (ctx.lang === "en" ? " (free now)" : " (libre ahora)") : ""}`)
        }))
    };
  }
});

export const checkClassroomConflicts = defineTool({
  name: "check_classroom_conflicts",
  title: "Conflictos de aula",
  description:
    "Clases que ocupan un aula en un día y franja horaria. Vacío = el aula está libre. " +
    "EN: Classes that occupy a classroom on a day and time range. Empty = the room is free.",
  access: "public",
  input: {
    classroom: z.string().min(1),
    building: z.string().min(1),
    day,
    from: hhmm,
    to: hhmm
  },
  async run(args, ctx) {
    const res = await ctx.api.send<{ classroom: string; building: string; day: string; hourFrom: string; hourTo: string }[]>(
      "POST", "/v1/classrooms/conflicts",
      { classroom: args.classroom, building: args.building, day: args.day, hourFrom: args.from, hourTo: args.to });
    return { free: res.length === 0, conflicts: res.map(c => slot({ day: c.day, time_from: c.hourFrom, time_to: c.hourTo, building: c.building, classroom: c.classroom })) };
  }
});

export const academicTools = [listCareers, getPlanSubjects, getSubject, getSubjectCommissions, findFreeClassrooms, checkClassroomConflicts];
