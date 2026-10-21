// Jackson shape of service/sync/DataSyncResult, verified on the jar: only the
// getters (getTotalProcessed, getDuration) and the @JsonProperty field
// (subjectPlans) are serialized; subjects()/commissions() are record-style
// accessors on a plain class, which Jackson does not see.

import type { DataSyncResult } from './dataSync';

export function dataSyncResultJson(r: DataSyncResult) {
  return {
    totalProcessed: r.totalProcessed,
    duration: r.duration,
    subjectPlans: { created: r.subjectPlans.created, updated: r.subjectPlans.updated, errors: r.subjectPlans.errors },
  };
}
