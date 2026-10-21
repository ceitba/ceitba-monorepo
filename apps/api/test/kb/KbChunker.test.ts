// Port of apps/api/src/test/java/org/ceitba/api/service/kb/KbChunkerTest.java
import { describe, expect, test } from 'bun:test';
import { chunk, MAX_ANCHOR, MAX_CHARS, MAX_TITLE } from '../../src/features/kb/logic/kbChunker';
import { headingAnchors } from '../../src/features/kb/logic/kbWikilinks';

const FILE = '[[file:3f2b1c9e-0000-4000-8000-000000000001]]';

describe('KbChunkerTest', () => {
  test('chunk0IsTitleSummaryAndIntroThenOneChunkPerSection', () => {
    const md = `Intro con [[valor-actual|valor actual]].

## Cómo se calcula
Se descuenta cada flujo ${FILE}.

### Ejemplo
Un ejemplo con [[61.12/tasa]].

## Usos
En [[61.12|Financiera]] se usa mucho ${FILE}.
`;
    const chunks = chunk('VAN', 'El valor actual neto.', md);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]!.ordinal).toBe(0);
    expect(chunks[0]!.heading).toBeNull();
    expect(chunks[0]!.anchor).toBeNull();
    expect(chunks[0]!.title).toBe('VAN');
    expect(chunks[0]!.body).toBe('El valor actual neto.\n\nIntro con valor actual.');
    expect(chunks[0]!.text()).toBe('VAN\n\nEl valor actual neto.\n\nIntro con valor actual.');

    expect(chunks[1]!.heading).toBe('Cómo se calcula');
    expect(chunks[1]!.anchor).toBe('como-se-calcula');
    // ### stays inside its ## section; wikilinks become text, bare citations go.
    expect(chunks[1]!.title).toBe('VAN — Cómo se calcula');
    expect(chunks[1]!.body).toBe('Se descuenta cada flujo .\n\n### Ejemplo\nUn ejemplo con 61.12/tasa.');

    expect(chunks[2]!.ordinal).toBe(2);
    expect(chunks[2]!.text()).toBe('VAN — Usos\n\nEn Financiera se usa mucho .');
  });

  test('headingsInsideCodeFencesDoNotSplit', () => {
    const md = '## Código\n```\n## no es un título\n```\n';
    const chunks = chunk('T', 'S', md);
    expect(chunks).toHaveLength(2);
    expect(chunks[1]!.text()).toContain('## no es un título');
  });

  test('emptySectionsAreSkippedButChunk0AlwaysExists', () => {
    const chunks = chunk('T', 'S', '## Vacía\n\n## Llena\nTexto.\n');
    expect(chunks.map((c) => c.heading)).toEqual([null, 'Llena']);
    expect(chunks[0]!.text()).toBe('T\n\nS');
    expect(chunks.map((c) => c.ordinal)).toEqual([0, 1]);
  });

  test('longSectionsAreSplitAtParagraphsWithinTheLimit', () => {
    const para = 'palabra '.repeat(400).trim(); // ~3.2k chars
    const md = '## Larga\n' + para + '\n\n' + para + '\n\n' + para + '\n';
    const chunks = chunk('T', 'S', md);

    const parts = chunks.slice(1);
    expect(parts).toHaveLength(3);
    for (const c of parts) {
      expect(c.title).toBe('T — Larga');
      expect(c.text().length).toBeLessThanOrEqual(MAX_CHARS);
      expect(c.anchor).toBe('larga');
    }
  });

  test('aParagraphLongerThanTheLimitIsHardCut', () => {
    const md = '## X\n' + 'a'.repeat(MAX_CHARS * 2) + '\n';
    const all = chunk('T', 'S', md);
    expect(all.length).toBeGreaterThanOrEqual(4); // subList(1, 4) throws otherwise
    const parts = all.slice(1, 4);
    for (const c of parts) expect(c.text().length).toBeLessThanOrEqual(MAX_CHARS);
  });

  test('aHugeTitleOrHeadingStillLeavesRoomForTheText', () => {
    const heading = 'Título '.repeat(1500).trim(); // ~10k chars
    const chunks = chunk('T'.repeat(7000), 'S', '## ' + heading + '\nTexto del cuerpo.\n');

    expect(chunks).toHaveLength(2);
    for (const c of chunks) {
      expect(c.title.length).toBeLessThanOrEqual(MAX_TITLE);
      expect(c.text().length).toBeLessThanOrEqual(MAX_CHARS);
    }
    expect(chunks[1]!.body).toBe('Texto del cuerpo.');
    expect(chunks[1]!.anchor!.length).toBeLessThanOrEqual(MAX_ANCHOR);
  });

  test('anchorsMatchTheOnesWikilinksResolveTo', () => {
    const md = '## Fórmula ' + FILE + '\nTexto.\n\n## Ver [[valor-actual|VAN]]\nMás.\n';
    const chunks = chunk('T', 'S', md);

    expect(chunks[1]!.heading).toBe('Fórmula');
    expect([...headingAnchors(md)]).toEqual([chunks[1]!.anchor!, chunks[2]!.anchor!]);
  });
});
