package org.ceitba.api.repository.mail;

import org.ceitba.api.domain.mail.MailTrackingEvent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.UUID;

public interface MailTrackingEventRepository extends JpaRepository<MailTrackingEvent, Long> {

    // Unflagged clicks of a digest issue per link, grouped by url_key (the
    // URL without per-reader tokens): [url_key, label, unique, total].
    // Links < 1000 are the issue's shared ones (any delivery), the rest
    // belong to one delivery (MailLinkRewriter.PERSONAL_BASE).
    @Query(value = """
        SELECT l.url_key, MIN(l.label), COUNT(DISTINCT e.tracking_id), COUNT(*)
        FROM public.mail_tracking_event e
        JOIN public.digest_deliveries d ON d.tracking_id = e.tracking_id
        JOIN (
            SELECT CAST(NULL AS TEXT) AS tracking_id, il.link_id, il.url_key, il.label
            FROM public.digest_issue_links il WHERE il.issue_id = :issueId
            UNION ALL
            SELECT dl.tracking_id, dl.link_id, dl.url_key, dl.label
            FROM public.digest_delivery_links dl
            JOIN public.digest_deliveries dd ON dd.tracking_id = dl.tracking_id
            WHERE dd.issue_id = :issueId
        ) l ON l.link_id = e.link_id AND (l.tracking_id IS NULL OR l.tracking_id = e.tracking_id)
        WHERE d.issue_id = :issueId AND e.type = 'click' AND e.flagged = false
        GROUP BY l.url_key
        ORDER BY 3 DESC, 4 DESC, 1 ASC
        """, nativeQuery = true)
    List<Object[]> clicksByLink(@Param("issueId") UUID issueId);
}
