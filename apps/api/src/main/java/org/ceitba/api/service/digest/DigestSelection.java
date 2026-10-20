package org.ceitba.api.service.digest;

import java.util.Collection;
import java.util.Set;

// The issue's content is the same for every recipient (docs/WEEKLY-DIGEST.md):
// every published article of the covered week, every event of the next week
// and the later ones announced in the covered week, from all organizations
// and org-less ones, minus staff exclusions.
public final class DigestSelection {

    private DigestSelection() {}

    public static DigestContent.Shared included(DigestContent.Candidates candidates,
                                                Collection<String> excludedArticleIds,
                                                Collection<String> excludedEventIds) {
        var exA = Set.copyOf(excludedArticleIds);
        var exE = Set.copyOf(excludedEventIds);
        return new DigestContent.Shared(
            candidates.articles().stream().filter(a -> !exA.contains(a.id())).toList(),
            candidates.events().stream().filter(e -> !exE.contains(e.id())).toList());
    }
}
