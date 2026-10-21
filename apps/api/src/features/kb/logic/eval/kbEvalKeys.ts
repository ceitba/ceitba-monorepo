// KbEvalService.configKey / pageKey (apps/api/src/main/java/org/ceitba/api/service/kb/eval/KbEvalService.java).
// The rest of KbEvalService (eval runs, stored pages, results, metrics) is kb-admin/evals.ts.

export function configKey(plan: string, planEffort: string | null, write: string, writeEffort: string | null): string {
  return plan + (planEffort == null ? '' : '@' + planEffort) + '|' + write + (writeEffort == null ? '' : '@' + writeEffort);
}

export function pageKey(evalId: string, key: string, subjectId: string, slug: string): string {
  return 'kb/evals/' + evalId + '/' + key.replaceAll('|', '__').replaceAll('@', '_at_') + '/' + subjectId + '/' + slug + '.md';
}
