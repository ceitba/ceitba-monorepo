// Port of apps/api/src/test/java/org/ceitba/api/external/llm/DoBatchErrorsTest.java
// Classification of DigitalOcean batch errors, on the exact strings DO returned.
import { describe, expect, test } from 'bun:test';
import { batchList, info } from '../../../src/features/kb/logic/external/doBatchClient';
import { classify, classifyFailure } from '../../../src/features/kb/logic/external/doBatchErrors';
import { asText, path, readTree } from '../../../src/features/kb/logic/jsonNode';

const VALIDATION =
  'JSONL model validation failed: 1 unsupported model(s), e.g. unsupported model ' +
  '"openai-gpt-6-luna": not available on DigitalOcean';
const RATE_LIMIT_BODY =
  '{"error":{"message":"Rate limit exceeded: batch_create_per_minute, ' +
  'batch_creations_per_hour.","type":"rate_limit_exceeded_error"}}';

describe('DoBatchErrorsTest', () => {
  test('validationFailureIsAnUnsupportedModel', () => {
    expect(classifyFailure(VALIDATION)).toBe('UNSUPPORTED_MODEL');
    expect(classify(400, VALIDATION)).toBe('UNSUPPORTED_MODEL');
  });

  test('rateLimitIsRetryableNotFatal', () => {
    expect(classify(429, 'POST /v1/batches -> 429: ' + RATE_LIMIT_BODY)).toBe('RATE_LIMITED');
    // Even when the status is lost, the body says so.
    expect(classify(400, RATE_LIMIT_BODY)).toBe('RATE_LIMITED');
  });

  test('otherErrors', () => {
    expect(classify(0, 'POST /v1/batches: timeout')).toBe('TRANSIENT');
    expect(classify(503, 'unavailable')).toBe('TRANSIENT');
    expect(classify(400, 'file must have a .jsonl extension')).toBe('REJECTED');
    expect(classify(401, 'invalid api key')).toBe('REJECTED');
    expect(classifyFailure('batch expired')).toBe('REJECTED');
    expect(classifyFailure(null)).toBe('REJECTED');
  });

  test('doBatchClientReadsErrorMessageAndTheEdgesList', () => {
    const failed = readTree(
      `{"id":"b-1","status":"failed","error_message":${JSON.stringify(VALIDATION)},"request_counts":{"total":0,"completed":0,"failed":0}}`,
    );
    const i = info(failed);
    expect(i.status).toBe('failed');
    expect(i.finished()).toBe(true);
    expect(i.errorMessage).toBe(VALIDATION);

    const list = readTree(`{"edges":[{"node":{"id":"b-1","request_id":"r:DIGEST:1:m","status":"in_progress"}},
                      {"node":{"id":"b-2","request_id":"other","status":"completed"}}],
             "page_info":{"has_next_page":false}}`);
    expect(batchList(list).map((n) => asText(path(n, 'id')))).toEqual(['b-1', 'b-2']);
    expect(info(readTree('{"id":"b","status":"COMPLETED"}')).errorMessage).toBeNull();
  });
});
