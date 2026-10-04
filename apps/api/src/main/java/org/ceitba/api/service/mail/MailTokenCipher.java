package org.ceitba.api.service.mail;

import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;

// AES-256-GCM for OAuth refresh tokens at rest. Output: base64 of
// version(1) | iv(12) | ciphertext+tag. `aad` (the account email) is
// authenticated, so a ciphertext copied to another row does not decrypt.
// Key: MAIL_TOKEN_ENCRYPTION_KEY, 32 bytes in base64 (openssl rand -base64 32).
// Never log plaintexts or ciphertexts.
public class MailTokenCipher {

    private static final int VERSION = 1;
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    private final SecretKeySpec key;
    private final SecureRandom random = new SecureRandom();

    public MailTokenCipher(String base64Key) {
        byte[] raw;
        try {
            raw = Base64.getDecoder().decode(base64Key == null ? "" : base64Key.trim());
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException("MAIL_TOKEN_ENCRYPTION_KEY is not valid base64");
        }
        if (raw.length != 32) {
            throw new IllegalStateException("MAIL_TOKEN_ENCRYPTION_KEY must be 32 bytes in base64 "
                + "(openssl rand -base64 32)");
        }
        this.key = new SecretKeySpec(raw, "AES");
    }

    public String encrypt(String plaintext, String aad) {
        try {
            byte[] iv = new byte[IV_BYTES];
            random.nextBytes(iv);
            var cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, iv));
            cipher.updateAAD(aad(aad));
            byte[] ct = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            byte[] out = new byte[1 + IV_BYTES + ct.length];
            out[0] = VERSION;
            System.arraycopy(iv, 0, out, 1, IV_BYTES);
            System.arraycopy(ct, 0, out, 1 + IV_BYTES, ct.length);
            return Base64.getEncoder().encodeToString(out);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Could not encrypt the token", e);
        }
    }

    // Throws TokenDecryptionException on tampering, a wrong key or a wrong aad.
    public String decrypt(String encoded, String aad) {
        try {
            byte[] in = Base64.getDecoder().decode(encoded);
            if (in.length < 1 + IV_BYTES + TAG_BITS / 8 || in[0] != VERSION) {
                throw new TokenDecryptionException("Unsupported token format");
            }
            var cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, in, 1, IV_BYTES));
            cipher.updateAAD(aad(aad));
            byte[] pt = cipher.doFinal(in, 1 + IV_BYTES, in.length - 1 - IV_BYTES);
            return new String(pt, StandardCharsets.UTF_8);
        } catch (AEADBadTagException | IllegalArgumentException e) {
            throw new TokenDecryptionException("Stored token cannot be decrypted (tampered or wrong key)");
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Could not decrypt the token", e);
        }
    }

    private static byte[] aad(String aad) {
        return (aad == null ? "" : aad.toLowerCase(java.util.Locale.ROOT)).getBytes(StandardCharsets.UTF_8);
    }

    public static class TokenDecryptionException extends RuntimeException {
        public TokenDecryptionException(String message) { super(message); }
    }
}
