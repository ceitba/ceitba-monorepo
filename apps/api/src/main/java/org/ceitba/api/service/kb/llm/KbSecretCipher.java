package org.ceitba.api.service.kb.llm;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;

// AES-256-GCM for secrets stored in the database (custom endpoint API keys).
// Key source: KB_SECRETS_KEY (optional override, base64 of 32 bytes) when set,
// else HKDF-SHA256(AUTH_JWT_SECRET, info "ceitba-kb-endpoint-keys-v1"), so no
// extra setup is needed and the JWT key itself is never used.
// Stored form: "v1:<env|jwt>:" + base64(iv(12) || ciphertext || tag). The
// prefix says which source encrypted it, so setting KB_SECRETS_KEY later keeps
// old values readable. Rotating the key source makes old values unreadable
// (KeyUnreadableException): the owner must re-enter them. Never logs plaintext.
@Component
public class KbSecretCipher {

    public static final class KeyUnreadableException extends IllegalStateException {
        public KeyUnreadableException() {
            super("The stored API key cannot be decrypted (AUTH_JWT_SECRET or KB_SECRETS_KEY changed): re-enter the token");
        }
    }

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final byte[] INFO = "ceitba-kb-endpoint-keys-v1".getBytes(StandardCharsets.UTF_8);

    private final SecretKeySpec envKey;
    private final SecretKeySpec jwtKey;

    @Autowired
    public KbSecretCipher(@Value("${kb.secrets.key:}") String base64Key,
                          @Value("${auth.jwt.secret:}") String jwtSecret) {
        this.envKey = parse(base64Key);
        this.jwtKey = jwtSecret == null || jwtSecret.isBlank() ? null : hkdf(jwtSecret.getBytes(StandardCharsets.UTF_8));
    }

    private static SecretKeySpec parse(String base64Key) {
        if (base64Key == null || base64Key.isBlank()) return null;
        try {
            var raw = Base64.getDecoder().decode(base64Key.trim());
            return raw.length == 32 ? new SecretKeySpec(raw, "AES") : null;
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    // HKDF-SHA256 (RFC 5869), empty salt, one 32-byte block.
    private static SecretKeySpec hkdf(byte[] ikm) {
        try {
            var mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(new byte[32], "HmacSHA256"));
            var prk = mac.doFinal(ikm);
            mac.init(new SecretKeySpec(prk, "HmacSHA256"));
            mac.update(INFO);
            mac.update((byte) 1);
            return new SecretKeySpec(mac.doFinal(), "AES");
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    public String encrypt(String plain) {
        var source = envKey != null ? "env" : "jwt";
        var key = envKey != null ? envKey : jwtKey;
        if (key == null) throw new IllegalStateException("No encryption key available (AUTH_JWT_SECRET is empty)");
        try {
            var iv = new byte[12];
            RANDOM.nextBytes(iv);
            var c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, iv));
            var ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
            var out = new byte[iv.length + ct.length];
            System.arraycopy(iv, 0, out, 0, iv.length);
            System.arraycopy(ct, 0, out, iv.length, ct.length);
            return "v1:" + source + ":" + Base64.getEncoder().encodeToString(out);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("could not encrypt the secret", e);
        }
    }

    // null when nothing is stored; KeyUnreadableException when it cannot be decrypted.
    public String decrypt(String stored) {
        if (stored == null || stored.isBlank()) return null;
        var parts = stored.split(":", 3);
        if (parts.length != 3 || !parts[0].equals("v1")) throw new KeyUnreadableException();
        var key = switch (parts[1]) {
            case "env" -> envKey;
            case "jwt" -> jwtKey;
            default -> null;
        };
        if (key == null) throw new KeyUnreadableException();
        try {
            var in = Base64.getDecoder().decode(parts[2]);
            var c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, in, 0, 12));
            return new String(c.doFinal(in, 12, in.length - 12), StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IllegalArgumentException e) {
            throw new KeyUnreadableException();
        }
    }

    public boolean readable(String stored) {
        if (stored == null || stored.isBlank()) return true;
        try {
            decrypt(stored);
            return true;
        } catch (KeyUnreadableException e) {
            return false;
        }
    }
}
