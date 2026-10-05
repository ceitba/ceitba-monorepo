package org.ceitba.api.domain.kb;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;
import java.util.UUID;

// A custom OpenAI-compatible LLM endpoint (V51). The key is stored encrypted
// and is write-only: nothing outside KbEndpointRegistry ever decrypts it.
@Entity
@Table(schema = "wiki", name = "kb_llm_endpoint")
public class KbLlmEndpoint {

    @Id
    private UUID id;

    @Column(nullable = false, length = 48)
    private String name;

    @Column(name = "base_url", nullable = false, length = 512)
    private String baseUrl;

    @Column(name = "api_key_encrypted", columnDefinition = "text")
    private String apiKeyEncrypted;

    @Column(name = "max_concurrency", nullable = false)
    private int maxConcurrency = 2;

    @Column(name = "timeout_sec", nullable = false)
    private int timeoutSec = 600;

    @Column(nullable = false)
    private boolean enabled = true;

    @Column(name = "created_by")
    private UUID createdBy;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    @Column(name = "updated_by")
    private UUID updatedBy;

    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    protected KbLlmEndpoint() {}

    public KbLlmEndpoint(String name, String baseUrl, UUID by, OffsetDateTime at) {
        this.id = UUID.randomUUID();
        this.name = name;
        this.baseUrl = baseUrl;
        this.createdBy = by;
        this.createdAt = at;
        this.updatedBy = by;
        this.updatedAt = at;
    }

    public void touch(UUID by, OffsetDateTime at) {
        this.updatedBy = by;
        this.updatedAt = at;
    }

    public UUID getId() { return id; }
    public String getName() { return name; }
    public String getBaseUrl() { return baseUrl; }
    public String getApiKeyEncrypted() { return apiKeyEncrypted; }
    public boolean hasKey() { return apiKeyEncrypted != null && !apiKeyEncrypted.isBlank(); }
    public int getMaxConcurrency() { return maxConcurrency; }
    public int getTimeoutSec() { return timeoutSec; }
    public boolean isEnabled() { return enabled; }
    public OffsetDateTime getCreatedAt() { return createdAt; }
    public OffsetDateTime getUpdatedAt() { return updatedAt; }

    public void setName(String v) { this.name = v; }
    public void setBaseUrl(String v) { this.baseUrl = v; }
    public void setApiKeyEncrypted(String v) { this.apiKeyEncrypted = v; }
    public void setMaxConcurrency(int v) { this.maxConcurrency = v; }
    public void setTimeoutSec(int v) { this.timeoutSec = v; }
    public void setEnabled(boolean v) { this.enabled = v; }
}
