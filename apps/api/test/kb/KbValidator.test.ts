// Port of apps/api/src/test/java/org/ceitba/api/service/kb/KbValidatorTest.java
import { describe, expect, test } from 'bun:test';
import { parse, type Draft } from '../../src/features/kb/logic/kbPageParser';
import { sourceInfo, validate } from '../../src/features/kb/logic/kbValidator';
import { words } from './support/words';

const F1 = '11111111-1111-1111-1111-111111111111';
const F2 = '22222222-2222-2222-2222-222222222222';

function draft(sources: string, body: string): Draft {
  const content =
    '---\ntitle: T\nsubject: "61.12"\ntype: concept\nsummary: S\nsources: [' + sources +
    ']\ngenerator: manual\ngenerated_at: 2026-10-02\n---\n' + body;
  const r = parse('t.md', content, '61.12');
  expect(r.errors).toEqual([]);
  return r.draft!;
}

function parseErrors(body: string): string[] {
  const content =
    '---\ntitle: T\nsubject: "61.12"\ntype: concept\nsummary: S\nsources: [' + F1 +
    ']\ngenerator: manual\ngenerated_at: 2026-10-02\n---\n' + body;
  return parse('t.md', content, '61.12').errors;
}

const CITE = ' [[file:' + F1 + '|a.pdf]]';

const anyStartsWith = (errors: string[], prefix: string, label?: string) =>
  expect({ label, ok: errors.some((e) => e.startsWith(prefix)), errors }).toMatchObject({ ok: true });

describe('KbValidatorTest', () => {
  test('sourcesMustBePublishedFilesOfTheSubjectAndCitedFilesListed', () => {
    const d = draft(F1 + ', ' + F2, '## A\n[[file:' + F1 + ']] [[file:33333333-3333-3333-3333-333333333333]]');
    const errors = validate(d, new Map([
      [F1, sourceInfo(F1, true, '61.12', 'texto')],
      [F2, sourceInfo(F2, false, '61.12', 'texto')],
    ]));
    expect(errors).toEqual([
      'cites file 33333333-3333-3333-3333-333333333333 which is not in sources',
      'source ' + F2 + ' is not a published file',
    ]);

    expect(validate(draft(F1, '## A\n[[file:' + F1 + ']]'), new Map([[F1, sourceInfo(F1, true, '93.41', 'x')]]))).toEqual([
      'source ' + F1 + ' is not a file of subject 61.12',
    ]);
    expect(validate(draft(F1, '## A\n[[file:' + F1 + ']]'), new Map())).toEqual(['source ' + F1 + ' does not exist']);
    expect(validate(draft(F1, '## A\n[[file:' + F1 + ']]'), new Map([[F1, sourceInfo(F1, true, '61.12', 'x')]]))).toEqual([]);
  });

  test('copiesFromASourceAreRejected', () => {
    const text = words(0, 80);
    const d = draft(F1, '## A\n' + words(5, 45) + ' [[file:' + F1 + ']]');
    const errors = validate(d, new Map([[F1, sourceInfo(F1, true, '61.12', text)]]));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.startsWith('copies 40+ consecutive words')).toBe(true);
  });

  test('goodMathAndProseAreAccepted', () => {
    expect(
      parseErrors(
        '## A\nLa media $\\bar{X}$ y $$\\frac{a}{b} \\\\ c$$ cuestan \\$5. Usa `\\bar` en código.' + CITE +
          '\n\n```\n\\\\bar $\n```\n\n## Pendiente de la curva\nLa pendiente es negativa.' + CITE +
          '\n\nVer [[t#a]] y [[#a]]. Todo el mercado compite.' + CITE,
      ),
    ).toEqual([]);
  });

  test('brokenLatexIsRejected', () => {
    for (const bad of [
      '## A\nLa media \\bar{X} es.',
      '## A\nLa media \\\\bar{X} es.',
      '## A\n$\\bar{X} \\\n\\pm z$ es.',
      '## A\nUn precio de $5 y nada más.',
      '## A\nSe ve $\\\\pm z$ aquí.',
    ]) {
      anyStartsWith(parseErrors(bad + CITE), 'latex_format:', bad);
    }
  });

  test('editorNotesAreRejected', () => {
    for (const bad of [
      '## Qué falta\n- Algo' + CITE,
      '## Contenido\nTexto' + CITE + '\n\n## TODO\nx',
      '## A\nTexto' + CITE + '\n- Agregar enlaces a páginas de cada tema cuando existan',
      '## A\nTexto' + CITE + '\n- TODO: ampliar',
      '## A\nTexto' + CITE + '\n- Por completar',
    ]) {
      anyStartsWith(parseErrors(bad), 'meta_section:', bad);
    }
  });

  test('selfLinksAndSpacedCitationsAreRejected', () => {
    anyStartsWith(parseErrors('## A\nVer [[t|Esta]]' + CITE), 'self_link:');
    anyStartsWith(parseErrors('## A\nTexto [[file: ' + F1 + '|a.pdf]]'), 'citation ');
  });
});
