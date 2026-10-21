// Port of apps/api/src/test/java/org/ceitba/api/service/kb/admin/KbBatchProbeClassificationTest.java
// Only an explicit "no batch for this model/provider" decides batchSupported.
import { describe, expect, test } from 'bun:test';
import { batchUnsupported } from '../../../src/features/kb/logic/admin/kbModelCatalogService';

describe('KbBatchProbeClassificationTest', () => {
  test('explicitUnsupportedErrorsCount', () => {
    expect(batchUnsupported(400, '{"id":"model_not_supported","message":"model glm-5.3 is not supported"}')).toBe(true);
    expect(batchUnsupported(400, 'provider not supported for batch inference')).toBe(true);
    expect(batchUnsupported(422, 'Batch inference is not supported for this model')).toBe(true);
    expect(batchUnsupported(404, 'This model does not support batch requests')).toBe(true);
    expect(batchUnsupported(400, 'batches are unavailable for model x')).toBe(true);
  });

  test('otherFailuresDoNotDecideBatchSupport', () => {
    expect(batchUnsupported(400, 'POST /v1/batches/files -> 400: {"message": "file must have a .jsonl extension"}')).toBe(false);
    expect(batchUnsupported(402, '{"id": "Payment Required", "message": "This account has been blocked" }')).toBe(false);
    expect(batchUnsupported(401, 'invalid api key')).toBe(false);
    expect(batchUnsupported(429, 'rate limited')).toBe(false);
    expect(batchUnsupported(500, 'model not supported')).toBe(false);
    expect(batchUnsupported(400, 'invalid custom_id')).toBe(false);
    expect(batchUnsupported(400, null)).toBe(false);
  });
});
