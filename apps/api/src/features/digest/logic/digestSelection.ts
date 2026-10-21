// Port of apps/api/src/main/java/org/ceitba/api/service/digest/DigestSelection.java.
// The issue's content is the same for every recipient: every published article
// of the covered week, every event of the next week and the later ones
// announced in the covered week, from all organizations and org-less ones,
// minus staff exclusions.
import type { DigestCandidates, DigestShared } from './digestContent';

export function digestIncluded(candidates: DigestCandidates, excludedArticleIds: Iterable<string>,
                               excludedEventIds: Iterable<string>): DigestShared {
  const exA = new Set(excludedArticleIds);
  const exE = new Set(excludedEventIds);
  return {
    articles: candidates.articles.filter((a) => !exA.has(a.id)),
    events: candidates.events.filter((e) => !exE.has(e.id)),
  };
}
