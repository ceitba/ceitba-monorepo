import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Career } from "./api/types";
import { sharedCatalog } from "./catalog";
import type { SessionContext } from "./context";
import { errorMessage, registerTools, type ToolDef } from "./tools/define";
import { academicTools } from "./tools/academic";
import { meTools } from "./tools/me";
import { newsTools } from "./tools/news";
import { scheduleTools } from "./tools/schedules";
import { staffTools } from "./tools/staff";
import { wikiTools } from "./tools/wiki";

export const ALL_TOOLS: ToolDef[] = [
  ...academicTools, ...scheduleTools, ...newsTools, ...meTools, ...wikiTools, ...staffTools
] as ToolDef[];

const INSTRUCTIONS = `Servidor MCP de CEITBA (Centro de Estudiantes del ITBA).
Datos: plan de estudios y materias, comisiones y horarios, aulas libres, combinador de horarios,
noticias y eventos estudiantiles, organizaciones, beneficios, y con sesión: horarios guardados,
apuntes y wikis por materia, grupos de estudio y propuestas. El personal de CEITBA ve además
herramientas [Staff]/[Moderación].
- Respondé en el idioma de la persona (por defecto español). Las fechas son de Argentina (YYYY-MM-DD).
- Usá list_careers para conocer los ids de plan (p. ej. "S10-Rev23") y whoami para el plan del usuario.
- Para armar horarios usá generate_schedules en lugar de combinar a mano.
- Las herramientas de escritura cambian datos reales: confirmá con la persona antes de usarlas.
EN: CEITBA (ITBA student union) data. Reply in the user's language; dates are Argentina time.`;

export function createCeitbaServer(ctx: SessionContext, version = "0.1.0"): { server: McpServer; tools: string[] } {
  const server = new McpServer(
    { name: "ceitba", title: "CEITBA", version },
    { instructions: INSTRUCTIONS, capabilities: { logging: {} } }
  );

  const tools = registerTools(server, ctx, ALL_TOOLS);
  registerResources(server, ctx);
  registerPrompts(server);
  return { server, tools };
}

function registerResources(server: McpServer, ctx: SessionContext): void {
  server.registerResource(
    "plan",
    new ResourceTemplate("ceitba://plan/{planId}", {
      list: async () => {
        const careers = Object.values(await ctx.api.get<Record<string, Career>>("/v1/careers/plans").catch(() => ({})));
        return {
          resources: careers.flatMap(c => c.plans.map(p => ({
            uri: `ceitba://plan/${encodeURIComponent(p)}`, name: `${c.name} · ${p}`, mimeType: "application/json"
          })))
        };
      }
    }),
    { title: "Plan de estudios", description: "Materias de un plan por año y cuatrimestre. EN: A study plan's subjects.", mimeType: "application/json" },
    async (uri, vars) => {
      const planId = decodeURIComponent(String(vars.planId));
      const subjects = await sharedCatalog.planSubjects(ctx.api, planId);
      const text = JSON.stringify(subjects.map(s => ({
        id: s.subject_id, name: s.name, credits: s.credits, year: s.year, semester: s.semester,
        section: s.section, prerequisites: s.dependencies
      })));
      return { contents: [{ uri: uri.href, mimeType: "application/json", text }] };
    }
  );

  const id = ctx.identity;
  if (!id || !(id.staff || id.capabilities.includes("apuntes"))) return;
  server.registerResource(
    "wiki-page",
    new ResourceTemplate("ceitba://wiki/{subjectId}/{slug}", { list: undefined }),
    { title: "Página de wiki de materia", description: "Markdown de una página de la wiki. EN: A subject wiki page.", mimeType: "text/markdown" },
    async (uri, vars) => {
      try {
        const p = await ctx.api.get<{ title: string; markdown: string }>(
          `/v1/wiki/subjects/${encodeURIComponent(String(vars.subjectId))}/kb/${encodeURIComponent(String(vars.slug))}`);
        return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: `# ${p.title}\n\n${p.markdown}` }] };
      } catch (e) {
        throw new Error(errorMessage(e, ctx));
      }
    }
  );
}

function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "planificar_cuatrimestre",
    {
      title: "Planificar mi cuatrimestre",
      description: "Arma opciones de horario para las materias que querés cursar. EN: Plan your term's schedule.",
      argsSchema: {
        plan: z.string().describe("Plan, p. ej. S10-Rev23"),
        materias: z.string().describe("Códigos separados por coma, p. ej. 93.41, 72.11"),
        restricciones: z.string().optional().describe("P. ej. \"trabajo lunes y miércoles a la mañana, quiero un día libre\"")
      }
    },
    ({ plan, materias, restricciones }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text:
            `Quiero cursar estas materias del plan ${plan}: ${materias}.` +
            (restricciones ? ` Restricciones: ${restricciones}.` : "") +
            " Revisá con get_subject_commissions los horarios y correlativas, traducí mis restricciones a bloqueos y" +
            " usá generate_schedules. Mostrame las 3 mejores opciones como grilla semanal y explicá ventajas y desventajas" +
            " (días libres, horas muertas, cambios de edificio)."
        }
      }]
    })
  );

  server.registerPrompt(
    "estudiar_materia",
    {
      title: "Estudiar una materia",
      description: "Resumen de una materia con su wiki y apuntes. EN: Study a subject using its wiki and notes.",
      argsSchema: { materia: z.string().describe("Código de materia, p. ej. 93.41") }
    },
    ({ materia }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text:
            `Ayudame a estudiar ${materia}. Usá get_subject para ubicarla, get_subject_wiki y get_wiki_page para los` +
            " temas y list_subject_files para los apuntes disponibles. Armá un plan de estudio por temas, citando las" +
            " páginas de la wiki que uses y avisando si alguna está desactualizada (stale)."
        }
      }]
    })
  );

  server.registerPrompt(
    "que_hay_esta_semana",
    {
      title: "¿Qué hay esta semana?",
      description: "Eventos, noticias y destacados de los próximos días. EN: This week's events and news."
    },
    () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text:
            "¿Qué pasa esta semana en el ITBA? Usá list_events (próximos 7 días), list_articles (últimas noticias) y" +
            " list_highlights. Si tengo sesión, priorizá las organizaciones que sigo (list_my_follows)."
        }
      }]
    })
  );
}
