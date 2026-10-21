// Port of apps/api/src/test/java/org/ceitba/api/service/kb/admin/KbSettingsValidationTest.java
// Wrongly typed values are refused (not read as 0/false), read-only fields of
// the echoed response are ignored, and resending a default stores nothing.
import { describe, expect, test } from 'bun:test';
import { ValidationError } from '../../../src/http/errors';
import { checkTypes, DEFAULT_TOKEN_BUDGET_MAX, kbPipelineProperties, KbSettingsLogic } from '../../../src/features/kb/logic/admin/kbSettings';
import { nodeToString, readTree } from '../../../src/features/kb/logic/jsonNode';
import { kbLlmProperties } from '../../../src/features/kb/logic/llm/kbLlmProperties';

const service = new KbSettingsLogic(kbPipelineProperties({ enabled: false }), kbLlmProperties(null, null, 'sync', null, false));

describe('KbSettingsValidationTest', () => {
  test('wrongTypesNameTheField', () => {
    expect(() => checkTypes(readTree('{"weeklyCostLimitUsd":"25"}'))).toThrow(ValidationError);
    expect(() => checkTypes(readTree('{"weeklyCostLimitUsd":"25"}'))).toThrow('weeklyCostLimitUsd');
    expect(() => checkTypes(readTree('{"enabled":"yes"}'))).toThrow(ValidationError);
    expect(() => checkTypes(readTree('{"enabled":"yes"}'))).toThrow('enabled');
    checkTypes(readTree('{"weeklyCostLimitUsd":25,"enabled":true,"cron":null}'));
  });

  test('defaultsAndReadOnlyFieldsAreNotStored', () => {
    const body = readTree(`
      {"enabled":false,"cron":"0 0 3 * * SUN","runTokenBudget":3000000,"modelWrite":"glm-5.3",
       "weeklyCostLimitUsd":25,"costImpact":{"previous":null},"source":{},"updatedAt":"2026-10-01T00:00:00Z"}`);
    const next = service.applied({}, body);
    expect(nodeToString(next)).toBe('{"weeklyCostLimitUsd":25}');
  });

  // A stored (or env) budget of 5 trillion is used as at most the ceiling.
  test('runTokenBudgetIsClampedWhenUsed', () => {
    expect(service.merge(readTree('{"runTokenBudget":5000000000000}')).runTokenBudget).toBe(DEFAULT_TOKEN_BUDGET_MAX);
    expect(service.merge(readTree('{"runTokenBudget":1000}')).runTokenBudget).toBe(1000);
  });
});
