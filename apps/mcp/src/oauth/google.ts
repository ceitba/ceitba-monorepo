// Google sign-in for the OAuth bridge (authorization code flow, server side).
// We only need the ID token: the CEITBA API verifies it (signature, aud in
// AUTH_GOOGLE_MOBILE_AUDIENCES, nonce, allowlist) at POST /v1/auth/google/mobile.

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  hostedDomain?: string;
}

export interface GoogleClient {
  authorizationUrl(state: string, nonce: string): string;
  exchangeCode(code: string): Promise<string>;
}

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export function googleClient(cfg: GoogleConfig, fetchImpl: typeof fetch = fetch): GoogleClient {
  return {
    authorizationUrl(state, nonce) {
      const u = new URL(AUTH_URL);
      u.searchParams.set("client_id", cfg.clientId);
      u.searchParams.set("redirect_uri", cfg.redirectUri);
      u.searchParams.set("response_type", "code");
      u.searchParams.set("scope", "openid email profile");
      u.searchParams.set("state", state);
      u.searchParams.set("nonce", nonce);
      u.searchParams.set("prompt", "select_account");
      if (cfg.hostedDomain) u.searchParams.set("hd", cfg.hostedDomain);
      return u.toString();
    },
    async exchangeCode(code) {
      const res = await fetchImpl(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          redirect_uri: cfg.redirectUri,
          grant_type: "authorization_code"
        }),
        signal: AbortSignal.timeout(15_000)
      });
      const body = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string };
      if (!res.ok || !body.id_token) throw new Error(`Google token exchange failed: ${body.error ?? res.status}`);
      return body.id_token;
    }
  };
}
