// TestGoogleIdTokens: "Google" ID tokens signed with a local RSA key, verified
// by the real JwksGoogleIdTokenVerifier wired to that key instead of Google's JWKS.

import { generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import type { AuthConfig } from '../../src/config/sections/auth';
import { JwksGoogleIdTokenVerifier } from '../../src/external/google';

export const WEB_CLIENT = 'test-web-client.apps.googleusercontent.com';
export const IOS_CLIENT = 'test-ios-client.apps.googleusercontent.com';

const keys = await generateKeyPair('RS256');

export async function googleToken(email: string, customize: (claims: JWTPayload) => void = () => {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: JWTPayload = {
    iss: 'https://accounts.google.com', aud: WEB_CLIENT, sub: `google-${email}`, email, email_verified: true,
    name: `Test ${email}`, picture: `https://example.com/${email}.png`, iat: now, exp: now + 3600,
  };
  customize(claims);
  return new SignJWT(claims).setProtectedHeader({ alg: 'RS256' }).sign(keys.privateKey);
}

export const localKeyVerifier = (auth: AuthConfig) => new JwksGoogleIdTokenVerifier(auth, keys.publicKey);
