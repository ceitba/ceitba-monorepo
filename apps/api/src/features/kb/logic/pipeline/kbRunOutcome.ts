// Port of apps/api/src/main/java/org/ceitba/api/service/kb/pipeline/KbRunOutcome.java.
//
// Final status of a run that reached its end (pipeline: its subjects; eval:
// its configurations): FAILED when every one failed, PARTIAL when some did,
// SUCCEEDED otherwise (including when there was nothing to do).

/** partial: ones that finished with only part of their work: the run is at least PARTIAL. */
export function status(total: number, failed: number, partial = 0): 'SUCCEEDED' | 'PARTIAL' | 'FAILED' {
  let base: 'SUCCEEDED' | 'PARTIAL' | 'FAILED';
  if (total <= 0 || failed <= 0) base = 'SUCCEEDED';
  else base = failed >= total ? 'FAILED' : 'PARTIAL';
  return base === 'SUCCEEDED' && partial > 0 ? 'PARTIAL' : base;
}

/** SUCCEEDED or PARTIAL: the run finished and produced something. */
export function completed(s: string | null): boolean {
  return s === 'SUCCEEDED' || s === 'PARTIAL';
}
