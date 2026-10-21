// Port of apps/api/src/main/java/org/ceitba/api/external/llm/DoBatchErrors.java.
//
// What a DigitalOcean batch error means for the caller.
//   RATE_LIMITED       429 / rate_limit_exceeded (batch_create_per_minute,
//                      batch_creations_per_hour): retry later, never fatal
//   UNSUPPORTED_MODEL  the JSONL's model id (or the model/provider) has no
//                      batch support, e.g. DO's validation failure
//   TRANSIENT          no response or 5xx: retry later
//   REJECTED           any other refusal (bad request, auth, account)

export type Kind = 'RATE_LIMITED' | 'UNSUPPORTED_MODEL' | 'TRANSIENT' | 'REJECTED';

// CASE_INSENSITIVE (ASCII): JS `i` without `u`. Java counts {0,40} in code points, JS in UTF-16 units.
const UNSUPPORTED = new RegExp(
  'unsupported[_ -]model' +
    '|(model|provider)[_ -]?not[_ -]?supported' +
    "|(not|isn't|is not|un)[_ -]?(supported|available)[^.\\n]{0,40}\\bbatch" +
    "|\\bbatch(es|ing)?\\b[^.\\n]{0,60}(not|isn't|is not|un)[_ -]?(supported|available)" +
    "|does not support[^.\\n]{0,40}\\bbatch|doesn't support[^.\\n]{0,40}\\bbatch",
  'i',
);

/** An HTTP error of a batch call (status 0 = no response). */
export function classify(status: number, message: string | null): Kind {
  if (status === 429 || rateLimited(message)) return 'RATE_LIMITED';
  if (status === 0 || status >= 500) return 'TRANSIENT';
  if (status >= 400 && unsupportedModel(message)) return 'UNSUPPORTED_MODEL';
  return 'REJECTED';
}

/** The error_message of a batch DO reports as failed. */
export function classifyFailure(errorMessage: string | null): Kind {
  if (rateLimited(errorMessage)) return 'RATE_LIMITED';
  return unsupportedModel(errorMessage) ? 'UNSUPPORTED_MODEL' : 'REJECTED';
}

export function unsupportedModel(message: string | null): boolean {
  return message != null && UNSUPPORTED.test(message);
}

export function rateLimited(message: string | null): boolean {
  if (message == null) return false;
  const m = message.toLowerCase();
  return m.includes('rate_limit_exceeded') || m.includes('rate limit exceeded');
}
