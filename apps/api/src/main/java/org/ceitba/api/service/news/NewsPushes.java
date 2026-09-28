package org.ceitba.api.service.news;

import org.ceitba.api.domain.news.Article;
import org.ceitba.api.domain.news.NewsEvent;
import org.ceitba.api.domain.news.Organization;
import org.ceitba.api.service.push.PushMessage;
import org.ceitba.api.service.push.events.PushToOrgFollowers;

import java.util.Map;
import java.util.Optional;

// Follower notifications for newsletter content. The app deep-links on
// data.type ("article" | "event") + data.id; data.org is the org slug.
final class NewsPushes {

    static final String TYPE_ARTICLE = "article";
    static final String TYPE_EVENT   = "event";

    private NewsPushes() {}

    static Optional<PushToOrgFollowers> articlePublished(Article a) {
        return forOrg(a.getOrganization(), a.getTitle(), TYPE_ARTICLE, a.getId());
    }

    static Optional<PushToOrgFollowers> eventPublished(NewsEvent e) {
        return forOrg(e.getOrganization(), e.getTitle(), TYPE_EVENT, e.getId());
    }

    private static Optional<PushToOrgFollowers> forOrg(Organization org, String body, String type, String id) {
        if (org == null || body == null || body.isBlank()) return Optional.empty();
        var title = org.getName() != null && !org.getName().isBlank() ? org.getName() : org.getSlug();
        var message = new PushMessage(title, body,
            Map.of(PushMessage.TYPE, type, PushMessage.ID, id, "org", org.getSlug()));
        return Optional.of(new PushToOrgFollowers(org.getSlug(), message));
    }
}
