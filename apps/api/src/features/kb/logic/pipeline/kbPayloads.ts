// Port of apps/api/src/main/java/org/ceitba/api/service/kb/pipeline/KbPayloads.java.
//
// Builds the Anthropic `params` of every pipeline request: system prompt
// (versioned resources kb/prompts/<stage>.<version>.md, copied byte-identical to
// ../../prompts), the user message, one forced tool, max_tokens. Also chunking
// and excerpt selection.

import { readFileSync } from 'node:fs';
import { jIsBlank, jSplit, jStrip, lowerRoot } from '../javaString';
import { asText, deepCopy, isArray, nodeToString, path, prettyJackson, type JsonObject, type JsonValue, type Node } from '../jsonNode';
import type { KbModelReader } from '../ports';
import { normalize } from '../subjectNormalize';
import { MAX_TOKENS_CAP } from '../llm/syncLlmExecutor';
import type { KbEffectiveSettings } from '../admin/kbSettings';

export const PROMPT_VERSION = 'v2'; // v2: 8k-token digest chunks, bounded digest schema

/** About 8k input tokens (3.5 chars/token) per digest chunk. */
export const CHUNK_CHARS = 28_000;
/** ~12k tokens of raw excerpts per written page. */
export const EXCERPT_CHARS = 42_000;

const PROMPTS_DIR = new URL('../../prompts/', import.meta.url);

/**
 * Reasoning models spend part of max_tokens on thinking before the answer: the
 * configured answer budget plus room for it (low 4000, medium 8000, high 16000;
 * unset effort = the provider's default, medium), capped at the sync cap and the
 * model's own output limit. Never lower than what was configured.
 */
export function withHeadroom(maxTokens: number, effort: string | null, modelMaxOutput: number | null): number {
  let extra: number;
  switch (effort == null ? 'medium' : lowerRoot(effort)) {
    case 'minimal':
    case 'none':
      extra = 1000;
      break;
    case 'low':
      extra = 4000;
      break;
    case 'high':
      extra = 16000;
      break;
    default:
      extra = 8000;
  }
  let cap = MAX_TOKENS_CAP;
  if (modelMaxOutput != null && modelMaxOutput > 0) cap = Math.min(cap, modelMaxOutput);
  return Math.max(maxTokens, Math.min(cap, maxTokens + extra));
}

export function estimateTokens(params: Node): number {
  return Math.ceil(nodeToString(params).length / 3.5);
}

export class KbPayloads {
  private readonly prompts = new Map<string, string>();

  constructor(private readonly models: KbModelReader | null) {}

  /** params for a pipeline stage with the settings' max_tokens and reasoning_effort (stageKey: DIGEST|PLAN|WRITE|RETRY). */
  async tunedFor(model: string, stageKey: string, s: KbEffectiveSettings, stable: string | null, variable: string): Promise<JsonObject> {
    return this.tuned(model, stageKey, s.maxTokens(stageKey), s.reasoningEffort(stageKey), stable, variable);
  }

  async tuned(model: string, stageKey: string, maxTokens: number, effort: string | null, stable: string | null, variable: string): Promise<JsonObject> {
    const m = this.models == null ? null : await this.models.findById(model);
    const reasoning = m != null && m.supportsReasoningEffort;
    if (reasoning) maxTokens = withHeadroom(maxTokens, effort, m!.maxOutputTokens);
    const p = this.params(model, lowerRoot(stageKey), maxTokens, stable, variable);
    if (effort != null && reasoning) p.reasoning_effort = effort;
    return p;
  }

  prompt(stage: string): string {
    let p = this.prompts.get(stage);
    if (p === undefined) {
      const name = `${stage}.${PROMPT_VERSION}.md`;
      try {
        p = readFileSync(new URL(name, PROMPTS_DIR), 'utf8');
      } catch (e) {
        throw new Error(`Missing prompt kb/prompts/${name}`, { cause: e });
      }
      this.prompts.set(stage, p);
    }
    return p;
  }

  /**
   * For provider prompt caching the stable part (rules in `system`, then `stable`:
   * the subject and its page index, in a fixed order) comes first and the variable
   * part (digests, excerpts, current page) last, as separate text blocks.
   */
  params(model: string, stage: string, maxTokens: number, stable: string | null, variable: string): JsonObject {
    const msg: JsonObject = { role: 'user' };
    if (stable == null) {
      msg.content = variable;
    } else {
      msg.content = [
        { type: 'text', text: '## Contexto\n\n' + stable },
        { type: 'text', text: '## Tarea\n\n' + variable },
      ];
    }
    const tool = this.tool(stage);
    return {
      model,
      max_tokens: maxTokens,
      system: this.prompt(stage),
      messages: [msg],
      tools: [tool],
      tool_choice: { type: 'tool', name: asText(path(tool, 'name')) },
    };
  }

  /** A copy of `params` with one more text block at the end of the user message (the PLAN retry's note). */
  withNote(params: JsonValue, note: string): JsonObject {
    const p = deepCopy(params) as JsonObject;
    if (!isArray(p.messages)) p.messages = []; // ObjectNode.withArray creates it
    const messages = p.messages as JsonValue[];
    const msg = messages[0] as JsonObject;
    let content: JsonValue[];
    if (isArray(path(msg, 'content'))) {
      content = msg.content as JsonValue[];
    } else {
      const text = asText(path(msg, 'content'), '')!;
      content = [{ type: 'text', text }];
      msg.content = content;
    }
    content.push({ type: 'text', text: note });
    return p;
  }

  /** writerWithDefaultPrettyPrinter().writeValueAsString(o). */
  toJson(o: JsonValue): string {
    return prettyJackson(o);
  }

