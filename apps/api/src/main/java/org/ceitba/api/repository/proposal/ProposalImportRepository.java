package org.ceitba.api.repository.proposal;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.Types;
import java.time.OffsetDateTime;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

// Writes behind the legacy Firestore proposal import
// (service/sync/ProposalFirestoreImporter). Plain JDBC on purpose: imported
// rows carry their own ids (derived from the Firestore document) and their
// original timestamps, which the JPA entities generate themselves, and many
// columns are legitimately NULL. Every insert is ON CONFLICT DO NOTHING so a
// re-run adds only what is missing and never overwrites rows that changed in
// the new system. Runs in the caller's transaction (the JPA transaction
// manager exposes its connection to JDBC). Timestamps are never null: the
// importer falls back to the proposal's (or the import's) time.
@Repository
public class ProposalImportRepository {

    private final NamedParameterJdbcTemplate jdbc;

    public ProposalImportRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // True when the row was inserted, false when the id already existed.
    public boolean insertProposal(UUID id, UUID authorId, String title, String description, String topic,
                                  String status, String lifecycle, String rejectionReason,
                                  UUID moderatedBy, OffsetDateTime createdAt) {
        var p = new MapSqlParameterSource()
            .addValue("id", id)
            .addValue("author", authorId, Types.OTHER)
            .addValue("title", title)
            .addValue("description", description)
            .addValue("topic", topic)
            .addValue("status", status)
            .addValue("lifecycle", lifecycle)
            .addValue("reason", rejectionReason, Types.VARCHAR)
            .addValue("mod", moderatedBy, Types.OTHER)
            .addValue("at", createdAt);
        return jdbc.update("""
            INSERT INTO public.proposal (id, author_id, title, description, topic, status, lifecycle,
                                         rejection_reason, moderated_by, created_at, updated_at)
            VALUES (:id, :author, :title, :description, :topic, :status, :lifecycle,
                    :reason, :mod, :at, :at)
            ON CONFLICT (id) DO NOTHING
            """, p) == 1;
    }

    public boolean proposalExists(UUID id) {
        return Boolean.TRUE.equals(jdbc.queryForObject(
            "SELECT EXISTS (SELECT 1 FROM public.proposal WHERE id = :id)", Map.of("id", id), Boolean.class));
    }

    // Serializes the import of one proposal with live vote/comment writes,
    // which lock the same row (ProposalRepository.findForUpdate).
    public void lockProposal(UUID id) {
        jdbc.query("SELECT id FROM public.proposal WHERE id = :id FOR UPDATE",
            Map.of("id", id), rs -> { });
    }

    // user_id -> alias for one proposal.
    public Map<UUID, String> aliases(UUID proposalId) {
        var out = new HashMap<UUID, String>();
        jdbc.query("SELECT user_id, alias FROM public.proposal_alias WHERE proposal_id = :p",
            Map.of("p", proposalId),
            rs -> { out.put(rs.getObject("user_id", UUID.class), rs.getString("alias")); });
        return out;
    }

    public boolean insertAlias(UUID proposalId, UUID userId, String alias) {
        return jdbc.update("""
            INSERT INTO public.proposal_alias (proposal_id, user_id, alias)
            VALUES (:p, :u, :alias)
            ON CONFLICT DO NOTHING
            """, Map.of("p", proposalId, "u", userId, "alias", alias)) == 1;
    }

    public boolean insertVote(UUID proposalId, UUID userId, String value, OffsetDateTime at) {
        var p = new MapSqlParameterSource()
            .addValue("p", proposalId)
            .addValue("u", userId)
            .addValue("value", value)
            .addValue("at", at);
        return jdbc.update("""
            INSERT INTO public.proposal_vote (proposal_id, user_id, value, created_at, updated_at)
            VALUES (:p, :u, :value, :at, :at)
            ON CONFLICT DO NOTHING
            """, p) == 1;
    }

    public boolean insertComment(UUID id, UUID proposalId, UUID authorId, UUID parentId, String body,
                                 OffsetDateTime at) {
        var p = new MapSqlParameterSource()
            .addValue("id", id)
            .addValue("p", proposalId)
            .addValue("author", authorId, Types.OTHER)
            .addValue("parent", parentId, Types.OTHER)
            .addValue("body", body)
            .addValue("at", at);
        return jdbc.update("""
            INSERT INTO public.proposal_comment (id, proposal_id, author_id, parent_id, body, created_at)
            VALUES (:id, :p, :author, :parent, :body, :at)
            ON CONFLICT (id) DO NOTHING
            """, p) == 1;
    }

    // A tombstone (deleted, no body, no author) that keeps legacy replies to a
    // blank comment attached to their thread.
    public boolean insertDeletedComment(UUID id, UUID proposalId, UUID parentId, OffsetDateTime at) {
        var p = new MapSqlParameterSource()
            .addValue("id", id)
            .addValue("p", proposalId)
            .addValue("parent", parentId, Types.OTHER)
            .addValue("at", at);
        return jdbc.update("""
            INSERT INTO public.proposal_comment (id, proposal_id, parent_id, body, created_at, deleted_at)
            VALUES (:id, :p, :parent, NULL, :at, :at)
            ON CONFLICT (id) DO NOTHING
            """, p) == 1;
    }

    // Skipped (false) when the position or the object key is already used.
    public boolean insertAttachment(UUID proposalId, int position, String objectKey, String contentType) {
        return jdbc.update("""
            INSERT INTO public.proposal_attachment (proposal_id, position, object_key, content_type)
            VALUES (:p, :pos, :key, :type)
            ON CONFLICT DO NOTHING
            """, Map.of("p", proposalId, "pos", position, "key", objectKey, "type", contentType)) == 1;
    }

    // Counters recomputed from the rows (same definition ProposalService
    // maintains incrementally: live comments include replies).
    public void recomputeCounters(UUID proposalId) {
        jdbc.update("""
            UPDATE public.proposal p SET
                up_count      = (SELECT count(*) FROM public.proposal_vote v
                                 WHERE v.proposal_id = p.id AND v.value = 'UP'),
                down_count    = (SELECT count(*) FROM public.proposal_vote v
                                 WHERE v.proposal_id = p.id AND v.value = 'DOWN'),
                comment_count = (SELECT count(*) FROM public.proposal_comment c
                                 WHERE c.proposal_id = p.id AND c.deleted_at IS NULL)
            WHERE p.id = :id
            """, Map.of("id", proposalId));
    }
}
