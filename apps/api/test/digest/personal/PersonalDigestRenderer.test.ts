// Port of apps/api/src/test/java/org/ceitba/api/service/digest/personal/PersonalDigestRendererTest.java
// (+ `interop:` byte-for-byte comparisons with the Java renderer).
import { describe, expect, test } from 'bun:test';
import { renderPersonalDigest, slots, type VoteLinks } from '../../../src/features/digest/logic/personal/personalDigestRenderer';
import { needsSchedule, type PersonalDigest } from '../../../src/features/digest/logic/personal/types';
import { INTEROP } from '../../interop/java-golden';

const SCHEDULER = 'https://ceitba.org.ar/app/horario';
const CORRECTION = crypto.randomUUID();

const links = (): VoteLinks => ({ confirm: 'https://n/correction?token=t&vote=confirm', reject: 'https://n/correction?token=t&vote=reject' });

const current = (subjectName: string, commission: string | null): PersonalDigest => ({
  state: 'CURRENT',
  subjects: [{ code: '93.41', name: subjectName, commissionName: commission }, { code: '93.58', name: 'Matemática', commissionName: null }],
  wiki: [{ subjectCode: '93.41', subjectName, url: 'https://ceitba.org.ar/apuntes/93.41?vista=wiki', updatedThisWeek: true }],
  corrections: [{
    correctionId: CORRECTION, subjectName, commissionName: commission,
    proposed: [{ day: 'TUESDAY', from: '09:00', to: '12:00' }, { day: 'WEDNESDAY', from: '08:00', to: '10:00' }],
    sga: [{ day: 'MONDAY', from: '08:00', to: '11:00' }],
  }],
});

describe('PersonalDigestRendererTest', () => {
  test('currentScheduleShowsSubjectsWikiAndCorrections', () => {
    const s = renderPersonalDigest(current('Física I', 'A'), SCHEDULER, links);
    for (const x of ['Tu cuatrimestre', 'Física I', 'com. A', 'Matemática',
      'href="https://ceitba.org.ar/apuntes/93.41?vista=wiki"', 'actualizado esta semana',
      'Alguien reportó que Física I (com. A) se dicta martes 09:00 a 12:00 y miércoles 08:00 a 10:00 '
        + 'en vez de lunes 08:00 a 11:00. ¿Es así?',
      'href="https://n/correction?token=t&amp;vote=confirm"', 'Sí, es así',
      'href="https://n/correction?token=t&amp;vote=reject"']) expect(s.html).toContain(x);
    expect(s.html!.startsWith('<tr>')).toBe(true);
    expect(s.html!.endsWith('</tr>')).toBe(true);
    expect(s.html).not.toContain(SCHEDULER);
    for (const x of ['TU CUATRIMESTRE', '* Física I · com. A',
      'Física I (actualizado esta semana): https://ceitba.org.ar/apuntes/93.41?vista=wiki',
      'Sí, es así: https://n/correction?token=t&vote=confirm',
      'No: https://n/correction?token=t&vote=reject']) expect(s.text).toContain(x);
  });

  test('needsScheduleIsJustTheCallToAction', () => {
    const s = renderPersonalDigest(needsSchedule(), SCHEDULER, links);
    expect(s.html).toContain('Armá tu horario en la app');
    expect(s.html).toContain(`href="${SCHEDULER}"`);
    expect(s.html).not.toContain('Alguien reportó');
    expect(s.text).toContain(`Armá tu horario en la app: ${SCHEDULER}`);
  });

  test('escapesEverything', () => {
    const evil = "<script>alert('x')</script>&\"";
    const s = renderPersonalDigest(current(evil, '<b>A</b>'), SCHEDULER, () =>
      ({ confirm: 'https://n/?a="><img src=x>', reject: 'https://n/?b=1&c=2' }));
    for (const x of ['<script>', '<b>A</b>', '"><img']) expect(s.html).not.toContain(x);
    for (const x of ['&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;&amp;&quot;', 'com. &lt;b&gt;A&lt;/b&gt;',
      'https://n/?a=&quot;&gt;&lt;img src=x&gt;', 'https://n/?b=1&amp;c=2']) expect(s.html).toContain(x);
  });

  test('slotListsReadNaturally', () => {
    expect(slots([{ day: 'SATURDAY', from: '10:00', to: '13:00' }])).toBe('sábado 10:00 a 13:00');
    expect(slots([{ day: 'MONDAY', from: '08:00', to: '10:00' }, { day: 'TUESDAY', from: '08:00', to: '10:00' },
      { day: 'FRIDAY', from: '18:00', to: '21:00' }])).toBe('lunes 08:00 a 10:00, martes 08:00 a 10:00 y viernes 18:00 a 21:00');
  });
});

describe('interop: PersonalDigestRenderer byte-for-byte against Java', () => {
  for (const c of INTEROP.personalRender) {
    test(c.name, () => {
      const s = renderPersonalDigest(c.input.digest, c.input.schedulerUrl,
        (id) => ({ confirm: `https://n/correction?token=${id}&vote=confirm`, reject: `https://n/correction?token=${id}&vote=reject` }));
      expect(s.html).toBe(c.html);
      expect(s.text).toBe(c.text);
    });
  }
});
