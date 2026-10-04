package org.ceitba.api.service.digest;

import java.util.Collection;
import java.util.List;
import java.util.Set;

// Who sees what (docs/WEEKLY-DIGEST.md), pure so it is unit-testable:
//   articles: org-less (independent) ones for everyone, org ones only for
//             that org's followers
//   events:   only those of followed orgs
// minus whatever staff excluded from the issue.
public final class DigestSelection {

    private DigestSelection() {}

    // followed = null: as if the reader followed every org.
    public static DigestContent.Personal personalise(DigestContent.Candidates candidates,
                                                     Set<String> followed,
                                                     Collection<String> excludedArticleIds,
                                                     Collection<String> excludedEventIds,
                                                     List<DigestContent.Org> followedOrgs) {
        var exA = Set.copyOf(excludedArticleIds);
        var exE = Set.copyOf(excludedEventIds);
        var articles = candidates.articles().stream()
            .filter(a -> !exA.contains(a.id()))
            .filter(a -> a.organization() == null || followed == null || followed.contains(a.organization().slug()))
            .toList();
        var events = candidates.events().stream()
            .filter(e -> !exE.contains(e.id()))
            .filter(e -> e.organization() != null
                && (followed == null || followed.contains(e.organization().slug())))
            .toList();
        return new DigestContent.Personal(articles, events, followedOrgs);
    }
}
