// Port of apps/api/src/test/java/org/ceitba/api/service/kb/KbPageParserTest.java
import { describe, expect, test } from 'bun:test';
import { parse } from '../../src/features/kb/logic/kbPageParser';

const F1 = '11111111-1111-1111-1111-111111111111';

function page(frontmatter: string, body: string): string {
  return '---\n' + frontmatter + '\n---\n' + body;
}

function fm(subject: string, type: string): string {
  return (
    'title: Valor tiempo del dinero\nsubject: ' + subject + '\ntype: ' + type +
    '\nsummary: Resumen.\naliases: [VTD]\nsources: [' + F1 + ']\ngenerator: claude-opus-5.5/manual\n' +
    'generated_at: 2026-10-02'
  );
}

const BODY =
  'Intro [[van-y-tir]].\n\n## Interés\nTexto [[file:' + F1 + '|guía]].\n\n' +
  '### Sub\nmás\n\n## Descuento\nVer [[81.07/balance|balance]] y [[81.07]] [[file:' + F1 + ']].\n';

const anyMatch = (errors: string[], s: string) => expect(errors.some((e) => e.includes(s))).toBe(true);

describe('KbPageParserTest', () => {
  test('parsesAValidPage', () => {
    const r = parse('valor-tiempo-del-dinero.md', page(fm('"61.12"', 'concept'), BODY), '61.12');
    expect(r.errors).toEqual([]);
    const d = r.draft!;
    expect(d.slug).toBe('valor-tiempo-del-dinero');
    expect(d.type).toBe('CONCEPT');
    expect(d.aliases).toEqual(['VTD']);
    expect(d.sources).toEqual([F1]);
    expect(d.generatedAt.toString().substring(0, 10)).toBe('2026-10-02');
    expect(d.body.startsWith('Intro')).toBe(true);
    expect(d.body).not.toContain('---');
    expect(d.links.links.map((l) => l.raw)).toEqual(['van-y-tir', '81.07/balance', '81.07']);
    expect(d.links.citations).toHaveLength(2);
  });

  test('rejectsBadFrontmatterAndStructure', () => {
    anyMatch(parse('a.md', 'no frontmatter', '61.12').errors, 'missing frontmatter');
    anyMatch(parse('a.md', '---\ntitle: x\n', '61.12').errors, 'not closed');
    // Unquoted subject parses as a number.
    anyMatch(parse('a.md', page(fm('61.12', 'concept'), BODY), '61.12').errors, 'quoted string');
    anyMatch(parse('a.md', page(fm('"61.13"', 'concept'), BODY), '61.12').errors, 'does not match the folder');
    anyMatch(parse('a.md', page(fm('"61.12"', 'index'), BODY), '61.12').errors, 'only for index.md');
    anyMatch(parse('index.md', page(fm('"61.12"', 'topic'), BODY), '61.12').errors, 'must have type: index');
    anyMatch(parse('Mal_Slug.md', page(fm('"61.12"', 'concept'), BODY), '61.12').errors, 'invalid slug');
    anyMatch(parse('graph.md', page(fm('"61.12"', 'concept'), BODY), '61.12').errors, 'reserved');
    const missing = parse('a.md', page('title: x\nsubject: "61.12"\ntype: concept', BODY), '61.12').errors;
    anyMatch(missing, 'summary is required');
    anyMatch(missing, 'sources is required');
    anyMatch(missing, 'generated_at is required');
  });

  test('everyH2SectionNeedsACitation', () => {
    const body = '## Uno\nsin cita\n### Sub\n[[file:' + F1 + ']]\n## Dos\n```\n## no es heading\n```\nnada\n';
    const r = parse('a.md', page(fm('"61.12"', 'concept'), body), '61.12');
    expect(r.errors).toEqual(["section 'Dos' has no [[file:…]] citation"]);
    // A citation inside a code block does not count.
    const code = '## Uno\n`[[file:' + F1 + ']]`\n';
    expect(parse('a.md', page(fm('"61.12"', 'concept'), code), '61.12').errors).toEqual([
      "section 'Uno' has no [[file:…]] citation",
    ]);
    expect(parse('a.md', page(fm('"61.12"', 'concept'), '## Uno\n[[file:nope]]'), '61.12').errors).toContain(
      'invalid citation [[file:nope]]',
    );
  });
});
