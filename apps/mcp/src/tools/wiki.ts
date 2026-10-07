import { z } from "zod";
import { clampLimit, compact, cut } from "../trim";
import { defineTool } from "./define";

// Apuntes (students' shared notes) and the per-subject wiki (KB). Both are
// gated by the "apuntes" capability (apps/api/docs/CAPABILITIES.md).
const CAP = "apuntes";
const subjectId = z.string().min(1).describe("Código de materia, p. ej. \"93.41\". / Subject code.");

interface KbPageSummary { id: string; slug: string; title: string; type: string; summary: string | null; aliases: string[] }
interface KbPage extends KbPageSummary {
  subjectId: string; subjectName: string; markdown: string; sources: unknown[]; sourceYears: { min: number | null; max: number | null } | null;
  stale: boolean; links: { subjectId?: string; slug: string; title?: string }[] | string[]; backlinks: unknown[]; generatedAt: string | null; status: string;
}

export const searchApuntes = defineTool({
  name: "search_apuntes",
  title: "Buscar apuntes",
  description:
    "Materias con apuntes compartidos por estudiantes (cantidad de archivos, si tienen wiki). Buscá por nombre o código. " +
    "EN: Subjects with student-shared notes (file counts, whether a wiki exists).",
  access: "user",
  capability: CAP,
  input: {
    q: z.string().optional(),
    mine: z.boolean().optional().describe("Solo materias de mi plan. / Only subjects of my plan."),
    limit: z.number().int().min(1).max(50).optional()
  },
  async run(args, ctx) {
    const res = await ctx.api.get<{ subjectId: string; subjectName: string; fileCount: number; lastUpdatedAt: string | null;
      year: number | null; semester: number | null; hasWiki: boolean }[]>(
      "/v1/wiki/apuntes/subjects", { q: args.q, mine: args.mine, limit: clampLimit(args.limit, 20, 50) });
    return res.map(s => compact({
      subjectId: s.subjectId, name: s.subjectName, files: s.fileCount, wiki: s.hasWiki || undefined,
      year: s.year, semester: s.semester, updatedAt: s.lastUpdatedAt
    }));
  }
});

export const listSubjectFiles = defineTool({
  name: "list_subject_files",
  title: "Apuntes de una materia",
  description:
    "Archivos de apuntes de una materia agrupados por quien los compartió (nombre, tipo, año académico, link a Drive). " +
    "EN: Note files of a subject grouped by sharer (name, kind, academic year, Drive link).",
  access: "user",
  capability: CAP,
  input: { subjectId, limit: z.number().int().min(1).max(300).optional() },
  async run(args, ctx) {
    const res = await ctx.api.get<{ subjectId: string; subjectName: string; groups: { author: { name: string | null; anonymous: boolean; community: boolean };
      files: { id: string; name: string; kind: string; path: string | null; academicYear: number | null; driveUrl: string | null; publishedAt: string | null }[] }[] }>(
      `/v1/wiki/subjects/${encodeURIComponent(args.subjectId)}/files`);
    const limit = clampLimit(args.limit, 100, 300);
    const files = res.groups.flatMap(g => g.files.map(f => compact({
      id: f.id, name: f.name, kind: f.kind, folder: f.path, year: f.academicYear, drive: f.driveUrl,
      sharedBy: g.author.anonymous ? "anónimo" : g.author.name ?? undefined
    })));
    return compact({ subject: `${res.subjectId} ${res.subjectName}`, total: files.length, truncated: files.length > limit || undefined, files: files.slice(0, limit) });
  }
});

export const getSubjectWiki = defineTool({
  name: "get_subject_wiki",
  title: "Wiki de la materia",
  description:
    "Índice de la wiki de una materia (generada a partir de los apuntes): resumen y lista de páginas (temas, " +
    "guías, exámenes). Leé cada página con get_wiki_page. EN: A subject wiki's index and page list.",
  access: "user",
  capability: CAP,
  input: { subjectId },
  async run(args, ctx) {
    const res = await ctx.api.get<{ subjectId: string; subjectName: string; index: KbPage | null; pages: KbPageSummary[]; related: { subjectId: string; subjectName?: string }[] | string[] }>(
      `/v1/wiki/subjects/${encodeURIComponent(args.subjectId)}/kb`);
    return compact({
      subject: `${res.subjectId} ${res.subjectName}`,
      overview: res.index ? cut(res.index.markdown, 4000).text : undefined,
      pages: res.pages.map(p => compact({ slug: p.slug, title: p.title, type: p.type, summary: p.summary })),
      related: res.related
    });
  }
});

export const getWikiPage = defineTool({
  name: "get_wiki_page",
  title: "Página de wiki",
  description:
    "Contenido (markdown) de una página de la wiki de una materia, con sus fuentes. Si es larga, seguí con offset. " +
    "Las páginas \"stale\" se basan en apuntes viejos. EN: A subject wiki page (markdown), paged by offset.",
  access: "user",
  capability: CAP,
  input: {
    subjectId,
    slug: z.string().min(1),
    offset: z.number().int().min(0).optional(),
    maxChars: z.number().int().min(1000).max(30000).optional().describe("Por defecto 12000. / Default 12000.")
  },
  async run(args, ctx) {
    const p = await ctx.api.get<KbPage>(`/v1/wiki/subjects/${encodeURIComponent(args.subjectId)}/kb/${encodeURIComponent(args.slug)}`);
    const body = cut(p.markdown, args.maxChars ?? 12000, args.offset ?? 0);
    return compact({
      subject: `${p.subjectId} ${p.subjectName}`,
      slug: p.slug, title: p.title, type: p.type, summary: p.summary,
      stale: p.stale || undefined,
      sourceYears: p.sourceYears?.min ? `${p.sourceYears.min}-${p.sourceYears.max}` : undefined,
      sources: p.sources?.length,
      generatedAt: p.generatedAt,
      markdown: body.text,
      totalChars: body.totalChars,
      nextOffset: body.truncated ? body.offset + body.text.length : undefined
    });
  }
});

export const listMyBookmarks = defineTool({
  name: "list_my_bookmarks",
  title: "Materias fijadas",
  description: "Materias que fijaste en Apuntes. EN: Subjects you pinned in Apuntes.",
  access: "user",
  input: {},
  async run(_args, ctx) {
    const res = await ctx.api.get<{ subjectId: string; subjectName: string; fileCount: number; hasWiki: boolean }[]>("/v1/wiki/bookmarks");
    return res.map(b => compact({ subjectId: b.subjectId, name: b.subjectName, files: b.fileCount, wiki: b.hasWiki || undefined }));
  }
});

export const wikiTools = [searchApuntes, listSubjectFiles, getSubjectWiki, getWikiPage, listMyBookmarks];
