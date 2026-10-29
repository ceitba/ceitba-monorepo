// web/sync/DataSyncController. Every route is ROLE_SYNC (policy URL rule /v1/sync/**).

import { defineRoutes } from '../../http/router';
import { MalformedBodyError, ValidationError } from '../../http/errors';
import { jv, param } from '../../http/validation';
import { PERIODS, type CommissionQuery } from '../../external/itba';
import { javaIsBlank, javaTrim } from '../../lib/javaCompat';
import { DataSyncService } from './dataSync';
import { dataSyncResultJson } from './dto';
import { FirestoreImportService, importResponse, type FirestoreExport } from './firestoreImport';
import { BULK_MAX_BODY_BYTES } from '../../http/body';

// web/sync/dto/FirestoreExport (bound without @Valid; unknown properties ignored).
const FirestoreUserDoc = jv.object({
  id: jv.string(), email: jv.string(), name: jv.string(), degree: jv.string(), plan: jv.string(), moderator: jv.bool(),
  socialMedia: jv.object({ linkedin: jv.string(), instagram: jv.string(), discord: jv.string() }),
});
const FirestoreBenefitDoc = jv.object({
  id: jv.string(), title: jv.string(), category: jv.string(), tags: jv.list(jv.string()), imageUrl: jv.string(),
  // @JsonFormat(ACCEPT_SINGLE_VALUE_AS_ARRAY) List<String>: normalized in toExport().
  description: jv.json(),
  location: jv.string(), locationUrl: jv.string(), inscriptionUrl: jv.string(), phone: jv.string(), website: jv.string(), email: jv.string(),
});
const FirestoreExportBody = jv.object({
  usuarios: jv.list(FirestoreUserDoc),
  propuestas: jv.list(jv.map(jv.json())),
  benefits: jv.list(FirestoreBenefitDoc),
});

/** Jackson's List<String> with a lone value accepted: scalars coerce to their text, anything else is a bind failure. */
function stringList(v: unknown): (string | null)[] | null {
  if (v === null || v === undefined) return null;
  const items = Array.isArray(v) ? v : [v];
  return items.map((x) => {
    if (x === null) return null;
    if (typeof x === 'string') return x;
    if (typeof x === 'number' || typeof x === 'boolean') return String(x);
    throw new MalformedBodyError();
  });
}

function toExport(body: unknown): FirestoreExport {
  const b = body as { usuarios: unknown[] | null; propuestas: unknown[] | null; benefits: (Record<string, unknown> | null)[] | null };
  return {
    usuarios: b.usuarios as FirestoreExport['usuarios'],
    propuestas: b.propuestas as FirestoreExport['propuestas'],
    benefits: b.benefits === null ? null : b.benefits.map((d) => (d === null ? null : { ...d, description: stringList(d.description) } as never)),
  };
}


/** buildQuery(year, period, levels): null when nothing is given (the service fills defaults). */
export function buildQuery(year: number | null, period: string | null, levels: string | null): CommissionQuery | null {
  if (year === null && period === null && (levels === null || javaIsBlank(levels))) return null;
  // Stored on every synced commission (term_period): reject what ITBA wouldn't send back.
  if (period !== null && !PERIODS.includes(period)) throw new ValidationError('period', period, `must be one of [${PERIODS.join(', ')}]`);
  // Stored as SMALLINT (term_year).
  if (year !== null && (year < 2000 || year > 2999)) throw new ValidationError('year', year, 'must be between 2000 and 2999');
  let levelList: string[] | null = null;
  if (levels !== null && !javaIsBlank(levels)) {
    levelList = levels.split(',').map(javaTrim).filter((l) => l === 'GRADUATE' || l === 'UNDERGRADUATE');
  }
  return { year, period, levels: levelList };
}

export default defineRoutes((r, deps) => {
  const svc = new DataSyncService(deps);
  const firestore = new FirestoreImportService(deps);
  const tags = ['Data Sync'];
  const termQuery = { year: param.int({ required: false }), period: param.string({ required: false }), levels: param.string({ required: false }) };

  r.post('/v1/sync/all', { tags, summary: 'Manually trigger full data synchronization', query: termQuery },
    async ({ query }) => dataSyncResultJson(await svc.syncAll(buildQuery(query.year, query.period, query.levels))));
  r.post('/v1/sync/subjects', { tags, summary: 'Manually trigger subjects synchronization' },
    async () => dataSyncResultJson(await svc.syncSubjectsAndPlansOnly()));
  r.post('/v1/sync/commissions', { tags, summary: 'Manually trigger commissions synchronization', query: termQuery },
    async ({ query }) => dataSyncResultJson(await svc.syncCommissionsOnly(buildQuery(query.year, query.period, query.levels))));
  r.post('/v1/sync/plan/{planId}/subjects', { tags, summary: 'Sync subjects for a specific plan', params: { planId: param.string() } },
    ({ params }) => svc.syncByPlan(params.planId!));
  r.post('/v1/sync/subject/{subjectCode}/commissions', { tags, summary: 'Sync commissions for a specific subject', params: { subjectCode: param.string() }, query: termQuery },
    ({ params, query }) => svc.syncCommissionsBySubject(params.subjectCode!, buildQuery(query.year, query.period, query.levels)));
  // One-time migration of the legacy Firestore project; dryRun=true runs every document and rolls it back.
  r.post('/v1/sync/import/firestore', {
    tags, summary: 'Import a legacy Firestore export (Usuarios, Benefits, Propuestas)',
    body: FirestoreExportBody, bodyValidation: 'bindOnly', maxBodyBytes: BULK_MAX_BODY_BYTES, query: { dryRun: param.bool({ def: false }) }, argOrder: ['body', 'query'],
  }, async ({ body, query }) => importResponse(await firestore.importExport(toExport(body), query.dryRun!)));
});
