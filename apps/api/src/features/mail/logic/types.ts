// Shapes shared by the mail logic (service/mail records that cross classes).

/** MailSenderAccountService.Credentials */
export interface MailCredentials {
  accountId: number;
  email: string;
  refreshToken: string;
  /** The stored ciphertext (part of the access-token cache key). */
  tokenEnc: string;
}

/** GoogleMailOAuthClient.Tokens */
export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  idToken: string | null;
  scope: string | null;
  /** Seconds. */
  expiresIn: number;
}

/** GoogleMailOAuthClient.GoogleOAuthException */
export class GoogleOAuthError extends Error {
  constructor(readonly kind: 'INVALID_GRANT' | 'REJECTED' | 'TRANSPORT', message: string) {
    super(message);
  }
}
