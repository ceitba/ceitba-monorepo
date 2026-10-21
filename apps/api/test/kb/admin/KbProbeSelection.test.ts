// Port of apps/api/src/test/java/org/ceitba/api/service/kb/admin/KbProbeSelectionTest.java
// lastProbe per mode; selectable by the mode a stage would use; a pending
// batch probe never blocks selection.
import { describe, expect, test } from 'bun:test';
import { mergeProbe } from '../../../src/features/kb/logic/admin/kbModelCatalogService';
import { asBoolean, asText, at, has, path, type JsonObject } from '../../../src/features/kb/logic/jsonNode';
import { KbModel } from '../../../src/features/kb/logic/types';

function probe(mode: string, ok: boolean, pending: boolean): JsonObject {
  const p: JsonObject = { mode, ok, toolCalling: ok ? 'yes' : 'no' };
  if (pending) p.pending = true;
  return p;
}

describe('KbProbeSelectionTest', () => {
  test('probesAreKeptPerModeWithTheLatestOnTop', () => {
    const afterSync = mergeProbe(null, probe('sync', true, false));
    const afterBatch = mergeProbe(afterSync, probe('batch', false, true));
    expect(asText(path(afterBatch, 'mode'))).toBe('batch'); // most recent on top
    expect(asBoolean(path(afterBatch, 'pending'))).toBe(true);
    expect(asBoolean(at(afterBatch, 'sync', 'ok'))).toBe(true);
    expect(asBoolean(at(afterBatch, 'batch', 'pending'))).toBe(true);
    expect(has(path(afterBatch, 'batch'), 'sync')).toBe(false);
    // A legacy single entry counts for its own mode.
    const legacy: JsonObject = { mode: 'sync', ok: true };
    const merged = mergeProbe(legacy, probe('batch', true, false));
    expect(asBoolean(at(merged, 'sync', 'ok'))).toBe(true);
    expect(asBoolean(at(merged, 'batch', 'ok'))).toBe(true);
  });

  test('selectableFollowsTheStageMode', () => {
    const luna = new KbModel('openai-gpt-6-luna', 'Luna', 'openai', true, true);
    expect(luna.modeFor('auto')).toBe('BATCH');
    expect(luna.modeFor('sync')).toBe('SYNC');
    luna.lastProbe = mergeProbe(mergeProbe(null, probe('sync', true, false)), probe('batch', false, true));
    expect(luna.selectableIn('BATCH')).toBe(true); // pending batch probe: the sync probe decides
    expect(luna.selectableIn('SYNC')).toBe(true);
    luna.lastProbe = mergeProbe(luna.lastProbe, probe('batch', false, false));
    expect(luna.selectableIn('BATCH')).toBe(false); // batch probe failed
    expect(luna.selectableIn('SYNC')).toBe(true);

    const glm = new KbModel('glm-5.3', 'GLM', 'zhipu', false, true);
    expect(glm.modeFor('auto')).toBe('SYNC');
    glm.lastProbe = mergeProbe(null, probe('sync', true, false));
    expect(glm.selectableIn(glm.modeFor('auto'))).toBe(true);
    glm.enabled = false;
    expect(glm.selectableIn('SYNC')).toBe(false);
    expect(new KbModel('x', 'x', 'x', false, true).selectableIn('SYNC')).toBe(false);
  });
});
