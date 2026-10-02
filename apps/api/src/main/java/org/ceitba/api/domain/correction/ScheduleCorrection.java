package org.ceitba.api.domain.correction;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

// A student-suggested correction of a commission's weekly slots (V30).
// State transitions live in ScheduleCorrectionService; every write happens
// under a row lock on the parent commission.
@Entity
@Table(schema = "public", name = "schedule_correction")
public class ScheduleCorrection {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "commission_id", nullable = false, length = 20)
    private String commissionId;

    // Never exposed by any response; nullable after account deletion.
    @Column(name = "suggester_id")
    private UUID suggesterId;

    // Normalized (sorted) slots; see CorrectionSlot.
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "proposed_slots", columnDefinition = "jsonb", nullable = false)
    private List<CorrectionSlot> proposedSlots;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "sga_snapshot", columnDefinition = "jsonb", nullable = false)
    private List<CorrectionSlot> sgaSnapshot;

    @Column(name = "slots_key", nullable = false, columnDefinition = "text")
    private String slotsKey;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private ScheduleCorrectionStatus status = ScheduleCorrectionStatus.PENDING;

    @Column(name = "confirm_count", nullable = false)
    private int confirmCount;

    @Column(name = "reject_count", nullable = false)
    private int rejectCount;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    @Column(name = "applied_at")
    private OffsetDateTime appliedAt;

    @Column(name = "reviewed_at")
    private OffsetDateTime reviewedAt;

    @Column(name = "reviewed_by")
    private UUID reviewedBy;

    @Column(name = "reviewed_by_staff", nullable = false)
    private boolean reviewedByStaff;

    @Column(name = "seen_at")
    private OffsetDateTime seenAt;

    protected ScheduleCorrection() {}

    public ScheduleCorrection(String commissionId, UUID suggesterId, List<CorrectionSlot> proposedSlots,
                              List<CorrectionSlot> sgaSnapshot, String slotsKey) {
        this.commissionId = commissionId;
        this.suggesterId = suggesterId;
        this.proposedSlots = List.copyOf(proposedSlots);
        this.sgaSnapshot = List.copyOf(sgaSnapshot);
        this.slotsKey = slotsKey;
    }

    public UUID getId() { return id; }
    public String getCommissionId() { return commissionId; }
    public UUID getSuggesterId() { return suggesterId; }
    public List<CorrectionSlot> getProposedSlots() { return proposedSlots; }
    public List<CorrectionSlot> getSgaSnapshot() { return sgaSnapshot; }
    public String getSlotsKey() { return slotsKey; }
    public ScheduleCorrectionStatus getStatus() { return status; }
    public int getConfirmCount() { return confirmCount; }
    public int getRejectCount() { return rejectCount; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getAppliedAt() { return appliedAt; }
    public OffsetDateTime getReviewedAt() { return reviewedAt; }
    public UUID getReviewedBy() { return reviewedBy; }
    public boolean isReviewedByStaff() { return reviewedByStaff; }
    public OffsetDateTime getSeenAt() { return seenAt; }

    public void setStatus(ScheduleCorrectionStatus status) { this.status = status; }
    public void setAppliedAt(OffsetDateTime appliedAt) { this.appliedAt = appliedAt; }
    public void setSeenAt(OffsetDateTime seenAt) { this.seenAt = seenAt; }

    public void setCounts(int confirms, int rejects) {
        this.confirmCount = confirms;
        this.rejectCount = rejects;
    }

    public void markReviewed(UUID staffUserId, OffsetDateTime at) {
        this.reviewedBy = staffUserId;
        this.reviewedAt = at;
        this.reviewedByStaff = true;
    }
}
