// Unit tests of the share helpers (no Java unit test exists for share):
// the Jackson re-rendering of jsonb payloads and resolveDisplayName.
import { describe, expect, test } from 'bun:test';
import { jacksonFromJsonbText, jsonWithRaw, RawJsonText } from '../../src/features/share/jsonbJackson';
import { resolveDisplayName } from '../../src/features/share/service';

describe('jacksonFromJsonbText', () => {
  test('keeps Postgres key order and writes decimals as Double.toString', () => {
    // Postgres jsonb text output: shorter keys first, numerics in plain notation.
    expect(jacksonFromJsonbText('{"2": [1.50, 0.0000001, 100000000000000000000], "b": 1.0, "s": "ñ\\u001f\\"\\n/", "z": {"x": true, "y": null}, "10": "x"}'))
      .toBe('{"2":[1.5,1.0E-7,100000000000000000000],"b":1.0,"s":"ñ\\u001F\\"\\n/","z":{"x":true,"y":null},"10":"x"}');
    expect(jacksonFromJsonbText('{}')).toBe('{}');
    expect(jacksonFromJsonbText('[-0, -1.25e2, 3]')).toBe('[0,-125.0,3]');
  });

  test('jsonWithRaw splices fragments verbatim', async () => {
    const r = jsonWithRaw({ a: 1, p: new RawJsonText('{"10":1,"2":2.0}'), q: [new RawJsonText('[]'), null] }, 201);
    expect(r.status).toBe(201);
    expect(r.headers.get('content-type')).toBe('application/json');
    expect(await r.text()).toBe('{"a":1,"p":{"10":1,"2":2.0},"q":[[],null]}');
  });
});

describe('resolveDisplayName', () => {
  const u = (name: string | null, email = 'bob@itba.edu.ar') => ({ name, email });
  test('requested name, trimmed', () => expect(resolveDisplayName('  Bobby ', u('Robert X'))).toBe('Bobby'));
  test('first word of the name when the request is blank', () => {
    expect(resolveDisplayName('   ', u('  Alice  Smith '))).toBe('Alice');
    expect(resolveDisplayName(null, u('Ana\tMaría'))).toBe('Ana');
  });
  test('email local part when the name is blank or missing', () => {
    expect(resolveDisplayName(null, u(null))).toBe('bob');
    expect(resolveDisplayName(null, u('\u2003'))).toBe('bob'); // isBlank uses Character.isWhitespace
    expect(resolveDisplayName(null, u(null, '@x.org'))).toBe('@x.org');
  });
});
