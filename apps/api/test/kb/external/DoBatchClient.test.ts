// Port of apps/api/src/test/java/org/ceitba/api/external/llm/DoBatchClientTest.java
import { describe, expect, test } from 'bun:test';
import { info, jsonlFileName, resultsOf } from '../../../src/features/kb/logic/external/doBatchClient';
import { readTree } from '../../../src/features/kb/logic/jsonNode';

describe('DoBatchClientTest', () => {
  test('batchFileNamesAlwaysEndInJsonl', () => {
    expect(jsonlFileName('probe-anthropic-claude-haiku-4.5')).toBe('probe-anthropic-claude-haiku-4.5.jsonl');
    expect(jsonlFileName('run-1/DIGEST.jsonl')).toBe('run-1-DIGEST.jsonl');
    expect(jsonlFileName(' ')).toBe('batch.jsonl');
    expect(jsonlFileName(null)).toBe('batch.jsonl');
  });

  test('completedWithoutResultsYetIsStillFinalizing', () => {
    const early = info(readTree('{"batch_id":"b","status":"completed","result_available":false}'));
    expect(early.status).toBe('finalizing');
    expect(early.finished()).toBe(false);
    const ready = info(readTree('{"batch_id":"b","status":"completed","result_available":true}'));
    expect(ready.finished()).toBe(true);
  });

  test('resultsReadDosDownloadShape', () => {
    const r = resultsOf(readTree('{"result_available":true,"download":{"presigned_url":"https://x/out.jsonl","expires_at":"t"}}'));
    expect(r.available).toBe(true);
    expect(r.outputFileUrl).toBe('https://x/out.jsonl');
    const openai = resultsOf(readTree('{"output_file_url":"https://y/o","error_file_url":"https://y/e"}'));
    expect(openai.outputFileUrl).toBe('https://y/o');
    expect(openai.errorFileUrl).toBe('https://y/e');
  });
});