  // ---- tools ---------------------------------------------------------------

  tool(stage: string): JsonObject {
    const t: JsonObject = {};
    const props: JsonObject = {};
    const schema: JsonObject = { type: 'object', properties: props };
    const boundedStrings = (maxItems: number, maxLength: number): JsonObject => ({
      type: 'array',
      maxItems,
      items: { type: 'string', maxLength },
    });
    const stringArray = (): JsonObject => ({ type: 'array', items: { type: 'string' } });
    switch (stage) {
      case 'digest': {
        t.name = 'submit_digest';
        t.description = 'Submit the digest of this chunk';
        // Bounded output (digest.v2.md states the same limits).
        const topic: JsonObject = {
          type: 'object',
          properties: {
            name: { type: 'string', maxLength: 80 },
            aliases: boundedStrings(4, 80),
            summary: { type: 'string', maxLength: 300 },
            keyPoints: boundedStrings(5, 160),
            formulas: boundedStrings(5, 160),
          },
          required: ['name', 'summary'],
        };
        props.topics = { type: 'array', maxItems: 12, items: topic };
        props.materialKind = { type: 'string' };
        props.unitHint = { type: ['string', 'null'] };
        props.language = { type: 'string' };
        schema.required = ['topics'];
        break;
      }
      case 'plan': {
        t.name = 'submit_plan';
        t.description = 'Submit the page operations';
        const sources = stringArray();
        sources.description =
          'Ids of the input source files that support the page, exactly as given in ' +
          'the input (fileId). Required with at least one id for create/update; may be empty only for delete.';
        const mustCover = stringArray();
        mustCover.description =
          'What the page must present: each key definition, method, theorem or ' +
          'formula it has to include, written precisely. For quantitative topics give the formulas in LaTeX ' +
          'with their notation (e.g. `IC media σ desconocida: \\bar X \\pm t_{n-1,1-\\alpha/2}\\, s/\\sqrt{n}`). ' +
          '2–8 items. May be empty only for delete and index.';
        const op: JsonObject = {
          type: 'object',
          properties: {
            op: { type: 'string', enum: ['create', 'update', 'delete'] },
            slug: { type: 'string', description: 'Page slug: Spanish, lowercase ASCII words joined by hyphens' },
            type: { type: 'string', enum: ['index', 'topic', 'concept'] },
            title: { type: 'string', description: 'Page title, in Spanish' },
            sources,
            reason: { type: 'string', description: 'Why, in one short sentence' },
            mustCover,
          },
          // Every field is required: a create/update without valid sources is dropped.
          required: ['op', 'slug', 'type', 'title', 'sources', 'reason', 'mustCover'],
        };
        props.operations = { type: 'array', items: op };
        schema.required = ['operations'];
        break;
      }
      default: {
        t.name = 'submit_page';
        t.description = 'Submit the complete page file (frontmatter + Markdown)';
        props.markdown = { type: 'string' };
        schema.required = ['markdown'];
      }
    }
    t.input_schema = schema;
    return t;
  }
}

// ---- chunks and excerpts --------------------------------------------------

/** Splits text into chunks of at most CHUNK_CHARS, at paragraph breaks when possible. */
export function chunks(text: string | null): string[] {
  const out: string[] = [];
  if (text == null || jIsBlank(text)) return out;
  let from = 0;
  while (from < text.length) {
    let end = Math.min(text.length, from + CHUNK_CHARS);
    if (end < text.length) {
      const para = text.lastIndexOf('\n\n', end);
      if (para > from + CHUNK_CHARS / 2) end = para;
    }
    out.push(jStrip(text.substring(from, end)));
    from = end;
  }
  return out.filter((s) => !jIsBlank(s));
}

export interface Excerpt {
  fileId: string;
  name: string;
  text: string;
}

export interface SourceText {
  fileId: string;
  name: string;
  text: string;
}

const PARAGRAPH_BREAK = /\n[ \t\n\x0B\f\r]*\n/;

/**
 * The paragraphs of the given (added/changed) files most related to the page,
 * kept in document order, within EXCERPT_CHARS overall (split evenly between files).
 */
export function excerpts(sources: SourceText[], keywords: Iterable<string>): Excerpt[] {
  const out: Excerpt[] = [];
  if (sources.length === 0) return out;
  const perFile = Math.trunc(EXCERPT_CHARS / sources.length);
  const folded = new Set<string>();
  for (const k of keywords) {
    for (const w of jSplit(normalize(k), ' ')) if (w.length >= 4) folded.add(w);
  }
  for (const s of sources) {
    const paragraphs = jSplit(s.text, PARAGRAPH_BREAK);
    const scored: { index: number; score: number; text: string }[] = [];
    for (let i = 0; i < paragraphs.length; i++) {
      const p = jStrip(paragraphs[i]!);
      if (p.length === 0) continue;
      let score = 0;
      const norm = normalize(p);
      for (const k of folded) if (norm.includes(k)) score++;
      scored.push({ index: i, score, text: p });
    }
    scored.sort((a, b) => b.score - a.score || a.index - b.index);
    const chosen: { index: number; score: number; text: string }[] = [];
    let used = 0;
    for (const p of scored) {
      if (used + p.text.length > perFile) {
        if (chosen.length === 0) chosen.push({ index: p.index, score: p.score, text: p.text.substring(0, perFile) });
        continue;
      }
      chosen.push(p);
      used += p.text.length + 2;
    }
    chosen.sort((a, b) => a.index - b.index);
    let sb = '';
    for (const p of chosen) sb += p.text + '\n\n';
    out.push({ fileId: s.fileId, name: s.name, text: jStrip(sb) });
  }
  return out;
}
