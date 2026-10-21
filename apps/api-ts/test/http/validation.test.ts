// Shared binding/validation helpers (src/http/validation.ts) the feature DTOs
// rely on: @Size on a Map, @JsonProperty/@JsonAlias renames, and Spring's
// conversion of an empty request parameter.
import { describe, expect, test } from 'bun:test';
import { ArgumentTypeMismatchError, BeanValidationError } from '../../src/http/errors';
import { jv, param, validateBody } from '../../src/http/validation';

const violations = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof BeanValidationError) return e.violations.map((v) => `${v.field}: ${v.message}`);
    throw e;
  }
  return [];
};

describe('jv.map', () => {
  test('sizeCountsTheEntries', () => {
    const S = jv.object({ data: jv.map(jv.string(), { size: { max: 2 } }) });
    expect(validateBody(S, { data: { a: '1', b: '2' } })).toEqual({ data: { a: '1', b: '2' } });
    expect(violations(() => validateBody(S, { data: { a: '1', b: '2', c: '3' } }))).toEqual(['data: size must be between 0 and 2']);
    expect(violations(() => validateBody(S, { data: { a: '1', b: '2', c: '3' } }, { language: 'es', country: '' } as never))).toEqual(['data: el tamaño debe estar entre 0 y 2']);
    expect(validateBody(S, {})).toEqual({ data: null });
  });
});

describe('jv.object json names', () => {
  const S = jv.object({ fileNumber: jv.int({ positive: true }), timeFrom: jv.string() }, { json: { fileNumber: 'file_number', timeFrom: ['time_from', 'timeFrom'] } });

  test('readsTheJsonPropertyAndIgnoresTheJavaName', () => {
    expect(validateBody(S, { file_number: 5, time_from: '09:00' })).toEqual({ fileNumber: 5, timeFrom: '09:00' });
    expect(validateBody(S, { fileNumber: 5 })).toEqual({ fileNumber: null, timeFrom: null });
  });

  test('aliasesAreAcceptedAndTheLastNameWins', () => {
    expect(validateBody(S, { timeFrom: '10:00' }).timeFrom).toBe('10:00');
    expect(validateBody(S, { time_from: '09:00', timeFrom: '10:00' }).timeFrom).toBe('10:00');
  });

  test('violationsAreNamedByTheComponent', () => {
    expect(violations(() => validateBody(S, { file_number: 0 }))).toEqual(['fileNumber: must be greater than 0']);
  });
});

describe('param: empty values', () => {
  test('anOptionalObjectParameterIsNull', () => {
    expect(param.int({ required: false }).parse('', 'limit')).toBeNull();
    expect(param.uuid({ required: false }).parse('', 'setId')).toBeNull();
    expect(param.localDate({ required: false }).parse('', 'from')).toBeNull();
  });

  test('aStringStaysEmptyAndADefaultWins', () => {
    expect(param.string({ required: false }).parse('', 'q')).toBe('');
    expect(param.int({ def: 20, primitive: true }).parse('', 'limit')).toBe(20);
  });

  test('aRequiredPrimitiveFailsToConvert', () => {
    expect(() => param.int({ primitive: true }).parse('', 'year')).toThrow(ArgumentTypeMismatchError);
  });
});
