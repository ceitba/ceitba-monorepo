// Port of apps/api/src/test/java/org/ceitba/api/service/kb/KbWikilinksTest.java
import { describe, expect, test } from 'bun:test';
import { anchor, headingAnchors, parse } from '../../src/features/kb/logic/kbWikilinks';

describe('KbWikilinksTest', () => {
  test('classifiesTargets', () => {
    const p = parse(
      '[[van-y-tir]] [[van-y-tir|VAN]] [[81.07/balance|b]] [[81.07]] [[93.41A]] ' +
        '[[file:11111111-1111-1111-1111-111111111111|x]] `[[en-codigo]]`\n```\n[[en-bloque]]\n```',
      '61.12',
    );
    expect(p.links).toEqual([
      { raw: 'van-y-tir', subjectId: '61.12', slug: 'van-y-tir', anchor: null },
      { raw: '81.07/balance', subjectId: '81.07', slug: 'balance', anchor: null },
      { raw: '81.07', subjectId: '81.07', slug: 'index', anchor: null },
      { raw: '93.41A', subjectId: '93.41A', slug: 'index', anchor: null },
    ]);
    expect(p.citations).toHaveLength(1);
    expect(p.citations[0]!.id).not.toBeNull();
  });

  test('anchors', () => {
    const p = parse('[[van-y-tir#Cómo se calcula|x]] [[81.07/balance#activo]] [[#Tasa efectiva]] [[81.07#Temas]]', '61.12', 'vtd');
    expect(p.links).toEqual([
      { raw: 'van-y-tir#Cómo se calcula', subjectId: '61.12', slug: 'van-y-tir', anchor: 'como-se-calcula' },
      { raw: '81.07/balance#activo', subjectId: '81.07', slug: 'balance', anchor: 'activo' },
      { raw: '#Tasa efectiva', subjectId: '61.12', slug: 'vtd', anchor: 'tasa-efectiva' },
      { raw: '81.07#Temas', subjectId: '81.07', slug: 'index', anchor: 'temas' },
    ]);
    expect(anchor('  ¿Qué es el VAN? (2da parte)  ')).toBe('que-es-el-van-2da-parte');
    expect([
      ...headingAnchors('# Título\n## Cómo se calcula\n### Paso 2 ##\n#### Con [[vtd|VTD]]\n##### muy profundo\n```\n## en código\n```'),
    ]).toEqual(['como-se-calcula', 'paso-2', 'con-vtd']);
  });
});
