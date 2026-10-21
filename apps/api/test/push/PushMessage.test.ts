// Port of apps/api/src/test/java/org/ceitba/api/service/push/PushMessageTest.java
import { describe, expect, test } from 'bun:test';
import { pushForResource, pushMessage, PushMessageError } from '../../src/features/push/logic/pushMessage';

describe('PushMessageTest', () => {
  test('forResourceCarriesTypeAndId', () => {
    const m = pushForResource('CEITBA', 'Hola', 'article', 'a1');
    expect(m.data).toEqual({ type: 'article', id: 'a1' });
  });

  test('titleAndBodyAreRequired', () => {
    expect(() => pushMessage(' ', 'b', null)).toThrow(PushMessageError);
    expect(() => pushMessage('t', null, null)).toThrow(PushMessageError);
  });

  test('dataIsCopiedImmutableAndDropsNullValues', () => {
    const src = new Map<string, string | null>([['type', 'article'], ['id', null]]);
    const m = pushMessage('t', 'b', src);
    src.set('later', 'x');

    expect(Object.entries(m.data)).toEqual([['type', 'article']]);
    expect(() => {
      (m.data as Record<string, string>).k = 'v';
    }).toThrow(TypeError);
    expect(pushMessage('t', 'b', null).data).toEqual({});
  });
});
