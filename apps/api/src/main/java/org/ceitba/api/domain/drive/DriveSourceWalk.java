package org.ceitba.api.domain.drive;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

// The resumable walk of one source (V42): the current generation and the
// folders still to list. Written by DriveSyncStore only.
@Entity
@Table(schema = "wiki", name = "drive_source_walk")
public class DriveSourceWalk {

    @Id
    @Column(name = "source_id")
    private UUID sourceId;

    @Column(nullable = false)
    private long generation;

    @Column(name = "started_at", nullable = false)
    private OffsetDateTime startedAt;

    @Column(name = "completed_at")
    private OffsetDateTime completedAt;

    // "<depth>/<drive folder id>", in BFS order.
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private List<String> frontier = new ArrayList<>();

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "root_ancestors", columnDefinition = "jsonb", nullable = false)
    private List<String> rootAncestors = new ArrayList<>();

    // Something was skipped in this generation (a folder vanished mid-walk,
    // a cap was hit): completing it removes nothing.
    @Column(nullable = false)
    private boolean incomplete;

    @Column(columnDefinition = "text")
    private String warning;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected DriveSourceWalk() {}

    public DriveSourceWalk(UUID sourceId) {
        this.sourceId = sourceId;
    }

    public boolean isCompleted() { return completedAt != null; }

    // A new generation from the root.
    public void start(long generation, OffsetDateTime at, List<String> frontier, List<String> rootAncestors) {
        this.generation = generation;
        this.startedAt = at;
        this.completedAt = null;
        this.frontier = new ArrayList<>(frontier);
        this.rootAncestors = new ArrayList<>(rootAncestors);
        this.incomplete = false;
        this.warning = null;
    }

    public UUID getSourceId() { return sourceId; }
    public long getGeneration() { return generation; }
    public OffsetDateTime getStartedAt() { return startedAt; }
    public OffsetDateTime getCompletedAt() { return completedAt; }
    public List<String> getFrontier() { return frontier == null ? List.of() : List.copyOf(frontier); }
    public List<String> getRootAncestors() { return rootAncestors == null ? List.of() : List.copyOf(rootAncestors); }
    public boolean isIncomplete() { return incomplete; }
    public String getWarning() { return warning; }

    public void setFrontier(List<String> frontier) { this.frontier = new ArrayList<>(frontier); }
    public void setCompletedAt(OffsetDateTime at) { this.completedAt = at; }
    public void markIncomplete(String warning) {
        this.incomplete = true;
        if (warning != null) this.warning = warning;
    }
}
