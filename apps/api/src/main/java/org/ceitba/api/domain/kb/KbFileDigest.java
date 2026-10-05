package org.ceitba.api.domain.kb;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;
import java.util.UUID;

// The digest of one file content version (V35): once it exists, that
// content is never sent to the LLM again (unless prompt_version changes).
@Entity
@Table(schema = "wiki", name = "kb_file_digest")
public class KbFileDigest {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(name = "file_id")
    private UUID fileId;

    @Column(name = "content_fingerprint", nullable = false, length = 64)
    private String contentFingerprint;

    @Column(name = "prompt_version", nullable = false, length = 16)
    private String promptVersion;

    @Column(nullable = false, length = 128)
    private String model;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(columnDefinition = "jsonb", nullable = false)
    private JsonNode digest;

    @Column(name = "tokens_in", nullable = false)
    private int tokensIn;

    @Column(name = "tokens_out", nullable = false)
    private int tokensOut;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    protected KbFileDigest() {}

    public KbFileDigest(UUID fileId, String contentFingerprint, String promptVersion, String model, JsonNode digest,
                        int tokensIn, int tokensOut) {
        this.fileId = fileId;
        this.contentFingerprint = contentFingerprint;
        this.promptVersion = promptVersion;
        this.model = model;
        this.digest = digest;
        this.tokensIn = tokensIn;
        this.tokensOut = tokensOut;
    }

    public UUID getId() { return id; }
    public UUID getFileId() { return fileId; }
    public String getContentFingerprint() { return contentFingerprint; }
    public String getPromptVersion() { return promptVersion; }
    public JsonNode getDigest() { return digest; }

    // Merged from only some of the file's chunks (the rest failed): the next
    // run digests the file again.
    public boolean isPartial() { return digest != null && digest.path("partial").asBoolean(false); }

    public void replace(String model, JsonNode digest, int tokensIn, int tokensOut) {
        this.model = model;
        this.digest = digest;
        this.tokensIn = tokensIn;
        this.tokensOut = tokensOut;
    }
}
