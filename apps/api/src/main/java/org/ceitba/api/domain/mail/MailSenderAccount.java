package org.ceitba.api.domain.mail;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.OffsetDateTime;
import java.util.UUID;

// A Google account connected over OAuth to send mail (Gmail API). The refresh
// token is stored AES-GCM encrypted (MailTokenCipher); nothing here is ever
// returned by the API.
@Entity
@Table(schema = "public", name = "mail_sender_account")
public class MailSenderAccount {

    public static final String OWNER_CEITBA = "ceitba";
    public static final String OWNER_ORGANIZATION = "organization";
    public static final String CONNECTED = "connected";
    public static final String BROKEN = "broken";
    public static final String REVOKED = "revoked";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String email;

    @Column(name = "owner_type", nullable = false)
    private String ownerType;

    @Column(name = "owner_ref")
    private String ownerRef;

    @Column(name = "refresh_token_enc", nullable = false)
    private String refreshTokenEnc;

    @Column(nullable = false)
    private String scopes;

    @Column(nullable = false)
    private String status;

    @Column(name = "connected_by")
    private UUID connectedBy;

    @Column(name = "connected_at", nullable = false)
    private OffsetDateTime connectedAt;

    @Column(name = "last_error")
    private String lastError;

    @Column(name = "last_used_at")
    private OffsetDateTime lastUsedAt;

    protected MailSenderAccount() {}

    public MailSenderAccount(String email, String ownerType, String ownerRef, String refreshTokenEnc,
                             String scopes, UUID connectedBy, OffsetDateTime now) {
        this.email = email;
        this.ownerType = ownerType;
        this.ownerRef = ownerRef;
        connect(refreshTokenEnc, scopes, connectedBy, now);
    }

    // (Re)connection: new token, healthy again.
    public void connect(String refreshTokenEnc, String scopes, UUID connectedBy, OffsetDateTime now) {
        this.refreshTokenEnc = refreshTokenEnc;
        this.scopes = scopes;
        this.connectedBy = connectedBy;
        this.connectedAt = now;
        this.status = CONNECTED;
        this.lastError = null;
    }

    public void markBroken(String error) {
        this.status = BROKEN;
        this.lastError = error;
    }

    public void markUsed(OffsetDateTime now) { this.lastUsedAt = now; }

    public Long getId() { return id; }
    public String getEmail() { return email; }
    public String getOwnerType() { return ownerType; }
    public String getOwnerRef() { return ownerRef; }
    public String getRefreshTokenEnc() { return refreshTokenEnc; }
    public String getScopes() { return scopes; }
    public String getStatus() { return status; }
    public UUID getConnectedBy() { return connectedBy; }
    public OffsetDateTime getConnectedAt() { return connectedAt; }
    public String getLastError() { return lastError; }
    public OffsetDateTime getLastUsedAt() { return lastUsedAt; }
}
