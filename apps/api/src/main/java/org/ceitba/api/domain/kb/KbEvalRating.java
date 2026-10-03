package org.ceitba.api.domain.kb;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;
import java.util.UUID;

// A blind A/B pair served to a reviewer, completed by their rating (V35).
// configA/configB are the configuration keys behind labels A and B;
// winner is a configuration key, "tie", or null while pending.
@Entity
@Table(schema = "wiki", name = "kb_eval_rating")
public class KbEvalRating {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "eval_id", nullable = false)
    private UUID evalId;

    @Column(name = "subject_id", nullable = false, length = 25)
    private String subjectId;

    @Column(nullable = false, length = 128)
    private String slug;

    @Column(name = "config_a", nullable = false, length = 300)
    private String configA;

    @Column(name = "config_b", nullable = false, length = 300)
    private String configB;

    @Column(name = "reviewer_id", nullable = false)
    private UUID reviewerId;

    @Column(length = 300)
    private String winner;

    @Column(name = "accuracy_a") private Short accuracyA;
    @Column(name = "clarity_a") private Short clarityA;
    @Column(name = "usefulness_a") private Short usefulnessA;
    @Column(name = "accuracy_b") private Short accuracyB;
    @Column(name = "clarity_b") private Short clarityB;
    @Column(name = "usefulness_b") private Short usefulnessB;

    @Column(columnDefinition = "text")
    private String comment;

    @Column(name = "assigned_at", nullable = false)
    private OffsetDateTime assignedAt;

    @Column(name = "rated_at")
    private OffsetDateTime ratedAt;

    protected KbEvalRating() {}

    public KbEvalRating(UUID evalId, String subjectId, String slug, String configA, String configB, UUID reviewerId,
                        OffsetDateTime at) {
        this.evalId = evalId;
        this.subjectId = subjectId;
        this.slug = slug;
        this.configA = configA;
        this.configB = configB;
        this.reviewerId = reviewerId;
        this.assignedAt = at;
    }

    public void rate(String winner, Short[] a, Short[] b, String comment, OffsetDateTime at) {
        this.winner = winner;
        if (a != null) { accuracyA = a[0]; clarityA = a[1]; usefulnessA = a[2]; }
        if (b != null) { accuracyB = b[0]; clarityB = b[1]; usefulnessB = b[2]; }
        this.comment = comment;
        this.ratedAt = at;
    }

    public UUID getId() { return id; }
    public UUID getEvalId() { return evalId; }
    public String getSubjectId() { return subjectId; }
    public String getSlug() { return slug; }
    public String getConfigA() { return configA; }
    public String getConfigB() { return configB; }
    public UUID getReviewerId() { return reviewerId; }
    public String getWinner() { return winner; }
    public Short getAccuracyA() { return accuracyA; }
    public Short getClarityA() { return clarityA; }
    public Short getUsefulnessA() { return usefulnessA; }
    public Short getAccuracyB() { return accuracyB; }
    public Short getClarityB() { return clarityB; }
    public Short getUsefulnessB() { return usefulnessB; }
    public OffsetDateTime getRatedAt() { return ratedAt; }
    public boolean isRated() { return ratedAt != null; }
}
