// Port of apps/api/src/test/java/org/ceitba/api/service/kb/KbLinkerTest.java
// Deterministic linker (port of scripts/kb/link_kb.py).
import { describe, expect, test } from 'bun:test';

import { link, unlinked, type Target } from '../../src/features/kb/logic/kbLinker';
import { javaSplit } from '../../src/lib/javaCompat';

const PAGES: Target[] = [
  { slug: 'tasa-interna-de-retorno', title: 'Tasa interna de retorno', aliases: ['TIR'] },
  { slug: 'valor-actual-neto', title: 'Valor actual neto', aliases: [] },
];

describe('KbLinkerTest', () => {
  test('linksTheFirstMentionPerSectionAndSkipsCodeAndHeadings', () => {
    const body = `## Valor actual neto
El valor actual neto se compara con la tasa interna de retorno.
Otra vez la tasa interna de retorno.

\`tasa interna de retorno\`
`;
    const r = link(body, 'otra', PAGES);
    expect(r.body).toContain('[[tasa-interna-de-retorno|tasa interna de retorno]] de retorno.'.replace(' de retorno.', ''));
    expect(r.body).toContain('## Valor actual neto\n');
    expect(r.body).toContain('`tasa interna de retorno`');
    expect(r.body).toContain('[[valor-actual-neto|valor actual neto]]');
    expect(javaSplit(r.body, /\[\[tasa-interna-de-retorno/, -1)).toHaveLength(2);
    expect(r.addedSlugs).toEqual(expect.arrayContaining(['tasa-interna-de-retorno', 'valor-actual-neto']));
  });

  test('doesNotLinkTheCurrentPageAndReportsUnlinkedMentions', () => {
    const body = '## A\nLa tasa interna de retorno importa.\n';
    expect(link(body, 'tasa-interna-de-retorno', PAGES).body).toBe(body);
    expect(unlinked(body, 'x', PAGES).map((m) => m.slug)).toEqual(['tasa-interna-de-retorno']);
    const linked = '## A\nLa [[tasa-interna-de-retorno|TIR]] importa.\n';
    expect(unlinked(linked, 'x', PAGES)).toEqual([]);
  });
});
